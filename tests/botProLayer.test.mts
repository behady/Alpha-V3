/**
 * The clinic layer: what the owner teaches Pro. The sanitiser keeps prices and medicines out,
 * the never-say phrases become a red line in checkReply, and the prompt block cannot override
 * the rulebook.
 *
 * Run: npm run test:pro-layer
 */
import assert from "node:assert/strict";
import { checkReply } from "../src/lib/botPro/checks";
import { EMPTY_LAYER, isEmptyLayer, neverSayHits, sanitizeLayer } from "../src/lib/botPro/layer";
import { normalizeNeverSay } from "../src/lib/botPro/checks";
import { normalizeForMatch } from "../src/lib/botPro/tools";
import { proClinicLayer } from "../src/lib/botPro/proPrompt";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

test("sanitizeLayer drops prices and medicines and says why", () => {
  const { layer, dropped } = sanitizeLayer({
    rules: ["  رحّب بالمريض باسمه ", "الكشف بـ 300 جنيه", "قوله ياخد اوجمنتين", "رحّب بالمريض باسمه"],
    handoffWhen: ["لو اشتكى من الدكتور"],
    neverSay: ["ارخص عيادة", "ab"],
    promptSection: "احنا عيادة عائلية. الخصم 20% للطلبة.",
  });
  assert.deepEqual(layer.rules, ["رحّب بالمريض باسمه"]);
  assert.deepEqual(layer.neverSay, ["ارخص عيادة"]); // "ab" is under phraseMin
  assert.equal(layer.promptSection, "احنا عيادة عائلية.");
  assert.deepEqual(dropped.map((d) => d.why).sort(), ["medicine", "price", "price"]);
});
test("sanitizeLayer of junk is the empty layer", () => {
  assert.deepEqual(sanitizeLayer(null).layer, EMPTY_LAYER);
  assert.deepEqual(sanitizeLayer({ rules: "not a list", neverSay: [5] }).layer, EMPTY_LAYER);
  assert.ok(isEmptyLayer(EMPTY_LAYER));
});
test("never-say survives Arabic spelling variants", () => {
  assert.deepEqual(neverSayHits("إحنا أرخص عياده في المنطقة", ["ارخص عيادة"]), ["ارخص عيادة"]);
  assert.deepEqual(neverSayHits("احنا عيادة كويسة", ["ارخص عيادة"]), []);
});
test("checkReply reports never_say", () => {
  const v = checkReply({ question: "بكام؟", reply: "احنا ارخص عيادة", allowed: new Set(), clocks: new Set(), drugsAllowed: "", neverSay: ["ارخص عيادة"] });
  assert.ok(v.some((x) => x.rule === "never_say"));
});
test("checkReply without neverSay is unchanged", () => {
  const v = checkReply({ question: "بكام؟", reply: "احنا ارخص عيادة", allowed: new Set(), clocks: new Set(), drugsAllowed: "" });
  assert.ok(!v.some((x) => x.rule === "never_say"));
});
test("proClinicLayer: empty is nothing, full says it cannot override", () => {
  assert.equal(proClinicLayer(null), "");
  assert.equal(proClinicLayer(EMPTY_LAYER), "");
  const block = proClinicLayer({ ...EMPTY_LAYER, rules: ["اقفل البيع بعرض كشف"], neverSay: ["ارخص عيادة"] });
  assert.match(block, /never overrides the rules above/);
  assert.match(block, /اقفل البيع بعرض كشف/);
  assert.ok(!block.includes("Hand the chat to the team when:"), "empty sections are left out");
});
test("sanitizeLayer drops prices written without a currency word, as bare numbers", () => {
  for (const line of ["الكشف بـ 300", "الكشف 300", "الحشو ب 500", "السعر ٣٠٠"]) {
    const { layer, dropped } = sanitizeLayer({ rules: [line], promptSection: line + "." });
    assert.deepEqual(layer.rules, [], line);
    assert.equal(layer.promptSection, "", line);
    // No unit: the bare-number rule caught it, so the owner is asked to reword without the number.
    assert.deepEqual(dropped.map((d) => d.why), ["number", "number"], line);
  }
});
test("a number with a currency or percent is a price; one without is a number", () => {
  assert.deepEqual(sanitizeLayer({ rules: ["الكشف بـ 300 جنيه"] }).dropped.map((d) => d.why), ["price"]);
  assert.deepEqual(sanitizeLayer({ rules: ["الخصم 20%"] }).dropped.map((d) => d.why), ["price"]);
  assert.deepEqual(sanitizeLayer({ rules: ["رد على 50 رسالة"] }).dropped.map((d) => d.why), ["number"]);
});
test("a price or number plus a medicine reports the number first", () => {
  const { layer, dropped } = sanitizeLayer({ rules: ["الكشف بـ 300 وقولهم ياخدوا اوجمنتين"] });
  assert.deepEqual(layer.rules, []);
  assert.deepEqual(dropped.map((d) => d.why), ["number"]);
  assert.deepEqual(sanitizeLayer({ rules: ["الكشف بـ 300 جنيه وقولهم ياخدوا اوجمنتين"] }).dropped.map((d) => d.why), ["price"]);
});
test("durations, counts, clocks and phones are not prices", () => {
  const { layer, dropped } = sanitizeLayer({ rules: ["رد خلال 15 دقيقة", "المتابعة بعد 14 يوم", "ابعت 3 مواعيد", "الواتس 01001234567", "الفتح 10:30"] });
  assert.deepEqual(dropped, []);
  assert.equal(layer.rules.length, 5);
});
test("a decimal in the prompt section does not split the sentence", () => {
  const { layer, dropped } = sanitizeLayer({ promptSection: "احنا عيادة عائلية. الخصم 20.5%" });
  assert.equal(layer.promptSection, "احنا عيادة عائلية.");
  assert.deepEqual(dropped, [{ text: "الخصم 20.5%", why: "price" }]);
});
test("never-say: a leading ال is only dropped when three letters are left", () => {
  // "ألم" used to fold to "م" and hit almost every reply.
  assert.deepEqual(neverSayHits("أهلاً بحضرتك، نقدر نساعدك", ["ألم"]), []);
  assert.deepEqual(neverSayHits("عندك ألم؟", ["ألم"]), ["ألم"]);
  assert.deepEqual(neverSayHits("ألمك شديد؟", ["ألم"]), ["ألم"], "a suffix still matches");
  assert.deepEqual(neverSayHits("العالم كله", ["ألم"]), [], "not inside another word");
  assert.deepEqual(neverSayHits("يعني تمام", ["آلي"]), []);
  assert.deepEqual(neverSayHits("الدكتور التالي", ["آلي"]), []);
  assert.deepEqual(neverSayHits("الو، مين معايا؟", ["الو"]), ["الو"]);
  assert.deepEqual(neverSayHits("الوقت مناسب لحضرتك", ["الو"]), []);
  assert.deepEqual(neverSayHits("والوقت مناسب", ["الو"]), []);
  assert.deepEqual(neverSayHits("انا المساعد الآلي", ["مساعد آلي"]), ["مساعد آلي"]);
  assert.deepEqual(neverSayHits("انا المساعد الآلي", ["المساعد الآلي"]), ["المساعد الآلي"]);
  assert.deepEqual(neverSayHits("ده بالمساعد الآلي", ["مساعد آلي"]), ["مساعد آلي"], "بال is an article too");
});
test("never-say spelling: one normaliser for both sides", () => {
  assert.equal(normalizeNeverSay("  المُساعِد   الآلـــي "), "مساعد الي");
  assert.equal(normalizeNeverSay("ألم"), "الم");
  assert.equal(normalizeNeverSay("الو"), "الو");
  assert.equal(normalizeNeverSay("للمساعد"), "مساعد");
  assert.equal(normalizeNeverSay("مدرسة مستشفى"), "مدرسه مستشفي");
  assert.equal(normalizeNeverSay("BOT"), "bot");
});
test("normalizeForMatch is unchanged (other callers depend on it)", () => {
  assert.equal(normalizeForMatch("ألم"), "م");
  assert.equal(normalizeForMatch("الكشف"), "كشف");
});
test("sanitizeLayer refuses never-say phrases that fold to under phraseMin", () => {
  const { layer } = sanitizeLayer({ neverSay: ["ألم", "ـــاب", "اَبْ", "مساعد آلي"] });
  assert.deepEqual(layer.neverSay, ["ألم", "مساعد آلي"]);
});
