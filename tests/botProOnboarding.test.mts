/**
 * Onboarding store and transcript helpers: the pure pieces (phone masking, transcripts, "did this
 * chat end in a booking", and the tolerant parse of the saved state). The Firestore store itself is
 * thin and covered by the typecheck.
 *
 * Run: npm run test:pro-onboarding
 */
import assert from "node:assert/strict";
import { EMPTY_LAYER } from "../src/lib/botPro/layer";
import { EMPTY_STATE, readState, toMs } from "../src/lib/botPro/onboarding/store";
import { bookedAfter, maskPhones, transcriptOf, type RawConversation } from "../src/lib/botPro/onboarding/transcript";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 10, 0, 0);

const conv = (messages: Array<[string, string]>, appointmentsCreatedAt: number[] = []): RawConversation => ({
  key: "k",
  messages: messages.map(([author, text], i) => ({ author, text, at: T0 + i * 60_000 })),
  appointmentsCreatedAt,
});

const longestDigitRun = (s: string) => Math.max(0, ...(s.match(/[0-9٠-٩]+/g) ?? []).map((r) => r.length));

test("maskPhones hides Latin and Arabic-Indic numbers, spaces and all", () => {
  const out = maskPhones("كلمني على 0101 234 5678 او ٠١٢٣٤٥٦٧٨٩");
  assert.ok(longestDigitRun(out.replace(/[ \-]/g, "")) < 7, out);
  assert.equal(out, "كلمني على <رقم> او <رقم>");
});
test("maskPhones leaves short numbers alone", () => {
  assert.equal(maskPhones("الساعة 5 يوم 12 وعندي 3 اسنان"), "الساعة 5 يوم 12 وعندي 3 اسنان");
});
test("maskPhones handles dashes and a plus sign", () => {
  const out = maskPhones("+20 100-123-4567");
  assert.ok(!/\d{7}/.test(out.replace(/[ \-]/g, "")), out);
});

test("transcriptOf is null for a patient-only chat", () => {
  assert.equal(transcriptOf(conv([["patient", "ازيك"], ["patient", "عايز احجز"]])), null);
});
test("transcriptOf is null for a clinic-only chat", () => {
  assert.equal(transcriptOf(conv([["bot", "اهلا"], ["staff", "تحت امرك"]])), null);
});
test("transcriptOf labels authors and skips bracket lines", () => {
  const t = transcriptOf(conv([["patient", "عايز احجز"], ["patient", "[صورة]"], ["staff", "اتفضل يا فندم"], ["bot", "تحب الساعة كام؟"]]));
  assert.equal(t, "مريض: عايز احجز\nالاستقبال: اتفضل يا فندم\nالبوت: تحب الساعة كام؟");
});
test("transcriptOf ignores system lines and masks phones", () => {
  const t = transcriptOf(conv([["patient", "رقمي 01012345678"], ["system", "تذكير"], ["staff", "تمام"]]));
  assert.equal(t, "مريض: رقمي <رقم>\nالاستقبال: تمام");
});
test("transcriptOf cuts from the oldest line when over maxChars", () => {
  const lines: Array<[string, string]> = [];
  for (let i = 0; i < 40; i++) lines.push([i % 2 ? "staff" : "patient", `رسالة رقم ${i} ${"ا".repeat(30)}`]);
  const t = transcriptOf(conv(lines), 300)!;
  assert.ok(t.length <= 300, String(t.length));
  assert.ok(t.includes("رسالة رقم 39"));
  assert.ok(!t.includes("رسالة رقم 0 "));
});

test("bookedAfter: 3 days after the first patient line is a booking", () => {
  assert.equal(bookedAfter(conv([["staff", "اهلا"], ["patient", "عايز احجز"]], [T0 + 60_000 + 3 * DAY])), true);
});
test("bookedAfter: 20 days after is not", () => {
  assert.equal(bookedAfter(conv([["patient", "عايز احجز"], ["staff", "تمام"]], [T0 + 20 * DAY])), false);
});
test("bookedAfter: an appointment before the chat is not", () => {
  assert.equal(bookedAfter(conv([["patient", "عايز احجز"], ["staff", "تمام"]], [T0 - 2 * DAY])), false);
});
test("bookedAfter: no patient message means false", () => {
  assert.equal(bookedAfter(conv([["staff", "اهلا"]], [T0 + DAY])), false);
});

test("readState(undefined) is the empty state", () => {
  assert.deepEqual(readState(undefined), EMPTY_STATE);
  assert.deepEqual(readState(null), EMPTY_STATE);
  assert.deepEqual(readState("junk"), EMPTY_STATE);
});
test("readState hands out fresh copies, never the shared empty state", () => {
  const a = readState(undefined);
  a.scan.queue.push("x");
  a.draft.rules.push("y");
  assert.deepEqual(EMPTY_STATE.scan.queue, []);
  assert.deepEqual(EMPTY_STATE.draft, EMPTY_LAYER);
});
test("readState keeps what is there and fills the rest", () => {
  const s = readState({ scan: { status: "running", queue: ["a"] } });
  assert.equal(s.scan.status, "running");
  assert.deepEqual(s.scan.queue, ["a"]);
  assert.equal(s.scan.total, 0);
  assert.equal(s.scan.lockUntil, 0);
  assert.equal(s.nextVersion, EMPTY_STATE.nextVersion);
  assert.deepEqual(s.usage, { calls: 0, inTok: 0, outTok: 0 });
});
test("readState survives wrong types", () => {
  const s = readState({
    scan: { status: "bogus", queue: [1, "b", null], total: "7", done: 3, error: 5 },
    learned: "x",
    questions: ["q", 4],
    liveVersion: 9,
    nextVersion: -2,
    usage: { calls: 2, inTok: "x" },
  });
  assert.equal(s.scan.status, "idle");
  assert.deepEqual(s.scan.queue, ["b"]);
  assert.equal(s.scan.total, 0);
  assert.equal(s.scan.done, 3);
  assert.equal(s.scan.error, undefined);
  assert.deepEqual(s.learned, []);
  assert.deepEqual(s.questions, ["q"]);
  assert.equal(s.liveVersion, null);
  assert.equal(s.nextVersion, EMPTY_STATE.nextVersion);
  assert.deepEqual(s.usage, { calls: 2, inTok: 0, outTok: 0 });
});
test("readState sanitises the draft", () => {
  const s = readState({ draft: { rules: ["رحّب بالمريض", "الكشف بـ 300 جنيه"], neverSay: ["ارخص عيادة"] } });
  assert.deepEqual(s.draft.rules, ["رحّب بالمريض"]);
  assert.deepEqual(s.draft.neverSay, ["ارخص عيادة"]);
});
test("readState keeps optional scan times and error only when valid", () => {
  const s = readState({ scan: { status: "failed", startedAt: 5, finishedAt: 9, error: "boom" } });
  assert.equal(s.scan.startedAt, 5);
  assert.equal(s.scan.finishedAt, 9);
  assert.equal(s.scan.error, "boom");
});

test("toMs reads timestamps, numbers and ISO strings, and drops the rest", () => {
  assert.equal(toMs({ toMillis: () => 123 }), 123);
  assert.equal(toMs(456), 456);
  assert.equal(toMs("2026-10-01T10:00:00.000Z"), T0);
  assert.equal(toMs("not a date"), null);
  assert.equal(toMs(undefined), null);
  assert.equal(toMs({}), null);
});
