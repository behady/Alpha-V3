// A dragged appointment keeps the clinic's 12-hour time. Run with tsx.
//
// Dragging a card on the calendar (day, week, rooms and doctors views) saved the drop position as
// "21:30" — every other way of booking saves "09:30 PM". The dentist's home printed the stored text
// as it was, so a dentist whose receptionist dragged two visits saw 21:30 and 21:55 among the
// usual times; the patient's "your appointment moved" WhatsApp quoted "21:30" too.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeTimeKey } from "../src/lib/appointmentTime";
import { minutesToClock } from "../src/lib/weekSchedule";

// What the calendar produces on a drop, and what must be stored.
assert.equal(normalizeTimeKey(minutesToClock(21 * 60 + 30)), "09:30 PM");
assert.equal(normalizeTimeKey(minutesToClock(21 * 60 + 55)), "09:55 PM");
assert.equal(normalizeTimeKey(minutesToClock(12 * 60)), "12:00 PM", "noon");
assert.equal(normalizeTimeKey(minutesToClock(0)), "12:00 AM", "midnight");
assert.equal(normalizeTimeKey(minutesToClock(9 * 60 + 5)), "09:05 AM");
// A time already in the stored form passes through unchanged.
assert.equal(normalizeTimeKey("09:30 PM"), "09:30 PM");

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

// The one writer every drag goes through stores — and messages — the 12-hour form.
const service = read("src/lib/bookingService.ts");
const writer = service.slice(service.indexOf("export async function updateBookingTime"));
const body = writer.slice(0, writer.search(/\r?\n\}\r?\n/));
assert.ok(body.length > 100, "found the end of updateBookingTime");
assert.match(body, /const newTime = normalizeTimeKey\(droppedTime\)/, "updateBookingTime normalises the dropped time");
assert.ok(body.indexOf("normalizeTimeKey(droppedTime)") < body.indexOf("updateDoc("), "normalised before it is written");
assert.ok(body.indexOf("normalizeTimeKey(droppedTime)") < body.indexOf("sendPatientAppointmentWhatsApp("), "and before the patient is told");

// Rows already saved as "21:30" still read as 12-hour wherever the raw text was printed.
const home = read("src/components/dashboard/DentistHome.tsx");
assert.doesNotMatch(home, /String\((a|hero)\.time \|\| ""\)\}/, "the dentist's home prints no raw stored time");
const mobile = read("src/components/dashboard/MobileDashboard.tsx");
assert.doesNotMatch(mobile, /\{apt\.time\} —/, "the phone dashboard prints no raw stored time");

console.log("dragTimeFormat: ok");
