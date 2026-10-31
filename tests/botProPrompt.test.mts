/**
 * The Pro brain's system prompt: the fixed rulebook and the per-turn clinic/patient layer.
 *
 * Pinned: the persona lines are the standard assistant's, byte for byte (read from the source of
 * botPrompt.ts, so a drift on either side fails here); the rulebook is a pure function of its two
 * switches and carries no clinic data (Gemini's implicit prefix cache needs it byte-identical);
 * the turn layer shows every appointment on the number in the patient's Arabic, lists the whole
 * family, never shows the old pre-picked slot list, and never says "no appointment" when the
 * bookings could not be read.
 *
 * Run: npm run test:pro-prompt
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { proRulebook, proTurnLayer } from "../src/lib/botPro/proPrompt";
import type { BotPromptInput } from "../src/lib/bot/botPrompt";
import type { ProPerson } from "../src/lib/botPro/person";
import { arabicDayLabel, arabicTimeLabel } from "../src/lib/arabicDateTime";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const botPromptSource = readFileSync(join(here, "../src/lib/bot/botPrompt.ts"), "utf8");

/** The string literal on the source line that starts with `prefix`, unescaped. */
function sourceLine(prefix: string): string {
  const line = botPromptSource.split(/\r?\n/).find((l) => l.trim().startsWith(`"${prefix}`));
  assert.ok(line, `botPrompt.ts has a line starting ${prefix}`);
  const literal = line!.trim().replace(/,$/, "");
  return JSON.parse(literal) as string;
}

const PERSONA_1 = sourceLine("- انت بتشتغل في الاستقبال");
const PERSONA_2 = sourceLine("- بس لو المريض سأل سؤال مباشر");

const VARIANTS = [
  { clinical: false, canBook: true },
  { clinical: true, canBook: true },
  { clinical: false, canBook: false },
  { clinical: true, canBook: false },
];

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
  return { patientId: "p1", family: [{ id: "p1", name: "منى" }], upcoming: [], past: [], degraded: false, ...over };
}

test("rulebook carries both persona lines from botPrompt.ts verbatim, in every variant", () => {
  assert.ok(PERSONA_1.length > 100 && PERSONA_2.length > 100);
  for (const v of VARIANTS) {
    const r = proRulebook(v);
    assert.ok(r.includes(PERSONA_1), `persona line 1 in ${JSON.stringify(v)}`);
    assert.ok(r.includes(PERSONA_2), `persona line 2 in ${JSON.stringify(v)}`);
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

test("rulebook holds the tool rules and the already-booked rule", () => {
  const r = proRulebook({ clinical: false, canBook: true });
  for (const needle of ["find_slots", "get_price", "get_patient_file", "book_slot", "slotId", "extraAppointment", "reply", "medicineId", "handoff_medical"]) {
    assert.ok(r.includes(needle), needle);
  }
  assert.ok(r.includes("تقويم"), "tells the model to search prices by a short term");
  assert.ok(!r.includes("أقرب مواعيد متاحة"), "the old pre-picked slot list is gone");
  assert.ok(!r.includes("slotKey"), "Pro books by slotId, not the old slotKey");
});

test("booking off: no find_slots/book_slot instructions, booking requests go to staff", () => {
  const r = proRulebook({ clinical: false, canBook: false });
  assert.ok(r.includes("الحجز مش متاح للرقم ده دلوقتي"));
  assert.ok(!r.includes("action book_slot و slotId"));
  const on = proRulebook({ clinical: false, canBook: true });
  assert.ok(on.includes("action book_slot و slotId"));
});

test("clinical on: dentist script; clinical off: every medical question is handed off", () => {
  const c = proRulebook({ clinical: true, canBook: true });
  assert.ok(c.includes("وضع الدكتور شغال"));
  assert.ok(c.includes("نزيف مش بيقف"), "red flags listed");
  const n = proRulebook({ clinical: false, canBook: true });
  assert.ok(!n.includes("وضع الدكتور شغال"));
  assert.ok(n.includes("أي سؤال طبي (ألم، ورم، دواء، تشخيص، هل ده طبيعي): اختار handoff_medical."));
});

test("rulebook stays under 2,500 words", () => {
  for (const v of VARIANTS) {
    const words = proRulebook(v).split(/\s+/).filter(Boolean).length;
    assert.ok(words < 2500, `${words} words in ${JSON.stringify(v)}`);
  }
});

test("turn layer shows an upcoming appointment in Arabic and never the old slot list", () => {
  const p = person({
    upcoming: [{ id: "a1", patientId: "p1", patientName: "منى", date: "2026-11-05", time: "05:00 PM", doctor: "د. أحمد", status: "Scheduled", service: "تنضيف" }],
  });
  // Even if the caller passes the old fields, the Pro layer must not show them.
  const t = proTurnLayer(
    baseInput({ offeredSlots: [{ id: "s1", label: "بكره 5 م" }], bookingStep: "اختيار اليوم", patient: { known: true, name: "منى", upcomingAppointment: "قديم" } }),
    p,
  );
  assert.ok(t.includes(arabicDayLabel("2026-11-05")), "day label");
  assert.ok(t.includes(arabicTimeLabel("05:00 PM")), "time label");
  assert.ok(t.includes("د. أحمد"));
  assert.ok(t.includes("تنضيف"));
  assert.ok(!t.includes("أقرب مواعيد متاحة"));
  assert.ok(!t.includes("slotKey"));
  assert.ok(!t.includes("معندوش ميعاد جاي"), "no contradiction with the appointment list");
  assert.ok(!t.includes("عنده ميعاد جاي: قديم"), "the one-line legacy appointment is replaced by the full list");
});

test("turn layer lists every family member and marks who is writing", () => {
  const p = person({
    patientId: "p2",
    family: [
      { id: "p1", name: "منى" },
      { id: "p2", name: "عمر" },
      { id: "p3", name: "ليلى" },
    ],
    upcoming: [{ id: "a1", patientId: "p3", date: "2026-11-06", time: "06:30 PM", doctor: "", status: "Scheduled" }],
  });
  const t = proTurnLayer(baseInput(), p);
  for (const name of ["منى", "عمر", "ليلى"]) assert.ok(t.includes(name), name);
  assert.ok(/عمر \[p2\] ← ده اللي بيكتب/.test(t), "writer marked");
  // The family member's appointment names who it is for.
  const line = t.split("\n").find((l) => l.includes(arabicDayLabel("2026-11-06")))!;
  assert.ok(line.includes("ليلى"), line);
});

test("degraded read: never 'no appointment', the model is told to ask instead", () => {
  const t = proTurnLayer(baseInput(), person({ degraded: true }));
  assert.ok(!t.includes("معندوش ميعاد جاي"));
  assert.ok(!t.includes("مفيش أي ميعاد جاي"));
  assert.ok(t.includes("النظام مقدرش يراجع كل الحجوزات"));
  const clean = proTurnLayer(baseInput(), person());
  assert.ok(clean.includes("مفيش أي ميعاد جاي"));
});

test("only the last 5 past visits are shown", () => {
  const past = Array.from({ length: 8 }, (_, i) => ({
    id: `v${i}`,
    patientId: "p1",
    date: `2026-10-${String(20 - i).padStart(2, "0")}`,
    time: "05:00 PM",
    doctor: "د. أحمد",
    status: "Completed",
  }));
  const t = proTurnLayer(baseInput(), person({ past }));
  for (let i = 0; i < 5; i++) assert.ok(t.includes(arabicDayLabel(past[i].date)), `visit ${i}`);
  for (let i = 5; i < 8; i++) assert.ok(!t.includes(arabicDayLabel(past[i].date)), `visit ${i} dropped`);
});

test("memory appears once, after the appointments; today's date is given when known", () => {
  const p = person({ upcoming: [{ id: "a1", patientId: "p1", date: "2026-11-05", time: "05:00 PM", doctor: "", status: "Scheduled" }] });
  const t = proTurnLayer(baseInput({ memory: "سألت عن التقويم الشفاف" }), p, { todayKey: "2026-10-31" });
  assert.equal(t.split("سألت عن التقويم الشفاف").length - 1, 1);
  assert.ok(t.indexOf("سألت عن التقويم الشفاف") > t.indexOf(arabicDayLabel("2026-11-05")));
  assert.ok(t.includes("2026-10-31") && t.includes(arabicDayLabel("2026-10-31")));
  assert.ok(t.startsWith("\n") || t.includes("اسم العيادة: عيادة النور"));
});

test("turn layer is deterministic", () => {
  const p = person({ upcoming: [{ id: "a1", patientId: "p1", date: "2026-11-05", time: "05:00 PM", doctor: "", status: "Scheduled" }] });
  assert.equal(proTurnLayer(baseInput(), p), proTurnLayer(baseInput(), p));
});
