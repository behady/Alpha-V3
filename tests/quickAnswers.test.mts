import assert from "node:assert/strict";
import { quickIntent, isDecline } from "../src/lib/bot/quickAnswers";
import { readFileSync } from "node:fs";

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
  // A polite hat on a real question must never be answered INSTEAD of the question. Here the
  // question underneath is about how long it takes, so that is what wins — not the "شكرا".
  assert.equal(quickIntent("شكرا، التقويم بكام وبياخد قد ايه بالظبط"), "duration");
  // Nothing else matches this one, so it falls through to the model with the whole sentence
  // rather than being answered "وعليكم السلام" and losing the rest.
  assert.equal(quickIntent("السلام عليكم عايز اعرف سعر التنظيف وكمان التبييض"), null);
  // But the greeting plus a booking word is still a booking.
  assert.equal(quickIntent("السلام عليكم عايز احجز"), "booking");
});

run("nothing recognised returns null rather than guessing", () => {
  assert.equal(quickIntent("في بديل ارخص من الزيركون"), null);
  assert.equal(quickIntent("ايه الفرق بين التقويم المعدن والشفاف"), null);
  assert.equal(quickIntent(""), null);
});

run("the clinic-fact questions are recognised and routed by priority", () => {
  assert.equal(quickIntent("لازم ميعاد ولا اجي على طول"), "walk_in");
  assert.equal(quickIntent("ينفع اجي دلوقتي من غير حجز"), "walk_in");
  assert.equal(quickIntent("في تقسيط"), "installments");
  assert.equal(quickIntent("التقويم بيتدفع على مرات ولا مره واحده"), "installments");
  assert.equal(quickIntent("مفيش تخفيض شويه"), "offers");
  assert.equal(quickIntent("في باركن قدام العياده"), "parking");
  assert.equal(quickIntent("بتتعاملوا مع تامين"), "insurance");
  assert.equal(quickIntent("التنضيف بياخد وقت اد ايه"), "duration");
  assert.equal(quickIntent("علاج العصب كام جلسه"), "duration");
  assert.equal(quickIntent("ينفع اكل بعد الحشو"), "aftercare");
});

run("a 'not now' is remembered, and nothing automated follows it", () => {
  for (const t of ["مش دلوقتي", "مش دلوقت", "بعدين", "لا شكرا", "مش محتاج دلوقتي", "not now", "maybe later", "هشوف وابلغك", "مش مهتمة"]) {
    assert.ok(isDecline(t), `not read as a decline: ${t}`);
  }
  for (const t of ["عايز احجز", "تمام", "شكرا", "مش دلوقتي، بكرة الساعة 5 ينفع عشان معنديش وقت النهارده خالص", "الكشف بكام", "Hi"]) {
    assert.ok(!isDecline(t), `wrongly read as a decline: ${t}`);
  }
  const respond = readFileSync("src/lib/bot/respond.ts", "utf8");
  assert.ok(respond.includes("isDecline(text)") && respond.includes("markConversationDeclined(") && respond.includes("snoozeBotLead("), "the bot answers a decline but forgets it");
  const nudge = readFileSync("functions/quietNudge.js", "utf8");
  assert.ok(nudge.includes("declinedAtMs"), "the quiet nudge ignores a decline and asks 'still with me?' an hour later");
  assert.ok(!nudge.includes("لو حابب"), "the nudge still says 'حابب' to women");
  assert.ok(nudge.includes('split(/\\s+/)[0]'), "the nudge greets by full name");
  const followup = readFileSync("src/app/api/automation/lead-followup/route.ts", "utf8");
  assert.ok(followup.includes('reason: "declined"') && followup.includes('reason: "already_replied"'), "the lead follow-up still chases people who replied or declined");
});

console.log("\nquickAnswers: all suites passed");
