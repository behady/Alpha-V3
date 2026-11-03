/**
 * One model reply, several WhatsApp messages: a line of `---` is a break, the parts go out as
 * separate bubbles a few seconds apart, and places that can only send one message fold the
 * breaks into blank lines.
 *
 * Run: npm run test:bot-bubbles
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { joinBubbles, MAX_BUBBLES, splitBubbles } from "../src/lib/bot/bubbles";

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

test("both brains are told how to mark a break", () => {
  for (const f of ["src/lib/bot/botPrompt.ts", "src/lib/botPro/proPrompt.ts"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(src.includes("حط سطر فيه --- لوحده بين كل رسالة والتانية"), `${f} has the rule`);
  }
});
