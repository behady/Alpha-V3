// When an appointment panel writes itself, now that nobody presses Save.
//
// Every case here is a write to a patient's record, and three of the fields also send that patient
// a WhatsApp message. What these pin:
//
//   1. A half-typed time is never saved. The time box is free text and `normalizeTimeKey` returns
//      whatever it cannot parse, so an eager save would store "03:" as somebody's appointment.
//   2. A change that is not one does not count. "3:30 PM" and "03:30 PM" are the same time; saving
//      that difference would message the patient to say their visit had moved to when it already was.
//   3. Loud and quiet edits are told apart. Date, time and dentist message the patient, as does
//      cancelling; everything else is silent, and settles four times sooner.
//
// Run with tsx so the TS modules load directly: npm run test:autosave
import assert from "node:assert/strict";
import {
  autosaveVerdict, changedFields, isUsableDate, isUsableTime, LOUD_DELAY_MS, LOUD_FIELDS,
  QUIET_DELAY_MS, QUIET_FIELDS,
} from "../src/lib/appointmentAutosave";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}

const ALL = [...LOUD_FIELDS, ...QUIET_FIELDS];
const saved = {
  date: "2026-09-08",
  time: "03:30 PM",
  doctor: "Dr. Nour",
  treatment: "كشف",
  duration: 30,
  notes: "",
  status: "Confirmed",
  roomId: "r1",
};

// --- 1. A half-typed time is not a time -----------------------------------------------------------

ok(isUsableTime("03:30 PM"), "the stored form");
ok(isUsableTime("3:30 pm"), "a person's spelling of it");
ok(isUsableTime("15:30"), "and the 24-hour spelling");
ok(!isUsableTime("03:"), "mid-word");
ok(!isUsableTime("03:4"), "still mid-word");
ok(!isUsableTime("0"), "one keystroke in");
ok(!isUsableTime(""), "empty");
ok(!isUsableTime("tomorrow afternoon"), "words are not a time");
ok(!isUsableTime("25:00"), "no such hour");
ok(!isUsableTime("03:75 PM"), "no such minute");

ok(isUsableDate("2026-09-08"), "a real day");
ok(!isUsableDate("2026-02-31"), "February has no 31st — Date.parse would roll it into March");
ok(!isUsableDate("2026-9-8"), "not the form the app stores");
ok(!isUsableDate(""), "empty");
ok(!isUsableDate("08/09/2026"), "the display form is not the stored form");

// --- 2. A change that is not one ------------------------------------------------------------------

eq(changedFields(saved, { ...saved, time: "3:30 PM" }, ALL), [], "the same time written differently is not a change");
eq(changedFields(saved, { ...saved, time: "15:30" }, ALL), [], "nor is the same time in 24-hour");
eq(changedFields(saved, { ...saved, duration: "30" }, ALL), [], "a number that arrived as text is the same number");
eq(changedFields(saved, { ...saved, notes: "  " }, ALL), [], "whitespace is not a note");
eq(changedFields(saved, { ...saved, time: "04:00 PM" }, ALL), ["time"], "a real move is a change");
eq(changedFields(saved, { ...saved, notes: "brought x-ray" }, ALL), ["notes"], "so is a note");
eq(
  changedFields(saved, { ...saved, doctor: "Dr. Omar", notes: "swapped" }, ALL).sort(),
  ["doctor", "notes"],
  "two at once"
);

// --- 3. Loud and quiet ------------------------------------------------------------------------------

eq(autosaveVerdict(saved, saved), { save: false, reason: "unchanged" }, "nothing typed, nothing written");

{
  const v = autosaveVerdict(saved, { ...saved, notes: "brought x-ray" });
  eq(v, { save: true, delayMs: QUIET_DELAY_MS, loud: false, changed: ["notes"] }, "a note settles quickly and tells nobody");
}
{
  const v = autosaveVerdict(saved, { ...saved, duration: 45 });
  ok(v.save && !v.loud, "so does a longer visit");
}
{
  const v = autosaveVerdict(saved, { ...saved, status: "Checked In" });
  ok(v.save && !v.loud && v.delayMs === QUIET_DELAY_MS, "arriving is between the clinic and its own records");
}
{
  const v = autosaveVerdict(saved, { ...saved, time: "04:00 PM" });
  ok(v.save && v.loud && v.delayMs === LOUD_DELAY_MS, "moving the visit waits — the patient is about to be told");
}
{
  const v = autosaveVerdict(saved, { ...saved, doctor: "Dr. Omar" });
  ok(v.save && v.loud, "so does changing their dentist");
}
{
  const v = autosaveVerdict(saved, { ...saved, status: "Cancelled" });
  ok(v.save && v.loud, "and cancelling, which also messages them");
}
{
  const v = autosaveVerdict(saved, { ...saved, status: "Completed" });
  ok(v.save && !v.loud, "but finishing a visit does not");
}

// A quiet edit riding along with a half-typed loud one is held back too: the panel writes the whole
// form at once, so letting the note through would carry "03:" with it.
eq(
  autosaveVerdict(saved, { ...saved, time: "03:", notes: "brought x-ray" }),
  { save: false, reason: "unusable_time" },
  "one unusable field holds the whole write"
);
eq(
  autosaveVerdict(saved, { ...saved, date: "2026-02-31" }),
  { save: false, reason: "unusable_date" },
  "a day that does not exist is not saved"
);

// --- 4. A booking being created rather than edited ----------------------------------------------------

const REQUIRED = ["patientId", "doctor", "date", "time"] as const;
const blank = { patientId: "", doctor: "", date: "", time: "", notes: "" };
{
  const v = autosaveVerdict(blank, { ...blank, doctor: "Dr. Nour" }, { required: REQUIRED });
  eq(v, { save: false, reason: "incomplete" }, "a form with no patient yet is not an appointment");
}
{
  const half = { patientId: "p1", doctor: "Dr. Nour", date: "2026-09-08", time: "03:", notes: "" };
  eq(autosaveVerdict(blank, half, { required: REQUIRED }), { save: false, reason: "unusable_time" }, "nor is one whose time is half typed");
}
{
  const full = { patientId: "p1", doctor: "Dr. Nour", date: "2026-09-08", time: "03:30 PM", notes: "" };
  const v = autosaveVerdict(blank, full, { required: REQUIRED, fields: [...REQUIRED, "notes"] });
  ok(v.save && v.loud && v.delayMs === LOUD_DELAY_MS, "a complete new booking is written, and waits: creating it messages the patient");
}
{
  // Already created. Now only the note changes — quiet again, even though time is still required.
  const full = { patientId: "p1", doctor: "Dr. Nour", date: "2026-09-08", time: "03:30 PM", notes: "" };
  const v = autosaveVerdict(full, { ...full, notes: "brought x-ray" }, { required: REQUIRED, fields: [...REQUIRED, "notes"] });
  ok(v.save && !v.loud, "once it exists, a note on it is as quiet as anywhere else");
}

console.log(`appointmentAutosave: ${checks} checks passed`);
