// Fixture test for double-booking detection. Run with tsx so the TS module loads directly.
//
// The case that motivated this file: an appointment carries `doctorId` plus a `doctor` display
// string captured at booking time. Rename the dentist and that string goes stale, so a conflict
// check that matches on the name finds nothing and the clinic double-books with no warning.
import assert from "node:assert/strict";
import {
  apptBlocksDoctor,
  findDoctorConflicts,
  findRoomConflicts,
  intervalsOverlap,
  isReleasedAppointment,
  normalizeDoctorName,
} from "../src/lib/appointmentConflicts.ts";

// --- name normalisation ------------------------------------------------------------------------
assert.equal(normalizeDoctorName("  Dr. Ahmed "), "dr. ahmed");
assert.equal(normalizeDoctorName(null), "");

// --- released statuses -------------------------------------------------------------------------
assert.equal(isReleasedAppointment("Cancelled"), true);
assert.equal(isReleasedAppointment("No Show"), true);
assert.equal(isReleasedAppointment("Confirmed"), false);
// Legacy alias: "Arrived" normalises to "Checked In", which very much still holds the chair.
assert.equal(isReleasedAppointment("Arrived"), false);

// --- overlap arithmetic ------------------------------------------------------------------------
assert.equal(intervalsOverlap(60, 90, 80, 110), true);
assert.equal(intervalsOverlap(60, 90, 90, 120), false, "back-to-back appointments do not overlap");
assert.equal(intervalsOverlap(60, 120, 70, 80), true, "a short visit inside a long one overlaps");

// --- whose appointment is it? ------------------------------------------------------------------

// THE BUG: the dentist was renamed, so the stored display name no longer matches. Matching on the
// id still finds it.
const renamed = { doctorId: "staff_ahmed", doctor: "Dr. Ahmed" };
assert.equal(
  apptBlocksDoctor(renamed, "staff_ahmed", "Ahmed Hassan"),
  true,
  "a renamed dentist's own appointment must still block them"
);
assert.equal(
  apptBlocksDoctor(renamed, "staff_sara", "Sara"),
  false,
  "another dentist's appointment must not block"
);

// Legacy row with no id: name is all there is, which is exactly today's behaviour.
const legacy = { doctorId: null, doctor: "Dr. Ahmed" };
assert.equal(apptBlocksDoctor(legacy, "staff_ahmed", "Dr. Ahmed"), true);
assert.equal(apptBlocksDoctor(legacy, "staff_sara", "Dr. Sara"), false);

// A row belonging to nobody in particular occupies the chair rather than being waved through.
assert.equal(apptBlocksDoctor({ doctorId: null, doctor: "" }, "staff_ahmed", "Dr. Ahmed"), true);

// No dentist named at all → one chair, everything blocks.
assert.equal(apptBlocksDoctor(renamed, null, null), true);

// Id known on the row but the caller only has a name: fall back to the name rather than letting
// the row through unchecked.
assert.equal(apptBlocksDoctor(renamed, null, "Dr. Ahmed"), true);
assert.equal(apptBlocksDoctor(renamed, null, "Dr. Sara"), false);

// --- the real scenario, end to end -------------------------------------------------------------

const day = [
  // Ahmed, 10:00–10:30, booked before he was renamed.
  { id: "A1", time: "10:00 AM", duration: 30, status: "Confirmed", doctorId: "staff_ahmed", doctor: "Dr. Ahmed", roomId: "room1" },
  // Sara at the same time, in another room.
  { id: "A2", time: "10:00 AM", duration: 30, status: "Confirmed", doctorId: "staff_sara", doctor: "Dr. Sara", roomId: "room2" },
  // Ahmed's cancelled 11:00 — must not hold the slot.
  { id: "A3", time: "11:00 AM", duration: 60, status: "Cancelled", doctorId: "staff_ahmed", doctor: "Dr. Ahmed", roomId: "room1" },
  // A no-show, likewise released.
  { id: "A4", time: "01:00 PM", duration: 30, status: "No Show", doctorId: "staff_ahmed", doctor: "Dr. Ahmed", roomId: "room1" },
];

// Booking Ahmed (now called "Ahmed Hassan") at 10:15 must clash with A1.
assert.deepEqual(
  findDoctorConflicts(day, { time: "10:15 AM", duration: 30, doctorId: "staff_ahmed", doctorName: "Ahmed Hassan" }).map((a) => a.id),
  ["A1"],
  "the rename must not hide his own booking"
);

// The same slot is free for Sara — A2 is hers but at 10:00–10:30... which does overlap 10:15.
assert.deepEqual(
  findDoctorConflicts(day, { time: "10:45 AM", duration: 30, doctorId: "staff_sara", doctorName: "Dr. Sara" }).map((a) => a.id),
  [],
  "Sara's 10:00 does not reach 10:45"
);

// Cancelled and no-show slots are bookable again.
assert.deepEqual(
  findDoctorConflicts(day, { time: "11:00 AM", duration: 30, doctorId: "staff_ahmed", doctorName: "Ahmed Hassan" }).map((a) => a.id),
  [],
  "a cancelled appointment must release its slot"
);
assert.deepEqual(
  findDoctorConflicts(day, { time: "01:00 PM", duration: 30, doctorId: "staff_ahmed", doctorName: "Ahmed Hassan" }).map((a) => a.id),
  []
);

// Editing an appointment never conflicts with itself.
assert.deepEqual(
  findDoctorConflicts(day, {
    time: "10:00 AM", duration: 30, doctorId: "staff_ahmed", doctorName: "Ahmed Hassan",
    excludeAppointmentId: "A1",
  }).map((a) => a.id),
  []
);

// With no dentist chosen, any live booking blocks the slot.
assert.equal(findDoctorConflicts(day, { time: "10:00 AM", duration: 30 }).length, 2);

// --- rooms --------------------------------------------------------------------------------------
assert.deepEqual(
  findRoomConflicts(day, { time: "10:15 AM", duration: 30, roomId: "room1" }).map((a) => a.id),
  ["A1"]
);
assert.deepEqual(
  findRoomConflicts(day, { time: "10:15 AM", duration: 30, roomId: "room3" }).map((a) => a.id),
  [],
  "an empty room is free"
);
assert.deepEqual(findRoomConflicts(day, { time: "10:15 AM", duration: 30, roomId: "" }), []);

console.log("✓ appointmentConflicts: renamed dentists still block their own slots; cancellations release theirs");
