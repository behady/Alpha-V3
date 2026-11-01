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
