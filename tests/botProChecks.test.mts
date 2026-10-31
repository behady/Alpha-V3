/**
 * Red-line checks on a Pro reply: invented price, a time the calendar never offered, a medicine
 * name, the wrong script, claiming to be human, and volunteering that it is an AI.
 *
 * Run: npm run test:pro-checks
 */
import assert from "node:assert/strict";
import {
  allowedNumbers,
  asksIfBot,
  checkReply,
  claimsHuman,
  mentionsAi,
  strayClocks,
  strayNumbers,
  wrongScript,
} from "../src/lib/botPro/checks";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const rules = (args: { question?: string; reply: string; allowed?: string[]; clocks?: string[]; drugsAllowed?: string }) =>
  checkReply({
    question: args.question ?? "عايز أعرف الأسعار",
    reply: args.reply,
    allowed: allowedNumbers(args.allowed ?? []),
    clocks: new Set(args.clocks ?? []),
    drugsAllowed: args.drugsAllowed ?? "",
  }).map((v) => v.rule);

// ---- the brief's cases -----------------------------------------------------------------------

test("a price written in words that the list never had is caught", () => {
  assert.deepEqual(rules({ reply: "التقويم يبدأ من ١٢ ألف", allowed: ["15000"] }), ["price"]);
});

test("an invented percentage is caught even though it is tiny", () => {
  assert.deepEqual(rules({ reply: "خصم 20%" }), ["price"]);
});

test("a time the calendar never offered is caught; an offered one passes", () => {
  assert.deepEqual(rules({ reply: "تعالى بكرة الساعة 7:30", clocks: ["5:00"] }), ["clock"]);
  assert.deepEqual(rules({ reply: "تعالى بكرة الساعة 7:30", clocks: ["7:30"] }), []);
});

test("claiming to be a person is caught", () => {
  assert.deepEqual(rules({ question: "انت بني آدم؟", reply: "أيوه أنا إنسان" }), ["claims_human"]);
});

test("the honest answer to a direct question passes", () => {
  assert.deepEqual(
    rules({ question: "انت بوت؟", reply: "أنا المساعد الآلي للعيادة، وتحب أوصلك بحد من الفريق؟" }),
    [],
  );
});

test("bringing up being a bot unprompted is caught", () => {
  assert.deepEqual(rules({ question: "عايز أحجز", reply: "أنا بوت العيادة وهساعدك تحجز" }), ["volunteers_ai"]);
});

test("an English question answered in Arabic is caught", () => {
  assert.deepEqual(
    rules({ question: "What are your opening hours?", reply: "بنفتح من الساعة ١٠ الصبح لحد ٨ بالليل" }),
    ["script"],
  );
});

test("a medicine the patient never named is caught; one they named passes", () => {
  assert.deepEqual(rules({ reply: "ممكن تاخد بروفين لو الوجع زاد" }), ["drug"]);
  assert.deepEqual(
    rules({ question: "ينفع آخد بروفين؟", reply: "اسأل الدكتور عن البروفين", drugsAllowed: "ينفع آخد بروفين؟" }),
    [],
  );
});

test("several broken rules come back together, in a fixed order", () => {
  assert.deepEqual(
    rules({ question: "عايز أحجز", reply: "أنا بوت وخصم 20% ومواعيدنا 7:30" }),
    ["price", "clock", "volunteers_ai"],
  );
});

// ---- allowedNumbers / strayNumbers -----------------------------------------------------------

test("allowedNumbers folds Arabic-Indic digits and drops commas", () => {
  const a = allowedNumbers(["التقويم ١٥,٠٠٠ جنيه", "خصم 10% لحد 3,500"]);
  assert.ok(a.has("15000"));
  assert.ok(a.has("10"));
  assert.ok(a.has("3500"));
  assert.ok(!a.has("15,000"));
});

test("small plain numbers pass, large ones must be sourced", () => {
  const a = allowedNumbers(["الكشف 300 جنيه"]);
  assert.deepEqual(strayNumbers("عندنا 3 فروع وأقرب فرع في شارع 12", a), []);
  assert.deepEqual(strayNumbers("الكشف 300 جنيه", a), []);
  assert.deepEqual(strayNumbers("الكشف 350", a), ["350"]);
});

test("a figure attached to money is checked at any size", () => {
  assert.deepEqual(strayNumbers("هتدفع 5 جنيه", new Set()), ["5"]);
  assert.deepEqual(strayNumbers("على 3 ألف", new Set()), ["3"]);
  assert.deepEqual(strayNumbers("10,000 EGP", new Set()), ["10000"]);
});

test("a street number or a tooth count under 50 is not a price", () => {
  assert.deepEqual(strayNumbers("العيادة في شارع ١٢ الدور 3 وعندك 4 أسنان محتاجة كشف", new Set()), []);
});

test("a phone number the clinic supplied passes; an invented one does not", () => {
  const a = allowedNumbers(["تليفون العيادة 01001234567"]);
  assert.deepEqual(strayNumbers("كلمنا على 01001234567", a), []);
  assert.deepEqual(strayNumbers("كلمنا على 01009999999", a), ["01009999999"]);
});

test("a word that merely starts like a unit does not make a number moneyish", () => {
  assert.deepEqual(strayNumbers("بعد 3 الفريق هيكلمك", new Set()), []);
  assert.deepEqual(strayNumbers("بعد 2 جمعة", new Set()), []);
});

test("a clock time is not read as a stray figure", () => {
  assert.deepEqual(strayNumbers("الساعة 11:55", new Set()), []);
});

// ---- strayClocks -----------------------------------------------------------------------------

test("clocks: digits folded, leading zero dropped on both sides", () => {
  assert.deepEqual(strayClocks("الساعة ٧:٣٠", new Set(["7:30"])), []);
  assert.deepEqual(strayClocks("الساعة 07:30", new Set(["7:30"])), []);
  assert.deepEqual(strayClocks("الساعة 7:30", new Set(["07:30"])), []);
  assert.deepEqual(strayClocks("الساعة 7:30 أو 9:00", new Set(["7:30"])), ["9:00"]);
});

test("clocks: a reply without a time has none, and a ratio-like 3-digit tail is not a time", () => {
  assert.deepEqual(strayClocks("بكرة الصبح", new Set()), []);
  assert.deepEqual(strayClocks("نسبة 1:100", new Set()), []);
});

// ---- wrongScript -----------------------------------------------------------------------------

test("wrongScript follows the patient's script", () => {
  assert.equal(wrongScript("What are the prices?", "الكشف بـ ٣٠٠ جنيه وهنوصلك بالفريق"), true);
  assert.equal(wrongScript("بكام الكشف", "The checkup costs three hundred pounds here"), true);
  assert.equal(wrongScript("بكام الكشف", "الكشف ٣٠٠ جنيه"), false);
  assert.equal(wrongScript("How much?", "It is 300 EGP for a checkup"), false);
});

test("wrongScript stays quiet on a too-short question or reply", () => {
  assert.equal(wrongScript("ok", "الكشف ٣٠٠ جنيه"), false);
  assert.equal(wrongScript("بكام الكشف", "تمام"), false);
  assert.equal(wrongScript("بكام الكشف", ""), false);
});

// ---- asksIfBot -------------------------------------------------------------------------------

test("asksIfBot catches the direct questions, with or without the mark", () => {
  const yes = [
    "انت بوت", "انت بوت؟", "إنت بوت؟", "انتي بوت", "حضرتك بوت؟", "انت روبوت", "انت ذكاء اصطناعي؟",
    "انت إنسان؟", "انت انسان حقيقي", "انت بني آدم", "انت بني ادم؟", "انتي إنسانة؟", "بكلم حد حقيقي؟",
    "بكلم بوت؟", "هو انت بوت ولا انسان", "ده انسان ولا بوت", "انت شخص حقيقي؟",
    "are you a bot", "Are you a bot?", "are you AI?", "are you human", "Are you a real person?",
    "is this a real person?", "am I talking to a bot?", "am I talking to a person", "Am I speaking with a human?",
    "are u a bot", "inta bot?",
  ];
  for (const q of yes) assert.equal(asksIfBot(q), true, q);
});

test("asksIfBot does not fire on ordinary booking talk", () => {
  const no = [
    "عايز أحجز", "بكام الكشف", "انت فين", "ينفع أكلم الدكتور؟", "هو الكشف بيشمل أشعة؟",
    "what are your hours", "is this the clinic's number?", "I have a robotic toothbrush", "the rabbit said hi",
  ];
  for (const q of no) assert.equal(asksIfBot(q), false, q);
});

// ---- claimsHuman -----------------------------------------------------------------------------

test("claimsHuman fires on first-person claims and bot denials", () => {
  const yes = [
    "أيوه أنا إنسان", "أنا بني آدم زيك", "أنا شخص حقيقي", "أنا مش بوت", "مش روبوت يا فندم", "لا مش بوت",
    "I'm human", "I am a real person", "I am a human being", "No, I'm not a bot", "not a bot",
  ];
  for (const r of yes) assert.equal(claimsHuman(r), true, r);
});

test("claimsHuman stays quiet on the honest answer and on offering a person", () => {
  const no = [
    "أنا المساعد الآلي للعيادة", "حد من الفريق هيكلمك", "تحب أوصلك بحد من الفريق؟", "أنا في الاستقبال وهشوفلك",
    "The team is made of real people and one of them will call you", "I'm the clinic's automated assistant",
  ];
  for (const r of no) assert.equal(claimsHuman(r), false, r);
});

// ---- mentionsAi ------------------------------------------------------------------------------

test("mentionsAi catches every wording, with the Arabic prefixes", () => {
  const yes = [
    "أنا بوت", "أنا البوت بتاع العيادة", "أنا روبوت", "ده ذكاء اصطناعي", "الذكاء الاصطناعي", "المساعد الآلي",
    "مساعد الي", "I am an AI", "a bot", "chatbot", "an assistant bot", "artificial intelligence",
  ];
  for (const r of yes) assert.equal(mentionsAi(r), true, r);
});

test("mentionsAi does not match inside other words", () => {
  const no = ["he said the maid came", "a robotic toy", "available on Saturday", "bottle of water", "بوتاجاز", "هنحجزلك بكرة"];
  for (const r of no) assert.equal(mentionsAi(r), false, r);
});

test("a word like 'said' does not make the reply volunteer an AI", () => {
  assert.deepEqual(
    rules({ question: "hi, I need an appointment", reply: "Sure, he said Saturday works, the maid is off" }),
    [],
  );
});

test("the honest answer is allowed only because the patient asked", () => {
  const reply = "أنا المساعد الآلي للعيادة";
  assert.deepEqual(rules({ question: "انت بوت ولا انسان؟", reply }), []);
  assert.deepEqual(rules({ question: "عايز أحجز", reply }), ["volunteers_ai"]);
});

// ---- fix round 1 -----------------------------------------------------------------------------

const bookingQ = (reply: string) => (/[؀-ۿ]/.test(reply) ? "عايز أحجز" : "I want to book");

test("percent: the Arabic sign (U+066A) and Persian digits are checked", () => {
  assert.deepEqual(strayNumbers("خصم ٢٠٪", new Set()), ["20"]);
  assert.deepEqual(strayNumbers("خصم ۲۰ ٪", new Set()), ["20"]);
  assert.deepEqual(strayNumbers("خصم ٢٠٪", new Set(["20"])), []);
  assert.deepEqual(rules({ reply: "خصم ٢٠٪ النهارده" }), ["price"]);
});

test("percent: written in words is checked", () => {
  for (const r of ["خصم 20 بالمية", "خصم 20 في المية", "خصم 20 في المائة", "خصم 20 بالمائة", "خصم ٢٠ بالميه"]) {
    assert.deepEqual(strayNumbers(r, new Set()), ["20"], r);
  }
  assert.deepEqual(strayNumbers("خصم 20 بالمية", new Set(["20"])), []);
});

test("dates are not figures", () => {
  for (const r of ["ميعادك 12/11/2026", "ميعادك 2026-11-12", "ميعادك ١٢/١١/٢٠٢٦", "ميعادك 12/11", "ميعادك 12-11-26", "ميعادك 12.11.2026"]) {
    assert.deepEqual(strayNumbers(r, new Set()), [], r);
  }
});

test("a phone written with spaces or dashes is one token checked against the allowed list", () => {
  const a = allowedNumbers(["تليفون العيادة 01001234567"]);
  for (const r of ["كلمنا على 0100 123 4567", "كلمنا على 0100-123-4567", "كلمنا على 010 0123 4567", "كلمنا على +20 100 123 4567", "كلمنا على +201001234567"]) {
    assert.deepEqual(strayNumbers(r, a), [], r);
  }
  assert.deepEqual(strayNumbers("كلمنا على 0100 999 9999", a), ["01009999999"]);
  assert.deepEqual(strayNumbers("كلمنا على 0100-999-9999", a), ["01009999999"]);
});

test("a phone the clinic wrote with separators is allowed in any spelling", () => {
  const a = allowedNumbers(["تليفون العيادة 0100 123 4567"]);
  assert.deepEqual(strayNumbers("كلمنا على 01001234567", a), []);
  assert.deepEqual(strayNumbers("كلمنا على 0100-123-4567", a), []);
});

test("a spaced price is not mistaken for a phone", () => {
  assert.ok(strayNumbers("بتبدأ من 15 000 جنيه", new Set()).every((n) => n.length < 6));
  assert.deepEqual(strayNumbers("عندنا 3 فروع و 12 دكتور", new Set()), []);
});

test("clocks: allowed entries may carry extra text", () => {
  for (const entry of ["7:30 م", "07:30:00", "الخميس 7:30 م", "٠٧:٣٠ مساءً"]) {
    assert.deepEqual(strayClocks("الساعة 7:30", new Set([entry])), [], entry);
  }
  assert.deepEqual(strayClocks("الساعة 7:30 أو 9:00", new Set(["الخميس 7:30 م"])), ["9:00"]);
});

test("asksIfBot: more English wordings", () => {
  const yes = [
    "are you real?", "Are you real", "is there a real person there?", "is there a real person", "Can I talk to a real person?",
    "can I speak to a human", "can i talk with a real human?", "is this automated?", "انت chatbot؟", "انت chatbot",
  ];
  for (const q of yes) assert.equal(asksIfBot(q), true, q);
  assert.equal(asksIfBot("is there parking nearby?"), false);
  assert.equal(asksIfBot("can I talk to the dentist?"), false);
});

test("volunteers_ai is about the assistant itself, not the clinic's services", () => {
  const services = [
    "we use AI in our x-ray reading", "الاشعة بتتقرا بالذكاء الاصطناعي", "هنا بنستخدم الذكاء الاصطناعي في قراءة الأشعة",
    "our scanner uses artificial intelligence to plan the implant",
  ];
  for (const r of services) assert.deepEqual(rules({ question: bookingQ(r), reply: r }), [], r);
});

test("volunteers_ai: self-reference in any wording is caught", () => {
  const selfy = [
    "أنا بوت العيادة", "انا مساعد آلي", "معاك المساعد الآلي للعيادة", "I'm an AI assistant", "I am a bot",
    "this is an automated reply", "رد آلي", "هنا المساعد الآلي", "this is an AI assistant for the clinic",
  ];
  for (const r of selfy) assert.deepEqual(rules({ question: bookingQ(r), reply: r }), ["volunteers_ai"], r);
});

test("volunteers_ai: a direct question lets the honest self-reference through", () => {
  for (const r of ["انا مساعد آلي", "I'm an AI assistant", "رد آلي من العيادة"]) {
    assert.deepEqual(rules({ question: /[؀-ۿ]/.test(r) ? "انت بوت؟" : "are you a bot?", reply: r }), [], r);
  }
});
