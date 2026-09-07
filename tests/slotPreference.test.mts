import assert from "node:assert/strict";
import { readTimePreference, pickOfferedTimes, windowOf, type Minutes } from "../src/lib/bot/slotPreference";

/**
 * The slots the patient is actually shown.
 *
 * The bug this pins, from a real conversation on 2026-09-07: a clinic open 12pm–10pm offered
 * only 12:00 and 12:30, every day, because the offer was the head of an ascending list. Asked
 * for 9pm on Tuesday the assistant said Tuesday had nothing, with Tuesday 9pm free in the diary.
 * The assistant was obeying its instructions — the list it was handed was the lie.
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

const at = (h: number, m = 0): Minutes => h * 60 + m;
/** A clinic open 12:00–22:00 on 30-minute slots, entirely free. */
const OPEN_DAY: Minutes[] = Array.from({ length: 20 }, (_, i) => at(12) + i * 30);
const BOUNDS = { start: at(12), end: at(22) };

run("the reported case: 9pm on a clinic open till 10pm is offered", () => {
  const pref = readTimePreference("هل متاح الساعه ٩؟", BOUNDS);
  assert.deepEqual(pref, { kind: "at", minutes: at(21) }, "٩ at an afternoon clinic means 9pm");
  const offered = pickOfferedTimes(OPEN_DAY, 2, pref);
  assert.ok(offered.includes(at(21)), `9pm should be offered, got ${offered.map((m) => m / 60)}`);
});

run("without a preference the offer spans the day instead of clustering at opening", () => {
  const offered = pickOfferedTimes(OPEN_DAY, 3, null);
  assert.equal(offered[0], at(12), "still opens with the earliest");
  assert.equal(offered[offered.length - 1], at(21, 30), "and reaches the last slot of the night");
  assert.ok(offered.some((m) => windowOf(m) === "evening"), "an evening option every time");
  // The old behaviour, pinned as what must NOT happen again.
  assert.notDeepEqual(offered.slice(0, 2), [at(12), at(12, 30)], "never the two earliest");
});

run("the words patients actually use", () => {
  const w = (s: string) => readTimePreference(s, BOUNDS);
  assert.deepEqual(w("عايزة ميعاد بالليل"), { kind: "window", window: "evening" });
  assert.deepEqual(w("ينفع بعد الشغل؟"), { kind: "window", window: "evening" });
  assert.deepEqual(w("في حاجة بالمسا"), { kind: "window", window: "evening" });
  assert.deepEqual(w("do you have anything in the evening"), { kind: "window", window: "evening" });
  assert.deepEqual(w("3ayez maw3ed bl leil"), { kind: "window", window: "evening" });
  assert.deepEqual(w("الصبح أحسن ليا"), { kind: "window", window: "morning" });
  assert.deepEqual(w("بعد الضهر"), { kind: "window", window: "afternoon" });
  assert.equal(w("عايز احجز"), null, "no timing mentioned, no preference invented");
});

run("an explicit hour beats a word, and reads am/pm the way a patient means it", () => {
  assert.deepEqual(readTimePreference("الساعة 7 بالليل", BOUNDS), { kind: "at", minutes: at(19) });
  assert.deepEqual(readTimePreference("at 7:30 pm", BOUNDS), { kind: "at", minutes: at(19, 30) });
  assert.deepEqual(readTimePreference("الساعة 10 الصبح", BOUNDS), { kind: "at", minutes: at(10) });
  assert.deepEqual(readTimePreference("13:15", BOUNDS), { kind: "at", minutes: at(13, 15) });
  // A morning clinic hears a bare "9" as 9am; an afternoon clinic hears 9pm.
  assert.deepEqual(readTimePreference("الساعة 9", { start: at(9), end: at(17) }), { kind: "at", minutes: at(9) });
  assert.deepEqual(readTimePreference("الساعة 9", BOUNDS), { kind: "at", minutes: at(21) });
});

run("a bare number in an ordinary sentence is not a time", () => {
  assert.equal(readTimePreference("عندي 3 اسنان بتوجعني", BOUNDS), null);
  assert.equal(readTimePreference("التقويم بكام؟ 12000 غالي", BOUNDS), null);
  assert.equal(readTimePreference("انا عندي 30 سنة", BOUNDS), null);
});

run("Arabic words are matched whole, never inside a longer word", () => {
  // "صبح" sits inside "أصبح"/"يصبح"; "مسا" inside "مساعدة" — neither is a request for a time.
  assert.equal(readTimePreference("محتاج مساعدة لو سمحت", BOUNDS), null);
  assert.equal(readTimePreference("الوجع أصبح أسوأ", BOUNDS), null);
});

run("a window filters the day, and an impossible window yields nothing for the caller to fall back from", () => {
  const evening = pickOfferedTimes(OPEN_DAY, 3, { kind: "window", window: "evening" });
  assert.ok(evening.length > 0);
  assert.ok(evening.every((m) => m >= at(17)), `all evening, got ${evening.map((m) => m / 60)}`);

  const morningAtAfternoonClinic = pickOfferedTimes(OPEN_DAY, 3, { kind: "window", window: "morning" });
  assert.deepEqual(morningAtAfternoonClinic, [], "the day contributes nothing rather than a wrong-window time");
});

run("a nearly full day still offers what is left, and an exact hour that is taken falls to its neighbour", () => {
  const almostFull = [at(12), at(20, 30), at(21)];
  assert.deepEqual(pickOfferedTimes(almostFull, 3, null), almostFull, "fewer free than asked for: offer them all");

  const nineTaken = [at(20), at(20, 30), at(21, 30)];
  const offered = pickOfferedTimes(nineTaken, 2, { kind: "at", minutes: at(21) });
  assert.deepEqual(offered, [at(20, 30), at(21, 30)], "the two nearest to 9pm, in time order");
});

run("an empty day offers nothing, and never throws", () => {
  assert.deepEqual(pickOfferedTimes([], 3, null), []);
  assert.deepEqual(pickOfferedTimes([], 3, { kind: "at", minutes: at(21) }), []);
  assert.deepEqual(pickOfferedTimes(OPEN_DAY, 0, null), []);
  assert.equal(readTimePreference("", BOUNDS), null);
  assert.equal(readTimePreference("   "), null);
});

run("offers always come back in time order, whatever was asked for", () => {
  for (const pref of [null, { kind: "window", window: "evening" } as const, { kind: "at", minutes: at(21) } as const]) {
    const offered = pickOfferedTimes(OPEN_DAY, 3, pref);
    assert.deepEqual(offered, [...offered].sort((a, b) => a - b), `not sorted for ${JSON.stringify(pref)}`);
  }
});
