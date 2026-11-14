// What counts as a name at the "send us your full name" step. Run with tsx.
//
// A patient who was asked for a name and answered with a voice note saying "ازي حضرتك أنا من
// بلبيس من الشرقية" was registered under that sentence and given an appointment. A sentence is
// not a name, whether it was typed or spoken.
import assert from "node:assert/strict";
import { nameFromReply } from "../src/lib/bot/nameGuard";
import { decideBotReply, type BotContext } from "../src/lib/bot/engine";
import { joinsMediaBurst } from "../src/lib/bot/burstGuard";

// Names, as people actually send them.
assert.equal(nameFromReply("  محمد   صلاح "), "محمد صلاح");
assert.equal(nameFromReply("احمد محمد علي"), "احمد محمد علي");
assert.equal(nameFromReply("منى عبد الرحمن"), "منى عبد الرحمن");
assert.equal(nameFromReply("Adam Morsi"), "Adam Morsi");
assert.equal(nameFromReply("سارة"), "سارة");
// The spoken forms: the lead-in is dropped, the name is kept.
assert.equal(nameFromReply("اسمي محمد أحمد"), "محمد أحمد");
assert.equal(nameFromReply("أنا اسمي ملك أيمن محمد."), "ملك أيمن محمد");
assert.equal(nameFromReply("الاسم: علي حسن"), "علي حسن");
assert.equal(nameFromReply("my name is Omar Adel"), "Omar Adel");

// A name sent with a phone number and a thank-you is still a name. The real message: the patient
// was asked for his name three times after sending exactly this, and reception had to step in.
assert.equal(nameFromReply("خميس عبد الوهاب الحلواني.. موبايل رقم.. 01064785354.. ولكم الشكر"), "خميس عبد الوهاب الحلواني");
assert.equal(nameFromReply("محمد صلاح 01001234567"), "محمد صلاح");
assert.equal(nameFromReply("منى عبد الرحمن، شكرا"), "منى عبد الرحمن");
assert.equal(nameFromReply("الاسم احمد علي ورقمي +201001234567"), "احمد علي");
// ...but what is left must still be a name on its own.
assert.equal(nameFromReply("تم أعلاه.. في انتظار اللوكيش"), null);
assert.equal(nameFromReply("تمام.. عنوان العيادة.. ولكم الشكر"), null);
assert.equal(nameFromReply("01064785354"), null);
assert.equal(nameFromReply("شكرا"), null);

// Sentences, greetings and questions are not names.
assert.equal(nameFromReply("ازي حضرتك أنا من بلبيس من الشرقية"), null, "the real voice note");
assert.equal(nameFromReply("المكان فين لو سمحت"), null);
assert.equal(nameFromReply("السلام عليكم"), null);
assert.equal(nameFromReply("تمام"), null);
assert.equal(nameFromReply("عايز احجز بكره"), null);
assert.equal(nameFromReply("الزراعة ب 3600"), null, "digits are not a name");
assert.equal(nameFromReply("3"), null);
assert.equal(nameFromReply("x"), null);
assert.equal(nameFromReply("محمد احمد علي حسن ابراهيم سيد عبد الله محمود"), null, "too long to be a name");

// The decider: in AI mode a sentence at the name step goes to the model and the step is kept.
const aiCtx: BotContext = {
  clinicName: "Alpha Dental",
  patientName: "",
  hoursText: "السبت: 10:00 - 22:00",
  addressText: "مدينة نصر",
  canOfferBooking: true,
  aiFirst: true,
  aiAvailable: true,
};
const spoken = decideBotReply({ state: "booking_name", text: "ازي حضرتك أنا من بلبيس من الشرقية", ctx: aiCtx });
assert.equal(spoken.action?.type, "ai", "a sentence is talk, not a name");
assert.equal(spoken.next, "booking_name", "and the name is still owed");

const named = decideBotReply({ state: "booking_name", text: "اسمي محمد أحمد", ctx: aiCtx });
assert.equal(named.action?.type, "register");
assert.equal((named.action as { name: string }).name, "محمد أحمد");

// Without the AI the question is simply asked again — never a patient called "ازي حضرتك".
const plain = decideBotReply({ state: "booking_name", text: "ازي حضرتك أنا من بلبيس من الشرقية", ctx: { ...aiCtx, aiFirst: false, aiAvailable: false } });
assert.equal(plain.reason, "ask_name_again");

// A second voice note is a second message, not the second photo of an album.
assert.equal(joinsMediaBurst("audio"), false, "every voice note is read");
assert.equal(joinsMediaBurst("image"), true);
assert.equal(joinsMediaBurst("video"), true);
assert.equal(joinsMediaBurst("document"), true);
assert.equal(joinsMediaBurst("sticker"), false);
assert.equal(joinsMediaBurst(undefined), false);

console.log("nameGuard: ok");
