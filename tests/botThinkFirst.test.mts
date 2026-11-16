// The bot reads the whole burst before it answers, and books the hour the patient named.
//
// Two real conversations on 16/11/2026, Alpha Dental:
//   1. Four photos and "😆😆😆", "😆😆" inside six seconds. A photo's turn and an emoji's turn each
//      answered: three bubbles in five seconds, the same "today 8:00 or tomorrow 3:00?" twice.
//   2. "ممكن بكره س٦" (tomorrow at 6). The model read "س٦" as its slot id "s6" — the sixth slot,
//      tomorrow 10:30 م — booked it, and confirmed "حجزتلك بكره" with no time.
//
// Run with tsx: npx tsx tests/botThinkFirst.test.mts
import assert from "node:assert/strict";
import { waitForQuiet, SETTLE_QUIET_MS, SETTLE_MAX_MS, type NewerLine } from "../src/lib/bot/settle";
import { honourAskedHour, readTimePreference, slotKeyMinutes } from "../src/lib/bot/slotPreference";
import { photoNoteSummary } from "../src/lib/bot/thread";

let checks = 0;
const ok = (cond: unknown, message: string) => {
  assert.ok(cond, message);
  checks++;
};
const eq = <T,>(a: T, b: T, message: string) => {
  assert.deepEqual(a, b, message);
  checks++;
};

/** A fake clock and an inbox that fills at given moments. */
function scenario(arrivals: Array<{ at: number; takesOver: boolean }>, start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    newer: async (): Promise<NewerLine[]> => arrivals.filter((a) => a.at <= t),
    elapsed: () => t - start,
  };
}

// --- 1. Waiting for the patient to finish ---------------------------------------------------------
{
  const s = scenario([]);
  eq(await waitForQuiet({ since: 0, ...s }), "quiet", "a lone message is answered");
  eq(s.elapsed(), SETTLE_QUIET_MS, "after the quiet pause, not instantly");
}
{
  // The photo turn: "😆😆😆" 4 s later and "😆😆" 6 s later both reach the model themselves.
  const s = scenario([{ at: 4000, takesOver: true }, { at: 6000, takesOver: true }]);
  eq(await waitForQuiet({ since: 0, ...s }), "superseded", "the photo's turn steps aside for the newer message");
  ok(s.elapsed() < SETTLE_QUIET_MS, "and stops as soon as it sees it");
}
{
  // The last emoji's turn: nothing newer, so it answers the whole burst once.
  const s = scenario([], 6000);
  eq(await waitForQuiet({ since: 6000, ...s }), "quiet", "the newest message's turn answers");
}
{
  // An album keeps arriving: photos never take over, but the answer waits for the last one.
  const s = scenario([{ at: 1000, takesOver: false }, { at: 2500, takesOver: false }, { at: 4000, takesOver: false }]);
  eq(await waitForQuiet({ since: 0, ...s }), "quiet", "album photos do not silence the answer");
  ok(s.elapsed() >= 4000 + SETTLE_QUIET_MS, "it waits until the album has stopped");
}
{
  // Someone typing non-stop: answered by the cap, not never.
  const flood = Array.from({ length: 40 }, (_, i) => ({ at: (i + 1) * 1000, takesOver: false }));
  const s = scenario(flood);
  eq(await waitForQuiet({ since: 0, ...s }), "quiet", "a flood still gets an answer");
  ok(s.elapsed() <= SETTLE_MAX_MS + 1500, "within the cap");
}
{
  // A failed read never blocks the answer.
  let t = 0;
  const r = await waitForQuiet({ since: 0, now: () => t, sleep: async (ms) => void (t += ms), newer: async () => { throw new Error("offline"); } });
  eq(r, "quiet", "a read failure answers as before");
}

// --- 2. "س٦" is six o'clock ----------------------------------------------------------------------
const BOUNDS = { start: 15 * 60, end: 23 * 60 };
eq(readTimePreference("ممكن بكره س٦", BOUNDS), { kind: "at", minutes: 18 * 60 }, "س٦ at an evening clinic is 6 م");
eq(readTimePreference("حاولى تحجزى س 6", BOUNDS), { kind: "at", minutes: 18 * 60 }, "with a space and Latin digits");
eq(readTimePreference("يافندم س٦:٣٠", BOUNDS), { kind: "at", minutes: 18 * 60 + 30 }, "with minutes");
eq(readTimePreference("عندي درس 3 بكره", BOUNDS), null, "a س inside a word is not a clock");
eq(readTimePreference("الساعة ٩", BOUNDS), { kind: "at", minutes: 21 * 60 }, "the old shapes still read");

// --- 3. The booking honours the hour -------------------------------------------------------------
eq(slotKeyMinutes("2026-11-17|10:30 PM|"), 22 * 60 + 30, "slot key clock");
eq(slotKeyMinutes("2026-11-17|12:00 PM|Dr"), 12 * 60, "noon");
eq(slotKeyMinutes("2026-11-17|12:15 AM|Dr"), 15, "just after midnight");
eq(slotKeyMinutes("garbage"), null, "not a slot key");

const offered = ["2026-11-16|07:30 PM|", "2026-11-17|03:00 PM|", "2026-11-17|06:00 PM|", "2026-11-18|06:00 PM|", "2026-11-17|10:30 PM|"];
eq(honourAskedHour(18 * 60, "2026-11-17|10:30 PM|", offered), "2026-11-17|06:00 PM|", "the reported case: 6 on the same day replaces 10:30");
eq(honourAskedHour(18 * 60, "2026-11-17|06:00 PM|", offered), "2026-11-17|06:00 PM|", "a right pick stands");
eq(honourAskedHour(6 * 60, "2026-11-17|06:00 PM|", offered), "2026-11-17|06:00 PM|", "6 and 18:00 are the same request");
eq(honourAskedHour(20 * 60, "2026-11-17|10:30 PM|", offered), null, "no slot at the asked hour: nothing is booked");
eq(honourAskedHour(18 * 60, "2026-11-19|03:00 PM|", offered), null, "another day's 6:00 is not taken instead");

// --- 4. A photo in the history is the patient's -------------------------------------------------
eq(photoNoteSummary("🖼️ وصف الصورة (للفريق): صورة لشعر سيدة من الخلف."), "صورة لشعر سيدة من الخلف.", "the summary");
eq(photoNoteSummary("🖼️ وصف الصورة (للفريق): ضرس مكسور — ⚠️ يبدو عاجل\nقراءة مبدئية: كسر في الحشو"), "ضرس مكسور", "without the staff-only flag and reading");
eq(photoNoteSummary("مساء الخير"), null, "any other line");

console.log(`botThinkFirst: ${checks} checks passed`);
