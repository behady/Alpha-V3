/**
 * Reading a contract company's price list from its spreadsheet, and lining it up with the clinic's
 * own treatments.
 *
 * Every company a clinic signs with sends its tariff the same way: a sheet with a price column and
 * a service column, grouped under headings ("أولاً: التشخيص"), with a title on top and a phone
 * number at the bottom. Typing sixty prices into a list by hand is the job this replaces.
 *
 * Pure: rows in, items and matches out. The screen (PriceListImport.tsx) reads the file, shows the
 * matches for the owner to confirm, and writes; nothing here touches Firestore.
 *
 * Matching is by meaning, not by spelling: Arabic letter variants (أ/إ/آ → ا, ة → ه, ى → ي),
 * diacritics, the "**" footnote marks, brackets and punctuation are all ignored, and a name that is
 * not an exact match is scored by the words the two share. Below the floor it is offered as a new
 * treatment on the list — never silently attached to the nearest guess.
 *
 * Across languages too: a clinic that named its treatments in English ("Composite Filling") is
 * matched against an Arabic sheet ("حشو كومبوزيت") through the app's own bilingual starter names
 * and a small dental glossary, word by word.
 */

import { SERVICE_TEMPLATES } from "./setupWizard";

export type ImportedItem = {
  /** Position in the sheet, for a stable key and so the review reads in the sheet's order. */
  row: number;
  name: string;
  price: number;
  /** The heading the item sat under, e.g. "رابعا :الحشو". Empty when the sheet has none. */
  section: string;
  /** The sheet marked it (a trailing "**"): usually a limit or a prior approval; shown, not acted on. */
  marked: boolean;
};

export type CatalogueService = { id: string; name: string; price?: number; listId?: string | null };

export type MatchKind = "exact" | "close" | "new";

export type ItemMatch = {
  item: ImportedItem;
  kind: MatchKind;
  /** The clinic treatment it lines up with; null for "new". */
  serviceId: string | null;
  /** 0..1 — 1 for exact. */
  score: number;
  /** Looks wrong next to the rest of the sheet (e.g. a stray extra digit): shown for a second look. */
  suspicious: boolean;
};

/** Below this, two names are not the same treatment. */
export const MATCH_FLOOR = 0.6;

const ARABIC_DIACRITICS = /[ً-ْٰـ]/g;

/** One spelling for comparing: lower case, unified Arabic letters, no marks, single spaces. */
export function normalizeName(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    // Egyptian sheets write ذ as د (الجدور / الجذور); one spelling for both.
    .replace(/ذ/g, "د")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[*"'“”«»()[\]{}/\\|،,.:;!?_+=-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that say nothing about which treatment it is. */
const FILLER = new Set(["ال", "و", "في", "من", "علي", "على", "لل", "بال", "the", "of", "and", "a", "for", "per", "للسنه", "الواحده", "للوحده", "سنه", "واحده", "وحده", "بدون", "مع", "unit", "tooth"]);

/** The words that name the treatment: prefixes off, filler out, English dental words in Arabic, once each. */
function words(name: string): string[] {
  const out = normalizeName(name)
    .split(" ")
    .map((w) => GLOSSARY[w] ?? w)
    .map((w) => w.replace(/^(ال|بال|لل|وال)/, ""))
    .filter((w) => w.length > 1 && !FILLER.has(w));
  return [...new Set(out)];
}

/**
 * Dental words in English → the word an Egyptian price sheet uses. Word for word, so a custom name
 * ("Zirconia Crown on Implant") still lines up with its Arabic line.
 */
const GLOSSARY: Record<string, string> = {
  consultation: "كشف", consult: "كشف", exam: "كشف", examination: "كشف", checkup: "كشف",
  xray: "اشعه", "x-ray": "اشعه", radiology: "اشعه", periapical: "اشعه", panoramic: "بانوراما", pano: "بانوراما",
  filling: "حشو", composite: "كومبوزيت", amalgam: "مملغم", glass: "جلاس", ionomer: "ايونيمر",
  root: "جذور", canal: "عصب", rct: "عصب", endo: "عصب", retreatment: "اعاده", pulpotomy: "عصب",
  crown: "طربوش", crowns: "طربوش", zirconia: "زركونيا", zircon: "زركونيا", porcelain: "بورسلين", pfm: "بورسلين",
  ceramic: "سيراميك", emax: "ايماكس", "e-max": "ايماكس", temporary: "مؤقت", bridge: "كوبري",
  veneer: "قشره", veneers: "قشره", laminate: "قشره", laminates: "قشره",
  implant: "زراعه", implants: "زراعه", bone: "عضم", graft: "عضم", membrane: "غشاء", sinus: "sinus",
  extraction: "خلع", surgical: "جراحي", simple: "عادي", wisdom: "عقل", impacted: "مدفون",
  scaling: "رواسب", polishing: "تلميع", cleaning: "تنظيف", gum: "لثه", gingival: "لثه",
  denture: "طقم", dentures: "طقم", partial: "متحركه", flexible: "مرنه",
  post: "دعامه", core: "دعامه", fiber: "فيبر", mta: "mta", cement: "لاصق", cementation: "لاصق",
  fluoride: "فلورايد", whitening: "تبييض", pediatric: "اطفال", child: "اطفال", kids: "اطفال",
  cyst: "كيس", guard: "guard", night: "night",
};

/** Every way a clinic treatment can be named on a sheet: as stored, its starter-list twin, and word for word. */
export function serviceAliases(name: string): string[] {
  const out = new Set<string>([name]);
  const n = normalizeName(name);
  for (const t of SERVICE_TEMPLATES) {
    if (normalizeName(t.name.en) === n) out.add(t.name.ar);
    if (normalizeName(t.name.ar) === n) out.add(t.name.en);
  }
  const translated = n
    .split(" ")
    .map((w) => GLOSSARY[w] ?? "")
    .filter(Boolean);
  if (translated.length > 0) out.add(translated.join(" "));
  return [...out];
}

/**
 * How much two names overlap, 0..1 (Dice: twice the shared words over all words), so a sheet's
 * longer wording ("طربوش زركونيا سيراميك للوحدة") still lines up with a short catalogue name
 * ("طربوش زركون"), while one shared word in two long names stays below the floor.
 */
export function nameSimilarity(a: string, b: string): number {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) {
    if (wb.has(w)) {
      shared += 1;
      continue;
    }
    // A spelling difference inside one word (كمبوزيت / كومبوزيت) counts as most of a match.
    for (const v of wb) {
      if (Math.min(w.length, v.length) >= 4 && (w.includes(v) || v.includes(w) || editDistance(w, v) <= 1)) {
        shared += 0.85;
        break;
      }
    }
  }
  return (2 * shared) / (wa.size + wb.size);
}

/**
 * Words that make it a different treatment. One side saying "children's", "panoramic", "root
 * canal" or "metal" and the other not is two treatments however much else they share — a regular
 * x-ray is not a panoramic one, a child's root canal is not a child's filling.
 */
const DECIDING = ["اطفال", "بانوراما", "عصب", "جدور", "عقل", "مدفون", "جراحي", "معدن", "بورسلين", "زركونيا", "زركون", "ايماكس", "مؤقت", "اعاده", "متحركه", "كيس", "غشاء", "عضم", "قشره", "زراعه", "تبييض"];

function decidingWords(name: string): Set<string> {
  const ws = words(name);
  const out = new Set<string>();
  for (const d of DECIDING) if (ws.some((w) => w === d || (d.length >= 4 && w.startsWith(d)))) out.add(d === "زركون" ? "زركونيا" : d === "جدور" ? "عصب" : d);
  return out;
}

/** The best overlap between a sheet line and any name the treatment goes by; 0 when a deciding word disagrees. */
function aliasSimilarity(itemName: string, aliases: readonly string[]): number {
  const mine = decidingWords(itemName);
  let best = 0;
  for (const a of aliases) {
    const theirs = decidingWords(a);
    const agree = mine.size === theirs.size && [...mine].every((d) => theirs.has(d));
    if (!agree) continue;
    best = Math.max(best, nameSimilarity(itemName, a));
  }
  return best;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const cleaned = v
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[,٬\s]/g, "")
    .replace(/(ج\.?م|egp|le|جنيه)$/i, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/**
 * The items on the sheet, read from its rows as the spreadsheet library hands them over.
 *
 * A row with a number and a name is an item, whichever column each is in. A row with text and no
 * number is a heading (the section the next items belong to) — unless it is the title above the
 * first item, a column header, or the contact line below the last, which are not sections at all.
 */
export function parsePriceSheet(rows: readonly (readonly unknown[])[]): ImportedItem[] {
  const out: ImportedItem[] = [];
  let section = "";
  rows.forEach((cells, index) => {
    const numbers = cells.map(asNumber);
    const texts = cells.map(asText);
    const priceAt = numbers.findIndex((n) => n !== null && n > 0);
    const nameAt = texts.findIndex((t, i) => i !== priceAt && t !== "" && asNumber(t) === null);
    if (priceAt >= 0 && nameAt >= 0) {
      const rawName = texts[nameAt];
      out.push({
        row: index + 1,
        name: rawName.replace(/\*+/g, "").replace(/\s+/g, " ").trim(),
        price: Math.round((numbers[priceAt] as number) * 100) / 100,
        section,
        marked: /\*\*/.test(rawName),
      });
      return;
    }
    if (priceAt < 0 && nameAt >= 0) {
      const heading = texts[nameAt];
      // A column header ("التكلفة | نوع الخدمة") has text in two cells; a heading has it in one.
      const textCells = texts.filter((t) => t !== "").length;
      if (textCells === 1) section = heading;
    }
  });
  // A title above the first heading only ever names items that come before any heading; the
  // contact line after the last item becomes a heading nothing sits under.
  return out;
}

/** The clinic's treatment each sheet item lines up with, best first; one treatment is used once. */
export function matchItems(items: readonly ImportedItem[], catalogue: readonly CatalogueService[], listId: string): ItemMatch[] {
  // Another list's own treatments are not candidates: they belong to that company.
  const candidates = catalogue.filter((s) => !s.listId || s.listId === listId);
  const aliases = new Map(candidates.map((s) => [s.id, serviceAliases(s.name)]));
  const byNorm = new Map<string, CatalogueService>();
  for (const s of candidates) {
    for (const a of aliases.get(s.id) ?? []) {
      const k = normalizeName(a);
      if (k && !byNorm.has(k)) byNorm.set(k, s);
    }
  }
  const taken = new Set<string>();
  const results: ItemMatch[] = items.map((item) => {
    const exact = byNorm.get(normalizeName(item.name));
    if (exact && !taken.has(exact.id)) {
      taken.add(exact.id);
      return { item, kind: "exact", serviceId: exact.id, score: 1, suspicious: false };
    }
    return { item, kind: "new", serviceId: null, score: 0, suspicious: false };
  });
  // Close matches second, so an exact match is never lost to a fuzzy one; and best pairs first
  // across the whole sheet, so an early line cannot take a treatment a later line fits better.
  const pairs: { r: ItemMatch; s: CatalogueService; score: number }[] = [];
  for (const r of results) {
    if (r.kind !== "new") continue;
    for (const s of candidates) {
      if (taken.has(s.id)) continue;
      const score = aliasSimilarity(r.item.name, aliases.get(s.id) ?? [s.name]);
      if (score >= MATCH_FLOOR) pairs.push({ r, s, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.r.item.row - b.r.item.row);
  for (const { r, s, score } of pairs) {
    if (r.kind !== "new" || taken.has(s.id)) continue;
    taken.add(s.id);
    r.kind = "close";
    r.serviceId = s.id;
    r.score = Math.round(score * 100) / 100;
  }
  return flagSuspicious(results);
}

/**
 * A price worth a second look: more than double the next-highest price on the whole sheet (a stray
 * digit turns 3,603 into 36,030), or zero.
 */
export function flagSuspicious(matches: ItemMatch[]): ItemMatch[] {
  const prices = matches.map((m) => m.item.price).sort((a, b) => b - a);
  const top = prices[0] ?? 0;
  const second = prices[1] ?? 0;
  return matches.map((m) => ({
    ...m,
    suspicious: m.item.price <= 0 || (m.item.price === top && second > 0 && top > second * 2),
  }));
}

/** A treatment's billing rule from its name, for a new one: per visit, per jaw, or per tooth. */
export function guessPricingMode(name: string): "per_tooth" | "per_arch" | "flat" {
  const n = normalizeName(name);
  if (/كشف|استشاره|تلميع|ازاله الرواسب|كافتيرون|طقم|consult|exam|scaling|polish|denture/.test(n)) return "flat";
  if (/للفك|بالفك|الفكين|arch|jaw/.test(n)) return "per_arch";
  return "per_tooth";
}
