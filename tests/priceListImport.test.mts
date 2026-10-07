/**
 * Importing a contract company's price list from its spreadsheet. Invented data, shaped like the
 * real tariffs (price column, service column, headings, a title and a contact line).
 *
 *   npm run test:pricelist-import
 */
import assert from "node:assert/strict";
import { flagSuspicious, guessPricingMode, matchItems, nameSimilarity, normalizeName, parsePriceSheet, serviceAliases } from "../src/lib/priceListImport";

const sheet: unknown[][] = [
  ["قائمة أسعار عيادة تجريبية لشركة مثال", null],
  ["التكلفة", "نوع الخدمة"],
  ["أولاً: التشخيص", null],
  [100, "كشف"],
  ["50", "الأشعة"],
  ["ثانياً: الحشو", null],
  [700, "حشو كومبوزيت **"],
  [1200, "حشو الجذور الخلفية (rotary)"],
  [3000, "طربوش زركونيا للوحدة"],
  [30000, "قشرة تجميلية"],
  [900, "  ( Night Guard) للفك الواحد "],
  ["للاستعلام: 0100000000", null],
];

const items = parsePriceSheet(sheet);
assert.equal(items.length, 7, "seven priced rows; title, header, headings and contact line are not items");
assert.deepEqual(items.map((i) => [i.name, i.price, i.section]), [
  ["كشف", 100, "أولاً: التشخيص"],
  ["الأشعة", 50, "أولاً: التشخيص"],
  ["حشو كومبوزيت", 700, "ثانياً: الحشو"],
  ["حشو الجذور الخلفية (rotary)", 1200, "ثانياً: الحشو"],
  ["طربوش زركونيا للوحدة", 3000, "ثانياً: الحشو"],
  ["قشرة تجميلية", 30000, "ثانياً: الحشو"],
  ["( Night Guard) للفك الواحد", 900, "ثانياً: الحشو"],
], "price in either column, a text price read as a number, the ** mark stripped from the name");
assert.equal(items[2].marked, true, "the ** is kept as a mark");
assert.equal(items[0].marked, false);
assert.deepEqual(parsePriceSheet([["٣٬٦٠٣", "تركيبة"]]).map((i) => i.price), [3603], "Arabic digits and separators");

// spelling does not matter
assert.equal(normalizeName("الأشعة"), normalizeName("الاشعه"));
assert.ok(nameSimilarity("حشو كومبوزيت", "حشو كمبوزيت") >= 0.6, "one letter apart inside a word");
assert.ok(nameSimilarity("كشف", "خلع") === 0);

const catalogue = [
  { id: "exam", name: "كشف", price: 150 },
  { id: "xray", name: "الاشعه", price: 80 },
  { id: "comp", name: "حشو كمبوزيت", price: 900 },
  { id: "zir", name: "طربوش زركونيا", price: 4000 },
  { id: "other", name: "تبييض", price: 3000, listId: "another-company" },
];
const matches = matchItems(items, catalogue, "gasco");
const by = new Map(matches.map((m) => [m.item.name, m]));
assert.equal(by.get("كشف")?.kind, "exact");
assert.equal(by.get("الأشعة")?.serviceId, "xray", "letter variants are an exact match");
assert.equal(by.get("حشو كومبوزيت")?.kind, "close", "a spelling difference is a close match, shown to confirm");
assert.equal(by.get("حشو كومبوزيت")?.serviceId, "comp");
assert.equal(by.get("طربوش زركونيا للوحدة")?.serviceId, "zir", "'per unit' is not part of the name");
assert.equal(by.get("قشرة تجميلية")?.kind, "new", "nothing like it: a new treatment, never the nearest guess");
assert.equal(by.get("حشو الجذور الخلفية (rotary)")?.kind, "new");
assert.ok(!matches.some((m) => m.serviceId === "other"), "another company's own treatment is never a candidate");

// one clinic treatment is used once
const twice = matchItems(parsePriceSheet([[100, "كشف"], [120, "كشف"]]), catalogue, "gasco");
assert.deepEqual(twice.map((m) => m.kind), ["exact", "new"]);

// the stray digit
assert.equal(by.get("قشرة تجميلية")?.suspicious, true, "30,000 against a next-highest of 3,000");
assert.equal(by.get("طربوش زركونيا للوحدة")?.suspicious, false);
assert.equal(flagSuspicious([{ item: { row: 1, name: "x", price: 0, section: "", marked: false }, kind: "new", serviceId: null, score: 0, suspicious: false }])[0].suspicious, true, "a zero price");

// billing rule for a new treatment
assert.equal(guessPricingMode("كشف"), "flat");
assert.equal(guessPricingMode("طقم اسنان كامل مرنه"), "flat");
assert.equal(guessPricingMode("( Night Guard) للفك الواحد"), "per_arch");
assert.equal(guessPricingMode("حشو كومبوزيت"), "per_tooth");

// across languages: a clinic that named its treatments in English
{
  const english = [
    { id: "c1", name: "Consultation" },
    { id: "c2", name: "Composite Filling" },
    { id: "c3", name: "Zirconia Crown" },
    { id: "c4", name: "Extraction — Surgical" },
    { id: "c5", name: "Dental Implant (fixture)" },
  ];
  assert.ok(serviceAliases("Composite Filling").includes("حشو كومبوزيت"), "the app's own bilingual starter name");
  assert.ok(serviceAliases("Zirconia Crown on Implant").some((a) => /طربوش/.test(a) && /زراعه/.test(a)), "word for word for a custom name");
  const sheetAr = parsePriceSheet([[100, "كشف"], [700, "حشو كومبوزيت **"], [3000, "طربوش زركونيا سيراميك للوحدة"], [900, "خلع ضرس جراحى"], [11000, "زراعه سنه واحده الماني"], [500, "تلميع اسنان"]]);
  const m = matchItems(sheetAr, english, "gasco");
  assert.deepEqual(m.map((x) => x.serviceId), ["c1", "c2", "c3", "c4", "c5", null], "each Arabic line finds its English treatment; polishing has none");
  assert.deepEqual(m.slice(0, 2).map((x) => x.kind), ["exact", "exact"], "the starter twins are exact");
}

// a deciding word on one side only is a different treatment
{
  const english = [
    { id: "pano", name: "Panoramic X-ray" },
    { id: "pedo", name: "Pediatric Filling" },
    { id: "pfm", name: "PFM Crown" },
    { id: "zir", name: "Zirconia Crown" },
  ];
  const sheetAr = parsePriceSheet([[66, "الاشعة"], [1056, "حشو الجدور للاطفال بدون حشو نهائي"], [1056, "طربوش اطفال معدن"], [1782, "طربوش بورسلين سيراميك للوحدة"], [3102, 'طربوش زركونيا سيراميك للوحدة "Zirconia"']]);
  const m = matchItems(sheetAr, english, "gasco");
  assert.deepEqual(m.map((x) => x.serviceId), [null, null, null, "pfm", "zir"], "x-ray ≠ panoramic, child's root canal ≠ child's filling, child's metal crown ≠ PFM; porcelain and zirconia still found");
}

console.log("price list import: all checks passed");
