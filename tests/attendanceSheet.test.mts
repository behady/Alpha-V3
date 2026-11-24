// The clock-in sheet on the team page: one row per shift (and per missed day), the filters above it,
// and the Excel file it downloads.
//
// The failure that matters is the money. The sheet shows a "Day's pay" beside every shift so an owner
// can SEE how clocking in and out becomes a wage; if those figures did not add up to the payroll
// engine's estimated pay (the "Owed" figure at the top of the same profile), the page would argue
// with itself about somebody's salary.
//
// Run with tsx: npm run test:attendance-sheet
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import XLSX from "xlsx-js-style";
import { buildHrSection, hourlyRateFor, shiftPaySplit } from "../src/lib/automation/briefing/hr";
import { defaultSchedule, type Schedule } from "../src/lib/hrClient";
import type { PunchRecord } from "../src/lib/automation/briefing/data";
import { buildAttendanceSheet, matchesFilter, type AttendanceSheet } from "../src/lib/attendanceSheet";
import { attendanceFileName, attendanceWorkbook } from "../src/lib/attendanceSheetXlsx";

const REPO = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");
let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}
const close = (a: number, b: number, message: string) => ok(Math.abs(a - b) < 0.005, `${message} (${a} vs ${b})`);

const tz = "Africa/Cairo";
// Cairo is UTC+2 in November 2026 (winter time); build instants from Cairo wall-clock times.
const at = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+02:00`);
function shift(id: string, ymd: string, from: string, to: string | null, extra: Partial<PunchRecord> = {}): PunchRecord {
  const checkIn = at(ymd, from);
  let checkOut = to ? at(ymd, to) : null;
  if (checkOut && checkOut < checkIn) checkOut = new Date(checkOut.getTime() + 864e5);
  return {
    id, userId: "u1", staffId: "s1", userName: "Hana", date: ymd, checkIn, checkOut,
    durationMinutes: checkOut ? Math.round((checkOut.getTime() - checkIn.getTime()) / 60000) : 0,
    status: checkOut ? "completed" : "active", overtimeStatus: "", checkInDistanceM: 20, checkInAccuracyM: 10,
    checkInBranchName: null, deviceId: "d", ...extra,
  };
}

const roster: Schedule = defaultSchedule(); // Sun–Thu 13:00–21:00 = 40 h a week
// 2026-11-01 is a Sunday; 2026-11-06 a Friday (day off).
const punches: PunchRecord[] = [
  shift("p1", "2026-11-01", "13:00", "21:00"), // on time
  shift("p2", "2026-11-02", "13:40", "21:00"), // 40 min late
  shift("p3", "2026-11-03", "12:30", "22:00", { overtimeStatus: "approved" }), // 90 extra, approved
  shift("p4", "2026-11-04", "13:00", "22:00", { overtimeStatus: "rejected" }), // 60 extra, refused
  shift("p5", "2026-11-06", "10:00", "14:00"), // day off: 240 extra, waiting
  shift("p6", "2026-11-08", "13:02", null), // forgot to clock out (a past day, still "active")
  shift("p7", "2026-11-09", "13:00", "21:00", { autoClosed: true, checkInDistanceM: 1500 }), // closed by the system, far away
  // 2026-11-05 (Thursday) has no punch: a missed day.
  shift("p8", "2026-11-10", "12:50", null), // today, still in
];
const today = "2026-11-10";
const nowMinutes = 17 * 60; // 17:00 on the clinic's clock
const pay = { baseSalary: 9000, overtimeMultiplier: 1.5 };

const engine = () =>
  buildHrSection({
    staff: [{ id: "s1", uid: "u1", name: "Hana", role: "Assistant", ...pay, commissionPercentage: 0, registeredDeviceId: "d", schedule: roster }],
    punches,
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    today,
    nowMinutes,
    timeZone: tz,
    geofenceRadiusM: 200,
    monthStart: "2026-11-01",
  }).section.staff[0];

const build = (overrides: Partial<Parameters<typeof buildAttendanceSheet>[0]> = {}): AttendanceSheet =>
  buildAttendanceSheet({
    punches,
    schedule: roster,
    assumed: false,
    ...pay,
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    today,
    nowMinutes,
    timeZone: tz,
    ...overrides,
  });

// --- 1. The hour price and the split of one shift -----------------------------------------------
{
  // 40 h a week × 52 / 12 = 173.33 h a month.
  close(hourlyRateFor(9000, roster), 9000 / ((40 * 60 * 52) / (12 * 60)), "the hour price is the salary over the roster's monthly hours");
  eq(hourlyRateFor(9000, {}), 0, "no roster, no hour price (never a division by zero)");
  eq(hourlyRateFor(0, roster), 0, "no salary, no hour price");

  const now = { today, nowMinutes };
  eq(shiftPaySplit(punches[0], roster, tz, now), { worked: 480, regular: 480, overtime: 0 }, "an on-time shift is all regular");
  eq(shiftPaySplit(punches[1], roster, tz, now), { worked: 440, regular: 440, overtime: 0 }, "coming in late shortens the paid time");
  eq(shiftPaySplit(punches[2], roster, tz, now), { worked: 570, regular: 480, overtime: 90 }, "before the start and after the end are extra time");
  eq(shiftPaySplit(punches[4], roster, tz, now), { worked: 240, regular: 0, overtime: 240 }, "a shift on a day off is all extra time");
  eq(shiftPaySplit(punches[5], roster, tz, now).worked, 0, "a forgotten clock-out on a past day pays nothing until it is fixed");
  eq(shiftPaySplit(punches[7], roster, tz, now), { worked: 250, regular: 240, overtime: 10 }, "today's open shift counts up to now");
}

// --- 2. The sheet agrees with the payroll engine ------------------------------------------------
{
  const sheet = build();
  const row = engine();
  close(sheet.totals.pay, row.estimatedPay, "the day-by-day pay adds up to the engine's estimated pay (the 'Owed' at the top)");
  eq(sheet.totals.worked, row.minutesWorked, "the hours add up to the engine's hours");
  eq(sheet.totals.days, row.daysWorked, "the days add up to the engine's days worked");
  eq(sheet.totals.lateDays, row.lateDays, "late days agree");
  eq(sheet.totals.absentDays, row.absentDays, "missed days agree");
  close(sheet.hourlyRate, hourlyRateFor(9000, roster), "the sheet quotes the same hour price");
  ok(sheet.payShown, "a fixed salary shows the Day's pay column");

  const byId = new Map(sheet.rows.filter((r) => r.kind === "shift").map((r) => [r.id, r]));
  const rate = sheet.hourlyRate;
  close(byId.get("p1")!.pay!, 8 * rate, "an on-time day earns eight hours");
  close(byId.get("p3")!.pay!, 8 * rate + 1.5 * rate * 1.5, "approved extra time is paid at 1.5×");
  close(byId.get("p4")!.pay!, 8 * rate, "refused extra time is not paid");
  close(byId.get("p5")!.pay!, 0, "extra time still waiting for an answer is not paid yet");
  eq(byId.get("p2")!.late, 40, "the late minutes sit on the day's first shift");
  eq(byId.get("p1")!.late, 0, "an on-time shift is not late");
  eq(byId.get("p3")!.extraDecision, "approved", "approved extra time says so");
  eq(byId.get("p4")!.extraDecision, "rejected", "refused extra time says so");
  eq(byId.get("p5")!.extraDecision, "pending", "unanswered extra time is waiting");
  eq(byId.get("p1")!.extraDecision, null, "no extra time, nothing to decide");
  eq(byId.get("p8")!.extraDecision, null, "a shift still running is not asked about yet");
  ok(byId.get("p6")!.forgot && !byId.get("p6")!.stillIn, "a past day left open is a forgotten clock-out");
  ok(byId.get("p8")!.stillIn && !byId.get("p8")!.forgot, "today's open shift is someone still at work");
  ok(byId.get("p7")!.far, "a clock-in 1.5 km away is marked far");

  const absent = sheet.rows.filter((r) => r.kind === "absent").map((r) => r.date);
  eq(absent, ["2026-11-05"], "a rostered day with no clock-in is a missed day; a day off is not");
  eq(sheet.rows.map((r) => r.date), [...sheet.rows.map((r) => r.date)].sort().reverse(), "newest first, like the page reads");
}

// --- 3. The filters ----------------------------------------------------------------------------
{
  const sheet = build();
  const ids = (f: Parameters<typeof matchesFilter>[1]) => sheet.rows.filter((r) => matchesFilter(r, f)).map((r) => r.id).sort();
  eq(ids("late"), ["p2"], "Late lists the late days");
  eq(ids("extra"), ["p3", "p4", "p5"], "Extra time lists finished shifts that ran past the roster");
  eq(ids("open"), ["p6", "p7"], "Forgot to clock out lists the open shift and the one the system closed");
  eq(ids("far"), ["p7"], "Away from the clinic lists the far clock-in");
  eq(ids("absent"), ["absent-2026-11-05"], "Missed days lists the absences");
  eq(ids("all").length, sheet.rows.length, "All lists everything");
  eq(sheet.counts, { all: 9, late: 1, extra: 3, open: 2, far: 1, absent: 1 }, "each filter knows its count");
}

// --- 4. An assumed roster asserts no lateness or absence; no salary shows no pay -----------------
{
  const assumed = build({ assumed: true });
  eq(assumed.counts.late + assumed.counts.absent, 0, "with no roster of their own, nobody is called late or absent");
  ok(assumed.payShown, "the wage is still estimated on the assumed roster, as the header does");
  const noSalary = build({ baseSalary: 0 });
  ok(!noSalary.payShown, "no fixed salary: no Day's pay column");
  ok(noSalary.rows.every((r) => r.pay === null), "and no figure pretends to be a wage");
  const empty = build({ punches: [], startDate: "2026-11-06", endDate: "2026-11-07" });
  eq(empty.rows.length, 0, "a weekend with no clock-ins is an empty sheet, not missed days");
}

// --- 5. The Excel file -------------------------------------------------------------------------
{
  const sheet = build();
  for (const isAr of [false, true]) {
    const wb = attendanceWorkbook({ people: [{ name: "Hana Mostafa", sheet, assumed: false, baseSalary: 9000, overtimeMultiplier: 1.5 }], start: "2026-11-01", end: "2026-11-30", isAr, timeZone: tz });
    const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellFormula: true, cellNF: true });
    eq(back.SheetNames.length, 1, "one person = one sheet");
    const ws = back.Sheets[back.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
    const head = grid.findIndex((r) => r.includes(isAr ? "أجر اليوم" : "Day's pay"));
    ok(head > 0, "the sheet has the Day's pay heading");
    const total = grid.findIndex((r) => r[0] === (isAr ? "الإجمالي" : "Total"));
    eq(total - head - 1, sheet.rows.length, "one line per row of the page");
    const payCol = grid[head].indexOf(isAr ? "أجر اليوم" : "Day's pay");
    // Each day is written to the piaster; their sum may differ from the unrounded total by a piaster or two.
    ok(Math.abs(Number(grid[total][payCol]) - sheet.totals.pay) < 0.05, "the total pay is the page's total");
    const cell = ws[XLSX.utils.encode_cell({ r: total, c: payCol })];
    ok(typeof cell.f === "string" && cell.f.startsWith("SUM("), "the total is a real formula");
    const hoursCol = grid[head].indexOf(isAr ? "الساعات" : "Hours");
    close(Number(grid[total][hoursCol]) * 1440, sheet.totals.worked, "hours are Excel times that add up to the page's hours");
    eq(Boolean(back.Workbook?.Views?.[0]?.RTL), isAr, "the Arabic file reads right to left");
  }

  // The whole team: a summary first, then one sheet per person.
  const other = build({ baseSalary: 0 });
  const wb = attendanceWorkbook({
    people: [
      { name: "Hana Mostafa", sheet, assumed: false, baseSalary: 9000, overtimeMultiplier: 1.5 },
      { name: "Dr. Omar", sheet: other, assumed: false, baseSalary: 0, overtimeMultiplier: 1.5 },
    ],
    start: "2026-11-01",
    end: "2026-11-30",
    isAr: false,
    team: true,
    timeZone: tz,
  });
  eq(wb.SheetNames.length, 3, "the team file is a summary plus a sheet per person");
  eq(wb.SheetNames[0], "Summary", "the summary comes first");
  const summary = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Summary, { header: 1, raw: true, defval: null });
  ok(summary.some((r) => r[0] === "Hana Mostafa") && summary.some((r) => r[0] === "Dr. Omar"), "every person has a summary line");
  eq(attendanceFileName("Hana Mostafa", "2026-11-01", "2026-11-30"), "attendance-hana-mostafa-2026-11-01-to-2026-11-30.xlsx", "a readable ASCII file name");
  eq(attendanceFileName("نهى", "2026-11-01", "2026-11-30"), "attendance-2026-11-01-to-2026-11-30.xlsx", "an Arabic name drops out");
  // Sheet names: at most 31 characters, unique, none of : \ / ? * [ ]
  const long = attendanceWorkbook({
    people: [
      { name: "Dr. A very long name that goes past the limit", sheet, assumed: false, baseSalary: 9000, overtimeMultiplier: 1.5 },
      { name: "Dr. A very long name that goes past the limit", sheet, assumed: false, baseSalary: 9000, overtimeMultiplier: 1.5 },
      { name: "Nada / reception [1]", sheet, assumed: false, baseSalary: 9000, overtimeMultiplier: 1.5 },
    ],
    start: "2026-11-01",
    end: "2026-11-30",
    isAr: false,
    team: true,
    timeZone: tz,
  });
  ok(long.SheetNames.every((n) => n.length <= 31 && !/[:\\/?*[\]]/.test(n)), "sheet names follow Excel's rules");
  eq(new Set(long.SheetNames).size, long.SheetNames.length, "two people with one name get two sheets");
}

// --- 6. The tab is built on these, not on its own sums ------------------------------------------
{
  const tab = read("src/app/(dashboard)/team/AttendanceTab.tsx");
  ok(/buildAttendanceSheet\(/.test(tab) || /AttendanceSheet/.test(tab), "the tab reads the shared sheet, not its own arithmetic");
  ok(/matchesFilter\(/.test(tab), "the filters use the shared rule");
  const page = read("src/app/(dashboard)/team/page.tsx");
  ok(/attendanceWorkbook\(/.test(page), "the page writes the Excel file from the same sheet");
}

console.log(`attendance sheet: ${checks} checks passed`);
