/**
 * The Pro brain's system prompt: the fixed rulebook and the per-turn clinic/patient layer.
 *
 * Pinned: the persona and voice lines are the standard assistant's, byte for byte (read from the
 * source of botPrompt.ts, so a drift on either side fails here); the rulebook is a pure function
 * of its two switches and carries no clinic data (Gemini's implicit prefix cache needs it
 * byte-identical); the turn layer shows every appointment on the number in the patient's Arabic
 * (phone-only reception bookings included), lists the whole family, marks the writer only when it
 * is known, carries the slots offered on earlier turns, never shows the old pre-picked slot list,
 * and never says "no appointment" or "new number" when the reads could not be completed.
 *
 * Run: npm run test:pro-prompt
 */
import assert from "node:assert/strict";
import { PHONE_HIDDEN_LINE } from "../src/lib/bot/botPrompt";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PREVIOUS_SLOTS_HEADING, proRulebook, proTurnLayer } from "../src/lib/botPro/proPrompt";
import type { BotPromptInput } from "../src/lib/bot/botPrompt";
import type { ProAppointment, ProPerson } from "../src/lib/botPro/person";
import { arabicDayLabel, arabicTimeLabel } from "../src/lib/arabicDateTime";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const botPromptSource = readFileSync(join(here, "../src/lib/bot/botPrompt.ts"), "utf8");
const sourceLines = botPromptSource.split(/\r?\n/);

/** A JS string literal on one source line, unescaped. */
function literal(line: string): string {
  return JSON.parse(line.trim().replace(/,$/, "")) as string;
}

/** The string literal on the source line that starts with `prefix` (as written in the source), unescaped. */
function sourceLine(prefix: string): string {
  const line = sourceLines.find((l) => l.trim().startsWith(`"${prefix}`));
  assert.ok(line, `botPrompt.ts has a line starting ${prefix}`);
  return literal(line!);
}

/** Every literal of `const NAME = [ ... ];` in botPrompt.ts. */
function sourceArray(name: string): string[] {
  const start = sourceLines.findIndex((l) => l.startsWith(`const ${name} = [`));
  assert.ok(start >= 0, `botPrompt.ts has ${name}`);
  const out: string[] = [];
  for (let i = start + 1; !sourceLines[i].startsWith("];"); i++) out.push(literal(sourceLines[i]));
  return out;
}

const PERSONA_1 = sourceLine("- انت بتشتغل في الاستقبال");
const PERSONA_2 = sourceLine("- بس لو المريض سأل سؤال مباشر");
const SALES_VOICE = sourceArray("SALES_VOICE");

const VARIANTS = [
  { clinical: false, canBook: true },
  { clinical: true, canBook: true },
  { clinical: false, canBook: false },
  { clinical: true, canBook: false },
];

const TODAY = { todayKey: "2026-10-31" };

function baseInput(over: Partial<BotPromptInput> = {}): BotPromptInput {
  return {
    clinicName: "عيادة النور",
    mode: "sales",
    clinical: false,
    canBook: true,
    hoursText: "السبت للخميس 2 م - 10 م",
    priceLines: "تنضيف: يبدأ من 500 ج.م",
    knowledge: [],
    dossierText: "",
    offeredSlots: [],
    patient: { known: true, name: "منى", gender: "female" },
    ...over,
  };
}

function person(over: Partial<ProPerson> = {}): ProPerson {
  return { patientId: "p1", family: [{ id: "p1", name: "منى" }], upcoming: [], past: [], degraded: false, writerKnown: true, ...over };
}

function appt(over: Partial<ProAppointment> = {}): ProAppointment {
  return { id: "a1", patientId: "p1", date: "2026-11-05", time: "05:00 PM", doctor: "", status: "Scheduled", ...over };
}

function lineWith(text: string, needle: string): string {
  const line = text.split("\n").find((l) => l.includes(needle));
  assert.ok(line, `a line with ${needle}`);
  return line!;
}

/* ------------------------------------------------------------------------------------------- */
/* Rulebook                                                                                     */
/* ------------------------------------------------------------------------------------------- */

test("rulebook carries both persona lines from botPrompt.ts verbatim, in every variant", () => {
  assert.ok(PERSONA_1.length > 100 && PERSONA_2.length > 100);
  for (const v of VARIANTS) {
    const r = proRulebook(v);
    assert.ok(r.includes(PERSONA_1), `persona line 1 in ${JSON.stringify(v)}`);
    assert.ok(r.includes(PERSONA_2), `persona line 2 in ${JSON.stringify(v)}`);
  }
});

test("rulebook carries every SALES_VOICE line from botPrompt.ts verbatim", () => {
  assert.equal(SALES_VOICE.length, 11);
  for (const v of VARIANTS) {
    const lines = proRulebook(v).split("\n");
    for (const l of SALES_VOICE) assert.ok(lines.includes(l), l);
  }
});

test("same args give a byte-identical rulebook with no clinic data in it", () => {
  for (const v of VARIANTS) {
    assert.equal(proRulebook({ ...v }), proRulebook({ ...v }));
    const r = proRulebook(v);
    assert.ok(!r.includes("عيادة النور"));
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(r), "no date in the rulebook");
  }
  assert.notEqual(proRulebook(VARIANTS[0]), proRulebook(VARIANTS[1]));
  assert.notEqual(proRulebook(VARIANTS[0]), proRulebook(VARIANTS[2]));
});

test("precedence: red lines always win, clinic instructions beat the default style and sales steps", () => {
  const first = proRulebook(VARIANTS[0]).split("\n")[0];
  assert.ok(first.includes("الثوابت بتكسب دايماً"));
  assert.ok(first.includes("تعليمات صاحب العيادة") && first.includes("بتكسب على الأسلوب وخطوات البيع"));
});

test("rulebook holds the tool rules, the tool budget and the already-booked rule", () => {
  const r = proRulebook({ clinical: false, canBook: true });
  for (const needle of ["find_slots", "get_price", "get_patient_file", "book_slot", "slotId", "extraAppointment", "reply", "medicineId", "handoff_medical"]) {
    assert.ok(r.includes(needle), needle);
  }
  assert.ok(r.includes("\"تقويم\""), "tells the model to search prices by a short term");
  assert.ok(r.includes("3 نداءات أدوات بالكتير"), "tool budget");
  assert.ok(!r.includes("أقرب مواعيد متاحة"), "the old pre-picked slot list is gone");
  assert.ok(!r.includes("slotKey"), "Pro books by slotId, not the old slotKey");
});

test("already-booked covers ANY upcoming appointment on the number, phone bookings included", () => {
  const r = proRulebook({ clinical: false, canBook: true });
  assert.ok(r.includes("لو في أي ميعاد جاي على الرقم ده"));
  assert.ok(r.includes("حتى لو الاستقبال حجزه بالتليفون"));
  assert.ok(r.includes("ومش واضح الميعاد بتاع مين، اسأله"), "ask whose it is on a shared number");
  assert.ok(!r.includes("لو اللي بيكتب عنده ميعاد جاي"), "no writer-only wording left");
});

test("rulebook points a pick of an earlier offer at the previous-slots block", () => {
  const r = proRulebook({ clinical: false, canBook: true });
  assert.ok(r.split(PREVIOUS_SLOTS_HEADING).length - 1 >= 2, "red line + short-reply rule name the block");
  assert.ok(r.includes("لو اللي اختاره مش واحد منهم، دوّر بـ find_slots"));
});

test("reschedule stays system-driven: action reschedule, ask which in text, never a new search or booking", () => {
  for (const v of VARIANTS) {
    const r = proRulebook(v);
    const line = lineWith(r, "action reschedule — مش حجز جديد");
    assert.ok(line.includes("لو عنده ميعاد واحد جاي، اختار action reschedule"));
    assert.ok(line.includes("لو عنده أكتر من ميعاد، اسأله أنهي واحد في رد عادي"));
    assert.ok(line.includes("في تغيير الميعاد ممنوع find_slots و book_slot خالص"));
    assert.ok(!r.includes("إلا لو طلب منك"));
  }
  // The short-reply pick (and the earlier-offers block it names) is for new bookings only.
  const pick = lineWith(proRulebook({ clinical: false, canBook: true }), "رد قصير بعد ما عرضت مواعيد");
  assert.ok(pick.startsWith("- حجز جديد (مش تغيير ميعاد)"), pick);
  assert.ok(pick.includes(PREVIOUS_SLOTS_HEADING));
});

test("unknown writer on a shared number: ask whose booking it is", () => {
  const r = proRulebook({ clinical: false, canBook: true });
  assert.ok(lineWith(r, "الحجز بيتسجّل باسم اللي بيكتب").includes("اسأله الحجز ده لمين"));
});

test("booking off: no book_slot instructions, previous slots or extraAppointment", () => {
  for (const clinical of [false, true]) {
    const r = proRulebook({ clinical, canBook: false });
    assert.ok(r.includes("الحجز مش متاح للرقم ده دلوقتي"));
    assert.ok(!r.includes("action book_slot و slotId"));
    assert.ok(!r.includes("extraAppointment"), "no extraAppointment when booking is off");
    assert.ok(!r.includes(PREVIOUS_SLOTS_HEADING));
  }
  assert.ok(proRulebook({ clinical: false, canBook: true }).includes("action book_slot و slotId"));
});

test("clinical on: dentist script; clinical off: every medical question is handed off", () => {
  const c = proRulebook({ clinical: true, canBook: true });
  assert.ok(c.includes("وضع الدكتور شغال"));
  assert.ok(c.includes("نزيف مش بيقف"), "red flags listed");
  const n = proRulebook({ clinical: false, canBook: true });
  assert.ok(!n.includes("وضع الدكتور شغال"));
  assert.ok(n.includes("أي سؤال طبي (ألم، ورم، دواء، تشخيص، هل ده طبيعي): اختار handoff_medical."));
});

test("restored old rules: difference questions, stranger booking, one concrete step", () => {
  const r = proRulebook({ clinical: false, canBook: true });
  assert.ok(r.includes(sourceLine("- \\\"إيه الفرق بين ...؟\\\"")), "difference line verbatim");
  assert.ok(r.includes("handoff_other بس لو السؤال كله معندكش عنه أي معلومة"));
  assert.ok(r.includes("لو المريض غريب (مش معروف)، open_booking"));
  assert.ok(r.includes("اعرض خطوة واحدة محددة"));
  assert.ok(r.includes("أو في الملف اللي رجّعته get_patient_file"), "drug names from the returned file");
  assert.ok(r.includes("قريب مريض (لو مش على الرقم ده)"));
});

test("child/pregnant/nursing/chronic medicine ban in every variant, above the dentist script", () => {
  const ban = sourceLine("- ممنوع تدي دوا أو جرعة لطفل");
  for (const v of VARIANTS) {
    const r = proRulebook(v);
    assert.ok(r.includes(ban), `ban in ${JSON.stringify(v)}`);
    assert.ok(r.indexOf(ban) < r.indexOf("أدواتك"), "it sits in الثوابت");
  }
  const c = proRulebook({ clinical: true, canBook: true });
  assert.ok(c.indexOf(ban) < c.indexOf("وضع الدكتور شغال"), "the dentist script cannot outrank it");
  const redFlags = lineWith(c, "علامات الخطر → handoff_medical");
  assert.ok(redFlags.includes("وغير اللي في ممنوعات الأدوية"), "متحوّلوش never covers the medicine ban");
  assert.ok(redFlags.indexOf("ممنوعات الأدوية") < redFlags.indexOf("متحوّلوش"));
});

test("price red line: no estimating, rounding or calculating", () => {
  for (const v of VARIANTS) assert.ok(proRulebook(v).includes("بالرقم زي ما هو — ممنوع تقدّر أو تقرّب أو تحسب"));
});

test("complaint step offers another dentist only when booking is on", () => {
  assert.ok(proRulebook({ clinical: false, canBook: true }).includes("هحجزلك مع دكتور تاني"));
  for (const clinical of [false, true]) {
    const r = proRulebook({ clinical, canBook: false });
    assert.ok(!r.includes("هحجزلك مع دكتور تاني"));
    assert.ok(r.includes("اعرض خطوة واحدة محددة (\"هبلغ الاستقبال دلوقتي\")"));
  }
});

test("rulebook stays under 2,500 words", () => {
  for (const v of VARIANTS) {
    const words = proRulebook(v).split(/\s+/).filter(Boolean).length;
    assert.ok(words < 2500, `${words} words in ${JSON.stringify(v)}`);
  }
});

test("offered times are said as their label: the example is day + date + H:MM, and the rule says so", () => {
  const r = proRulebook({ clinical: false, canBook: true });
  assert.ok(r.includes("عندي الخميس 5/11 الساعة 5:00 م أو السبت 7/11 الساعة 7:00 م"), "label-form example");
  assert.ok(!r.includes("عندي بكره الساعة 5 أو بعد بكره 7"), "the bare-hour example is gone");
  assert.ok(lineWith(r, "أي ميعاد بتعرضه قوله زي الـ label بالظبط").includes("الساعة بالدقايق"));
  // No example time in any variant lacks its minutes, so the clock check never fights the prompt.
  for (const v of VARIANTS) assert.ok(!/الساعة \d+(?![\d:/])/.test(proRulebook(v)), `no bare-hour example in ${JSON.stringify(v)}`);
  for (const clinical of [false, true]) assert.ok(!proRulebook({ clinical, canBook: false }).includes("قوله زي الـ label"));
});

/* ------------------------------------------------------------------------------------------- */
/* Turn layer                                                                                   */
/* ------------------------------------------------------------------------------------------- */

test("turn layer shows an upcoming appointment in Arabic and never the old slot list", () => {
  const p = person({ upcoming: [appt({ patientName: "منى", doctor: "د. أحمد", service: "تنضيف" })] });
  // Even if the caller passes the old fields, the Pro layer must not show them.
  const t = proTurnLayer(
    baseInput({ offeredSlots: [{ id: "s1", label: "بكره 5 م" }], bookingStep: "اختيار اليوم", patient: { known: true, name: "منى", upcomingAppointment: "قديم" } }),
    p,
    TODAY,
  );
  const line = lineWith(t, arabicDayLabel("2026-11-05"));
  assert.ok(line.includes(arabicTimeLabel("05:00 PM")), "time label");
  assert.ok(line.includes("د. أحمد") && line.includes("تنضيف") && line.includes("منى (اللي بيكتب)"), line);
  assert.ok(!t.includes("أقرب مواعيد متاحة"));
  assert.ok(!t.includes("slotKey"));
  assert.ok(!t.includes("معندوش ميعاد جاي"), "no contradiction with the appointment list");
  assert.ok(!t.includes("عنده ميعاد جاي: قديم"), "the one-line legacy appointment is replaced by the full list");
});

test("new number + phone-only reception booking: shown as the writer's appointment", () => {
  const p = person({ patientId: null, family: [], writerKnown: false, upcoming: [appt({ patientId: undefined })] });
  const t = proTurnLayer(baseInput({ patient: { known: false } }), p, TODAY);
  const line = lineWith(t, arabicDayLabel("2026-11-05"));
  assert.ok(line.includes("اللي بيكتب"), line);
  assert.ok(!t.includes("مفيش أي ميعاد جاي"));
  // A booking on the number contradicts "new number" and "not linked to any file".
  assert.ok(!t.includes("رقم جديد، مش مسجل عندنا"));
  assert.ok(!t.includes("الرقم ده مش مربوط بأي ملف عندنا"));
  assert.ok(t.includes("بس في حجز على الرقم ده"));
});

test("phone-only booking with one person on the number is that person's", () => {
  const p = person({ upcoming: [appt({ patientId: undefined })] });
  assert.ok(lineWith(proTurnLayer(baseInput(), p, TODAY), arabicDayLabel("2026-11-05")).includes("منى (اللي بيكتب)"));
});

test("phone-only booking on a shared number with an unknown writer is not pinned on anyone", () => {
  const p = person({
    family: [{ id: "p1", name: "منى" }, { id: "p2", name: "عمر" }],
    writerKnown: false,
    upcoming: [appt({ patientId: undefined })],
  });
  const line = lineWith(proTurnLayer(baseInput(), p, TODAY), arabicDayLabel("2026-11-05"));
  assert.ok(line.includes("حد على الرقم ده") && !line.includes("اللي بيكتب"), line);
});

test("turn layer lists every family member and marks who is writing when known", () => {
  const p = person({
    patientId: "p2",
    family: [
      { id: "p1", name: "منى" },
      { id: "p2", name: "عمر" },
      { id: "p3", name: "ليلى" },
    ],
    upcoming: [appt({ patientId: "p3", date: "2026-11-06", time: "06:30 PM" })],
  });
  const t = proTurnLayer(baseInput(), p, TODAY);
  for (const name of ["منى", "عمر", "ليلى"]) assert.ok(t.includes(name), name);
  assert.ok(t.includes("- عمر [p2] ← ده اللي بيكتب"), "writer marked");
  assert.ok(!t.includes("مش معروف مين فيهم"));
  // The family member's appointment names who it is for, without the writer mark.
  const line = lineWith(t, arabicDayLabel("2026-11-06"));
  assert.ok(line.includes("ليلى") && !line.includes("اللي بيكتب"), line);
});

test("shared number, writer not known: nobody is marked, the model is told to ask", () => {
  const p = person({ patientId: "p1", family: [{ id: "p1", name: "منى" }, { id: "p2", name: "عمر" }], writerKnown: false, upcoming: [appt()] });
  const t = proTurnLayer(baseInput(), p, TODAY);
  assert.ok(!t.includes("ده اللي بيكتب"));
  assert.ok(!lineWith(t, arabicDayLabel("2026-11-05")).includes("اللي بيكتب"));
  assert.ok(t.includes("مش معروف مين فيهم اللي بيكتب"));
});

test("patientId null with family: ask who is writing", () => {
  const p = person({ patientId: null, family: [{ id: "p1", name: "منى" }, { id: "p2", name: "عمر" }], writerKnown: false });
  const t = proTurnLayer(baseInput(), p, TODAY);
  assert.ok(t.includes("منى [p1]") && t.includes("عمر [p2]"));
  assert.ok(!t.includes("ده اللي بيكتب"));
  assert.ok(t.includes("مش معروف مين فيهم اللي بيكتب"));
});

test("degraded read: never 'no appointment', the model is told to ask instead", () => {
  const t = proTurnLayer(baseInput(), person({ degraded: true }), TODAY);
  assert.ok(!t.includes("معندوش ميعاد جاي"));
  assert.ok(!t.includes("مفيش أي ميعاد جاي"));
  assert.ok(t.includes("النظام مقدرش يراجع كل الحجوزات"));
  const clean = proTurnLayer(baseInput(), person(), TODAY);
  assert.ok(clean.includes("مفيش أي ميعاد جاي"));
});

test("degraded read with nobody found: never stated as 'not on file' or 'new number'", () => {
  const p = person({ patientId: null, family: [], writerKnown: false, degraded: true });
  const t = proTurnLayer(baseInput({ patient: { known: false } }), p, TODAY);
  assert.ok(!t.includes("الرقم ده مش مربوط بأي ملف عندنا"));
  assert.ok(!t.includes("رقم جديد، مش مسجل عندنا"));
  assert.ok(t.includes("البحث ممكن يكون ناقص"));
  // Not degraded, the same empty result is a fact and may be said.
  const sure = proTurnLayer(baseInput({ patient: { known: false } }), person({ patientId: null, family: [], writerKnown: false }), TODAY);
  assert.ok(sure.includes("الرقم ده مش مربوط بأي ملف عندنا"));
});

test("slots offered on earlier turns are listed by id; not when booking is off", () => {
  const previousSlots = [
    { id: "s1", label: "بكره الساعة 5 م" },
    { id: "s2", label: "الإثنين الساعة 7 م" },
  ];
  const t = proTurnLayer(baseInput(), person(), { ...TODAY, previousSlots });
  assert.ok(t.includes(PREVIOUS_SLOTS_HEADING));
  assert.ok(t.includes("- s1 → بكره الساعة 5 م") && t.includes("- s2 → الإثنين الساعة 7 م"));
  assert.ok(!proTurnLayer(baseInput(), person(), TODAY).includes(PREVIOUS_SLOTS_HEADING), "absent when none");
  assert.ok(!proTurnLayer(baseInput({ canBook: false }), person(), { ...TODAY, previousSlots }).includes(PREVIOUS_SLOTS_HEADING));
});

test("only the last 5 past visits are shown, each with its status", () => {
  const past = Array.from({ length: 8 }, (_, i) => appt({
    id: `v${i}`,
    date: `2026-10-${String(20 - i).padStart(2, "0")}`,
    doctor: "د. أحمد",
    status: i === 0 ? "Completed" : "Scheduled",
  }));
  const t = proTurnLayer(baseInput(), person({ past }), TODAY);
  for (let i = 0; i < 5; i++) assert.ok(t.includes(arabicDayLabel(past[i].date)), `visit ${i}`);
  for (let i = 5; i < 8; i++) assert.ok(!t.includes(arabicDayLabel(past[i].date)), `visit ${i} dropped`);
  assert.ok(lineWith(t, arabicDayLabel(past[0].date)).includes("الحالة: Completed"));
  assert.ok(lineWith(t, arabicDayLabel(past[1].date)).includes("الحالة: Scheduled"));
  assert.ok(!t.includes("اتعملت فعلاً"), "heading does not claim every row happened");
});

test("order: clinic layer, today, people, appointments, memory last and once", () => {
  const p = person({ upcoming: [appt()] });
  const t = proTurnLayer(baseInput({ memory: "سألت عن التقويم الشفاف" }), p, TODAY);
  const at = (s: string) => {
    const i = t.indexOf(s);
    assert.ok(i >= 0, s);
    return i;
  };
  const clinic = at("اسم العيادة: عيادة النور");
  const today = at(`النهارده ${arabicDayLabel("2026-10-31")} (2026-10-31)`);
  const people = at("الناس على الرقم ده");
  const upcoming = at(arabicDayLabel("2026-11-05"));
  const memory = at("سألت عن التقويم الشفاف");
  assert.ok(clinic < today && today < people && people < upcoming && upcoming < memory);
  assert.equal(t.split("سألت عن التقويم الشفاف").length - 1, 1);
});

test("turn layer is deterministic", () => {
  const p = person({ upcoming: [appt()] });
  assert.equal(proTurnLayer(baseInput(), p, TODAY), proTurnLayer(baseInput(), p, TODAY));
});

/* ------------------------------------------------------------------------------------------- */
/* Owner switches: dentist names hidden, branches shown. Off = Plan-1 bytes.                    */
/* ------------------------------------------------------------------------------------------- */

const HIDE_RULE = '- ممنوع تذكر اسم أي دكتور أو طبيب في ردودك: قول "الدكتور" أو "الدكتور المختص" وخلاص، حتى لو المريض سأل.';
const BRANCH_RULE = "- لو المريض قال إن المكان بعيد أو سأل عن فرع تاني: اعرض عليه الفروع من القائمة (الاسم والعنوان) واسأله أنهي أقرب له — متحوّلش للاستقبال عشان سؤال عن فرع.";

const named = person({
  upcoming: [appt({ doctor: "Mahmoud amgad", service: "تنضيف" })],
  past: [appt({ id: "a0", date: "2026-10-01", doctor: "Sara Ali", status: "Completed" })],
});
const withDentists = () => baseInput({ addressText: "5 شارع 9", facts: { dentists: "د. محمد سمير — زراعة" } });

test("turn layer and rulebook are unchanged when neither new input is set", () => {
  const plain = proTurnLayer(withDentists(), named, TODAY);
  assert.equal(proTurnLayer({ ...withDentists(), hideDoctorNames: false, branchesText: "" }, named, TODAY), plain);
  assert.ok(!plain.includes(HIDE_RULE) && !plain.includes("الفروع:"));
  assert.ok(plain.includes(" مع Mahmoud amgad") && plain.includes(" مع Sara Ali") && plain.includes("د. محمد سمير"));
  for (const v of VARIANTS) assert.equal(proRulebook({ ...v, hideDoctorNames: false }), proRulebook(v));
});

test("hidden names: the rule line, and no dentist named anywhere in the turn layer", () => {
  const t = proTurnLayer({ ...withDentists(), hideDoctorNames: true }, named, { ...TODAY, previousSlots: [{ id: "s1", label: "الخميس 5/11 الساعة 5:00 م" }] });
  assert.equal(t.split("\n").filter((l) => l === HIDE_RULE).length, 1);
  for (const name of ["Mahmoud amgad", "Sara Ali", "محمد سمير"]) assert.ok(!t.includes(name), `no ${name}`);
  assert.ok(!t.includes("- الأطباء:"));
  // The appointment itself is still there: day, time and service, just no dentist.
  assert.ok(t.includes(`${arabicDayLabel("2026-11-05")} الساعة ${arabicTimeLabel("05:00 PM")} — تنضيف`));
});

test("hidden names: the rulebook drops the two lines that tell Pro to name a dentist", () => {
  for (const v of VARIANTS) {
    const r = proRulebook({ ...v, hideDoctorNames: true });
    assert.ok(!r.includes("دوّر على مواعيد الدكتور ده الأول واذكر اسمه"));
    assert.ok(!r.includes('جاوب من خانة "الأطباء"'));
    assert.equal(proRulebook({ ...v, hideDoctorNames: true }), r, "still a pure function");
  }
  assert.ok(proRulebook({ clinical: false, canBook: true }).includes('جاوب من خانة "الأطباء"'));
});

test("branches: the الفروع block next to the address, with the far-away rule", () => {
  const branchesText = "• المعادي: شارع 9 — ت: 01001234567\n• مدينة نصر: 12 عباس العقاد";
  const t = proTurnLayer({ ...withDentists(), branchesText }, named, TODAY);
  assert.ok(t.includes(`العنوان: 5 شارع 9\nالفروع:\n${branchesText}\n${BRANCH_RULE}`));
});

test("the hide rule's line break is written as \\n, not a raw line ending inside the template", () => {
  const proSource = readFileSync(join(here, "../src/lib/botPro/proPrompt.ts"), "utf8");
  assert.ok(proSource.includes("hide ? `\\n${HIDE_DOCTOR_NAMES_RULE}` : \"\""));
  const t = proTurnLayer({ ...withDentists(), hideDoctorNames: true }, named, TODAY);
  assert.ok(t.includes(`\n\n${HIDE_RULE}\n`) || t.includes(`\n${HIDE_RULE}\n`));
  assert.ok(!t.includes("\r"));
});

// ---- hidden number (a lid sender) ---------------------------------------------------------------

test("hidden number: the rulebook asks for the number only while booking is closed", () => {
  const closed = proRulebook({ clinical: false, canBook: false, phoneHidden: true });
  assert.ok(closed.includes(PHONE_HIDDEN_LINE));
  assert.equal(closed.split("\n").filter((l) => l === PHONE_HIDDEN_LINE).length, 1);
  assert.ok(!proRulebook({ clinical: false, canBook: true, phoneHidden: true }).includes(PHONE_HIDDEN_LINE), "open booking: no ask");
  for (const canBook of [true, false]) {
    assert.equal(proRulebook({ clinical: true, canBook, phoneHidden: false }), proRulebook({ clinical: true, canBook }), "false = today's bytes");
  }
});
