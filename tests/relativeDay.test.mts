import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixRelativeDayWords, relativeDayWord, shiftDateKey } from "../src/lib/bot/relativeDay";

/**
 * "Today is never called tomorrow."
 *
 * On Saturday 14/11 at 06:52 the assistant offered "بكره السبت الساعة 3:00 م": today's slot,
 * called tomorrow. The weekday and date come from the code's own slot labels and are right; the
 * relative word is the model's guess. The check corrects the word against the calendar, and leaves
 * every reply it cannot read for certain byte-identical.
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

const SAT = "2026-11-14"; // Saturday, the day of the incident
const FRI = "2026-11-13";
const WED = "2026-11-11";

run("the incident, verbatim: بكره السبت on a Saturday becomes النهارده السبت", () => {
  assert.equal(
    fixRelativeDayWords("عندي ميعاد مناسب لحضرتك بكره السبت الساعة 3:00 م أو 6:30 م، تحب نثبت أنهي ميعاد؟", SAT),
    "عندي ميعاد مناسب لحضرتك النهارده السبت الساعة 3:00 م أو 6:30 م، تحب نثبت أنهي ميعاد؟"
  );
});

run("right words, bare words and lookalikes are left byte-identical", () => {
  for (const s of [
    "النهارده السبت 14/11 الساعة 3:00 م",
    "بكره الأحد 15/11 الساعة 6:30 م",
    "بعد بكره الإثنين 16/11",
    "عندي السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 6:30 م",
    "عندي بكره الساعة 3:00 م",
    "تنورنا بكره أو السبت الجاي",
    "النهارده حد من الاستقبال هيكلمك",
    "اليوم السبت مش مناسب",
    "بكره، السبت 14/11",
    "شوبكره السبت",
    "",
  ])
    assert.equal(fixRelativeDayWords(s, SAT), s, s);
  // Two different days joined by a comma are not one day said twice.
  assert.equal(fixRelativeDayWords("لو مش هينفع بكره، السبت فيه مواعيد", WED), "لو مش هينفع بكره، السبت فيه مواعيد");
});

run("a line break ends the statement: a day word closing one line is not the next line's day", () => {
  // Before: "مفيش مواعيد فاضية النهارده" became "... بكره", telling the patient tomorrow was full.
  for (const [s, today] of [
    ["مفيش مواعيد فاضية النهارده\n\nالأحد 15/11 الساعة 3:00 م أو الإثنين 16/11 الساعة 6:30 م", SAT],
    ["للأسف إحنا أجازة النهارده\nالسبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 6:30 م", FRI],
    ["مفيش حاجة بكره\r\nالسبت 21/11 الساعة 3:00 م", SAT],
    ["We're closed today\n\nSaturday 14/11 at 3:00 PM or Sunday 15/11 at 6:30 PM", FRI],
  ])
    assert.equal(fixRelativeDayWords(s, today), s, s);
  // On one line it is still one statement, and still corrected.
  assert.equal(fixRelativeDayWords("العنوان شارع الرحمة.\n\nعندي بكره السبت الساعة 3:00 م", SAT), "العنوان شارع الرحمة.\n\nعندي النهارده السبت الساعة 3:00 م");
  const nbsp = String.fromCharCode(0xa0);
  assert.equal(fixRelativeDayWords(`عندي بكره${nbsp}السبت 14/11`, SAT), `عندي النهارده${nbsp}السبت 14/11`, "a no-break space is still a space");
  // A date on the next line does not overrule the weekday beside the word.
  assert.equal(fixRelativeDayWords("بكره السبت\n21/11 مش متاح", SAT), "النهارده السبت\n21/11 مش متاح");
});

run("next week's day is a different day: السبت الجاي is never touched", () => {
  for (const s of ["بكره السبت الجاي", "بكره السبت الجاية", "النهارده الأحد اللي جاي", "بكره السبت القادم", "بعد بكره الخميس الجاى"])
    assert.equal(fixRelativeDayWords(s, SAT), s, s);
});

run("the mirror: النهارده before tomorrow's day becomes بكره", () => {
  assert.equal(fixRelativeDayWords("النهارده الأحد 15/11 الساعة 3:00 م", SAT), "بكره الأحد 15/11 الساعة 3:00 م");
  assert.equal(fixRelativeDayWords("بعد بكره الأحد", SAT), "بكره الأحد");
  assert.equal(fixRelativeDayWords("إنهاردة الأحد", SAT), "بكره الأحد");
});

run("the date wins over the weekday, and a date further out drops the word", () => {
  assert.equal(fixRelativeDayWords("بكره السبت 21/11 الساعة 3:00 م", SAT), "السبت 21/11 الساعة 3:00 م");
  assert.equal(fixRelativeDayWords("بكره 14/11 الساعة 3:00 م", SAT), "النهارده 14/11 الساعة 3:00 م");
  assert.equal(fixRelativeDayWords("بكرة يوم الثلاثاء", SAT), "يوم الثلاثاء");
  assert.equal(fixRelativeDayWords("بكره السبت ١٤/١١", SAT), "النهارده السبت ١٤/١١", "Arabic-Indic digits");
  assert.equal(fixRelativeDayWords("بكره (السبت 14/11)", SAT), "النهارده (السبت 14/11)");
  assert.equal(fixRelativeDayWords("عندي بكره (السبت 21/11)", SAT), "عندي (السبت 21/11)", "the bracket stays when the word goes");
});

run("an Arabic comma after the day, and an attached و, as seen in live replies", () => {
  assert.equal(fixRelativeDayWords("أيوه متاح بكره الأربعاء، عندي ميعاد الساعة 8:00 م", WED), "أيوه متاح النهارده الأربعاء، عندي ميعاد الساعة 8:00 م");
  assert.equal(fixRelativeDayWords("عندي السبت 3:00 م وبكره الأحد 6:30 م", SAT), "عندي السبت 3:00 م وبكره الأحد 6:30 م");
  assert.equal(fixRelativeDayWords("عندي الأحد 3:00 م وبكره السبت 6:30 م", SAT), "عندي الأحد 3:00 م والنهارده السبت 6:30 م");
  assert.equal(fixRelativeDayWords("وبكره السبت 21/11", SAT), "والسبت 21/11");
  assert.equal(fixRelativeDayWords("وبكرة يوم الثلاثاء", SAT), "ويوم الثلاثاء");
});

run("on a Friday, بكره السبت is right", () => {
  assert.equal(fixRelativeDayWords("بكره السبت 14/11 الساعة 3:00 م", FRI), "بكره السبت 14/11 الساعة 3:00 م");
});

run("English: today/tomorrow beside a weekday or date", () => {
  assert.equal(fixRelativeDayWords("I have tomorrow, Saturday 14/11 at 3:00 PM", SAT), "I have today, Saturday 14/11 at 3:00 PM");
  assert.equal(fixRelativeDayWords("Tomorrow Sunday 15/11 works", SAT), "Tomorrow Sunday 15/11 works");
  assert.equal(fixRelativeDayWords("Today Sunday 15/11 works", SAT), "Tomorrow Sunday 15/11 works");
  // No word fits: it is dropped, with no stray "on" or comma left behind.
  assert.equal(fixRelativeDayWords("I have tomorrow, Saturday 21/11 at 3:00 PM", SAT), "I have Saturday 21/11 at 3:00 PM");
  assert.equal(fixRelativeDayWords("Tomorrow on Saturday 21/11 works", SAT), "Saturday 21/11 works");
  assert.equal(fixRelativeDayWords("See you tomorrow at 3:00 PM", SAT), "See you tomorrow at 3:00 PM", "bare: untouched");
});

run("no today, or a bad one: the text comes back as it was", () => {
  const s = "بكره السبت الساعة 3:00 م";
  assert.equal(fixRelativeDayWords(s, ""), s);
  assert.equal(fixRelativeDayWords(s, "14/11/2026"), s);
});

run("the word helper, across a month and a year boundary", () => {
  assert.equal(relativeDayWord("2026-11-14", SAT), "النهارده");
  assert.equal(relativeDayWord("2026-11-15", SAT), "بكره");
  assert.equal(relativeDayWord("2026-11-16", SAT), "بعد بكره");
  assert.equal(relativeDayWord("2026-11-17", SAT), "");
  assert.equal(relativeDayWord("2026-11-13", SAT), "", "yesterday takes no word");
  assert.equal(relativeDayWord("2027-01-01", "2026-12-31"), "بكره");
  assert.equal(relativeDayWord("2026-12-01", "2026-11-30"), "بكره");
  assert.equal(relativeDayWord("not-a-date", SAT), "");
  assert.equal(shiftDateKey("2026-02-28", 1), "2026-03-01");
  assert.equal(fixRelativeDayWords("النهارده الجمعة 1/1", "2026-12-31"), "بكره الجمعة 1/1");
});

run("wiring: respond.ts checks the reply before the times are read from it; aiReply passes today", () => {
  const src = readFileSync(new URL("../src/lib/bot/respond.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const names = src.indexOf("if (settings.hideDoctorNames && profile?.doctors.length");
  const fix = src.indexOf("const dayFixed = fixRelativeDayWords(ai.text, clinicNow().dateKey);");
  const agree = src.indexOf("isBareAgreement(act.question)) {");
  const spoken = src.indexOf("spokenSlotKeys = spokenSlots(said, slotOffer, clinicNow().dateKey);");
  const hold = src.indexOf("holdRepeatOffer({");
  assert.ok(names > 0 && fix > 0 && agree > 0 && spoken > 0 && hold > 0);
  assert.ok(names < fix && fix < agree && fix < spoken && spoken < hold, "after the name check, before the times are read");
  const block = src.slice(fix - 200, fix + 500);
  assert.ok(block.includes('ai.kind === "answer" || ai.kind === "handoff"'), "either kind of reply, either brain");
  assert.ok(/if \(!args\.dryRun\) \{\s*void adminClinicCollection\(clinicId, "ai_debug"\)\s*\.add\(\{ kind: "relative_day_fixed"/.test(block), "no debug write from the playground");
  const ai = readFileSync(new URL("../src/lib/bot/aiReply.ts", import.meta.url), "utf8");
  assert.ok(ai.includes("todayKey: clinicNow().dateKey,"), "the standard brain's prompt is told today");
});
