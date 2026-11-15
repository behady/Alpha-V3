// Automatic clock-out: an open shift is closed a set number of hours after the shift ended.
// Run: npm run test:autoclose
import assert from "node:assert/strict";
import {
  autoCloseCutoff,
  decideAutoClose,
  defaultWeekSchedule,
  parseAutoCloseHours,
} from "../src/lib/attendanceAutoClose";

const TZ = "Africa/Cairo";
let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/** Cairo is UTC+2 in winter (November) and UTC+3 in summer (July). */
const cairoWinter = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+02:00`);
const cairoSummer = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+03:00`);

const week = defaultWeekSchedule(); // Sun–Thu 13:00–21:00

console.log("parseAutoCloseHours");

check("empty, zero, negative and junk all mean OFF", () => {
  for (const raw of ["", null, undefined, "0", 0, "-2", "abc", NaN]) {
    assert.equal(parseAutoCloseHours(raw), null, `expected off for ${String(raw)}`);
  }
});

check("reads a number or a string, including half hours", () => {
  assert.equal(parseAutoCloseHours("2"), 2);
  assert.equal(parseAutoCloseHours(1.5), 1.5);
});

check("is capped at 12 hours so it can never reach the next shift", () => {
  assert.equal(parseAutoCloseHours("48"), 12);
});

console.log("autoCloseCutoff");

check("normal day: shift ends 21:00, 2 hours grace -> closed at 23:00", () => {
  // 2026-11-11 is a Wednesday.
  const cutoff = autoCloseCutoff({ checkIn: cairoWinter("2026-11-11", "13:05"), schedule: week, hours: 2, timeZone: TZ });
  assert.equal(cutoff.toISOString(), cairoWinter("2026-11-11", "23:00").toISOString());
});

check("summer time is respected (UTC+3)", () => {
  // 2026-07-15 is a Wednesday.
  const cutoff = autoCloseCutoff({ checkIn: cairoSummer("2026-07-15", "13:00"), schedule: week, hours: 2, timeZone: TZ });
  assert.equal(cutoff.toISOString(), cairoSummer("2026-07-15", "23:00").toISOString());
});

check("the person's own shift wins over the default", () => {
  const own = { ...week, "3": { active: true, start: "09:00", end: "15:00" } };
  const cutoff = autoCloseCutoff({ checkIn: cairoWinter("2026-11-11", "09:00"), schedule: own, hours: 1, timeZone: TZ });
  assert.equal(cutoff.toISOString(), cairoWinter("2026-11-11", "16:00").toISOString());
});

check("no shifts saved for the person -> default week is used", () => {
  const cutoff = autoCloseCutoff({ checkIn: cairoWinter("2026-11-11", "13:00"), schedule: undefined, hours: 2, timeZone: TZ });
  assert.equal(cutoff.toISOString(), cairoWinter("2026-11-11", "23:00").toISOString());
});

check("day off (Friday): the clinic's closing time stands in for the shift end", () => {
  // 2026-11-13 is a Friday.
  const cutoff = autoCloseCutoff({ checkIn: cairoWinter("2026-11-13", "14:00"), schedule: week, clinicEnd: "23:00", hours: 1, timeZone: TZ });
  assert.equal(cutoff.toISOString(), cairoWinter("2026-11-14", "00:00").toISOString());
});

check("day off and no clinic closing time -> 21:00", () => {
  const cutoff = autoCloseCutoff({ checkIn: cairoWinter("2026-11-13", "14:00"), schedule: week, hours: 2, timeZone: TZ });
  assert.equal(cutoff.toISOString(), cairoWinter("2026-11-13", "23:00").toISOString());
});

check("overnight shift 18:00–02:00 ends tomorrow", () => {
  const night = { ...week, "3": { active: true, start: "18:00", end: "02:00" } };
  const cutoff = autoCloseCutoff({ checkIn: cairoWinter("2026-11-11", "18:10"), schedule: night, hours: 1, timeZone: TZ });
  assert.equal(cutoff.toISOString(), cairoWinter("2026-11-12", "03:00").toISOString());
});

check("clocking in after the shift already ended gives the grace from clock-in, not a close in the past", () => {
  const checkIn = cairoWinter("2026-11-11", "23:30");
  const cutoff = autoCloseCutoff({ checkIn, schedule: week, hours: 2, timeZone: TZ });
  assert.equal(cutoff.toISOString(), cairoWinter("2026-11-12", "01:30").toISOString());
  assert.ok(cutoff.getTime() > checkIn.getTime());
});

check("a broken shift time falls back instead of producing an invalid date", () => {
  const broken = { ...week, "3": { active: true, start: "13:00", end: "soon" } };
  const cutoff = autoCloseCutoff({ checkIn: cairoWinter("2026-11-11", "13:00"), schedule: broken, hours: 2, timeZone: TZ });
  assert.equal(cutoff.toISOString(), cairoWinter("2026-11-11", "23:00").toISOString());
});

console.log("decideAutoClose");

const base = { checkIn: cairoWinter("2026-11-11", "13:05"), schedule: week, hours: 2, timeZone: TZ };

check("before the cutoff the shift is left alone — genuine overtime is not cut short", () => {
  const d = decideAutoClose({ ...base, now: cairoWinter("2026-11-11", "22:59") });
  assert.equal(d.close, false);
});

check("at the cutoff the shift is closed", () => {
  const d = decideAutoClose({ ...base, now: cairoWinter("2026-11-11", "23:00") });
  assert.equal(d.close, true);
});

check("the reported failure: found open the next afternoon, recorded as 9h55m, not 24h", () => {
  const d = decideAutoClose({ ...base, now: cairoWinter("2026-11-12", "13:00") });
  assert.equal(d.close, true);
  if (d.close) {
    assert.equal(d.cutoff.toISOString(), cairoWinter("2026-11-11", "23:00").toISOString());
    assert.equal(d.durationMinutes, 595);
  }
});

check("found four days later: still closed at the first night's cutoff", () => {
  const d = decideAutoClose({ ...base, now: cairoWinter("2026-11-15", "13:00") });
  assert.equal(d.close && d.durationMinutes, 595);
});

console.log(`\nAll assertions passed. ${passed} checks.`);
