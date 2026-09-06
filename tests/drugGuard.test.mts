import assert from "node:assert/strict";
import { strayDrugNames } from "../src/lib/bot/drugGuard";

/**
 * The one rule in the assistant that a prompt is not allowed to be responsible for: it may repeat
 * a medicine's name, never introduce one. These cases are the two failures that matter — letting a
 * recommendation through, and blocking a legitimate read-back of the dentist's own prescription.
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

const PRESCRIPTION = "Augmentin 1g — كل 12 ساعة — 5 أيام\nBrufen 600 — عند اللزوم";

run("a brand the model reached for on its own is caught", () => {
  // The live slip that caused this file: a painkiller offered by name to a patient in pain.
  assert.deepEqual(strayDrugNames("تقدري تاخدي مسكن زي البروفين بعد الأكل", ""), ["بروفين"]);
  assert.deepEqual(strayDrugNames("You can take Panadol until your appointment", ""), ["panadol"]);
  assert.ok(strayDrugNames("هاخدلك أوجمنتين 1 جرام كل 12 ساعة", "").length === 1);
  // Spelling is not an escape hatch: alef forms, ta marbuta and diacritics all normalise.
  assert.ok(strayDrugNames("خدي كتافاست", "").length === 1);
  assert.ok(strayDrugNames("خدي كَتافلام", "").length === 1);
});

run("the dentist's own prescription may be read back, in either script", () => {
  assert.deepEqual(strayDrugNames("الدكتور كاتبلك Augmentin 1g كل 12 ساعة و Brufen 600 عند اللزوم", PRESCRIPTION), []);
  // The prescription is printed in Latin; the assistant answers in Arabic. Same medicine.
  assert.deepEqual(strayDrugNames("الدكتور كاتبلك أوجمنتين وبروفين", PRESCRIPTION), []);
  // And the reverse, for a patient who writes in English.
  assert.deepEqual(strayDrugNames("Your prescription is Augmentin and Brufen", "أوجمنتين، بروفين"), []);
});

run("a name the patient used first may be said back to them", () => {
  const asked = "ينفع اخد بنادول مع الدوا ده؟";
  assert.deepEqual(strayDrugNames("بخصوص البنادول، ده الدكتور هو اللي يقوله — هوصلك بيه حالاً", asked), []);
  // But answering a Panadol question by suggesting a DIFFERENT drug is still caught.
  assert.deepEqual(strayDrugNames("بلاش بنادول، خدي كتافلام", asked), ["كتافلام"]);
});

run("ordinary dental talk is not a medicine", () => {
  // Everything the assistant says all day long must pass clean, or the guard silences the bot.
  for (const line of [
    "جلسة التنظيف والتلميع بتبدأ من 350 ج.م",
    "تقدري تاخدي المسكّن اللي حضرتك متعوّدة عليه حسب إرشادات العلبة",
    "الدكتور محمد إيهاب متاح الأحد الساعة 9:30 م",
    "حشو العصب بياخد من جلستين لتلاتة حسب الحالة",
    "Laser whitening starts from 800 EGP and the check-up fee is deducted",
    "ممكن تعملي مضمضة بمياه دافية وملح",
  ]) {
    assert.deepEqual(strayDrugNames(line, ""), [], line);
  }
});

console.log("drugGuard: all suites passed");
