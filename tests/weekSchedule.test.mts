// What the week view says above and inside each day column.
//
// The week used to be seven columns of cards with a date on top and nothing else, built from UTC
// dates while the query feeding it used local ones. These pin the replacement: which days make a
// week, what a day's counts mean (a cancelled visit frees its slot; a no-show is not a visit but is
// worth a count of its own), and what a card of a given height has room to say.
//
// Run with tsx: npm run test:week-schedule
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WEEK_ROW_PX,
  countsAsVisit,
  dayNameKey,
  daySummary,
  isOffDay,
  isUnconfirmed,
  minutesToClock,
  weekCardTier,
  weekDaysFrom,
} from "../src/lib/weekSchedule";
import { timeRange } from "../src/lib/scheduleCard";
import type { ClinicScheduleConfig } from "../src/lib/clinicSchedule";

const REPO = join(import.meta.dirname, "..");
let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const clinic = (over: Partial<ClinicScheduleConfig> = {}): ClinicScheduleConfig => ({
  startHour: 9,
  startMinute: 0,
  endHour: 13,
  endMinute: 0,
  slotDuration: 30,
  offDays: [],
  isConfigured: true,
  ...over,
});

// --- 1. Which days make a week -------------------------------------------------------------------
{
  const week = ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];
  eq(weekDaysFrom("2026-09-23"), week, "a Wednesday belongs to the week that began the Saturday before");
  eq(weekDaysFrom("2026-09-19"), week, "a Saturday starts its own week");
  eq(weekDaysFrom("2026-09-25"), week, "a Friday closes the week that began six days earlier");
  for (const d of week) eq(weekDaysFrom(d), week, `every day of the week gives the same week (${d})`);
  eq(weekDaysFrom("2027-01-01")[0], "2026-12-26", "a week can start in the previous year");
  eq(weekDaysFrom("2027-01-01").length, 7, "and still has seven days");
  eq(weekDaysFrom("garbage").length, 7, "an unparseable key still gives a week rather than nothing");
}

// --- 2. Day names and off days --------------------------------------------------------------------
{
  eq(dayNameKey("2026-09-25"), "friday", "the day name is the key the clinic's off-days list uses");
  ok(isOffDay("2026-09-25", { offDays: ["friday"] }), "Friday is off when the clinic says so");
  ok(!isOffDay("2026-09-24", { offDays: ["friday"] }), "Thursday is not");
  ok(isOffDay("2026-09-25", { offDays: ["Friday "] }), "case and whitespace in the settings do not matter");
}

// --- 3. The counts above a column ----------------------------------------------------------------
{
  const appts = [
    { status: "Scheduled", time: "09:00 AM", duration: 30, cost: 500 },
    { status: "Confirmed", time: "09:30 AM", duration: 60, cost: 1500 },
    { status: "Cancelled", time: "11:00 AM", duration: 30, cost: 900 },
    { status: "No Show", time: "12:00 PM", duration: 30, cost: 300 },
    { status: "Completed", time: "09:15 AM", duration: 30, cost: 700 },
  ];
  const s = daySummary(appts, clinic(), "2026-09-24");
  eq(s.visits, 3, "cancelled and no-show are not visits");
  eq(s.unconfirmed, 1, "only Scheduled is unconfirmed");
  eq(s.noShows, 1, "a no-show is counted on its own");
  eq(s.expectedMoney, 2700, "expected money is the quoted price of the visits that count");
  eq(s.totalSlots, 8, "09:00–13:00 in half hours is eight slots");
  // 09:00 taken (Scheduled + the 09:15 straddle), 09:30 taken (Confirmed to 10:30 + straddle),
  // 10:00 taken (Confirmed runs to 10:30); 10:30, 11:00, 11:30, 12:00, 12:30 free.
  eq(s.freeSlots, 5, "a cancelled or no-show visit frees its slot; a straddling visit takes both it touches");
  ok(!s.isEmpty && !s.isOffDay, "a day with visits is neither empty nor off");

  eq(daySummary([{ status: "Pending", time: "09:00 AM", cost: 1 }], clinic(), "2026-09-24").unconfirmed, 1, "the legacy 'Pending' is unconfirmed");
  eq(daySummary([{ status: "Rescheduled", time: "09:00 AM", cost: 1 }], clinic(), "2026-09-24").visits, 0, "a rescheduled row is not a visit");
  const early = daySummary([{ status: "Confirmed", time: "08:00 AM", duration: 30, cost: 100 }], clinic(), "2026-09-24");
  eq([early.visits, early.freeSlots], [1, 8], "a visit before opening is a visit, but does not make the morning full");
  const off = daySummary(appts, clinic({ offDays: ["thursday"] }), "2026-09-24");
  eq([off.isOffDay, off.freeSlots, off.totalSlots, off.visits], [true, 0, 0, 3], "an off day has no free slots to offer, but still counts what was booked on it");
  const empty = daySummary([], clinic(), "2026-09-24");
  ok(empty.isEmpty && empty.freeSlots === empty.totalSlots, "an empty day is all free");
  eq(daySummary([{ status: "Confirmed", time: "09:00 AM", cost: "abc" }], clinic(), "2026-09-24").expectedMoney, 0, "a cost that is not a number adds nothing");
  ok(countsAsVisit(undefined) && isUnconfirmed(undefined), "a row with no status is a scheduled visit, as the stages module says");
}

// --- 4. What a card has room for --------------------------------------------------------------------
{
  eq(weekCardTier(47), "name", "under 48px: the name alone");
  eq(weekCardTier(48), "line", "48px: name and what the visit is for");
  eq(weekCardTier(71), "line", "…up to 71");
  eq(weekCardTier(72), "time", "72px adds when it starts and ends");
  eq(weekCardTier(96), "full", "96px adds the phone");
  const ppm = WEEK_ROW_PX / 30;
  eq(weekCardTier(15 * ppm - 2), "line", "at the real geometry a 15-minute card still says what it is for");
  eq(weekCardTier(30 * ppm - 2), "full", "and a 30-minute card says everything");
}

// --- 5. Clock strings feed the range --------------------------------------------------------------
{
  eq(minutesToClock(570), "09:30", "minutes to a 24-hour clock");
  eq(minutesToClock(1470), "00:30", "past midnight wraps");
  eq(timeRange(minutesToClock(540), 45), "09:00 – 09:45", "and timeRange accepts it — it does not accept the stored 'hh:mm AM' form");
}

// --- 6. The screens keep the promises --------------------------------------------------------------
{
  const lib = readFileSync(join(REPO, "src/lib/weekSchedule.ts"), "utf8");
  const view = readFileSync(join(REPO, "src/components/dashboard/WeeklyScheduleView.tsx"), "utf8");
  const dash = readFileSync(join(REPO, "src/components/dashboard/DesktopDashboard.tsx"), "utf8");
  ok(!/toISOString/.test(lib), "weekSchedule.ts works in local dates only");
  ok(!/toISOString/.test(view), "the week view builds no date from UTC — that is how its columns and the query disagreed");
  ok(/weekDaysFrom\(scheduleViewDate\)/.test(dash), "the dashboard's week query takes its days from the same function as the grid");
  ok(/weekDaysFrom\(/.test(view), "…and so does the grid");
  ok(!/amber-/.test(view), "no amber on the week view — the status bar is the only colour on a card");
  ok(/canSeeMoney/.test(view), "money on the strip is behind the finance gate");
}

console.log(`weekSchedule: ${checks} checks passed`);
