/**
 * Warmer Egyptian openings, and one welcome per sitting (lib/bot/wordingFix, plus the code's own
 * name questions in engine.ts and respond.ts and their English copies in localize.ts).
 *
 * The lines are the real ones from 14/11/2026: "أهلاً بك! … العرض متاح بالفعل"، and "تمام 👍 /
 * أهلاً بيك 🙏 عشان أسجل الحجز باسمك…" arriving on a patient's fifth message. The pipeline below
 * runs in respond.ts's order: tidyModelWording → feminizeAddress → stripRepeatIntro.
 *
 * Run: npm run test:wording
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tidyModelWording } from "../src/lib/bot/wordingFix";
import { feminizeAddress } from "../src/lib/bot/voiceFix";
import { stripRepeatIntro } from "../src/lib/bot/repeatIntro";
import { localizeOutbound } from "../src/lib/bot/localize";
import { decideBotReply, type BotContext } from "../src/lib/bot/engine";

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const CLINIC = "Alpha Dental Clinic";
const first = { laterTurn: false, patientText: "أهلاً عيادة ألفا، حابب أحجز عرض الـ 299 ج (كشف وتنظيف وتلميع)." };

/** respond.ts's order: the wording, then a woman addressed as one, then the repeated intro. */
function pipeline(model: string, o: { laterTurn: boolean; patientText: string; heardIntroBefore?: boolean; female?: boolean }): string {
  let t = tidyModelWording(model, { laterTurn: o.laterTurn, patientText: o.patientText });
  if (o.female) t = feminizeAddress(t, "female");
  if (o.heardIntroBefore) t = stripRepeatIntro(t, "سارة", CLINIC);
  return t;
}

run("first reply: the Egyptian welcome, and no translated بالفعل", () => {
  assert.equal(
    tidyModelWording("أهلاً بك! معاك سارة من Alpha Dental CLinic. العرض متاح بالفعل، كشف شامل مع تنظيف الجير والتصبغات والتلميع بـ 299 ج.م بس بدل 550 ج.م.", first),
    // The clinic's name is the clinic's own stored spelling: never rewritten here (owner's decision).
    "أهلاً بحضرتك! معاك سارة من Alpha Dental CLinic. العرض متاح، كشف شامل مع تنظيف الجير والتصبغات والتلميع بـ 299 ج.م بس بدل 550 ج.م."
  );
  assert.equal(
    tidyModelWording("أهلاً بك، معاك سارة من Alpha Dental Clinic.\n\nالعرض متاح بالفعل وبيشمل الكشف الشامل وتنظيف الجير", first),
    "أهلاً بحضرتك، معاك سارة من Alpha Dental Clinic.\n\nالعرض متاح وبيشمل الكشف الشامل وتنظيف الجير"
  );
  assert.equal(
    tidyModelWording("أهلاً بك، معاك سارة من Alpha Dental Clinic.\n\nالعرض متاح وفعلاً بيشمل الكشف الشامل", first),
    "أهلاً بحضرتك، معاك سارة من Alpha Dental Clinic.\n\nالعرض متاح وبيشمل الكشف الشامل"
  );
  assert.equal(tidyModelWording("العرض متاح وفعلاً يشمل الكشف", first), "العرض متاح ويشمل الكشف");
  assert.equal(tidyModelWording("العرض متاح بالفعل ويشمل كشف شامل", first), "العرض متاح ويشمل كشف شامل");
  // Anywhere else, the Egyptian word.
  assert.equal(tidyModelWording("الكشف بالفعل بيتخصم من العلاج، وبالفعل ناس كتير بتكمل", first), "الكشف فعلاً بيتخصم من العلاج، وفعلاً ناس كتير بتكمل");
  // A greeting that is already Egyptian is the model's to keep on the first reply.
  assert.equal(tidyModelWording("أهلاً بيك! معاك سارة من Alpha Dental CLinic.\n\nعنواننا: شارع الرحمة.", { ...first, patientText: "الموقع" }), "أهلاً بيك! معاك سارة من Alpha Dental CLinic.\n\nعنواننا: شارع الرحمة.");
});

run("every formal shape becomes أهلاً بحضرتك, and nothing that only looks like it", () => {
  assert.equal(tidyModelWording("مرحباً بك في عيادتنا", first), "أهلاً بحضرتك في عيادتنا");
  assert.equal(tidyModelWording("أهلاً وسهلاً بكِ يا أستاذة منى", first), "أهلاً وسهلاً بحضرتك يا أستاذة منى");
  assert.equal(tidyModelWording("العفو، وأهلاً بك في أي وقت", first), "العفو، وأهلاً بحضرتك في أي وقت");
  assert.equal(tidyModelWording("أهلًا بك", first), "أهلاً بحضرتك");
  // Plural, "بيك", and longer words are not the formal singular.
  for (const keep of ["أهلاً بكم في العيادة", "أهلاً بيك يا فندم", "أهلاً بكلامك ده"]) {
    assert.equal(tidyModelWording(keep, first), keep, keep);
  }
  // "بالفعل" after a word that only ends in "متاح" is not the filler after "متاح": the Egyptian word.
  assert.equal(tidyModelWording("ده المتاح بالفعل؟", first), "ده المتاح فعلاً؟");
});

run("a later turn: the welcome the patient already had is not said again", () => {
  const later = { laterTurn: true, patientText: "تمام", heardIntroBefore: true };
  // stripRepeatIntro used to leave "أهلاً بك." standing on its own line.
  assert.equal(pipeline("أهلاً بك، معاك سارة من Alpha Dental Clinic.\n\nتمام، حجزتلك ميعاد الأحد الساعة 3:00 م.", { ...later, patientText: "الأحد الساعة 3 عصرا" }), "تمام، حجزتلك ميعاد الأحد الساعة 3:00 م.");
  assert.equal(
    pipeline("أهلاً بيك، معاك سارة من Alpha Dental CLinic.\n\nعنواننا: شارع الرحمة (شارع أبو بكر).\n\nتحب تيجي تكشف عن حاجة معينة؟", { ...later, patientText: "العنوان ايه" }),
    "عنواننا: شارع الرحمة (شارع أبو بكر).\n\nتحب تيجي تكشف عن حاجة معينة؟"
  );
  assert.equal(
    pipeline("أهلاً بحضرتك يا أستاذ خميس، معاك سارة من Alpha Dental Clinic. تم تسجيل بياناتك وهوصلك حالاً بمسؤول الاستقبال.", { ...later, patientText: "خميس عبد الوهاب الحلواني" }),
    "تم تسجيل بياناتك وهوصلك حالاً بمسؤول الاستقبال."
  );
  assert.equal(pipeline("أهلاً بيك 🙏 تحب نظبط ميعاد السبت ولا الأحد؟", later), "تحب نظبط ميعاد السبت ولا الأحد؟");
  assert.equal(pipeline("أهلاً بيك.\n\nتحب نظبط ميعاد السبت ولا الأحد؟", later), "تحب نظبط ميعاد السبت ولا الأحد؟");
  // A woman: the same, and what is left is still addressed to her.
  assert.equal(pipeline("أهلاً بيك! معاك سارة.\n\nتحب نظبط ميعاد السبت؟", { ...later, female: true }), "تحبي نظبط ميعاد السبت؟");
  // "مساءً" in a picked time is not a greeting.
  assert.equal(pipeline("أهلاً بيك 🙏 تمام، الساعة 6:30 م مناسبة جداً.", { ...later, patientText: "الساعة 6 ونص مساءً" }), "تمام، الساعة 6:30 م مناسبة جداً.");
});

run("a later turn keeps what is not a repeated welcome", () => {
  const later = { laterTurn: true, patientText: "تمام", heardIntroBefore: true };
  // The patient greeted again: answering in kind is what a person does.
  assert.equal(pipeline("أهلاً بحضرتك 🙏 تحب نكمل الحجز؟", { ...later, patientText: "السلام عليكم" }), "أهلاً بحضرتك 🙏 تحب نكمل الحجز؟");
  assert.equal(pipeline("أهلاً بيك 🙏 تحب نكمل الحجز؟", { ...later, patientText: "ازيك" }), "أهلاً بيك 🙏 تحب نكمل الحجز؟");
  assert.equal(pipeline("أهلاً بيك 🙏 تحب نكمل الحجز؟", { ...later, patientText: "hello again" }), "أهلاً بيك 🙏 تحب نكمل الحجز؟");
  assert.equal(
    pipeline("وعليكم السلام ورحمة الله وبركاته، معاك سارة من Alpha Dental Clinic.\n\nخير، تحت أمرك.", { ...later, patientText: "السلام عليكم يا أحباب هو إيه اللي بيحصل؟" }),
    "وعليكم السلام ورحمة الله وبركاته.\n\nخير، تحت أمرك."
  );
  // The greeting goes on ("وبأهل بلبيس"), or sits inside the reply: a sentence, not a welcome.
  assert.equal(pipeline("أهلاً بحضرتك وبأهل بلبيس كلهم.\n\nتحب نكمل الحجز؟", { ...later, patientText: "أنا من بلبيس" }), "أهلاً بحضرتك وبأهل بلبيس كلهم.\n\nتحب نكمل الحجز؟");
  assert.equal(pipeline("العفو، وأهلاً بيك وبكل أهل السويس. تنورنا في أي وقت.", { ...later, patientText: "تمام شكرا انا سكان في السويس" }), "العفو، وأهلاً بيك وبكل أهل السويس. تنورنا في أي وقت.");
  // Nothing worth sending would be left.
  assert.equal(tidyModelWording("أهلاً بيك 🙏", { laterTurn: true, patientText: "تمام" }), "أهلاً بيك 🙏");
  assert.equal(tidyModelWording("أهلاً بيك، تمام", { laterTurn: true, patientText: "تمام" }), "أهلاً بيك، تمام");
  // The first reply of a sitting keeps its welcome.
  assert.equal(tidyModelWording("أهلاً بيك 🙏 تحب نظبط ميعاد السبت ولا الأحد؟", first), "أهلاً بيك 🙏 تحب نظبط ميعاد السبت ولا الأحد؟");
});

run("English and Franco, and a reply with nothing to fix, come back exactly as they went in", () => {
  for (const keep of [
    "Hello! I'm Sarah from Alpha Dental CLinic. The offer is already available, and your smile matters.",
    "ahlan bik, el 3ard mota7 bel fe3l",
    "عنواننا: شارع الرحمة (شارع أبو بكر).",
    "تمام 👍",
    "  ",
    "",
  ]) {
    assert.equal(tidyModelWording(keep, { laterTurn: true, patientText: "ok" }), keep, keep);
    assert.equal(tidyModelWording(keep, first), keep, keep);
  }
});

const here = dirname(fileURLToPath(import.meta.url));
const source = (p: string) => readFileSync(join(here, "..", p), "utf8");

run("the code's own name questions do not greet a patient who is mid-conversation", () => {
  for (const file of ["src/lib/bot/respond.ts", "src/lib/bot/engine.ts"]) {
    const src = source(file);
    assert.ok(!src.includes("${v.welcome} 🙏"), `${file}: no "أهلاً بيك 🙏" in front of a name question`);
    assert.ok(!src.includes("أهلاً بيك 🌟"), `${file}: no "أهلاً بيك 🌟" in front of a name question`);
  }
  // The menu path (no model on that turn): typed "1" for a new number, and the book button.
  const newPatient: BotContext = { clinicName: "Alpha Dental", canOfferBooking: false, canRegister: true };
  for (const text of ["1", "m1"]) {
    const d = decideBotReply({ state: "awaiting_choice", text, ctx: newPatient });
    assert.ok(/^ask_name$/.test(d.reason), d.reason);
    assert.ok(!/^\s*(أهلا|أهلاً|اهلا)/.test(d.reply), d.reply);
  }
  const she = decideBotReply({ state: "awaiting_choice", text: "1", ctx: { ...newPatient, gender: "female" } });
  assert.equal(she.reply, "عشان نسجل الحجز، ياريت حضرتك تبعتيلنا الاسم الكامل 🙏");
});

run("every name question, either gender, still reaches an English-writing patient in English", () => {
  const tapped = decideBotReply({ state: "awaiting_choice", text: "m1", ctx: { clinicName: "Alpha Dental", canOfferBooking: false, canRegister: true } }).reply;
  const lines = [
    "عشان أسجل الحجز باسمك، ابعتلي اسمك الكامل 🙏",
    "عشان أسجل الحجز باسمك، ابعتيلي اسمك الكامل 🙏",
    "عشان نسجل الحجز، ياريت حضرتك تبعتلنا الاسم الكامل 🙏",
    "عشان نسجل الحجز، ياريت حضرتك تبعتيلنا الاسم الكامل 🙏",
    tapped,
    // respond.ts addresses a woman after the engine wrote the line: "ابعتلنا" → "ابعتيلنا".
    feminizeAddress(tapped, "female"),
  ];
  assert.notEqual(lines[4], lines[5], "the book button's line has a feminine form");
  for (const line of lines) {
    const en = localizeOutbound(line).text;
    assert.ok(!/[؀-ۿ]/.test(en), `still Arabic: ${en}`);
    // With the model's own line in front, as respond.ts sends it when slots were picked.
    assert.ok(!/[؀-ۿ]/.test(localizeOutbound(`تمام 👍\n\n${line}`).text));
  }
  // respond.ts's two templates, as it builds them for each gender.
  const respondSrc = source("src/lib/bot/respond.ts");
  assert.ok(respondSrc.includes("const askName = `عشان أسجل الحجز باسمك، ${v.send === \"ابعتي\" ? \"ابعتيلي\" : \"ابعتلي\"} اسمك الكامل 🙏`;"));
  assert.ok(respondSrc.includes("const askName = `عشان نسجل الحجز، ياريت حضرتك ${v.send === \"ابعتي\" ? \"تبعتيلنا\" : \"تبعتلنا\"} الاسم الكامل 🙏`;"));
});

console.log("wordingFix: all suites passed");
