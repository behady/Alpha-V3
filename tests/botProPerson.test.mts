/**
 * Who is writing: the patients on a number (family can share one phone), the conversation's linked
 * patient (the only identity left on the QR line, where WhatsApp hides the number), and every
 * appointment for them, including ones reception booked by phone that carry only patientPhone.
 *
 * Run: npm run test:pro-person
 */
import assert from "node:assert/strict";
import { familyOnNumber, phoneKeysOf, splitAppointments, type ProAppointment } from "../src/lib/botPro/person";
import { phoneMatchKey } from "../src/lib/patientPhone";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const p = (id: string, name: string, phone: string) => ({ id, data: { name, phone } as Record<string, unknown> });
const appt = (over: Partial<ProAppointment & { patientPhone?: string }>) => ({
  id: "a", date: "2026-11-05", time: "05:00 PM", doctor: "", status: "Scheduled", ...over,
});
const TODAY = "2026-10-31";

test("reception booking with only a phone counts", () => {
  const rows = [appt({ id: "a1", patientPhone: "01001234567" })];
  const { upcoming } = splitAppointments(rows, { ids: [], phoneKeys: [phoneMatchKey("+201001234567")] }, TODAY);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].id, "a1");
});

test("an appointment for someone else's number or id is not ours", () => {
  const rows = [appt({ id: "a1", patientPhone: "01119999999" }), appt({ id: "a2", patientId: "other" })];
  const { upcoming, past } = splitAppointments(rows, { ids: ["m"], phoneKeys: [phoneMatchKey("01001234567")] }, TODAY);
  assert.deepEqual(upcoming, []);
  assert.deepEqual(past, []);
});

test("matched by patient id alone", () => {
  const rows = [appt({ id: "a1", patientId: "m" })];
  const { upcoming } = splitAppointments(rows, { ids: ["m"], phoneKeys: [] }, TODAY);
  assert.equal(upcoming.length, 1);
});

test("no ids and no phone keys matches nothing, even rows with an empty phone", () => {
  const rows = [appt({ id: "a1", patientPhone: "" }), appt({ id: "a2" })];
  const { upcoming } = splitAppointments(rows, { ids: [], phoneKeys: [""] }, TODAY);
  assert.deepEqual(upcoming, []);
});

test("cancelled and no-show are not upcoming", () => {
  const rows = [
    appt({ id: "c", patientId: "m", status: "Cancelled" }),
    appt({ id: "n", patientId: "m", status: "No Show" }),
    appt({ id: "ok", patientId: "m", status: "Confirmed" }),
  ];
  const { upcoming } = splitAppointments(rows, { ids: ["m"], phoneKeys: [] }, TODAY);
  assert.deepEqual(upcoming.map((a) => a.id), ["ok"]);
});

test("upcoming is soonest first, today counts, and the phone field is not leaked", () => {
  const rows = [
    appt({ id: "late", patientId: "m", date: "2026-12-01" }),
    appt({ id: "today-pm", patientId: "m", date: TODAY, time: "05:00 PM" }),
    appt({ id: "soon", patientId: "m", date: "2026-11-02", patientPhone: "01001234567" }),
  ];
  const { upcoming } = splitAppointments(rows, { ids: ["m"], phoneKeys: [] }, TODAY);
  assert.deepEqual(upcoming.map((a) => a.id), ["today-pm", "soon", "late"]);
  assert.equal("patientPhone" in upcoming[2 - 1], false);
});

test("past is the last 10 by date, newest first, and excludes today onwards", () => {
  const rows: Array<ProAppointment & { patientPhone?: string }> = [];
  for (let i = 1; i <= 12; i++) rows.push(appt({ id: `p${i}`, patientId: "m", date: `2026-09-${String(i).padStart(2, "0")}`, status: "Completed" }));
  rows.push(appt({ id: "future", patientId: "m", date: "2026-11-09" }));
  const { upcoming, past } = splitAppointments(rows, { ids: ["m"], phoneKeys: [] }, TODAY);
  assert.equal(past.length, 10);
  assert.equal(past[0].id, "p12");
  assert.equal(past[9].id, "p3");
  assert.deepEqual(upcoming.map((a) => a.id), ["future"]);
});

test("family on one number, linked lid patient included", () => {
  const fam = familyOnNumber(
    [p("m", "Mona", "01001234567"), p("k", "Karim", "+201001234567"), p("x", "Other", "01119999999")],
    phoneMatchKey("01001234567"),
    "z"
  );
  assert.deepEqual(fam.map((f) => f.id).sort(), ["k", "m", "z"]);
  assert.equal(fam.find((f) => f.id === "m")?.name, "Mona");
});

test("the linked patient is not listed twice", () => {
  const fam = familyOnNumber([p("m", "Mona", "01001234567")], phoneMatchKey("01001234567"), "m");
  assert.deepEqual(fam, [{ id: "m", name: "Mona" }]);
});

test("a patient with no phone never matches an unknown sender", () => {
  const fam = familyOnNumber([p("e", "NoPhone", "")], "", undefined);
  assert.deepEqual(fam, []);
});

test("second phone field on the file matches", () => {
  const patient = { name: "Mona", phone: "", mobile: "01001234567" };
  assert.ok(phoneKeysOf(patient).includes(phoneMatchKey("01001234567")));
  const fam = familyOnNumber([{ id: "m", data: patient }], phoneMatchKey("+201001234567"));
  assert.deepEqual(fam.map((f) => f.id), ["m"]);
});

test("phoneKeysOf dedupes and drops empties", () => {
  const keys = phoneKeysOf({ phone: "01001234567", whatsapp: "+201001234567", mobile: "", telephone: "   " });
  assert.deepEqual(keys, [phoneMatchKey("01001234567")]);
});

test("hidden QR number: no phone, linked patient still found", () => {
  const fam = familyOnNumber([], "", "z");
  assert.equal(fam.length, 1);
  assert.equal(fam[0].id, "z");
});

test("same-day times sort by the clock, not by the text (10:00 AM before 05:00 PM)", () => {
  const rows = [
    appt({ id: "pm", patientId: "m", date: "2026-11-02", time: "05:00 PM" }),
    appt({ id: "am", patientId: "m", date: "2026-11-02", time: "10:00 AM" }),
  ];
  const { upcoming } = splitAppointments(rows, { ids: ["m"], phoneKeys: [] }, TODAY);
  assert.deepEqual(upcoming.map((a) => a.id), ["am", "pm"]);
});
