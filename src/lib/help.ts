import fs from "node:fs";
import path from "node:path";
import { HELP_SECTIONS, type HelpArticle, type HelpLang, type HelpSectionId } from "./helpSections";

/**
 * Reads help articles off disk. **Server only** — this file imports `node:fs`, so importing it
 * from a client component breaks the build. Client components want `./helpSections` instead.
 *
 * Articles are plain markdown, one file per language:
 *
 *   src/content/help/en/clinic-profile-and-logo.md
 *   src/content/help/ar/clinic-profile-and-logo.md
 *
 * They are read here and handed to the client in both languages at once, because the language
 * lives in a React context the server cannot see. Two copies of an article is a few kilobytes —
 * cheaper than routing every language switch through the network.
 */

export type { HelpArticle, HelpLang, HelpSectionId };

const CONTENT_ROOT = path.join(process.cwd(), "src", "content", "help");

/**
 * Deliberately not a YAML parser. The frontmatter here is a fixed, flat set of keys written by
 * hand, and pulling in a YAML dependency to read `title: Something` would be the larger risk.
 * Anything unrecognised is ignored rather than throwing, so a typo in one article cannot take
 * the whole Help Center down.
 */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const normalised = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) return { meta: {}, body: normalised.trim() };

  const end = normalised.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: normalised.trim() };

  const meta: Record<string, string> = {};
  for (const line of normalised.slice(4, end).split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    meta[key] = line
      .slice(colon + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }

  return { meta, body: normalised.slice(end + 4).trim() };
}

function readArticle(lang: HelpLang, file: string): HelpArticle | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(CONTENT_ROOT, lang, file), "utf8");
  } catch {
    return null;
  }

  const { meta, body } = parseFrontmatter(raw);
  const slug = file.replace(/\.md$/, "");

  return {
    slug,
    lang,
    title: meta.title || slug,
    summary: meta.summary || "",
    section: (meta.section as HelpSectionId) || "setup",
    order: Number.parseInt(meta.order ?? "", 10) || 999,
    roles: meta.roles ? meta.roles.split(",").map((r) => r.trim()).filter(Boolean) : [],
    plan: meta.plan || "",
    body,
  };
}

function listFiles(lang: HelpLang): string[] {
  try {
    return fs
      .readdirSync(path.join(CONTENT_ROOT, lang))
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

/** Every article in one language, ordered by section then by the `order` field. */
export function getHelpArticles(lang: HelpLang): HelpArticle[] {
  const sectionRank = new Map(HELP_SECTIONS.map((s, i) => [s.id, i]));

  return listFiles(lang)
    .map((f) => readArticle(lang, f))
    .filter((a): a is HelpArticle => a !== null)
    .sort((a, b) => {
      const bySection = (sectionRank.get(a.section) ?? 99) - (sectionRank.get(b.section) ?? 99);
      return bySection !== 0 ? bySection : a.order - b.order;
    });
}

export function getHelpArticle(slug: string, lang: HelpLang): HelpArticle | null {
  // Guard against a slug from the URL escaping the content directory.
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  return readArticle(lang, `${slug}.md`);
}

/**
 * Slugs that exist in at least one language. English is the drafting language, so a slug present
 * only in English still gets a page — Arabic readers see the English text rather than a 404.
 */
export function getHelpSlugs(): string[] {
  const slugs = new Set<string>();
  for (const lang of ["en", "ar"] as HelpLang[]) {
    for (const f of listFiles(lang)) slugs.add(f.replace(/\.md$/, ""));
  }
  return [...slugs].sort();
}
