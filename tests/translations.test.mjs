/**
 * The app's translation table, and every key that reaches for it.
 *
 * `t()` returns the key itself when it cannot find a translation. That is a sensible fallback and a
 * terrible failure mode: a missing key ships as the literal string "attNetPayout" on the payroll
 * screen, which reads as a bug in the data rather than a gap in the dictionary, and nothing in the
 * build says a word. Two checks close it — the two language blocks must hold the same keys, and
 * every key a component asks for must exist.
 *
 * The settings screens use their own dictionary (src/config/settingsText.ts, guarded by
 * settingsRegistry.test.mts); this covers the rest of the app.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(join(REPO, "src/context/LanguageContext.tsx"), "utf8");

let checks = 0;
const ok = (condition, message) => {
  assert.ok(condition, message);
  checks += 1;
};

/** The body of `translations.<lang>`, brace-counted so nested objects do not cut it short. */
function block(lang) {
  const start = source.search(new RegExp(`\\n  ${lang}:\\s*\\{`));
  assert.notEqual(start, -1, `translations.${lang} is missing`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in translations.${lang}`);
}

const keysOf = (body) =>
  new Set([...body.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]));

const en = keysOf(block("en"));
const ar = keysOf(block("ar"));

ok(en.size > 200, `the English block has only ${en.size} keys, which suggests it did not parse`);

// --- 1. the two blocks hold the same keys --------------------------------------------------------
const missingFromAr = [...en].filter((k) => !ar.has(k));
const missingFromEn = [...ar].filter((k) => !en.has(k));
ok(
  missingFromAr.length === 0,
  `${missingFromAr.length} key(s) are in English and not Arabic, so they render as the key name ` +
    `to an Arabic reader: ${missingFromAr.slice(0, 8).join(", ")}`
);
ok(
  missingFromEn.length === 0,
  `${missingFromEn.length} key(s) are in Arabic and not English: ${missingFromEn.slice(0, 8).join(", ")}`
);

// --- 2. no key is translated to nothing ----------------------------------------------------------
for (const lang of ["en", "ar"]) {
  const empty = [...block(lang).matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*""/gm)].map((m) => m[1]);
  ok(
    empty.length === 0,
    `${lang} translates ${empty.join(", ")} to an empty string, which renders as nothing at all`
  );
}

// --- 3. every key a component asks for exists ------------------------------------------------------
function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && !entry.name.startsWith(".")) sourceFiles(full, out);
    } else if (/\.tsx$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const asked = new Map(); // key -> the file that asked for it
for (const file of sourceFiles(join(REPO, "src"))) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\bt\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/g)) {
    if (!asked.has(m[1])) asked.set(m[1], file.split(sep).pop());
  }
}

ok(asked.size > 0, "found no t(\"…\") calls at all, so this check is not looking where it thinks");

for (const [key, file] of asked) {
  ok(
    en.has(key),
    `${file} calls t("${key}") and the translation table has no such key, so both languages ` +
      `render the literal text "${key}" on screen`
  );
}

console.log(
  `✓ translations: ${checks} checks — ${en.size} keys in both languages, ${asked.size} asked for by name`
);
