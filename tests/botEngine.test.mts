// The WhatsApp assistant's decisions. Run with tsx.
//
// decideBotReply is pure, which is the whole reason it exists separately: every branch below can
// be checked here instead of by messaging a real phone and reading a real patient's record
// afterwards. The assertions that matter most are the ones about NOT speaking.
import assert from "node:assert/strict";
import { decideBotReply, needsHuman, type BotContext } from "../src/lib/bot/engine";

const ctx: BotContext = {
  clinicName: "Alpha Dental",
  patientName: "ahmed",
  hoursText: "السبت: 10:00 - 22:00",
  addressText: "المعادي",
  canOfferBooking: true,
};

const say = (state: any, text: string) => decideBotReply({ state, text, ctx });

// ================================================================================================
// Memory: the same message means different things depending on what came before. This is the
// difference between an assistant and an autoresponder, and the reason state is stored at all.
// ================================================================================================
const first = say("new", "السلام عليكم");
assert.equal(first.next, "awaiting_choice");
assert.ok(first.reply.includes("Alpha Dental"), "the greeting names the clinic");
assert.ok(first.reply.includes("ahmed"), "and the patient, when we know them");

const second = say("awaiting_choice", "2");
assert.equal(second.reason, "hours", "'2' after a menu means the menu's second option");
assert.ok(second.reply.includes("10:00"), "and answers from the clinic's real hours");

// The identical text with no menu behind it is just a first message.
assert.equal(say("new", "2").reason, "greeted", "'2' with nothing before it is not a menu choice");

// ================================================================================================
// THE ONE THAT MATTERS: a machine must not answer a clinical message.
// ================================================================================================
for (const msg of [
  "وشي وارم",
  "عندي الم شديد",
  "الضرس بينزف",
  "my face is swollen",
  "I have severe pain",
  "عندي حراره وورم",
]) {
  const d = say("awaiting_choice", msg);
  assert.equal(d.handoff, true, `must hand over: ${msg}`);
  assert.equal(d.next, "handed_off");
  assert.equal(d.reason, "clinical");
}

// Even when it looks like a menu choice, pain wins.
const painWithNumber = say("awaiting_choice", "2 وعندي وجع");
assert.equal(painWithNumber.reason, "clinical", "a patient in pain who types a number is still in pain");

// ================================================================================================
// Never talk over a human, and never answer someone who asked for silence.
// ================================================================================================
assert.equal(say("handed_off", "شكرا").reply, "", "a person owns this thread now");
assert.equal(say("handed_off", "1").reply, "", "including when they send a menu number");

const optOut = say("awaiting_choice", "إيقاف");
assert.equal(optOut.reply, "", "answering a stop request is the rudest possible reply");
assert.equal(optOut.next, "handed_off");

assert.equal(say("awaiting_choice", "   ").reply, "", "an empty message gets no reply");

// ================================================================================================
// Menu choices, in the shapes patients actually send them.
// ================================================================================================
for (const one of ["1", "١", "1.", " 1 "]) {
  const d = say("awaiting_choice", one);
  assert.equal(d.action?.type, "list_days", `"${one}" is choice 1 and starts real booking`);
  assert.equal(d.next, "booking_day");
  assert.equal(d.handoff, false);
}
assert.equal(say("awaiting_choice", "٣").reason, "asked_for_human");
assert.equal(say("awaiting_choice", "3").handoff, true);

// A clinic that cannot offer booking (no schedule, or unidentified sender) hands to a person —
// and the holding reply must never imply a slot is held.
const noBook = decideBotReply({
  state: "awaiting_choice",
  text: "1",
  ctx: { ...ctx, canOfferBooking: false },
});
assert.equal(noBook.handoff, true, "someone has to actually do the booking");
assert.ok(!/تم الحجز|confirmed|booked/i.test(noBook.reply), "must never claim a booking was made");

// ================================================================================================
// The booking sub-flow: numbered picks against stored option counts.
// ================================================================================================
const bctx: BotContext = { ...ctx, optionCount: 4 };
const pickDay = decideBotReply({ state: "booking_day", text: "٢", ctx: bctx });
assert.deepEqual(pickDay.action, { type: "list_times", index: 2 }, "an Arabic digit picks the day");
assert.equal(pickDay.next, "booking_time");

const pickTime = decideBotReply({ state: "booking_time", text: "3", ctx: bctx });
assert.deepEqual(pickTime.action, { type: "book", index: 3 }, "a digit in the time list books");

// Out-of-range and junk re-list rather than fetching a human — mis-typing is not confusion.
assert.equal(decideBotReply({ state: "booking_day", text: "9", ctx: bctx }).action?.type, "relist");
assert.equal(decideBotReply({ state: "booking_day", text: "بكرة", ctx: bctx }).action?.type, "relist");

// Zero always walks back: to the day list from times, to the menu from days.
const backToDays = decideBotReply({ state: "booking_time", text: "0", ctx: bctx });
assert.equal(backToDays.action?.type, "list_days");
assert.equal(backToDays.next, "booking_day");
const backToMenu = decideBotReply({ state: "booking_day", text: "0", ctx: bctx });
assert.equal(backToMenu.next, "awaiting_choice");
assert.ok(backToMenu.reply.includes("Alpha Dental"), "back to the menu means the menu is shown");

// THE ONE THAT MATTERS, again: a patient in pain mid-booking is still a patient in pain.
const painMidBooking = decideBotReply({ state: "booking_time", text: "سناني بتوجعني", ctx: bctx });
assert.equal(painMidBooking.reason, "clinical");
assert.equal(painMidBooking.handoff, true);

// And a stop request mid-booking is silence, not a slot list.
assert.equal(decideBotReply({ state: "booking_day", text: "إيقاف", ctx: bctx }).reply, "");

// ================================================================================================
// It gives up rather than nagging. Three identical questions is what gets a number reported.
// ================================================================================================
const r1 = say("awaiting_choice", "بكام التنظيف");
assert.equal(r1.next, "reprompted", "one retry");
assert.equal(r1.handoff, false);

const r2 = say("reprompted", "بكام التنظيف");
assert.equal(r2.next, "handed_off", "and then a person, never a third ask");
assert.equal(r2.handoff, true);

// ================================================================================================
// A clinic with nothing configured says so rather than inventing hours.
// ================================================================================================
const bare = decideBotReply({
  state: "awaiting_choice",
  text: "2",
  ctx: { clinicName: "Alpha Dental" },
});
assert.ok(!bare.reply.includes("undefined") && bare.reply.trim().length > 0);
assert.ok(/الاستقبال/.test(bare.reply), "falls back to a person rather than empty hours");

// A clinic that cannot take bookings does not offer booking.
const noBooking = decideBotReply({
  state: "new",
  text: "hi",
  ctx: { clinicName: "Alpha Dental", canOfferBooking: false },
});
assert.ok(noBooking.reply.includes("الاستقبال"), "offers the receptionist instead");

// needsHuman on its own
assert.equal(needsHuman("عايز احجز"), false, "wanting an appointment is not a clinical emergency");
assert.equal(needsHuman("مواعيد العيادة ايه"), false);
assert.equal(needsHuman(""), false);
assert.equal(needsHuman("عندي خراج"), true);

console.log("✓ bot engine: remembers the turn before, hands clinical messages to a person, and stops rather than nags");

// ================================================================================================
// Reading which chat an outgoing echo landed in — the seam the lid mapping hangs on.
// ================================================================================================
import { lidChatFromEvent } from "../src/lib/whatsappLid";

// The chat id survives inside the whatsapp-web.js message id even when from/to are unhelpful.
assert.equal(
  lidChatFromEvent({ id: "true_172357054414966@lid_AC2E4E7F226C001BAD3B7EE15E23F70A", to: null, from: "me" }),
  "172357054414966@lid"
);
assert.equal(lidChatFromEvent({ id: "false_172357054414966@lid_HASH" }), "172357054414966@lid");
assert.equal(lidChatFromEvent({ to: "172357054414966@lid" }), "172357054414966@lid");
assert.equal(lidChatFromEvent({ from: "172357054414966@lid" }), "172357054414966@lid");
// A phone-identified chat is not a lid, and must not be mistaken for one.
assert.equal(lidChatFromEvent({ id: "true_201551552440@c.us_HASH", to: "201551552440@c.us" }), "");
assert.equal(lidChatFromEvent({}), "");
assert.equal(lidChatFromEvent(null), "");

console.log("✓ lid mapping: the chat id is read from the echo, and phones are never mistaken for lids");

// ================================================================================================
// Tap ids: a button carries its whole meaning, so stale taps are safe.
// The first live tap-through booked the WRONG DAY because ids were bare digits read against the
// current step; these pin the fix.
// ================================================================================================
import { parseTapId } from "../src/lib/bot/engine";

assert.deepEqual(parseTapId("d2026-08-30"), { kind: "day", dateKey: "2026-08-30" });
assert.deepEqual(parseTapId("t2026-08-30|04:30 PM"), { kind: "time", dateKey: "2026-08-30", time: "04:30 PM" });
assert.deepEqual(parseTapId("m1"), { kind: "menu", choice: "1" });
assert.equal(parseTapId("1"), null, "typed digits are NOT taps — they stay stateful");
assert.equal(parseTapId("d2026-13-99x"), null);

// A tapped day means that day from ANY state — even mid-times, even handed off.
for (const state of ["awaiting_choice", "booking_time", "handed_off", "reprompted"] as const) {
  const d = decideBotReply({ state, text: "d2026-08-30", ctx: bctx });
  assert.deepEqual(d.action, { type: "list_times_date", dateKey: "2026-08-30" }, `day tap from ${state}`);
}
const slotTap = decideBotReply({ state: "awaiting_choice", text: "t2026-08-30|04:30 PM", ctx: bctx });
assert.deepEqual(slotTap.action, { type: "book_slot", dateKey: "2026-08-30", time: "04:30 PM" });

// The old failure, replayed: menu tap while the conversation sits in booking_day must open the
// booking flow fresh — never be read as "day number 1".
const staleMenuTap = decideBotReply({ state: "booking_day", text: "m1", ctx: bctx });
assert.deepEqual(staleMenuTap.action, { type: "list_days" }, "a stale menu tap restarts booking, not picks a day");

// Taps still lose to the absolute rules.
assert.equal(decideBotReply({ state: "awaiting_choice", text: "إيقاف", ctx: bctx }).reply, "");

console.log("✓ tap ids: buttons mean what they say, whenever and wherever they are tapped");

// ================================================================================================
// A new patient: real phone, nobody on file. The bot asks a name and registers — same contract as
// the public booking page — instead of bouncing every stranger to reception.
// ================================================================================================
const newPatientCtx: BotContext = { clinicName: "Alpha Dental", canOfferBooking: false, canRegister: true };
const askName = decideBotReply({ state: "awaiting_choice", text: "1", ctx: newPatientCtx });
assert.equal(askName.next, "booking_name");
assert.ok(askName.reply.includes("اسمك"), "asks for the name");

const named = decideBotReply({ state: "booking_name", text: "  محمد   صلاح ", ctx: newPatientCtx });
assert.deepEqual(named.action, { type: "register", name: "محمد صلاح" }, "whitespace folds, name registers");
assert.equal(named.next, "booking_day");

// Digits are not names — they are stray taps at old lists, and nobody gets registered as "3".
assert.equal(decideBotReply({ state: "booking_name", text: "3", ctx: newPatientCtx }).next, "booking_name");
assert.equal(decideBotReply({ state: "booking_name", text: "x", ctx: newPatientCtx }).next, "booking_name");

// Pain outranks the name question like everything else.
assert.equal(decideBotReply({ state: "booking_name", text: "عندي وجع شديد", ctx: newPatientCtx }).reason, "clinical");

// No phone at all (an unmapped lid): no registration offer — a person, as before.
const noPhone = decideBotReply({ state: "awaiting_choice", text: "1", ctx: { clinicName: "Alpha Dental" } });
assert.equal(noPhone.handoff, true);

console.log("✓ new patients: named, registered, and booked — with digits and pain refused as names");
