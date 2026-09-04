#!/usr/bin/env node
/**
 * Copies the built-in Egyptian formulary from the web app into the Android app.
 *
 *   node scripts/generate-android-drug-catalog.mjs      (or: npm run gen:android-drugs)
 *
 * The two surfaces cannot keep separate lists. A clinic that renames Augmentin stores one Firestore
 * row carrying `catalogId: "augmentin_1g"`, and both the website and the phone have to resolve that
 * id to the same drug — so the ids, and everything hanging off them, have to be one authored set.
 * Kotlin cannot read a TypeScript module, so the list is copied rather than shared, and copying it
 * by hand is how the two quietly drift apart. This script is the copy.
 *
 * It reads src/lib/drugCatalog.ts, which is the source of truth and the only file anyone edits,
 * and rewrites DrugCatalog.kt from it. The parse is deliberately literal: the two exported arrays
 * are plain JS object literals, so they are lifted out by scanning for balanced brackets (skipping
 * strings and comments) and evaluated. Nothing here understands TypeScript, so nothing here breaks
 * when the *types* in that file change — only a change to the two array literals matters.
 *
 * The output is written as UTF-8 with CRLF endings, matching the rest of the repo, so re-running it
 * on an unchanged catalog produces an empty diff.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "src", "lib", "drugCatalog.ts");
const TARGET = join(
  ROOT,
  "android", "app", "src", "main", "java", "com", "alphadental", "clinic", "data", "DrugCatalog.kt"
);

/** Path as it should read in a generated header — forward slashes on every platform. */
const posix = (p) => relative(ROOT, p).split("\\").join("/");

/**
 * Lifts one `export const NAME: Type = [ ... ]` array literal out of the source text.
 *
 * Bracket counting alone would stop early on a `]` inside a string and a `[` inside a comment, and
 * the catalog has both, so the scanner tracks which of those it is inside. Brackets, braces and
 * parens all count towards the same depth: any of them closing back to zero is the end of the
 * literal, and an unbalanced one is a syntax error the TypeScript build would have caught first.
 */
function extractArrayLiteral(source, declaration) {
  const at = source.indexOf(declaration);
  if (at < 0) throw new Error(`Could not find "${declaration}" in ${posix(SOURCE)}`);

  // Step past the type annotation before hunting for the opening bracket. `: CatalogDrug[] = [`
  // puts an empty pair of brackets between the name and the array, so stopping at the first `[`
  // lifts *that* pair — a well-formed empty list, from a scan that reports no error at all.
  const assign = source.indexOf("=", at + declaration.length);
  if (assign < 0) throw new Error(`Found "${declaration}" but it is never assigned`);

  const start = source.indexOf("[", assign);
  if (start < 0) throw new Error(`Found "${declaration}" but no array after it`);

  let depth = 0;
  let quote = null; // the delimiter of the string we are inside, if any
  let comment = null; // "line" | "block"

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (comment === "line") {
      if (ch === "\n") comment = null;
      continue;
    }
    if (comment === "block") {
      if (ch === "*" && next === "/") {
        comment = null;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") i += 1; // an escaped delimiter is not the end of the string
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      comment = "line";
      i += 1;
    } else if (ch === "/" && next === "*") {
      comment = "block";
      i += 1;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "[" || ch === "{" || ch === "(") {
      depth += 1;
    } else if (ch === "]" || ch === "}" || ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error(`Unbalanced brackets after "${declaration}" — the literal never closes`);
}

/** Evaluates a lifted literal. It is our own source file, never user input. */
function evaluateLiteral(literal, label) {
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`return (${literal});`)();
  } catch (err) {
    throw new Error(`${label} did not evaluate as a JavaScript literal: ${err.message}`);
  }
}

/**
 * One Kotlin string literal.
 *
 * `$` matters as much as the quote does: a bare `$` in a Kotlin string opens a template expression,
 * so an unescaped one is a compile error rather than a wrong character, and would only be found on
 * a machine with the Android SDK on it.
 */
function kt(value) {
  const body = String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${body}"`;
}

const REQUIRED_DRUG_FIELDS = [
  "id", "cat", "name", "genericEn", "genericAr", "descEn", "descAr", "doseEn", "doseAr",
];

function validate(categories, drugs) {
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error("DRUG_CATEGORIES came out empty");
  }
  if (!Array.isArray(drugs) || drugs.length === 0) {
    throw new Error("DRUG_CATALOG came out empty");
  }

  const categoryIds = new Set();
  for (const cat of categories) {
    for (const field of ["id", "labelEn", "labelAr"]) {
      if (typeof cat[field] !== "string" || !cat[field]) {
        throw new Error(`Category ${cat.id ?? "?"} is missing ${field}`);
      }
    }
    if (categoryIds.has(cat.id)) throw new Error(`Duplicate category id ${cat.id}`);
    categoryIds.add(cat.id);
  }

  const drugIds = new Set();
  for (const drug of drugs) {
    for (const field of REQUIRED_DRUG_FIELDS) {
      if (typeof drug[field] !== "string" || !drug[field]) {
        throw new Error(`Drug ${drug.id ?? "?"} is missing ${field}`);
      }
    }
    if (drugIds.has(drug.id)) throw new Error(`Duplicate drug id ${drug.id}`);
    drugIds.add(drug.id);
    // The id is the join key a clinic override is stored against, so it has to survive as a plain
    // Kotlin-safe token rather than something that needs quoting differently on either side.
    if (!/^[a-z0-9_]+$/.test(drug.id)) {
      throw new Error(`Drug id "${drug.id}" is not lowercase letters, digits and underscores`);
    }
    if (!categoryIds.has(drug.cat)) {
      throw new Error(`Drug ${drug.id} sits in unknown category "${drug.cat}"`);
    }
    if (drug.keywords !== undefined && !Array.isArray(drug.keywords)) {
      throw new Error(`Drug ${drug.id} has keywords that are not an array`);
    }
  }
}

function emit(categories, drugs) {
  const lines = [];
  const push = (text = "") => lines.push(text);

  push("// GENERATED FILE — do not edit by hand.");
  push("//");
  push(`// Written by ${posix(import.meta.filename ?? fileURLToPath(import.meta.url))}`);
  push(`// from ${posix(SOURCE)}, which is the one place this list is authored.`);
  push("//");
  push("// Edit the catalog on the web side and re-run `npm run gen:android-drugs`. Editing this file");
  push("// directly is how the phone and the website end up disagreeing about what `catalogId`");
  push("// means — and a clinic's saved override points at an id, not at a name.");
  push("");
  push("package com.alphadental.clinic.data");
  push("");
  push("/** A shelf in the picker. `soft` is a web-only Tailwind class and is deliberately not copied. */");
  push("data class DrugCategoryDef(val id: String, val labelEn: String, val labelAr: String)");
  push("");
  push("/**");
  push(" * One drug in the built-in library.");
  push(" *");
  push(" * Only `name`, `doseEn` and `doseAr` ever reach the paper. `descEn`/`descAr` say what it is");
  push(" * for, `noteEn`/`noteAr` are what to tell the patient, `cautionEn`/`cautionAr` are what to");
  push(" * check first — all three are for the dentist's eyes while picking, and none of them are");
  push(" * copied onto the prescription.");
  push(" */");
  push("data class CatalogDrug(");
  push("    val id: String,");
  push("    val cat: String,");
  push("    val name: String,");
  push("    val genericEn: String,");
  push("    val genericAr: String,");
  push("    val descEn: String,");
  push("    val descAr: String,");
  push("    val doseEn: String,");
  push("    val doseAr: String,");
  push("    val noteEn: String = \"\",");
  push("    val noteAr: String = \"\",");
  push("    val cautionEn: String = \"\",");
  push("    val cautionAr: String = \"\",");
  push("    val keywords: List<String> = emptyList(),");
  push(")");
  push("");
  push("object DrugCatalog {");
  push("");
  push("    val CATEGORIES: List<DrugCategoryDef> = listOf(");
  for (const cat of categories) {
    push(`        DrugCategoryDef(${kt(cat.id)}, ${kt(cat.labelEn)}, ${kt(cat.labelAr)}),`);
  }
  push("    )");
  push("");
  push(`    /** ${drugs.length} drugs, in the order the catalog authors them. */`);
  push("    val ALL: List<CatalogDrug> = listOf(");

  let lastCat = null;
  for (const drug of drugs) {
    if (drug.cat !== lastCat) {
      const cat = categories.find((c) => c.id === drug.cat);
      push(`        // ${cat.labelEn}`);
      lastCat = drug.cat;
    }
    push("        CatalogDrug(");
    push(`            id = ${kt(drug.id)},`);
    push(`            cat = ${kt(drug.cat)},`);
    push(`            name = ${kt(drug.name)},`);
    push(`            genericEn = ${kt(drug.genericEn)},`);
    push(`            genericAr = ${kt(drug.genericAr)},`);
    push(`            descEn = ${kt(drug.descEn)},`);
    push(`            descAr = ${kt(drug.descAr)},`);
    push(`            doseEn = ${kt(drug.doseEn)},`);
    push(`            doseAr = ${kt(drug.doseAr)},`);
    // Omitted rather than written as "" so the Kotlin reads like the TypeScript, where these are
    // optional and simply absent on the drugs that have nothing to say.
    if (drug.noteEn) push(`            noteEn = ${kt(drug.noteEn)},`);
    if (drug.noteAr) push(`            noteAr = ${kt(drug.noteAr)},`);
    if (drug.cautionEn) push(`            cautionEn = ${kt(drug.cautionEn)},`);
    if (drug.cautionAr) push(`            cautionAr = ${kt(drug.cautionAr)},`);
    if (drug.keywords?.length) {
      push(`            keywords = listOf(${drug.keywords.map(kt).join(", ")}),`);
    }
    push("        ),");
  }

  push("    )");
  push("");
  push("    /**");
  push("     * Written as escapes on purpose, exactly as the TypeScript does: tashkeel, the superscript");
  push("     * alef, tatweel and the bidi marks are all invisible, so a literal character class here");
  push("     * would look like an empty one in every editor.");
  push("     */");
  push("    private val AR_DIACRITICS = Regex(\"[\\u064B-\\u0652\\u0670\\u0640\\u200E\\u200F\\u061C]\")");
  push("    private val AR_HAMZA = Regex(\"[أإآٱ]\")");
  push("    private val WHITESPACE = Regex(\"\\\\s+\")");
  push("");
  push("    /**");
  push("     * Folds the spellings that make an Arabic needle miss: hamza forms, ya/alef maqsura, ta");
  push("     * marbuta. The twin of `normalizeDrugText` on the web — a search that folded differently");
  push("     * here would find a different drug for the same typed word.");
  push("     *");
  push("     * `lowercase()` and not `toLowerCase()`: the latter follows the device locale, and on a");
  push("     * Turkish phone it turns every capital I into a dotless one.");
  push("     */");
  push("    fun normalize(raw: String): String =");
  push("        raw.lowercase()");
  push("            .replace(AR_DIACRITICS, \"\")");
  push("            .replace(AR_HAMZA, \"ا\")");
  push("            .replace(\"ى\", \"ي\")");
  push("            .replace(\"ة\", \"ه\")");
  push("            .replace(\"ؤ\", \"و\")");
  push("            .replace(\"ئ\", \"ي\")");
  push("            .replace(WHITESPACE, \" \")");
  push("            .trim()");
  push("");
  push("    /** Everything a search term may match on — built once, not per keystroke. */");
  push("    private val SEARCH_INDEX: Map<String, String> by lazy {");
  push("        val byId = CATEGORIES.associateBy { it.id }");
  push("        ALL.associate { drug ->");
  push("            val cat = byId[drug.cat]");
  push("            drug.id to normalize(");
  push("                (");
  push("                    listOf(");
  push("                        drug.name,");
  push("                        drug.genericEn,");
  push("                        drug.genericAr,");
  push("                        drug.descEn,");
  push("                        drug.descAr,");
  push("                        cat?.labelEn.orEmpty(),");
  push("                        cat?.labelAr.orEmpty(),");
  push("                    ) + drug.keywords");
  push("                ).joinToString(\" \")");
  push("            )");
  push("        }");
  push("    }");
  push("");
  push("    /**");
  push("     * Every whitespace-separated term must appear somewhere in the drug's text, in any order, so");
  push("     * \"aug 1\" and \"مضاد حيوي حساسيه\" both land. An empty query returns the catalog untouched.");
  push("     */");
  push("    fun search(query: String): List<CatalogDrug> {");
  push("        val q = normalize(query)");
  push("        if (q.isEmpty()) return ALL");
  push("        val terms = q.split(\" \").filter { it.isNotEmpty() }");
  push("        return ALL.filter { drug ->");
  push("            val stack = SEARCH_INDEX[drug.id].orEmpty()");
  push("            terms.all { stack.contains(it) }");
  push("        }");
  push("    }");
  push("");
  push("    fun categoryLabel(catId: String, arabic: Boolean): String {");
  push("        val cat = CATEGORIES.firstOrNull { it.id == catId } ?: return \"\"");
  push("        return if (arabic) cat.labelAr else cat.labelEn");
  push("    }");
  push("}");
  push("");

  // CRLF, like every other file in this repo: an LF rewrite turns a no-op regeneration into a
  // whole-file diff and buries whatever actually changed.
  return lines.join("\r\n");
}

const source = readFileSync(SOURCE, "utf8");
const categories = evaluateLiteral(
  extractArrayLiteral(source, "export const DRUG_CATEGORIES"),
  "DRUG_CATEGORIES"
);
const drugs = evaluateLiteral(
  extractArrayLiteral(source, "export const DRUG_CATALOG"),
  "DRUG_CATALOG"
);

validate(categories, drugs);
writeFileSync(TARGET, emit(categories, drugs), "utf8");

console.log(
  `${posix(TARGET)}: ${drugs.length} drugs in ${categories.length} categories, from ${posix(SOURCE)}`
);
