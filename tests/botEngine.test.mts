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
  assert.equal(say("awaiting_choice", one).reason, "booking_request", `"${one}" is choice 1`);
}
assert.equal(say("awaiting_choice", "٣").reason, "asked_for_human");
assert.equal(say("awaiting_choice", "3").handoff, true);

// Booking is not promised until Step 5 wires it. The holding reply must not imply a slot is held.
const booking = say("awaiting_choice", "1");
assert.equal(booking.handoff, true, "someone has to actually do the booking");
assert.ok(!/تم الحجز|confirmed|booked/i.test(booking.reply), "must never claim a booking was made");

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
