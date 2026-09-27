// What the owner's home says needs him, and the arithmetic behind the strip above it.
//
// The screen leads with problems now — cash behind pace, lab late, staff absent, tomorrow
// unconfirmed, a no-show spike — and everything below it is measured against last month or a
// target. These pin the rules, because each one is a place the screen could quietly cry wolf (a
// month "behind" on the 2nd because it was compared with all of last month) or stay silent.
//
// Run with tsx: npm run test:owner-alerts
import assert from "node:assert/strict";
import {
  PACE_BEHIND_RATIO,
  botShare,
  cashBySource,
  cashPace,
  dayFraction,
  monthFraction,
  needsYou,
  noShowSpike,
  noShowsByWeek,
  targetProgress,
  billedByDoctor,
} from "../src/lib/ownerAlerts";

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

// --- 1. How much of the day and month has gone ------------------------------------------------------
eq(dayFraction(540, 540, 1260), 0, "at opening nothing has gone");
eq(dayFraction(900, 540, 1260), 0.5, "halfway through a 09:00–21:00 day");
eq(dayFraction(1300, 540, 1260), 1, "after closing the day is done");
eq(dayFraction(600, 600, 600), 1, "a clinic with no hours configured is treated as done, so it is never 'behind'");
eq(monthFraction("2026-09-15"), 0.5, "the 15th of a 30-day month");
eq(monthFraction("2026-02-28"), 1, "the last day of the month");

// --- 2. Cash against pace -------------------------------------------------------------------------------
{
  const p = cashPace(4000, 10000, 0.5);
  eq(p, { expected: 5000, ratio: 0.8, behindBy: 1000 }, "half the day gone: measured against half of last time");
  eq(cashPace(9000, 10000, 1).ratio, 0.9, "equal windows pass elapsed = 1");
  eq(cashPace(500, null, 1).ratio, null, "nothing to compare against says so instead of 0%");
  eq(cashPace(500, 0, 1).ratio, null, "…and a zero last time is not a comparison either");
  eq(cashPace(12000, 10000, 1).behindBy, 0, "ahead is never negative-behind");
  ok(PACE_BEHIND_RATIO === 0.8, "behind means under 80% of pace");
}

// --- 3. Targets -----------------------------------------------------------------------------------------------
eq(targetProgress(6200, 10000, 0.66), { percent: 62, expectedPercent: 66, onPace: true }, "62% on the 20th is on pace");
eq(targetProgress(3000, 10000, 0.66), { percent: 30, expectedPercent: 66, onPace: false }, "30% on the 20th is not");
eq(targetProgress(500, 0, 0.5), null, "no target set: no bar");

// --- 4. No-shows by week --------------------------------------------------------------------------------------
{
  const appts = [
    { date: "2026-09-26", status: "No Show" },
    { date: "2026-09-27", status: "No Show" },
    { date: "2026-09-28", status: "No Show" },
    { date: "2026-09-28", status: "Cancelled" },
    { date: "2026-09-28", status: "Completed" },
    { date: "2026-09-20", status: "No Show" },
    { date: "2026-09-13", status: "Completed" },
    { date: "2026-09-06", status: "No Show" },
    { date: "2026-08-01", status: "No Show" }, // outside the four weeks
    { date: "", status: "No Show" },
  ];
  const weeks = noShowsByWeek(appts, "2026-09-29", 4);
  eq(weeks.map((w) => w.start), ["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"], "four Saturday-start weeks, oldest first");
  eq(weeks.map((w) => w.noShows), [1, 0, 1, 3], "no-shows land in their week; rows outside the window and undated rows are ignored");
  eq(weeks[3], { start: "2026-09-26", noShows: 3, cancelled: 1, booked: 5 }, "this week's bucket counts cancelled and booked too");
  const spike = noShowSpike(weeks);
  eq(spike, { spike: true, thisWeek: 3, usual: 0.67 }, "three this week against under one a week is a spike");
  eq(noShowSpike([{ start: "a", noShows: 2, cancelled: 0, booked: 9 }, { start: "b", noShows: 2, cancelled: 0, booked: 9 }]).spike, false, "two is not a spike, whatever the average");
  eq(noShowSpike([]).spike, false, "no weeks, no spike");
}

// --- 5. Cash by source ------------------------------------------------------------------------------------------
{
  const patients = [
    { id: "p1", source: "Facebook" },
    { id: "p2", source: "Google" },
    { id: "p3", source: "" },
  ];
  const ledger = [
    { type: "payment", patientId: "p1", paid: 500 },
    { type: "payment", patientId: "p1", paid: 300 },
    { type: "payment", patientId: "p2", paid: 1000 },
    { type: "procedure", patientId: "p2", cost: 2000, paid: 1000 }, // its paid mirrors the payment above — not cash again
    { type: "expense", patientId: "", cost: 900 },
    { type: "payment", patientId: "p3", paid: 100 },
    { type: "payment", patientId: "p9", paid: 50 },
  ];
  eq(cashBySource(ledger, patients, "Unknown"), [
    { source: "Google", cash: 1000, patients: 1 },
    { source: "Facebook", cash: 800, patients: 1 },
    { source: "Unknown", cash: 150, patients: 2 },
  ], "cash lands under the paying patient's source, biggest first; a procedure row's paid mirror, billed work and expenses are not cash");
}

// --- 6. The bot's share ---------------------------------------------------------------------------------------
eq(botShare([{ outcome: "booked" }, { outcome: "handoff" }, { needsHuman: true }, {}]), { total: 4, handedOff: 2, botAlone: 2, percentBot: 50 }, "handoffs and open human flags are the human half");
eq(botShare([]).percentBot, null, "no conversations: no percentage");

// --- 7. What needs you, in order ----------------------------------------------------------------------------
{
  const calm = needsYou({ pace: cashPace(1000, 1000, 1), labLate: 0, labDueToday: 0, absentToday: 0, lateToday: 0, unconfirmedTomorrow: 0, noShows: { spike: false, thisWeek: 0, usual: 0 }, overtimePending: 0 });
  eq(calm, [], "a good day is an empty list");
  const busy = needsYou({ pace: cashPace(3000, 10000, 1), labLate: 0, labDueToday: 2, absentToday: 1, lateToday: 2, unconfirmedTomorrow: 5, noShows: { spike: true, thisWeek: 4, usual: 1 }, overtimePending: 3 });
  eq(busy.map((i) => i.key), ["cash_behind", "staff_absent", "lab_late", "staff_late", "unconfirmed", "noshow_spike", "overtime"], "high first, then in reading order");
  eq(busy[0], { key: "cash_behind", n: 70, severity: "high", extra: 7000 }, "cash behind carries the percentage and the pounds");
  eq(busy[2], { key: "lab_late", n: 0, severity: "medium", extra: 2 }, "due-today lab work is worth a line, at medium");
  const noCompare = needsYou({ pace: cashPace(0, null, 1), labLate: 0, labDueToday: 0, absentToday: 0, lateToday: 0, unconfirmedTomorrow: 0, noShows: { spike: false, thisWeek: 0, usual: 0 }, overtimePending: 0 });
  eq(noCompare, [], "no comparison figure is not 'behind'");
}

// --- 8. Work billed per dentist ------------------------------------------------------------------------------
{
  const m = billedByDoctor([
    { type: "procedure", doctorName: "Dr. Omar", cost: 2000 },
    { type: "procedure", doctor: "Dr. Omar", cost: 500, paid: 500 },
    { type: "procedure", doctorName: "Dr. Hana", cost: 900, status: "deleted" },
    { type: "payment", doctorName: "Dr. Hana", paid: 900 },
    { type: "procedure", doctorName: "", cost: 100 },
  ]);
  eq([...m.entries()], [["Dr. Omar", 2500]], "procedure rows sum by dentist, paid or not; deleted rows, payments and nameless rows do not count");
}

console.log(`ownerAlerts: ${checks} checks passed`);
