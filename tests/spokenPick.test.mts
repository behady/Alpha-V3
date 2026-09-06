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
