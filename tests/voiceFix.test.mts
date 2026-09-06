import assert from "node:assert/strict";
import { feminizeAddress } from "../src/lib/bot/voiceFix";

/**
 * The slip that survives every prompt: one masculine "معاك" among twenty correct lines, because
 * the instructions the model is reading are themselves written in the masculine. The list here is
 * small on purpose — the cost of over-reaching is a reply that misgenders the dentist instead.
 */

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const she = (t: string) => feminizeAddress(t, "female");

run("the patient is addressed as a woman", () => {
  assert.equal(she("معاك سارة من العيادة"), "معاكي سارة من العيادة");
  assert.equal(she("أهلاً بيك 🙏 ابعت اسمك الكامل"), "أهلاً بيكي 🙏 ابعتي اسمك الكامل");
  assert.equal(she("مستنينك يوم الخميس"), "مستنينكي يوم الخميس");
  assert.equal(she("تحب تحجز مع دكتور محمد؟"), "تحبي تحجزي مع دكتور محمد؟");
  assert.equal(she("تقدر تاخد المسكن اللي متعود عليه"), "تقدري تاخدي المسكن اللي متعودة عليه");
  assert.equal(she("لو حبيت تعدل الميعاد قوللي"), "لو حبيتي تعدل الميعاد قوللي");
  assert.equal(she("الميعاد ده ليك"), "الميعاد ده ليكي");
});

run("what is already feminine is left alone", () => {
  for (const line of ["معاكي سارة", "أهلاً بيكي", "مستنينكي", "تحبي تحجزي", "ابعتيلي اسمك"]) {
    assert.equal(she(line), line, line);
  }
});

run("a third party is not the person being addressed", () => {
  // The whole risk of this file in one test: nothing here is about the patient.
  for (const line of [
    "الدكتور يقدر يشوفك النهاردة",
    "العيادة بتقدر ثقتك فينا",
    "دكتور محمد إيهاب متاح الساعة 4:00 م",
    "جوزك يقدر يجي معاكي عادي",
    "الأسعار دي بداية السعر والاستقبال بيأكد النهائي",
  ]) {
    assert.equal(she(line), line, line);
  }
});

run("a man and an unknown sender are never rewritten", () => {
  const masculine = "معاك سارة، تحب تحجز؟ ابعت اسمك الكامل";
  assert.equal(feminizeAddress(masculine, "male"), masculine);
  assert.equal(feminizeAddress(masculine, "unknown"), masculine);
  assert.equal(feminizeAddress(masculine, undefined), masculine);
  assert.equal(feminizeAddress("", "female"), "");
});

console.log("voiceFix: all suites passed");
