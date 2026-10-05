// The booking popup's time grid: which times a day offers, and which of them are already taken.
//
// "Taken" must mean exactly what the save-time warning means (lib/appointmentConflicts), or the
// grid would show a time as free and then the Save button would say it is not.
import assert from "node:assert/strict";
import {
  buildDaySlots,
  dateKeysFrom,
  isClinicOffDay,
  slotGrid,
  stripStartFor,
} from "../src/lib/bookingSlots";

const sched = {
  startHour: 10,
  startMinute: 0,
  endHour: 13,
  endMinute: 0,
  slotDuration: 30,
  offDays: ["friday"],
  isConfigured: true,
};

// --- the day's times ---------------------------------------------------------------------------
assert.deepEqual(buildDaySlots(sched), ["10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM"]);
assert.deepEqual(
  buildDaySlots({ ...sched, startHour: 22, endHour: 1 }),
  ["10:00 PM", "10:30 PM", "11:00 PM", "11:30 PM", "12:00 AM", "12:30 AM"],
  "a clinic that closes after midnight keeps its late slots, in order",
);
assert.deepEqual(buildDaySlots({ ...sched, slotDuration: 0 }).length, 6, "a zero step falls back to 30 minutes instead of looping");

// --- the date strip ----------------------------------------------------------------------------
assert.deepEqual(dateKeysFrom("2026-10-30", 4), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
assert.equal(isClinicOffDay("2026-10-09", ["friday"]), true, "9 Oct 2026 is a Friday");
assert.equal(isClinicOffDay("2026-10-08", ["friday"]), false);
assert.equal(isClinicOffDay("2026-10-09", []), false);
assert.equal(stripStartFor("2026-10-06", "2026-10-10", 14), "2026-10-06", "a date inside the fortnight keeps the strip on today");
assert.equal(stripStartFor("2026-10-06", "2026-10-19", 14), "2026-10-06", "the last day of the strip still counts as inside");
assert.equal(stripStartFor("2026-10-06", "2026-10-20", 14), "2026-10-20", "a date past the strip moves the strip to it");
assert.equal(stripStartFor("2026-10-06", "2026-09-29", 14), "2026-09-29", "a past visit's own day stays visible");

// --- free and taken ----------------------------------------------------------------------------
const day = [
  { id: "a1", time: "10:30 AM", duration: 60, doctorId: "d1", doctor: "Dr. Mona", status: "Confirmed" },
  { id: "a2", time: "12:00 PM", duration: 30, doctorId: "d2", doctor: "Dr. Karim", status: "Scheduled" },
  { id: "a3", time: "12:30 PM", duration: 30, doctorId: "d1", doctor: "Dr. Mona", status: "Cancelled" },
];
const slots = buildDaySlots(sched);
const mona = slotGrid(slots, day, { duration: 30, doctorId: "d1", doctorName: "Dr. Mona" });
assert.deepEqual(
  mona.map((s) => [s.time, s.busy]),
  [
    ["10:00 AM", false],
    ["10:30 AM", true],
    ["11:00 AM", true],
    ["11:30 AM", false],
    ["12:00 PM", false],
    ["12:30 PM", false],
  ],
  "Mona's hour from 10:30 blocks two slots; Karim's visit and a cancelled one do not block her",
);
const monaHour = slotGrid(slots, day, { duration: 60, doctorId: "d1", doctorName: "Dr. Mona" });
assert.equal(monaHour.find((s) => s.time === "10:00 AM")?.busy, true, "an hour from 10:00 runs into her 10:30 visit");

const editing = slotGrid(slots, day, { duration: 60, doctorId: "d1", doctorName: "Dr. Mona", excludeAppointmentId: "a1", current: "10:30 AM" });
assert.equal(editing.find((s) => s.time === "10:30 AM")?.busy, false, "the visit being edited never blocks itself");
assert.equal(editing.find((s) => s.time === "10:30 AM")?.current, true);

const offGrid = slotGrid(slots, [], { duration: 30, doctorName: "Dr. Mona", current: "11:15 AM" });
assert.deepEqual(
  offGrid.map((s) => s.time),
  ["10:00 AM", "10:30 AM", "11:00 AM", "11:15 AM", "11:30 AM", "12:00 PM", "12:30 PM"],
  "a stored time that is not on the grid is still shown, in its place, so it can stay selected",
);
const sameTimeDifferentSpelling = slotGrid(slots, [], { duration: 30, doctorName: "Dr. Mona", current: "11:00 am" });
assert.equal(sameTimeDifferentSpelling.length, slots.length, "the same time spelt differently is not added twice");
assert.equal(sameTimeDifferentSpelling.find((s) => s.time === "11:00 AM")?.current, true);

const lateClinic = buildDaySlots({ ...sched, startHour: 22, endHour: 1 });
assert.deepEqual(
  slotGrid(lateClinic, [], { duration: 30, current: "12:15 AM", dayStartMinutes: 22 * 60 }).map((s) => s.time).slice(-3),
  ["12:00 AM", "12:15 AM", "12:30 AM"],
  "after-midnight times sort after the evening ones",
);

console.log("bookingSlots: all checks passed");
