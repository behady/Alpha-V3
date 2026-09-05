import assert from "node:assert/strict";
import { parseDayWord } from "../src/lib/bot/dayWords";
import { guessGender, voiceFor } from "../src/lib/arabicNames";

/**
 * The day a patient named, and the person they are.
 *
 * Two small pieces of reading that the booking flow and the voice depend on. Dates are anchored
 * to a known Tuesday so every weekday offset is checked against a fixed calendar rather than
 * against whatever day the test happens to run on.
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

// 2026-09-01 is a Tuesday.
const TUE = "2026-09-01";

run("relative day words resolve against the clinic's today", () => {
  assert.equal(parseDayWord("ممكن ميعاد بكره", TUE), "2026-09-02");
  assert.equal(parseDayWord("بعد بكره ينفع؟", TUE), "2026-09-03");
  assert.equal(parseDayWord("عايز احجز النهارده", TUE), TUE);
  assert.equal(parseDayWord("ينفع دلوقتي", TUE), TUE);
  // "بعد بكره" must not be read as "بكره" plus noise.
  assert.notEqual(parseDayWord("بعد بكره", TUE), "2026-09-02");
});

run("weekday names in the spellings people type", () => {
  assert.equal(parseDayWord("الخميس", TUE), "2026-09-03");
  assert.equal(parseDayWord("يوم السبت", TUE), "2026-09-05");
  assert.equal(parseDayWord("الاتنين الجاي", TUE), "2026-09-07");
  assert.equal(parseDayWord("التلات", TUE), TUE, "a bare weekday that is today means today");
  assert.equal(parseDayWord("التلات الجاي", TUE), "2026-09-08", "'next' on today's weekday means next week");
  assert.equal(parseDayWord("الجمعه", TUE), "2026-09-04");
});

run("no day word means no date — never a guess", () => {
  assert.equal(parseDayWord("عايز احجز", TUE), null);
  assert.equal(parseDayWord("التنظيف بكام", TUE), null);
  assert.equal(parseDayWord("", TUE), null);
  // A calendar date is deliberately not parsed.
  assert.equal(parseDayWord("يوم ٢/٩", TUE), null);
});

run("gender from an Egyptian first name, neutral when unsure", () => {
  assert.equal(guessGender("فاطمة محمد"), "female");
  assert.equal(guessGender("منة الله"), "female");
  assert.equal(guessGender("د. هبة"), "female");
  assert.equal(guessGender("مريم"), "female");
  assert.equal(guessGender("سارة أحمد"), "female");
  assert.equal(guessGender("أحمد طارق"), "unknown");
  assert.equal(guessGender("ahmed tarek"), "unknown");
  // Men's names ending in ة must not be read as women's.
  assert.equal(guessGender("أسامة"), "male");
  assert.equal(guessGender("حمزة علي"), "male");
  assert.equal(guessGender(""), "unknown");
});

run("the voice inflects for women and defaults to the masculine forms", () => {
  assert.equal(voiceFor("female").withYou, "معاكي");
  assert.equal(voiceFor("female").send, "ابعتي");
  assert.equal(voiceFor("male").withYou, "معاك");
  assert.equal(voiceFor("unknown").send, "ابعت");
});

console.log("\ndayWords: all suites passed");
