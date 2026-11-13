/**
 * The decider in front of the one WhatsApp brain.
 *
 * Pure, and deliberately tiny: everything it does NOT decide goes to the brain. What it does
 * decide is what must never be a model's call — opt-out, a symptom, a staff member already in
 * the thread, the two one-word courtesies — plus the name step, which is a form, not a chat.
 *
 * Run: npm run test:bot
 */
import assert from "node:assert/strict";
import { adGreetingLine, parseMetaReferral } from "../src/lib/bot/adReferral";
import { decide, liveState, type BotContext, type BotState } from "../src/lib/bot/decide";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const ctx: BotContext = { clinicName: "Alpha Dental", patientName: "أحمد", clinicPhone: "01001234567", aiAvailable: true };
const say = (state: BotState, text: string, over: Partial<BotContext> = {}) => decide({ state, text, ctx: { ...ctx, ...over } });

test("opt-out is silent and hands nothing to the brain", () => {
  const d = say("awaiting_choice", "STOP");
  assert.equal(d.reply, "");
  assert.equal(d.action, undefined);
  assert.equal(d.reason, "opt_out");
  assert.equal(d.next, "handed_off");
});

test("an empty message is silence, state kept", () => {
  const d = say("booking_name", "   ");
  assert.equal(d.reason, "empty_message");
  assert.equal(d.reply, "");
  assert.equal(d.next, "booking_name");
});

test("ad welcome is free: a fixed greeting naming the ad, no model call, no menu", () => {
  const ad = parseMetaReferral({ source_type: "ad", source_id: "1", headline: "تبييض الأسنان بخصم 30%", body: "احجز كشفك المجاني النهاردة" } as never)!;
  const d = say("new", "", { ad, adOfferLine: "خصم 30% على التبييض", welcome: true });
  assert.equal(d.reason, "ad_welcome");
  assert.equal(d.action, undefined);
  assert.equal(d.next, "awaiting_choice");
  assert.ok(d.reply.includes("Alpha Dental") && d.reply.includes("أحمد"));
  assert.ok(d.reply.includes(adGreetingLine(ad, { offerLine: "خصم 30% على التبييض" })));
  assert.ok(!/\*[123]\*/.test(d.reply), "no numbered menu");
  // Without the welcome flag an empty message is still silence.
  assert.equal(say("new", "", { ad }).reason, "empty_message");
});

test("a symptom goes to a person, with the number to ring", () => {
  for (const msg of ["وشي وارم", "عندي الم شديد", "my face is swollen", "2 وعندي وجع"]) {
    const d = say("awaiting_choice", msg);
    assert.equal(d.reason, "clinical", msg);
    assert.equal(d.handoff, true);
    assert.equal(d.next, "handed_off");
    assert.ok(d.reply.includes("01001234567"), "the clinic's number is in the reply");
  }
});

test("dentist mode sends an ordinary symptom to the brain as a clinical turn; emergencies still hand off", () => {
  const d = say("awaiting_choice", "ضرسي بيوجعني", { clinicalMode: "dentist" });
  assert.deepEqual(d.action, { type: "ai", question: "ضرسي بيوجعني", clinical: true });
  assert.equal(d.reason, "clinical_ai");
  assert.equal(d.handoff, false);
  assert.equal(say("awaiting_choice", "مش قادر ابلع", { clinicalMode: "dentist" }).reason, "clinical", "a red-flag phrase never reaches the brain");
  assert.equal(say("awaiting_choice", "ضرسي بيوجعني", { clinicalMode: "dentist", aiAvailable: false }).reason, "clinical", "no AI, no dentist");
});

test("a staff member in the thread keeps the brain quiet; a stale handoff flag does not", () => {
  const quiet = say("handed_off", "شكرا", { staffActive: true });
  assert.equal(quiet.reply, "");
  assert.equal(quiet.action, undefined);
  assert.equal(quiet.reason, "already_with_a_human");
  assert.equal(say("handed_off", "مواعيدكم ايه").action?.type, "ai", "flagged but nobody answered: the brain keeps helping");
});

test("AI off (no key/plan configured): a person, never a menu", () => {
  const d = say("awaiting_choice", "مواعيدكم ايه", { aiAvailable: false });
  assert.equal(d.reason, "ai_off");
  assert.equal(d.handoff, true);
  assert.ok(!/\*[123]\*/.test(d.reply));
});

test("thanks gets one free courtesy line", () => {
  const d = say("awaiting_choice", "شكرا جدا");
  assert.equal(d.reason, "thanks");
  assert.equal(d.action, undefined);
  assert.ok(d.reply.trim().length > 0);
});

test("a bare ok confirms an appointment only when there is one soon; otherwise it is the brain's", () => {
  assert.deepEqual(say("awaiting_choice", "تمام", { hasSoonAppointment: true }).action, { type: "ack" });
  assert.equal(say("awaiting_choice", "تمام").action?.type, "ai");
});

test("everything else is the brain's, including the retired menu keys and tap ids", () => {
  for (const text of ["السلام عليكم", "التنظيف بكام", "عايز احجز", "عايز اكلم حد", "1", "2", "3", "٣", "0", "m1", "back_menu", "d2026-11-09|", "t2026-11-09|05:00 PM|", "dr|أحمد"]) {
    const d = say("awaiting_choice", text);
    assert.deepEqual(d.action, { type: "ai", question: text }, text);
    assert.equal(d.reply, "");
    assert.equal(d.handoff, false);
    assert.equal(d.reason, "ai");
  }
});

test("legacy states stored by the menu bot read as an open chat", () => {
  for (const s of ["reprompted", "booking_doctor", "booking_day", "booking_time"] as BotState[]) {
    assert.equal(liveState(s), "awaiting_choice", s);
    const d = say(s, "الاول");
    assert.deepEqual(d.action, { type: "ai", question: "الاول" });
    assert.equal(d.next, "awaiting_choice");
  }
  assert.equal(liveState("booking_name"), "booking_name");
  assert.equal(liveState("handed_off"), "handed_off");
  assert.equal(liveState("new"), "new");
});

test("the name step: a name registers, talk goes to the brain and the step is kept", () => {
  const reg = say("booking_name", "أحمد  محمود");
  assert.deepEqual(reg.action, { type: "register", name: "أحمد محمود", forRelative: false });
  assert.equal(reg.reason, "registered");
  assert.equal(say("booking_name", "م").action?.type, "ai", "one letter is not a name: asked again via the brain");
  for (const talk of ["Hi", "3", "التقويم بكام؟", "عايز احجز"]) {
    const d = say("booking_name", talk);
    assert.deepEqual(d.action, { type: "ai", question: talk }, talk);
    assert.equal(d.next, "booking_name");
  }
  const rel = say("booking_name", "سارة أحمد", { forRelative: true });
  assert.deepEqual(rel.action, { type: "register", name: "سارة أحمد", forRelative: true });
});

console.log("botDecide: all checks passed");
