/**
 * The day schedule must draw every visit booked on it — including the ones outside the clinic's
 * hours.
 *
 * The dashboard's day view used to draw exactly the clinic's opening hours and filter out any
 * visit that fell outside them. A clinic that set its hours to 10:00–20:00 in Settings after a
 * 09:00 visit was booked simply lost that visit from the day view: no card, no warning, while the
 * calendar page still showed it. These cases pin the rule that the drawn day stretches to fit.
 *
 * Run: npx tsx tests/dayBounds.test.mts
 */

import assert from "node:assert/strict";
import { dayBoundsCovering, visitStartInDay, type ClinicScheduleConfig } from "../src/lib/clinicSchedule";

const clinic = (over: Partial<ClinicScheduleConfig> = {}): ClinicScheduleConfig => ({
  startHour: 10,
  startMinute: 0,
  endHour: 20,
  endMinute: 0,
  slotDuration: 30,
  offDays: [],
  isConfigured: true,
  ...over,
});

let checks = 0;
const ok = (cond: boolean, msg: string) => {
  checks++;
  assert.ok(cond, msg);
};

// --- 1. No visits, or visits inside hours: the day is the clinic's hours -----------------------
{
  const b = dayBoundsCovering(clinic(), []);
  ok(b.start === 600 && b.end === 1200, "an empty day is drawn as the clinic's hours");
  const inside = dayBoundsCovering(clinic(), [{ startMin: 660, endMin: 720 }]);
  ok(inside.start === 600 && inside.end === 1200, "a visit inside hours does not widen the day");
  ok(inside.clinicStart === 600 && inside.clinicEnd === 1200, "the clinic's own hours are kept alongside");
}

// --- 2. A visit before opening pulls the start earlier, in whole slots ------------------------
{
  const b = dayBoundsCovering(clinic(), [{ startMin: 540, endMin: 570 }]); // 09:00
  ok(b.start === 540, `a 09:00 visit on a 10:00 clinic starts the day at 09:00, got ${b.start}`);
  const odd = dayBoundsCovering(clinic(), [{ startMin: 550, endMin: 580 }]); // 09:10
  ok(odd.start === 540, `09:10 rounds down to the 09:00 slot so the grid stays aligned, got ${odd.start}`);
}

// --- 3. A visit running past closing pushes the end later ------------------------------------
{
  const b = dayBoundsCovering(clinic(), [{ startMin: 1190, endMin: 1250 }]); // 19:50 for an hour
  ok(b.end === 1260, `a visit ending 20:50 on a 20:00 clinic ends the day at 21:00, got ${b.end}`);
}

// --- 4. The day never starts before midnight ---------------------------------------------------
{
  const b = dayBoundsCovering(clinic({ startHour: 0, startMinute: 20, slotDuration: 60 }), [{ startMin: 5, endMin: 35 }]);
  ok(b.start === 0, `the day is clamped at midnight, got ${b.start}`);
}

// --- 5. A clinic that runs past midnight keeps its late visits at the end of the day ----------
{
  const night = clinic({ startHour: 14, endHour: 2 }); // 14:00 – 02:00
  const b = dayBoundsCovering(night, []);
  ok(b.end === 1560, `02:00 the next morning is 1560 minutes, got ${b.end}`);
  ok(visitStartInDay(60, b) === 1500, "a 01:00 visit is drawn at the end of the day, not before its start");
  ok(visitStartInDay(540, b) === 540, "a 09:00 visit is a morning visit and stays where it is");
  const withEarly = dayBoundsCovering(night, [{ startMin: 540, endMin: 570 }]);
  ok(withEarly.start === 540, "…and that morning visit widens the day back to 09:00");
}

// --- 6. Garbage times do not break the day -----------------------------------------------------
{
  const b = dayBoundsCovering(clinic(), [{ startMin: NaN, endMin: NaN }]);
  ok(b.start === 600 && b.end === 1200, "an unparseable time leaves the day as the clinic's hours");
}

console.log(`dayBounds: ${checks} checks passed`);
