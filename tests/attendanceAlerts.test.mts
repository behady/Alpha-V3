// Who the owner hears about as late or absent, and when.
// Run: npm run test:attendance-alerts
import assert from "node:assert/strict";
import { attendanceAlertsDue, type RosterRow } from "../src/lib/alerts/attendanceAlerts";
import { notifyTiming } from "../src/lib/notificationCatalog";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const roster: RosterRow[] = [{ uid: "sohila", name: "sohila ahmed", start: "14:00" }];
const both = { late: { on: true, graceMinutes: 15 }, absent: { on: true, hours: 2 } };
const due = (time: string, opts: Partial<typeof both> = {}, punched: string[] = [], rows = roster) =>
  attendanceAlertsDue({ roster: rows, punched: new Set(punched), minutesNow: at(time), ...both, ...opts });

console.log("attendanceAlertsDue");

// DENT INN, 23 Nov 2026: five receptionists rostered from 14:00 were all called absent at 11:00,
// then all clocked in between 13:58 and 14:21.
check("nobody is late or absent before their shift has even started", () => {
  assert.deepEqual(due("11:00"), []);
  assert.deepEqual(due("13:59"), []);
});

check("inside the grace minutes after the shift starts: nothing yet", () => {
  assert.deepEqual(due("14:14"), []);
});

check("past the grace minutes with no clock-in: late, not absent", () => {
  const out = due("14:15");
  assert.equal(out.length, 1);
  assert.equal(out[0].event, "staffLate");
  assert.equal(out[0].uid, "sohila");
});

check("the absent hours after the shift starts: absent, and no late alongside it", () => {
  const out = due("16:00");
  assert.equal(out.length, 1);
  assert.equal(out[0].event, "staffAbsent");
});

check("someone who clocked in is never late or absent", () => {
  assert.deepEqual(due("14:30", {}, ["sohila"]), []);
  assert.deepEqual(due("18:00", {}, ["sohila"]), []);
});

check("each person is measured from their own shift", () => {
  const rows: RosterRow[] = [
    { uid: "morning", name: "Faten", start: "09:00" },
    { uid: "evening", name: "Norhan", start: "17:00" },
  ];
  const out = due("11:00", {}, [], rows);
  assert.deepEqual(out.map((a) => `${a.event}:${a.uid}`), ["staffAbsent:morning"]);
});

check("a row with no start time is skipped, never guessed", () => {
  assert.deepEqual(due("20:00", {}, [], [{ uid: "x", name: "X", start: null }]), []);
  assert.deepEqual(due("20:00", {}, [], [{ uid: "x", name: "X", start: "soon" }]), []);
});

check("late switched off: absent still comes at its time", () => {
  assert.deepEqual(due("14:30", { late: { on: false, graceMinutes: 15 } }), []);
  assert.equal(due("16:00", { late: { on: false, graceMinutes: 15 } })[0].event, "staffAbsent");
});

check("absent switched off: late keeps its place for the rest of the day", () => {
  const out = due("19:00", { absent: { on: false, hours: 2 } });
  assert.equal(out.length, 1);
  assert.equal(out[0].event, "staffLate");
});

check("a grace longer than the absent gap: absent wins, no late", () => {
  const out = due("16:30", { late: { on: true, graceMinutes: 180 } });
  assert.deepEqual(out.map((a) => a.event), ["staffAbsent"]);
});

check("the wording is Arabic and names the shift start", () => {
  const late = due("14:20")[0];
  assert.equal(late.title, "⏰ sohila ahmed: لسه مفيش تسجيل حضور");
  assert.equal(late.body, "الشيفت بدأ 14:00 — عدّى 20 دقيقة");
  const absent = due("16:05")[0];
  assert.equal(absent.title, "🚫 sohila ahmed: غياب النهارده");
  assert.equal(absent.body, "الشيفت بدأ 14:00 — عدّى 2 ساعة ومفيش تسجيل حضور");
});

console.log("catalogue");

check("absent is measured in hours after the shift, two by default", () => {
  assert.equal(notifyTiming("staffAbsent", "hours", {}), 2);
  assert.equal(notifyTiming("staffAbsent", "hours", { timings: { staffAbsent: { hours: 3 } } }), 3);
});

console.log(`\n${passed} passed`);
