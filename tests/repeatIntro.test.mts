import assert from "node:assert/strict";
import { stripRepeatIntro } from "../src/lib/bot/repeatIntro";

/**
 * The habit that gives the assistant away fastest. Over eight messages it introduced itself six
 * times; a receptionist says who they are once, when they pick up.
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

const NAME = "سارة";
const CLINIC = "Alpha Dental Clinic";
const strip = (t: string) => stripRepeatIntro(t, NAME, CLINIC);

run("the introduction goes, the greeting stays", () => {
  assert.equal(
    strip("أهلاً بيكي يا أستاذة منى، معاكي سارة من Alpha Dental Clinic.\n\nالتقويم بيبدأ من 12,000 ج.م."),
    "أهلاً بيكي يا أستاذة منى.\n\nالتقويم بيبدأ من 12,000 ج.م."
  );
  // The patient said salaam; their greeting is answered, only the badge comes off. The comma the
  // clause used to follow reads fine in front of the next clause, so it is left alone.
  assert.equal(
    strip("وعليكم السلام يا أستاذة منى، معاكي سارة من Alpha Dental Clinic. أقدر أساعدك في إيه؟"),
    "وعليكم السلام يا أستاذة منى، أقدر أساعدك في إيه؟"
  );
});

run("every shape it takes, in both languages", () => {
  assert.ok(!strip("معاكي سارة من Alpha Dental Clinic يا أستاذة منى. ميعادك يوم الخميس 4:00 م.").includes("سارة"));
  assert.ok(!strip("أنا سارة من Alpha Dental Clinic، وتحت أمر حضرتك في أي وقت تحبيه.").includes("سارة"));
  assert.ok(!strip("معاك سارة. جلسة التنظيف بتبدأ من 350 ج.م والكشف مجاني معاها.").includes("سارة"));
  assert.ok(!strip("Hello Mona! I'm Sarah from Alpha Dental Clinic. Cleaning starts from 350 EGP.").includes("Sarah"));
  assert.ok(!strip("This is Sarah from Alpha Dental Clinic. Your appointment is Thursday at 4 PM.").includes("Sarah"));
  assert.ok(strip("Hello Mona! I'm Sarah from Alpha Dental Clinic. Cleaning starts from 350 EGP.").includes("350 EGP"));
});

run("it never sends an empty or gutted message", () => {
  // A reply that is nothing but the introduction is left alone rather than blanked.
  assert.equal(strip("معاكي سارة من Alpha Dental Clinic."), "معاكي سارة من Alpha Dental Clinic.");
  assert.equal(strip(""), "");
  // No persona configured: nothing to strip, nothing touched.
  assert.equal(stripRepeatIntro("معاكي سارة من العيادة. أهلاً.", "", CLINIC), "معاكي سارة من العيادة. أهلاً.");
});

run("a message that is not an introduction is untouched", () => {
  for (const line of [
    "التقويم بيبدأ من 12,000 ج.م، والتقسيط 2000 وقت التركيب و850 شهرياً.",
    "ميعادك الجاي يوم الخميس 10/9 الساعة 4:00 م مع دكتور محمد إيهاب.",
    "Your appointment is confirmed for Sunday at 10:00 PM.",
    // Somebody else's name that happens to contain the persona's, and a patient called Sarah.
    "دكتورة سارة سليم متاحة يوم الأحد الساعة 5:00 م.",
  ]) {
    assert.equal(strip(line), line, line);
  }
});

console.log("repeatIntro: all suites passed");
