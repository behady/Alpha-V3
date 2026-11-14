/**
 * One model reply, several WhatsApp messages: a line of `---` is a break, the parts go out as
 * separate bubbles a few seconds apart, and places that can only send one message fold the
 * breaks into blank lines.
 *
 * Run: npm run test:bot-bubbles
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { joinBubbles, MAX_BUBBLES, priceBeforeQuestions, splitBubbles } from "../src/lib/bot/bubbles";
import { asksPrice } from "../src/lib/bot/quickAnswers";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const ASNANY = [
  "أهلًا و سهلا بحضرتك 💫\n\nتبييض الاسنان بالليزر خلال جلسه واحده ب1000 جنيه بدلاً من 2500 جنيه\nالسعر شامل جلسة تنضيف الجير و تلميع الاسنان مجاناً بدون ألم. 🦷",
  "العنوان ٣٠٠أ - شارع الثروة المعدنيه - حدائق الاهرام - البوابة الاولي - بجوار بافلو برجر - الدور الارضي\n\nhttps://maps.app.goo.gl/ih3r2y1EyehrEUHv8?g_st=ic",
  "للحجز ايه اكتر يوم ممكن يكون مناسب لحضرتك خلال الاسبوع ؟",
];

test("the clinic's three messages come out as three bubbles, blank lines inside a message kept", () => {
  assert.deepEqual(splitBubbles(ASNANY.join("\n---\n")), ASNANY);
  assert.deepEqual(splitBubbles(ASNANY.join("\n\n---\n\n")), ASNANY, "blank lines around the break");
  assert.deepEqual(splitBubbles(ASNANY.join("\n ---- \n")), ASNANY, "more dashes, spaces around");
  assert.deepEqual(splitBubbles(ASNANY.join("\n———\n")), ASNANY, "em dashes");
  assert.deepEqual(splitBubbles(`---\n${ASNANY[0]}\n---\n${ASNANY[1]}\n---`), ASNANY.slice(0, 2), "a stray break at either end is ignored");
});

test("a reply without a break is one message, and a dash inside a line is not a break", () => {
  assert.deepEqual(splitBubbles(ASNANY[1]), [ASNANY[1]], "the address has ' - ' five times");
  assert.deepEqual(splitBubbles("تمام 👍"), ["تمام 👍"]);
  assert.deepEqual(splitBubbles("  "), [""], "never empty");
  assert.deepEqual(splitBubbles("سعر الكشف 300 - 400 جنيه\n- على حسب الحالة"), ["سعر الكشف 300 - 400 جنيه\n- على حسب الحالة"], "a bullet is not a break");
});

test("at most four bubbles; the rest rides in the last one", () => {
  const six = ["أ", "ب", "ج", "د", "هـ", "و"].join("\n---\n");
  assert.equal(MAX_BUBBLES, 4);
  assert.deepEqual(splitBubbles(six), ["أ", "ب", "ج", "د\n\nهـ\n\nو"]);
});

test("folding back gives one message with blank lines, never dashes", () => {
  assert.equal(joinBubbles(ASNANY.join("\n---\n")), ASNANY.join("\n\n"));
  assert.equal(joinBubbles(ASNANY[2]), ASNANY[2]);
  assert.ok(!joinBubbles("أ\n---\nب").includes("---"));
});

test("respond.ts sends the parts one by one, and folds them where only one message can go", () => {
  const src = readFileSync(new URL("../src/lib/bot/respond.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const split = src.indexOf("const parts = splitBubbles(body);");
  assert.ok(split > 0, "the reply is split");
  assert.ok(src.includes("if (!structure && !args.dryRun) {\n        body = parts[0];\n        extraBubbles = parts.slice(1);"), "plain replies: first part now, the rest after");
  assert.ok(src.includes('body = parts.join("\\n\\n");\n        if (structure) structure = { ...structure, body: joinBubbles(structure.body) };'), "buttons, lists and the playground: one message");
  assert.ok(split < src.indexOf("if (pace && !structure && !extraBubbles.length && body.length > 180) {"), "the long-answer split yields to the model's breaks");
  assert.ok(src.includes("for (const bubble of extraBubbles.length ? extraBubbles : secondBubble ? [secondBubble] : []) {"), "one loop sends the rest");
  const loop = src.indexOf("for (const bubble of extraBubbles.length");
  assert.ok(loop > src.indexOf('claimKey("out", conversationKey(replyTo), body)'), "after the first bubble's claim and send");
  assert.ok(loop < src.indexOf("if (trailerBubble && !args.dryRun) {"), "before the photo disclaimer");
  assert.ok(src.includes("recordThreadMessage(clinicId, replyTo, { direction: \"out\", author: \"bot\", text: bubble, kind: reason }, Date.now())"), "each bubble is its own thread line");
});

// The real reply of 14/11/2026 08:25 (chat …054233): it already led with the price.
const TURN1 =
  "أيوه متاح عندنا كمبوزيت فينير، وسعره يبدأ من 1,500 ج.م، والاستقبال بيأكد السعر النهائي بعد ما الدكتور يحدد الأنسب لضحكتك. والكشف عموماً 200 ج.م وبيتخصم من تكلفة العلاج لو كمّلت معانا.\n\nالمواعيد المتاحة عندي مثلاً السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 6:30 م، تحب أنهي فيهم؟";

test("asked the price, the price comes before the model's own question", () => {
  assert.equal(priceBeforeQuestions(TURN1), TURN1, "already price-first: untouched");
  const questionFirst =
    "الهدف تجميلي لتعديل شكل الابتسامة ولا في سنة معينة مضايقاك؟\n\nأيوه بنعمل كمبوزيت فينير، وسعره بيبدأ من 1,500 ج.م.\n\nعندي ميعاد السبت 6:30 م، يناسبك؟";
  assert.equal(
    priceBeforeQuestions(questionFirst),
    "أيوه بنعمل كمبوزيت فينير، وسعره بيبدأ من 1,500 ج.م.\n\nالهدف تجميلي لتعديل شكل الابتسامة ولا في سنة معينة مضايقاك؟\n\nعندي ميعاد السبت 6:30 م، يناسبك؟",
    "the question moves to just after the figure; nothing is added or lost"
  );
  const greeting = "أهلاً بك، معاك سارة.\n\nالعرض بـ 299 ج.م بدل 550 ج.م.\n\nتحب نحجزلك السبت؟";
  assert.equal(priceBeforeQuestions(greeting), greeting, "a greeting stays first; a question after the price stays");
  assert.equal(priceBeforeQuestions("سؤال؟\n---\n500 ج.م"), "سؤال؟\n---\n500 ج.م", "the clinic's --- order is its own");
  assert.ok(priceBeforeQuestions("Is it for looks?\n\nVeneers start at EGP 1,500.").startsWith("Veneers"), "English, currency first");
  assert.ok(priceBeforeQuestions("محتاج كام سنة؟\n\nالحشو 300 ج للسن.").startsWith("الحشو"), "ج on its own");
  assert.equal(priceBeforeQuestions("محتاج كام جلسة؟\n\nغالباً 2 جلسة."), "محتاج كام جلسة؟\n\nغالباً 2 جلسة.", "a count is not a price");
  assert.equal(priceBeforeQuestions("تحب تيجي امتى؟\n\nالسبت 6:30 م متاح."), "تحب تيجي امتى؟\n\nالسبت 6:30 م متاح.", "a time is not a price");
});

test("asksPrice: a money question, not every كام", () => {
  for (const q of ["السعر كام", "بكام", "الفينير بكام؟", "how much is it", "بتعملوا فينيس\nالسعر كام", "سعره كام", "التنظيف بكم", "what are your prices"]) {
    assert.equal(asksPrice(q), true, q);
  }
  for (const q of ["الساعة كام", "عندكم كام فرع", "بتعملوا فينيس", "اتمنى اجي بكره", "costume", ""]) {
    assert.equal(asksPrice(q), false, q);
  }
});

test("respond.ts reorders the model's answer only when a price was asked", () => {
  const src = readFileSync(new URL("../src/lib/bot/respond.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const guard = src.indexOf("if ([act.question, ...unanswered].some(asksPrice)) ai.text = priceBeforeQuestions(ai.text);");
  assert.ok(guard > 0, "the guard is there");
  assert.ok(guard > src.indexOf("const cleaned = stripDoctorNames(ai.text"), "after the hidden-names backstop");
  assert.ok(guard < src.indexOf("brainUsed = brainReply.brainUsed;"), "before anything is built from the text");
});

test("both brains are told how to mark a break", () => {
  for (const f of ["src/lib/bot/botPrompt.ts", "src/lib/botPro/proPrompt.ts"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(src.includes("حط سطر فيه --- لوحده بين كل رسالة والتانية"), `${f} has the rule`);
  }
});
