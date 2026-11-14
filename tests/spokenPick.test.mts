import assert from "node:assert/strict";
import { resolveSpokenPick } from "../src/lib/bot/spokenPick";

/**
 * The turn where bookings were being lost.
 *
 * The assistant speaks two times aloud; the patient answers in three words. Asking the model to
 * classify that as "book this one" worked about half the time, and the other half a patient who
 * had already chosen was sent back to the dentist menu — or, if they were new, registered with no
 * appointment at all. This reads the choice instead.
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

const TWO = [
  { key: "2026-09-06|10:00 PM|Mohamed Ehab", label: "الأحد 6/9 الساعة 10:00 م مع Mohamed Ehab" },
  { key: "2026-09-07|03:00 PM|Mohamed Ehab", label: "الإثنين 7/9 الساعة 3:00 م مع Mohamed Ehab" },
];

run("an ordinal picks by position, in either language", () => {
  assert.equal(resolveSpokenPick("الاول", TWO), TWO[0].key);
  assert.equal(resolveSpokenPick("الأولاني", TWO), TWO[0].key);
  assert.equal(resolveSpokenPick("الاول يناسبني", TWO), TWO[0].key);
  assert.equal(resolveSpokenPick("the first one works", TWO), TWO[0].key);
  assert.equal(resolveSpokenPick("التاني احسن", TWO), TWO[1].key);
  assert.equal(resolveSpokenPick("second please", TWO), TWO[1].key);
  // A position nobody offered is not a pick.
  assert.equal(resolveSpokenPick("التالت", TWO), null);
});

run("a time or a day said back is a pick when it is unambiguous", () => {
  assert.equal(resolveSpokenPick("يبقى الساعة 10", TWO), TWO[0].key);
  assert.equal(resolveSpokenPick("3:00 تمام", TWO), TWO[1].key);
  assert.equal(resolveSpokenPick("الإثنين احسن ليا", TWO), TWO[1].key);
  assert.equal(resolveSpokenPick("الاحد", TWO), TWO[0].key);
  // Two slots on the same day: the day alone decides nothing.
  const sameDay = [
    { key: "2026-09-06|10:00 PM|A", label: "الأحد 6/9 الساعة 10:00 م مع A" },
    { key: "2026-09-06|10:30 PM|A", label: "الأحد 6/9 الساعة 10:30 م مع A" },
  ];
  assert.equal(resolveSpokenPick("الأحد", sameDay), null);
  assert.equal(resolveSpokenPick("10:30", sameDay), sameDay[1].key);
});

run("agreement counts only when there is nothing to be ambiguous about", () => {
  const one = [TWO[0]];
  assert.equal(resolveSpokenPick("تمام", one), one[0].key);
  assert.equal(resolveSpokenPick("ok", one), one[0].key);
  // With two on the table, "that one" is a question for the model, not an answer.
  assert.equal(resolveSpokenPick("تمام", TWO), null);
  assert.equal(resolveSpokenPick("يبقى الميعاد ده", TWO), null);
});

run("a sentence is not a pick", () => {
  assert.equal(resolveSpokenPick("", TWO), null);
  assert.equal(resolveSpokenPick("عايزة اعرف الاول سعر التنظيف وبعدين نشوف الميعاد المناسب ليا في الاسبوع الجاي", TWO), null);
  assert.equal(resolveSpokenPick("الاول", []), null);
});

// ------------------------------------------------------------------------------------------------
// What the reply said out loud. The real case: Saturday 6:30 or Sunday 3:00 was offered, Sunday
// 6:30 was ALSO stored because "الأحد" appeared somewhere, and "الأول" booked a time never offered.
// ------------------------------------------------------------------------------------------------
import { spokenSlots } from "../src/lib/bot/spokenPick";

const FOUR = [
  { key: "sat330", label: "السبت 14/11 الساعة 3:30 م" },
  { key: "sat630", label: "السبت 14/11 الساعة 6:30 م" },
  { key: "sun300", label: "الأحد 15/11 الساعة 3:00 م" },
  { key: "sun630", label: "الأحد 15/11 الساعة 6:30 م" },
];

run("a clock belongs to the day said just before it", () => {
  assert.deepEqual(spokenSlots("عندي ميعاد السبت الساعة 6:30 م أو الأحد الساعة 3:00 م، إيه اللي يناسبك؟", FOUR), ["sat630", "sun300"]);
  assert.deepEqual(spokenSlots("يناسبك ميعاد السبت الساعة 6:30 م ولا الأحد الساعة 6:30 م؟", FOUR), ["sat630", "sun630"]);
  assert.deepEqual(spokenSlots("متاح الأحد 15/11 الساعة 3:00 م أو الساعة 6:30 م.", FOUR), ["sun300", "sun630"]);
  // Spelled without the hamza, as the model often does.
  assert.deepEqual(spokenSlots("الاحد الساعة 6:30", FOUR), ["sun630"]);
});

run("without a day, only a clock one slot carries counts", () => {
  assert.deepEqual(spokenSlots("عندي بكره الساعة 3:30 أو 6:30", FOUR), ["sat330"]);
  assert.deepEqual(spokenSlots("أهلاً بيك، تحب تحجز؟", FOUR), []);
});

run("the pick then lands on what was heard", () => {
  const heard = spokenSlots("عندي ميعاد السبت الساعة 6:30 م أو الأحد الساعة 3:00 م", FOUR).map((k) => FOUR.find((s) => s.key === k)!);
  assert.equal(resolveSpokenPick("الأول", heard), "sat630");
  assert.equal(resolveSpokenPick("التاني", heard), "sun300");
  assert.equal(resolveSpokenPick("تمام", heard), null, "agreement between two times picks neither");
});

import { isBareAgreement } from "../src/lib/bot/spokenPick";

run("agreement and nothing else", () => {
  assert.equal(isBareAgreement("تمام"), true);
  assert.equal(isBareAgreement("ماشي 👍"), true);
  assert.equal(isBareAgreement("اوك تمام"), true);
  assert.equal(isBareAgreement("تمام الأول"), false, "that is a pick");
  assert.equal(isBareAgreement("تمام بس المكان فين"), false, "that is a question");
  assert.equal(isBareAgreement("شكرا"), false);
  assert.equal(isBareAgreement(""), false);
});
