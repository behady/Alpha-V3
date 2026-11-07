/**
 * What the retired menu bot used to answer for free — digits, button ids, list taps — now reaches
 * the brain as plain text, from every state a stored conversation can be in, and no decision ever
 * prints a numbered menu. This is the deploy-day proof that no patient mid-list is stranded.
 *
 * Run: npm run test:bot-retired-inputs
 */
import assert from "node:assert/strict";
import { decide, type BotContext, type BotState } from "../src/lib/bot/decide";

const ctx: BotContext = { clinicName: "Alpha Dental", clinicPhone: "01001234567", aiAvailable: true };

const RETIRED_INPUTS = ["1", "2", "3", "0", "٣", "m1", "m2", "m3", "back_menu", "back_days", "d2026-11-09|", "d2026-11-09|أحمد", "t2026-11-09|05:00 PM|", "t2026-11-09|05:00 PM|أحمد", "dr|أحمد", "dr|"];
const STATES: BotState[] = ["new", "awaiting_choice", "reprompted", "booking_doctor", "booking_day", "booking_time", "handed_off"];

let checked = 0;
for (const state of STATES) {
  for (const text of RETIRED_INPUTS) {
    const d = decide({ state, text, ctx });
    assert.deepEqual(d.action, { type: "ai", question: text }, `${state} / ${text}: the brain reads it`);
    assert.equal(d.reply, "", `${state} / ${text}: nothing fixed is said`);
    assert.equal(d.handoff, false, `${state} / ${text}: nobody is fetched over a stale tap`);
    assert.equal(d.next, "awaiting_choice", `${state} / ${text}: the chat is open`);
    checked++;
  }
}
console.log(`ok - ${checked} retired inputs across ${STATES.length} states all go to the brain`);

// A staff member in the thread still outranks a stale tap.
for (const text of RETIRED_INPUTS) {
  const d = decide({ state: "handed_off", text, ctx: { ...ctx, staffActive: true } });
  assert.equal(d.reply, "");
  assert.equal(d.action, undefined, `${text}: silent while a person owns the thread`);
}
console.log("ok - a person in the thread keeps every stale tap silent");

// No decision prints the menu, in any state, for any of the fixed replies the decider still owns.
const FIXED = ["", "شكرا", "تمام", "STOP", "وشي وارم", "عايز احجز"];
for (const state of STATES) {
  for (const text of FIXED) {
    for (const over of [{}, { welcome: true }, { hasSoonAppointment: true }, { aiAvailable: false }] as Partial<BotContext>[]) {
      const d = decide({ state, text, ctx: { ...ctx, ...over } });
      assert.ok(!/\*[0-3]\*/.test(d.reply), `${state} / "${text}": no numbered menu`);
      assert.ok(!d.reply.includes("رجوع للقائمة") && !d.reply.includes("الأزرار"), `${state} / "${text}": no menu words`);
    }
  }
}
console.log("ok - no fixed reply prints a menu");

console.log("botRetiredInputs: all checks passed");
