/**
 * The desk comes first: an answer composed while a receptionist was typing is not sent over her,
 * and a patient already told "the team has your message" is not told again on every message.
 *
 * Asnany, 25-26/11/2026 (Africa/Cairo):
 *   - …085935: the patient asked for 8 pm at 17:54:21. Reception typed "للاسف مواعيد انهارده
 *     مقفوله" on the clinic phone at 17:54:52; the model's answer, composed meanwhile, offered
 *     6 pm today one second later.
 *   - …436157: reception quoted 550 at 15:00:16; the model's 500 followed at 15:00:28.
 *   - …997971: swelling after a root canal. The model handed her to the team, then wrote a new
 *     apology and "I told the doctor right now" for every message she sent: about 25 in 66 minutes.
 *
 * The rules are pure (lib/bot/deskFirst) and tested directly; respond.ts opens the database on
 * import, so its wiring is checked at the source, as the other respond.ts suites do.
 * Run: npm run test:bot-desk-first
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { holdingLineAlreadySaid, staffAnsweredMeanwhile, yieldsToStaff } from "../src/lib/bot/deskFirst";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const T = (hms: string) => Date.parse(`2026-11-25T${hms}+02:00`);
const HOUR = 60 * 60 * 1000;

// --------------------------------------------------------------- staff wrote while it composed --
test("a staff message after the patient's message means the answer is theirs", () => {
  // The real one: patient 17:54:21, reception 17:54:52.
  assert.equal(staffAnsweredMeanwhile(T("17:54:52"), T("17:54:21")), true);
});

test("a staff message from before the patient's message does not", () => {
  assert.equal(staffAnsweredMeanwhile(T("17:40:00"), T("17:54:21")), false);
  assert.equal(staffAnsweredMeanwhile(T("17:54:21"), T("17:54:21")), false, "the same instant is not after");
});

test("no staff stamp at all (never written, or handed back to the bot) does not", () => {
  assert.equal(staffAnsweredMeanwhile(0, T("17:54:21")), false);
  assert.equal(staffAnsweredMeanwhile(undefined, T("17:54:21")), false);
  assert.equal(staffAnsweredMeanwhile("x", T("17:54:21")), false);
});

test("only the model's talk gives way: a booking or a card already acted on still goes", () => {
  assert.equal(yieldsToStaff("ai_answer"), true);
  assert.equal(yieldsToStaff("ai_handoff_other"), true);
  assert.equal(yieldsToStaff("ai_handoff_medical"), true);
  assert.equal(yieldsToStaff("booked"), false);
  assert.equal(yieldsToStaff("ai_cancel"), false);
  assert.equal(yieldsToStaff("ai_late"), false);
  assert.equal(yieldsToStaff("clinical"), false, "the fixed safety line with the clinic's number always goes");
  assert.equal(yieldsToStaff("opt_out"), false);
});

// ------------------------------------------------------------------- the holding line, once --
const open = (severity: string, lastMessageAt: number, staffActive = false) => ({ openHandoffSeverity: severity, staffActive, lastMessageAt });

test("a second medical or complaint hand-off inside the same exchange is not said again", () => {
  // 20:26:22 "ياريت حد يتواصل معايا", the hand-off open since 19:38.
  assert.equal(holdingLineAlreadySaid(open("urgent", T("20:25:59")), "ai_handoff_complaint", T("20:26:22")), true);
  assert.equal(holdingLineAlreadySaid(open("urgent", T("20:25:59")), "ai_handoff_medical", T("20:26:22")), true);
  assert.equal(holdingLineAlreadySaid(open("complaint", T("20:25:59")), "ai_handoff_complaint", T("20:26:22")), true);
  assert.equal(holdingLineAlreadySaid(open("urgent", T("20:25:59")), "clinical", T("20:26:22")), true);
});

test("a symptom after a complaint still gets the line with the clinic's number", () => {
  // The complaint's holding line carried no emergency number; the medical one does.
  assert.equal(holdingLineAlreadySaid(open("complaint", T("20:25:59")), "clinical", T("20:26:22")), false);
  assert.equal(holdingLineAlreadySaid(open("complaint", T("20:25:59")), "ai_handoff_medical", T("20:26:22")), false);
});

test("the first hand-off always speaks", () => {
  assert.equal(holdingLineAlreadySaid({ lastMessageAt: T("19:38:00") }, "ai_handoff_medical", T("19:38:22")), false);
  assert.equal(holdingLineAlreadySaid(open("", T("19:38:00")), "ai_handoff_complaint", T("19:38:22")), false);
});

test("an ordinary open ask does not silence a medical or complaint hand-off", () => {
  // "send me the Instagram link" is open; then she writes about pain: that line must go.
  assert.equal(holdingLineAlreadySaid(open("normal", T("20:00:00")), "ai_handoff_medical", T("20:01:00")), false);
});

test("an answer, a booking or an ordinary hand-off is never held back", () => {
  for (const reason of ["ai_answer", "booked", "ai_handoff_other", "ai_handoff_staff", "ai_cancel", "thanks"]) {
    assert.equal(holdingLineAlreadySaid(open("urgent", T("20:25:59")), reason, T("20:26:22")), false, reason);
  }
});

test("after an hour of silence the patient is told again", () => {
  assert.equal(holdingLineAlreadySaid(open("urgent", T("19:00:00")), "ai_handoff_medical", T("19:00:00") + HOUR + 1), false);
  assert.equal(holdingLineAlreadySaid(open("urgent", T("19:00:00")), "ai_handoff_medical", T("19:00:00") + HOUR - 1), true);
});

test("a person in the chat is another rule's business (the bot is silent anyway)", () => {
  assert.equal(holdingLineAlreadySaid(open("urgent", T("20:25:59"), true), "ai_handoff_medical", T("20:26:22")), false);
});

// ---------------------------------------------------------------------------------- the wiring --
const respond = readFileSync(new URL("../src/lib/bot/respond.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const conversation = readFileSync(new URL("../src/lib/bot/conversation.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the conversation carries the open hand-off's severity", () => {
  assert.match(conversation, /openHandoffSeverity\?: HandoffSeverity/);
  assert.match(conversation, /openHandoffSeverity: openHandoff \?/);
});

test("respond.ts drops the answer, and each later bubble, when staff wrote meanwhile", () => {
  assert.match(respond, /const staffTookIt = async \(\): Promise<boolean>/);
  assert.match(respond, /if \(await staffTookIt\(\)\) \{?\s*return skip\("staff_answered"\)/);
  const loop = respond.slice(respond.indexOf("for (const bubble of extraBubbles"));
  assert.match(loop.slice(0, 1200), /await staffTookIt\(\)/);
});

test("respond.ts says nothing on a repeated hand-off but still tells the desk", () => {
  const at = respond.indexOf("holdingLineAlreadySaid(conversation, reason, now)");
  assert.ok(at > 0, "the rule is applied");
  // Before the desk is flagged, so the flag and the push still happen for the silent turn.
  assert.ok(at < respond.indexOf("The moment the bot promises a person"), "applied before the hand-off is raised");
  assert.match(respond.slice(at, at + 400), /replyText = ""/);
});

console.log("\nall desk-first checks passed");
