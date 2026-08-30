import assert from "node:assert/strict";
import { quickIntent } from "../src/lib/bot/quickAnswers";
import { decideBotReply, type BotContext } from "../src/lib/bot/engine";

/**
 * The free layer between the digits and the model.
 *
 * Two things are being pinned. First, that the common messages are recognised at all — before
 * this every one of them cost an AI credit out of a budget of three, so a patient who opened with
 * a greeting and a courtesy had one answer left for their actual question. Second, and more
 * important, the ORDER: several intents legitimately match the same sentence, and the tests below
 * fix which one wins, because getting that wrong turns "my appointment is tomorrow, right?" into
 * an offer of a second appointment.
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

const ctx: BotContext = {
  clinicName: "Alpha Dental",
  patientName: "أحمد",
  hoursText: "من 3:00 م إلى 11:00 م\nالإجازة: الجمعة",
  addressText: "شارع الرحمة، القاهرة",
  clinicPhone: "+201066666124",
  canOfferBooking: true,
  doctorCount: 0,
  aiAvailable: true,
};

run("the everyday messages are recognised without a model call", () => {
  assert.equal(quickIntent("السلام عليكم"), "greeting");
  assert.equal(quickIntent("صباح الخير"), "greeting");
  assert.equal(quickIntent("hello"), "greeting");
  assert.equal(quickIntent("الو"), "greeting");
  assert.equal(quickIntent("شكرا"), "thanks");
  assert.equal(quickIntent("تسلم ايديكم"), "thanks");
  assert.equal(quickIntent("تمام"), "ack");
  assert.equal(quickIntent("اوك ماشي"), "ack");
  assert.equal(quickIntent("👍"), "ack");
  assert.equal(quickIntent("عايز اكلم حد من فضلك"), "human");
  assert.equal(quickIntent("عايز احجز"), "booking");
  assert.equal(quickIntent("3ayez a7gz meaad"), "booking");
  assert.equal(quickIntent("فين العياده بالظبط"), "location");
  assert.equal(quickIntent("ابعتلي اللوكيشن"), "location");
  assert.equal(quickIntent("بتسكروا الساعه كام"), "hours");
  assert.equal(quickIntent("انتو فاتحين دلوقتي"), "open_now");
  assert.equal(quickIntent("ابعتلي الاسعار"), "price_list");
});

run("the time-critical messages are no longer thrown away", () => {
  assert.equal(quickIntent("مش هعرف اجي بكره"), "cancel");
  assert.equal(quickIntent("ممكن نأجل الحجز لاسبوع جاي"), "reschedule");
  assert.equal(quickIntent("هتأخر ربع ساعه معلش"), "late");
});

run("'my appointment' outranks 'an appointment' — they need opposite answers", () => {
  // Both sentences contain the same noun. Reading the first as a booking request would offer a
  // second slot to a patient who already has one.
  assert.equal(quickIntent("ميعادي امتى"), "my_appointment");
  assert.equal(quickIntent("الميعاد بتاعي بكره صح ولا لأ"), "my_appointment");
  assert.equal(quickIntent("ياريت تأكدولي الميعاد"), "my_appointment");
  assert.equal(quickIntent("عايز ميعاد"), "booking");
  assert.equal(quickIntent("في مواعيد فاضية عندكو الاسبوع ده"), "booking");
});

run("asking for a person beats everything else in the sentence", () => {
  assert.equal(quickIntent("شكرا بس عايز اكلم حد"), "human");
  assert.equal(quickIntent("عايز احجز بس عايز اكلم حد الأول"), "human");
});

run("'open now' beats 'opening hours' — only one of them needs a clock", () => {
  assert.equal(quickIntent("انتوا فاتحين دلوقتي"), "open_now");
  assert.equal(quickIntent("مواعيد العمل ايه"), "hours");
});

run("courtesy only counts when it is the whole message", () => {
  // A polite hat on a real question must not be answered instead of the question.
  assert.equal(quickIntent("شكرا، التقويم بكام وبياخد قد ايه بالظبط"), null);
  assert.equal(quickIntent("السلام عليكم عايز اعرف سعر التنظيف وكمان التبييض"), null);
  // But the greeting plus a booking word is still a booking.
  assert.equal(quickIntent("السلام عليكم عايز احجز"), "booking");
});

run("nothing recognised returns null rather than guessing", () => {
  assert.equal(quickIntent("التقويم بياخد قد ايه"), null);
  assert.equal(quickIntent("في بديل ارخص من الزيركون"), null);
  assert.equal(quickIntent(""), null);
});

run("the engine routes a typed booking into the real flow, not the model", () => {
  // The word instead of the button used to reach the AI, which is the one path that cannot book.
  const d = decideBotReply({ state: "awaiting_choice", text: "عايز احجز", ctx });
  assert.equal(d.action?.type, "list_days");
  assert.equal(d.next, "booking_day");
});

run("a first message that is a real question is answered, not swallowed by the greeting", () => {
  // "التنظيف بكام" as an opening line used to get the menu and lose the question, while the same
  // message one turn later was answered correctly.
  const d = decideBotReply({ state: "new", text: "التنظيف بكام", ctx });
  assert.equal(d.action?.type, "ai");
  // A bare greeting still gets the greeting, for free.
  const g = decideBotReply({ state: "new", text: "السلام عليكم", ctx });
  assert.equal(g.reason, "greeted");
  assert.equal(g.action, undefined);
});

run("courtesy is answered in one line and never with the booking menu", () => {
  const a = decideBotReply({ state: "awaiting_choice", text: "تمام", ctx });
  assert.equal(a.reason, "ack");
  assert.equal(a.handoff, false);
  assert.ok(!a.reply.includes("*1*"), "an acknowledgement must not be answered with the menu");
  const t = decideBotReply({ state: "awaiting_choice", text: "شكرا", ctx });
  assert.equal(t.reason, "thanks");
  assert.ok(!t.reply.includes("*1*"));
});

run("a patient can escape a booking loop by asking for a person", () => {
  // Inside a booking state anything that is not a digit used to re-send the identical list, with
  // no exit, until the turn cap. Asking for a human now works from inside it.
  const d = decideBotReply({ state: "booking_day", text: "عايز اكلم حد", ctx: { ...ctx, optionCount: 6 } });
  assert.equal(d.handoff, true);
  assert.equal(d.reason, "asked_for_human");
  // And so does giving up on it.
  const c = decideBotReply({ state: "booking_day", text: "مش هعرف اجي", ctx: { ...ctx, optionCount: 6 } });
  assert.equal(c.handoff, true);
  // A digit still books, exactly as before.
  const n = decideBotReply({ state: "booking_day", text: "2", ctx: { ...ctx, optionCount: 6 } });
  assert.equal(n.action?.type, "list_times");
});

run("an emergency still outranks every intent above it", () => {
  // The clinical check runs before any of this, and must keep doing so: a patient in pain who
  // also says "thanks" is still a patient in pain.
  const d = decideBotReply({ state: "awaiting_choice", text: "شكرا بس ضرسي بيوجعني اوي", ctx });
  assert.equal(d.reason, "clinical");
  assert.equal(d.handoff, true);
  // And the reply now carries the number it tells them to ring.
  assert.ok(d.reply.includes("+201066666124"), "the emergency reply must include the clinic phone");
});

run("the address is answered from the clinic record, not handed to a person", () => {
  const d = decideBotReply({ state: "awaiting_choice", text: "ابعتلي اللوكيشن", ctx });
  assert.equal(d.reason, "location");
  assert.ok(d.reply.includes("شارع الرحمة"));
  // With no address configured there is nothing honest to say, so it falls through instead.
  const empty = decideBotReply({ state: "awaiting_choice", text: "ابعتلي اللوكيشن", ctx: { ...ctx, addressText: "" } });
  assert.notEqual(empty.reason, "location");
});

console.log("\nquickAnswers: all suites passed");
