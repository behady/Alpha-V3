import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { asksAboutTiming, holdRepeatOffer, patientMessagesSinceOffer, withoutSlotOffer } from "../src/lib/bot/slotRepeat";
import { isBareAgreement, resolveSpokenPick, spokenSlots } from "../src/lib/bot/spokenPick";

/**
 * The two times, once.
 *
 * 14/11/2026: a patient from the 299 ad asked for the address, then the area, and read
 * "تحب نظبط الحجز السبت 3:00 م ولا الأحد 3:00 م؟" under every answer, each time as its own bubble.
 * The texts below are the real replies of that day (Africa/Cairo), with the labels nextSlots()
 * gave for Saturday 14/11 and Sunday 15/11.
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

const S = (key: string, label: string) => ({ key, label });
const OFFER_300 = [
  S("2026-11-14|03:00 PM|", "السبت 14/11 الساعة 3:00 م"),
  S("2026-11-14|06:30 PM|", "السبت 14/11 الساعة 6:30 م"),
  S("2026-11-14|10:00 PM|", "السبت 14/11 الساعة 10:00 م"),
  S("2026-11-15|03:00 PM|", "الأحد 15/11 الساعة 3:00 م"),
  S("2026-11-15|06:30 PM|", "الأحد 15/11 الساعة 6:30 م"),
  S("2026-11-15|10:00 PM|", "الأحد 15/11 الساعة 10:00 م"),
];
const OFFER_330 = [
  S("2026-11-14|03:30 PM|", "السبت 14/11 الساعة 3:30 م"),
  S("2026-11-14|06:30 PM|", "السبت 14/11 الساعة 6:30 م"),
  S("2026-11-14|10:00 PM|", "السبت 14/11 الساعة 10:00 م"),
  S("2026-11-15|03:00 PM|", "الأحد 15/11 الساعة 3:00 م"),
  S("2026-11-15|06:30 PM|", "الأحد 15/11 الساعة 6:30 م"),
  S("2026-11-15|10:00 PM|", "الأحد 15/11 الساعة 10:00 م"),
];
const DOC = [
  S("2026-11-14|03:00 PM|د. أحمد", "السبت 14/11 الساعة 3:00 م مع د. أحمد"),
  S("2026-11-15|03:00 PM|د. سارة", "الأحد 15/11 الساعة 3:00 م مع د. سارة"),
];
const ADDRESS = "شارع الرحمة (شارع أبو بكر) - مساكن شروق النادي الأهلي - عمارة أولاد يحيى - الدور الأول.";
type Line = { author: string; text: string };

/** What respond.ts does on a plain "answer": hold or not, the text sent, the keys saved. */
function turn(o: { question: string; reply: string; prevBotOffer: string; thread: Line[]; offer: typeof OFFER_300; gap?: number }) {
  const previousKeys = spokenSlots(o.prevBotOffer, o.offer);
  const spokenKeys = spokenSlots(o.reply, o.offer);
  const hold =
    !isBareAgreement(o.question) &&
    holdRepeatOffer({ question: o.question, spokenKeys, previousKeys, thread: o.thread, offer: o.offer, gapMinutes: o.gap });
  const stripped = hold ? withoutSlotOffer(o.reply, o.offer) : null;
  return { hold: Boolean(stripped), text: stripped ?? o.reply, carry: stripped ? previousKeys : spokenKeys, previousKeys };
}

/* ---------------------------------------------------------------- chat ...785354, 09:25-09:32 */

const c1_q1 =
  "السلام عليكم ورحمة الله وبركاته.. العنوان واللوكيشن.. يناسبني موعد اي يوم في الفترة الصباحية من 10 صباحا... ولغاية 2 ظهرا.. خميس الحلواني على الخاص واتس اب موبايل رقم.. 01064785354.. مصر الجديدة";
const c1_r1b =
  "مواعيد العيادة بتبدأ يومياً من 3:00 العصر لـ 11:00 بالليل (الجمعة إجازة)، فللأسف مفيش مواعيد صباحية قبل الساعة 3. \n\nعندنا ميعاد السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 3:00 م، إيه اللي يناسبك فيهم؟";
const c1_q2 = "تمام.. عنوان العيادة.. ولكم الشكر";
const c1_r2 = `العنوان بالتفصيل: ${ADDRESS}\n\nتحب نظبط الحجز السبت 3:00 م ولا الأحد 3:00 م؟`;
const c1_q3 = "تمام يا احباب.. من فضلكم في اي منطقة..";
const c1_r3 =
  "العيادة في مدينة نصر، عند مساكن شروق النادي الأهلي في شارع الرحمة (شارع أبو بكر).\n\nتحب نسجل حجزك السبت الساعة 3:00 العصر ولا الأحد الساعة 3:00 العصر؟";
const c1_q4 = "Okay.. الأحد.. 15 نوفمبر الحالي الساعة 3 عصرا وألف شكر.. امكانية تبعتلي اللوكيشن..";

run("785354: a morning request is about timing, so a new pair may be offered", () => {
  assert.equal(asksAboutTiming(c1_q1), true);
});

let c1_sent2 = "";
run("785354 09:29: 'عنوان العيادة' gets the address only; the times he heard are kept", () => {
  const thread = [
    { author: "patient", text: c1_q1 },
    { author: "bot", text: `وعليكم السلام ورحمة الله وبركاته يا أستاذ خميس.\n\nعنواننا: ${ADDRESS}` },
    { author: "bot", text: c1_r1b },
    { author: "patient", text: c1_q2 },
  ];
  const t = turn({ question: c1_q2, reply: c1_r2, prevBotOffer: c1_r1b, thread, offer: OFFER_300 });
  assert.equal(t.hold, true);
  assert.equal(t.text, `العنوان بالتفصيل: ${ADDRESS}`);
  assert.deepEqual(t.carry, ["2026-11-14|03:00 PM|", "2026-11-15|03:00 PM|"]);
  c1_sent2 = t.text;
});

run("785354 09:30: 'في اي منطقة', the second info question, still no repeat", () => {
  const thread = [
    { author: "bot", text: c1_r1b },
    { author: "patient", text: c1_q2 },
    { author: "bot", text: c1_sent2 },
    { author: "patient", text: c1_q3 },
  ];
  const t = turn({ question: c1_q3, reply: c1_r3, prevBotOffer: c1_r1b, thread, offer: OFFER_300 });
  assert.equal(t.hold, true);
  assert.equal(t.text, "العيادة في مدينة نصر، عند مساكن شروق النادي الأهلي في شارع الرحمة (شارع أبو بكر).");
});

run("785354 09:32: he picks Sunday 3; that is timing, and the carried keys still resolve", () => {
  assert.equal(asksAboutTiming(c1_q4), true);
  const heard = spokenSlots(c1_r1b, OFFER_300).map((k) => OFFER_300.find((s) => s.key === k)!);
  assert.equal(resolveSpokenPick("الأحد", heard), "2026-11-15|03:00 PM|");
  assert.equal(resolveSpokenPick("التاني", heard), "2026-11-15|03:00 PM|");
});

/* ---------------------------------------------------------------- the address after the first offer */

run("262995: 'العنوان ايه' gets the address only", () => {
  const prev = "عندي ميعاد متاح السبت الساعة 3:30 م أو السبت الساعة 6:30 م، إيه اللي يناسبك؟";
  const reply = `عنواننا في ${ADDRESS}\n\nتحب نظبط ميعادك السبت الساعة 3:30 م ولا 6:30 م؟`;
  const t = turn({ question: "العنوان ايه", reply, prevBotOffer: prev, thread: [{ author: "bot", text: prev }, { author: "patient", text: "العنوان ايه" }], offer: OFFER_330 });
  assert.equal(t.hold, true);
  assert.equal(t.text, `عنواننا في ${ADDRESS}`);
});

run("247719: 'العنوان' gets the address only", () => {
  const prev = "عندي ميعاد متاح السبت 14/11 الساعة 3:30 م أو الساعة 6:30 م، إيه اللي يناسبك أكتر؟";
  const reply = `عنواننا: ${ADDRESS}\n\nتحب نظبط ميعادك السبت 14/11 الساعة 3:30 م ولا 6:30 م؟`;
  const t = turn({ question: "العنوان", reply, prevBotOffer: prev, thread: [{ author: "bot", text: prev }, { author: "patient", text: "العنوان" }], offer: OFFER_330 });
  assert.equal(t.hold, true);
  assert.equal(t.text, `عنواننا: ${ADDRESS}`);
});

/* ---------------------------------------------------------------- other patterns of that day */

run("270445685: a caries remark is answered; the same pair is not repeated", () => {
  const prev = "عندنا ميعاد السبت 14/11 الساعة 3:00 م أو الساعة 6:30 م، إيه اللي يناسبك؟";
  const reply =
    "ألف سلامة عليك. الدكتور في الكشف هيطمن على كل الأسنان ويحدد نوع الحشو المناسب ليها، والكشف بيتخصم من تكلفة أي علاج هتعمله معانا.\n\nعندنا ميعاد السبت 14/11 الساعة 3:00 م أو الساعة 6:30 م، تحب نظبطلك أنهي ميعاد؟";
  const t = turn({ question: "انا عندي تسووس في سناني", reply, prevBotOffer: prev, thread: [{ author: "bot", text: prev }, { author: "patient", text: "انا عندي تسووس في سناني" }], offer: OFFER_300 });
  assert.equal(t.hold, true);
  assert.ok(!/3:00|6:30/.test(t.text));
  assert.ok(t.text.startsWith("ألف سلامة عليك."));
  assert.ok(t.text.endsWith("هتعمله معانا."));
});

run("123054233: a rotated pair on 'السعر كام' is held too; the pair he heard is what is kept", () => {
  const prev = "أيوه بنعمل كمبوزيت فينير، وسعره بيبدأ من 1,500 ج.م.\n\nعندي ميعاد السبت الساعة 6:30 م أو الأحد الساعة 3:00 م، إيه اللي يناسبك أكتر؟";
  const reply =
    "أيوه متاح عندنا كمبوزيت فينير، وسعره يبدأ من 1,500 ج.م، والاستقبال بيأكد السعر النهائي.\n\nالمواعيد المتاحة عندي مثلاً السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 6:30 م، تحب أنهي فيهم؟";
  const t = turn({ question: "السعر كام", reply, prevBotOffer: prev, thread: [{ author: "bot", text: prev }, { author: "patient", text: "السعر كام" }], offer: OFFER_300 });
  assert.equal(t.hold, true);
  assert.equal(t.text, "أيوه متاح عندنا كمبوزيت فينير، وسعره يبدأ من 1,500 ج.م، والاستقبال بيأكد السعر النهائي.");
  assert.deepEqual(t.carry, t.previousKeys);
});

run("123054233: 'الفروع فين' keeps the branch question and drops only the times", () => {
  const prev = "عندي ميعاد السبت الساعة 6:30 م أو الأحد الساعة 3:00 م، إيه اللي يناسبك أكتر؟";
  const reply = `فرعنا في ${ADDRESS.replace(/\.$/, "")}، وفيه فرع متاح في شارع الطاقة بحدائق الأهرام.\n\nتحب نظبط ميعاد في فرع مساكن الشروق؟ عندي السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 6:30 م.`;
  const t = turn({ question: "الفروع فين", reply, prevBotOffer: prev, thread: [{ author: "bot", text: prev }, { author: "patient", text: "الفروع فين" }], offer: OFFER_300 });
  assert.equal(asksAboutTiming("الفروع فين"), false);
  assert.equal(asksAboutTiming("في فرع في الحدايق؟"), false, "الحدايق is not الحد (Sunday)");
  assert.equal(t.hold, true);
  assert.ok(t.text.endsWith("تحب نظبط ميعاد في فرع مساكن الشروق؟"));
});

run("every closing offer the model wrote that day is recognised as an offer and nothing else", () => {
  const offers = [
    "عندي ميعاد مناسب لحضرتك بكره السبت الساعة 3:00 م أو 6:30 م، تحب نثبت أنهي ميعاد؟",
    "يناسبك ميعاد السبت الساعة 3:00 م ولا السبت الساعة 6:30 م عشان نظبط الحجز؟",
    "تحب نظبط ميعاد الكشف السبت الساعة 6:30 م ولا الأحد الساعة 3:00 م؟",
    "عندي ميعاد مناسب السبت 14/11 الساعة 3:00 م أو الساعة 6:30 م، تحب أنهي فيهم؟",
    "يناسبك ميعاد يوم السبت الساعة 6:30 م ولا الأحد الساعة 3:00 م؟",
    "عندي ميعاد متاح السبت 14/11 الساعة 3:00 م أو الساعة 6:30 م، إيه اللي يناسبك أكتر؟",
    "عندي ميعاد السبت 14/11 الساعة 3:00 م، أو الساعة 6:30 م، إيه اللي يناسبك أكتر؟",
    "عندنا ميعاد السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 6:30 م، إيه اللي يناسبك؟",
    "تحب نظبط ميعادك السبت الساعة 6:30 م ولا الأحد الساعة 3:00 م؟",
  ];
  for (const offer of offers) {
    assert.equal(withoutSlotOffer(`عنواننا: ${ADDRESS}\n\n${offer}`, OFFER_300), `عنواننا: ${ADDRESS}`, offer);
  }
});

run("an offer said with the prompt's day words (النهارده / بكره / بعد بكره) is recognised too", () => {
  const threeDays = [...OFFER_300, S("2026-11-16|03:00 PM|", "الإثنين 16/11 الساعة 3:00 م")];
  for (const offer of [
    "عندي النهارده السبت 14/11 الساعة 3:00 م أو بكره الأحد 15/11 الساعة 6:30 م، تحب أنهي؟",
    "عندي النهارده السبت 14/11 الساعة 3:00 م أو بعد بكره الإثنين 16/11 الساعة 3:00 م، تحب أنهي؟",
    "تحب بكره الأحد 15/11 الساعة 3:00 م ولا بعد بكرة الإثنين 16/11 الساعة 3:00 م؟",
  ]) {
    assert.equal(withoutSlotOffer(`عنواننا: ${ADDRESS}\n\n${offer}`, threeDays), `عنواننا: ${ADDRESS}`, offer);
  }
});

/* ---------------------------------------------------------------- what must NOT change */

run("the first offer of a conversation is never touched (nothing offered before)", () => {
  const reply = "أهلاً بك! العرض متاح.\n\nعندي ميعاد السبت 14/11 الساعة 3:00 م أو الساعة 6:30 م، إيه اللي يناسبك أكتر؟";
  const t = turn({ question: "أهلاً عيادة ألفا، حابب أحجز عرض الـ 299 ج (كشف وتنظيف وتلميع).", reply, prevBotOffer: "", thread: [], offer: OFFER_300 });
  assert.equal(t.hold, false);
  assert.equal(t.text, reply);
});

run("declining a day, naming a time, asking to book or picking re-opens the offer", () => {
  for (const q of [
    "السبت مش مناسب", "مش فاضي اليوم ده", "امتى اقرب ميعاد؟", "عايز احجز", "ممكن بكره بالليل", "بعد الساعة 7",
    "after 7pm", "is sunday ok", "a7gez emta", "الايام دي مش مناسبة",
    "الأول", "التاني", "3", "first one", "الاسبوع الجاي", "يوم تاني",
  ]) {
    assert.equal(asksAboutTiming(q), true, q);
  }
  for (const q of [
    "العنوان", "المكان فين لو سمحت", "السعر كام", "في تأمين اكسا", "بتعملوا فينيس", "فيه زراعة", "الذراية ب 3600",
    "انا عندي تسووس في سناني", "تمام شكرا انا سكان في السويس", "عرض الـ 299", "رقمي 01064785354",
  ]) {
    assert.equal(asksAboutTiming(q), false, q);
  }
});

run("a bare 'تمام' is left to the which-one question (respond.ts excludes it)", () => {
  assert.equal(isBareAgreement("تمام"), true);
});

run("an hours sentence that shares a clock is not an offer", () => {
  const onlySat = [OFFER_300[0], OFFER_300[1]];
  assert.equal(withoutSlotOffer("مواعيد العيادة بتبدأ يومياً من 3:00 العصر لـ 11:00 بالليل (الجمعة إجازة).", onlySat), null);
});

run("a reply that is nothing but the offer is sent as written", () => {
  assert.equal(withoutSlotOffer("تحب السبت 3:00 م ولا الأحد 3:00 م؟", OFFER_300), null);
});

run("a --- bubble holding only the offer goes, with no dangling break", () => {
  const reply = `عنواننا: ${ADDRESS}\n---\nتحب نظبط ميعادك السبت 14/11 الساعة 3:30 م ولا 6:30 م؟`;
  assert.equal(withoutSlotOffer(reply, OFFER_330), `عنواننا: ${ADDRESS}`);
});

run("the third patient message since the offer may hear the times again", () => {
  const prev = "عندي ميعاد السبت 14/11 الساعة 3:00 م أو الساعة 6:30 م، إيه اللي يناسبك؟";
  const thread = [
    { author: "bot", text: prev },
    { author: "patient", text: "العنوان" },
    { author: "bot", text: `عنواننا: ${ADDRESS}` },
    { author: "patient", text: "في تأمين؟" },
    { author: "bot", text: "للأسف مش بنتعامل مع التأمين." },
    { author: "patient", text: "السعر كام" },
  ];
  assert.equal(patientMessagesSinceOffer(thread, OFFER_300), 3);
  const t = turn({ question: "السعر كام", reply: "الكشف 200 ج.م.\n\nعندي السبت 14/11 الساعة 3:00 م أو الساعة 6:30 م، تحب أنهي؟", prevBotOffer: prev, thread, offer: OFFER_300 });
  assert.equal(t.hold, false);
});

run("a patient back after 45+ minutes may hear the times again", () => {
  const prev = "عندي ميعاد السبت 14/11 الساعة 3:00 م أو الساعة 6:30 م، إيه اللي يناسبك؟";
  const t = turn({
    question: "العنوان",
    reply: `عنواننا: ${ADDRESS}\n\nعندي السبت 14/11 الساعة 3:00 م أو الساعة 6:30 م، تحب أنهي؟`,
    prevBotOffer: prev,
    thread: [{ author: "bot", text: prev }, { author: "patient", text: "العنوان" }],
    offer: OFFER_300,
    gap: 50,
  });
  assert.equal(t.hold, false);
});

run("English replies are left as written, even when they write a slot's date", () => {
  assert.equal(withoutSlotOffer("Our address is Nasr City.\n\nWould Saturday 3:00 PM or Sunday 3:00 PM work?", OFFER_300), null);
  const dated = "Our address is Nasr City.\n\nI have Saturday 14/11 at 3:00 PM or Sunday 15/11 at 3:00 PM, which suits you?";
  assert.equal(spokenSlots(dated, OFFER_300).length, 2, "the dates do name two offered slots");
  assert.equal(withoutSlotOffer(dated, OFFER_300), null);
});

/* ---------------------------------------------------------------- the reviewer's cases */

run("dentist names with 'د.' are not cut mid-name", () => {
  assert.equal(
    withoutSlotOffer(`عنواننا: ${ADDRESS}\n\nعندي السبت 3:00 م مع د. أحمد أو الأحد 3:00 م مع د. سارة، تحب أنهي؟`, DOC),
    `عنواننا: ${ADDRESS}`
  );
  assert.equal(
    withoutSlotOffer("الكشف بـ 200 ج.م وبيتخصم من العلاج.\n\nعندي السبت 14/11 الساعة 3:00 م مع د. أحمد، أو الأحد 15/11 الساعة 3:00 م مع د. سارة. تحب أنهي فيهم؟", DOC),
    "الكشف بـ 200 ج.م وبيتخصم من العلاج."
  );
});

run("a short which-one question after the times goes with them", () => {
  assert.equal(
    withoutSlotOffer(`عنواننا: ${ADDRESS}\n\nمتاح السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 3:00 م.\n\nإيه اللي يناسبك أكتر؟`, OFFER_300),
    `عنواننا: ${ADDRESS}`
  );
});

run("a real question after the times is not eaten, so nothing is cut", () => {
  assert.equal(withoutSlotOffer("عندي السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 3:00 م.\n\nالهدف تجميلي ولا في سنة معينة مضايقاك؟", OFFER_300), null);
  // Short enough to look like "which one?", but it asks something else.
  assert.equal(withoutSlotOffer(`عنواننا: ${ADDRESS}\n\nعندي السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 3:00 م.\n\nالهدف تجميلي ولا علاجي؟`, OFFER_300), null);
});

run("an answer fused into the offer sentence is kept whole (price, address, area)", () => {
  assert.equal(withoutSlotOffer("أيوه بنعمل فينير. الكشف بـ 200 ج.م وعندي السبت 3:00 م أو الأحد 3:00 م، تحب أنهي؟", OFFER_300), null);
  assert.equal(withoutSlotOffer(`أهلاً بيك.\n\nعنواننا ${ADDRESS.replace(/\.$/, "")} وعندي السبت 3:00 م أو الأحد 3:00 م، تحب أنهي؟`, OFFER_300), null);
  // A short place name fits under any letter count; only the word list keeps it.
  assert.equal(withoutSlotOffer("أهلاً بيك يا أستاذ خميس.\n\nعنواننا مدينة نصر وعندي السبت 3:00 م أو الأحد 3:00 م، تحب أنهي؟", OFFER_300), null);
  assert.equal(withoutSlotOffer("أهلاً بيك يا أستاذ خميس.\n\nالكشف مجاني وعندي السبت 3:00 م أو الأحد 3:00 م، تحب أنهي؟", OFFER_300), null);
});

run("offer first, answer after: left alone (only a CLOSING offer comes off)", () => {
  assert.equal(withoutSlotOffer(`تحب السبت 3:00 م ولا الأحد 3:00 م؟\n\nوعنواننا: ${ADDRESS}`, OFFER_300), null);
});

run("an emoji after the offer goes with it", () => {
  assert.equal(
    withoutSlotOffer(`عنواننا: ${ADDRESS}\n\nعندي السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 3:00 م، تحب أنهي؟ 😊`, OFFER_300),
    `عنواننا: ${ADDRESS}`
  );
});

run("a single restated time (a confirmation) never triggers the hold", () => {
  assert.equal(
    holdRepeatOffer({
      question: "اللي بعده",
      spokenKeys: ["2026-11-15|03:00 PM|"],
      previousKeys: ["2026-11-14|03:00 PM|", "2026-11-15|03:00 PM|"],
      thread: [{ author: "bot", text: "تحب السبت 14/11 الساعة 3:00 م ولا الأحد 15/11 الساعة 3:00 م؟" }, { author: "patient", text: "اللي بعده" }],
      offer: OFFER_300,
    }),
    false
  );
});

run("'السبت' alone after Sat/Sun is a pick, never held", () => {
  const thread = [{ author: "bot", text: "تحب السبت 14/11 الساعة 3:00 م ولا الأحد 15/11 الساعة 3:00 م؟" }, { author: "patient", text: "السبت" }];
  const both = ["2026-11-14|03:00 PM|", "2026-11-15|03:00 PM|"];
  assert.equal(holdRepeatOffer({ question: "السبت", spokenKeys: both, previousKeys: both, thread, offer: OFFER_300 }), false);
});

run("all or nothing: a time still said elsewhere in the reply means it is sent as written", () => {
  assert.equal(
    withoutSlotOffer("السبت 14/11 الساعة 3:00 م فيه زحمة شوية.\n\nعندي السبت 14/11 الساعة 3:00 م أو الأحد 15/11 الساعة 3:00 م، تحب أنهي؟", OFFER_300),
    null
  );
});

/* ---------------------------------------------------------------- guards added with the wiring */

run("when none of the times the patient heard is still free, new ones are news: not held", () => {
  const prev = "عندي ميعاد السبت 14/11 الساعة 3:30 م أو الساعة 6:30 م، إيه اللي يناسبك؟";
  const thread = [{ author: "bot", text: prev }, { author: "patient", text: "العنوان" }];
  const both = ["2026-11-14|03:30 PM|", "2026-11-14|06:30 PM|"];
  const nowOffered = OFFER_300.filter((s) => s.key !== both[1]); // Sat 3:30 was never on this list; Sat 6:30 just went
  assert.equal(
    holdRepeatOffer({ question: "العنوان", spokenKeys: ["2026-11-15|03:00 PM|", "2026-11-15|06:30 PM|"], previousKeys: both, thread, offer: nowOffered }),
    false
  );
});

run("several messages sent together: a booking word in an earlier one keeps the times", () => {
  const prev = "عندي ميعاد السبت 14/11 الساعة 3:00 م أو الساعة 6:30 م، إيه اللي يناسبك؟";
  const both = ["2026-11-14|03:00 PM|", "2026-11-14|06:30 PM|"];
  const thread = [
    { author: "bot", text: prev },
    { author: "patient", text: "عايز احجز" },
    { author: "patient", text: "العنوان" },
  ];
  assert.equal(holdRepeatOffer({ question: "العنوان", spokenKeys: both, previousKeys: both, thread, offer: OFFER_300 }), false);
  // The same two lines answered one by one: the earlier one was answered, so only "العنوان" counts.
  const answered = [
    { author: "bot", text: prev },
    { author: "patient", text: "عايز احجز" },
    { author: "bot", text: "تمام 👍" },
    { author: "patient", text: "العنوان" },
  ];
  assert.equal(holdRepeatOffer({ question: "العنوان", spokenKeys: both, previousKeys: both, thread: answered, offer: OFFER_300 }), true);
});

run("no thread line with the times (offer line out of reach): not held", () => {
  const both = ["2026-11-14|03:00 PM|", "2026-11-14|06:30 PM|"];
  assert.equal(
    holdRepeatOffer({ question: "العنوان", spokenKeys: both, previousKeys: both, thread: [{ author: "patient", text: "العنوان" }], offer: OFFER_300 }),
    false
  );
});

run("respond.ts: the hold sits after the spoken times are read and before the reply is built", () => {
  const src = readFileSync(new URL("../src/lib/bot/respond.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const spoken = src.indexOf("spokenSlotKeys = spokenSlots(said, slotOffer, clinicNow().dateKey);");
  const hold = src.indexOf("holdRepeatOffer({");
  const agree = src.indexOf("isBareAgreement(act.question)) {");
  const lang = src.indexOf('if (ai.kind === "answer" || ai.kind === "handoff") {', spoken);
  const plain = src.indexOf('} else if (ai.kind === "answer") {\n        replyText = ai.text;');
  assert.ok(spoken > 0 && hold > 0 && agree > 0 && lang > 0 && plain > 0);
  assert.ok(agree < spoken && spoken < hold && hold < lang && lang < plain);
  const block = src.slice(hold - 400, lang);
  for (const needle of ["!ai.bookSlot", "!ai.openBooking", "!ai.medicineId", "!ai.appointmentChange", "!ai.reschedule", "!isBareAgreement(act.question)"]) {
    assert.ok(block.includes(needle), needle);
  }
  assert.ok(block.includes("spokenSlotKeys = [...(conversation.pendingSlots ?? [])];"), "the times heard are carried");
  assert.ok(/if \(!args\.dryRun\) \{\s*void adminClinicCollection\(clinicId, "ai_debug"\)/.test(block), "no debug write from the playground");
});

console.log("slotRepeat: all passed");
