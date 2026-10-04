// The two pure libraries behind the team page: whose money a payment is, and what a roster asks for.
//
// The failure that matters here is not a crash. It is a person's own profile quoting a different
// figure from the reports page for the same work — which is what happens the moment this code starts
// recomputing commission instead of adding up what was stamped on each payment when it was taken.
//
// Run with tsx: npm run test:staff
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_COMMISSION, commissionByStaff, staffIdForRow } from "../src/lib/staffCommission";
import { defaultSchedule, expectedScheduleFor, hoursText, scheduleFrom, weeklyMinutes } from "../src/lib/hrClient";
import { buildHrSection, shiftOvertimeMinutes } from "../src/lib/automation/briefing/hr";

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

const STAFF = [
  { id: "s_hana", name: "Hana Mostafa" },
  { id: "s_omar", name: "Dr. Omar Sherif" },
];

// --- 1. Whose payment is it ---------------------------------------------------------------------
{
  eq(staffIdForRow(STAFF, { doctorId: "s_hana" }), "s_hana", "the stamped id wins");
  eq(
    staffIdForRow(STAFF, { doctorName: "hana   mostafa" }),
    "s_hana",
    "a row with no id falls back to the name, ignoring case and spacing — rows written before doctorId existed carry only a name, and dropping them would quietly shrink somebody's earnings"
  );
  eq(staffIdForRow(STAFF, { doctor: "Dr. Omar Sherif" }), "s_omar", "the older `doctor` field is read too");
  eq(staffIdForRow(STAFF, { doctorName: "Somebody Else" }), null, "an unknown name belongs to nobody rather than to the first row");
  eq(staffIdForRow(STAFF, {}), null, "and a row naming no dentist is not guessed at");
  eq(staffIdForRow(STAFF, { doctorId: "  ", doctorName: "Hana Mostafa" }), "s_hana", "a blank id is not an id");
}

// --- 2. Commission is read, never recomputed ----------------------------------------------------
{
  const rows = [
    { id: "p1", type: "payment", date: "2026-09-10", doctorId: "s_hana", paid: 1000, labFee: 0, doctorCommissionPercentage: 10, doctorCommissionAmount: 100, patientName: "Ahmed", serviceName: "Consultation" },
    { id: "p2", type: "payment", date: "2026-09-12", doctorId: "s_hana", paid: 2000, labFee: 500, doctorCommissionPercentage: 20, doctorCommissionAmount: 300, description: "Payment for Zirconia Crown (T: 11) | 1x2000=2000" },
    // Earned nothing, but it IS one of her payments — a count that omitted it would not match the ledger.
    { id: "p3", type: "payment", date: "2026-09-13", doctorId: "s_hana", paid: 400, doctorCommissionAmount: 0 },
    // A treatment row carries what it WOULD earn once collected. Counting it as well pays twice.
    { id: "c1", type: "procedure", date: "2026-09-10", doctorId: "s_hana", cost: 1000, doctorCommissionAmount: 100 },
    // An expense is nobody's commission.
    { id: "e1", type: "expense", date: "2026-09-11", doctorId: "s_hana", amount: 900, doctorCommissionAmount: 90 },
    { id: "p4", type: "payment", date: "2026-09-09", doctorName: "Dr. Omar Sherif", paid: 5000, doctorCommissionAmount: 750 },
  ];
  const map = commissionByStaff(rows, STAFF);

  const hana = map.get("s_hana")!;
  eq(hana.total, 400, "only payments count, and only what was stamped on them");
  eq(hana.payments, 3, "a payment that earned nothing is still one of hers");
  eq(hana.entries.map((e) => e.id), ["p3", "p2", "p1"], "newest first");
  eq(hana.entries[2].pct, 10, "the rate stamped at the time is carried, not today's rate");
  eq(hana.entries[1].serviceName, "Zirconia Crown", "the treatment is read out of the description when no serviceName was stored");
  eq(hana.entries[1].labFee, 500, "the lab fee on the payment is carried as stored");
  eq(hana.entries[0].patientName, "—", "a payment with no patient name shows something rather than a blank");

  eq(map.get("s_omar")!.total, 750, "a name-matched row lands on the right person");
  eq(map.has("nobody"), false, "no bucket is invented");

  const unstamped = commissionByStaff(
    [{ id: "old", type: "payment", date: "2026-08-01", doctorId: "s_hana", paid: 800 }],
    STAFF
  );
  eq(unstamped.get("s_hana")!.entries[0].pct, null, "a row from before the rate was stamped says so rather than claiming 0%");
  eq(unstamped.get("s_hana")!.total, 0, "and contributes nothing, rather than a figure worked out now");

  eq(NO_COMMISSION.total, 0, "the empty case is a value, so a profile needs no null check");
}

// --- 3. The roster, and the assumption made when there is none ----------------------------------
{
  eq(scheduleFrom(null), null, "no roster is null, not an empty one");
  eq(scheduleFrom({}), null, "and neither is an object with no days in it");
  ok(scheduleFrom({ "0": { active: true, start: "09:00", end: "17:00" } }) !== null, "one day is a roster");

  const stored = expectedScheduleFor({ "1": { active: true, start: "09:00", end: "17:00" } });
  eq(stored.assumed, false, "a real roster is not an assumption");
  eq(weeklyMinutes(stored.schedule), 480, "eight hours on one day");

  const assumed = expectedScheduleFor(undefined);
  eq(
    assumed.assumed,
    true,
    "no roster must be REPORTED as assumed — a screen that silently invented a wage is the bug this flag exists to prevent"
  );
  eq(weeklyMinutes(assumed.schedule), 5 * 8 * 60, "the clinic default is five eight-hour days");
  eq(Object.keys(defaultSchedule()).length, 7, "every day is present, so an unticked Friday is a decision rather than a missing key");
  eq(defaultSchedule()[5].active, false, "Friday is off by default — the Egyptian weekend");
  eq(defaultSchedule()[6].active, false, "and so is Saturday");
  eq(defaultSchedule()[0].active, true, "the week starts working on Sunday");

  eq(weeklyMinutes({ 0: { active: true, start: "21:00", end: "13:00" } }), 0, "a backwards day contributes nothing rather than a negative");
  eq(weeklyMinutes({ 0: { active: false, start: "09:00", end: "17:00" } }), 0, "an unticked day is not counted");

  eq(hoursText(0), "0h 0m", "nothing reads as zero rather than blank");
  eq(hoursText(95), "1h 35m", "and minutes carry into hours");
  eq(hoursText(-5), "0h 0m", "a negative is not printed");
}

// --- 3b. Extra time per shift agrees with the payroll engine -----------------------------------
// The profile asks "pay this extra time?" only under a shift that has some. If its per-shift figure
// drifted from the engine's, the owner would be asked about time the payslip does not count.
{
  const tz = "Africa/Cairo";
  // Cairo is UTC+3 in October 2026 (summer time); build instants from Cairo wall-clock times.
  const at = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+03:00`);
  const roster = defaultSchedule(); // Sun–Thu 13:00–21:00
  const shift = (id: string, ymd: string, from: string, to: string, overtimeStatus = "") => {
    const checkIn = at(ymd, from);
    let checkOut = at(ymd, to);
    if (checkOut < checkIn) checkOut = new Date(checkOut.getTime() + 864e5);
    return {
      id, userId: "u1", staffId: "s1", userName: "Hana", date: ymd, checkIn, checkOut,
      durationMinutes: Math.round((checkOut.getTime() - checkIn.getTime()) / 60000),
      status: "completed", overtimeStatus, checkInDistanceM: 10, checkInAccuracyM: 10, deviceId: "d",
    };
  };
  // 2026-10-04 is a Sunday, 2026-10-09 a Friday (day off).
  const punches = [
    shift("p1", "2026-10-04", "13:00", "21:00"), // on time: no extra
    shift("p2", "2026-10-05", "12:30", "22:00"), // 30 before + 60 after = 90 extra
    shift("p3", "2026-10-09", "10:00", "14:00"), // day off: all 240 extra
    shift("p4", "2026-10-06", "20:00", "01:00"), // past midnight: 240 extra
  ];
  eq(shiftOvertimeMinutes(punches[0], roster, tz), 0, "a shift inside the roster has no extra time to approve");
  eq(shiftOvertimeMinutes(punches[1], roster, tz), 90, "time before the start and after the end both count");
  eq(shiftOvertimeMinutes(punches[2], roster, tz), 240, "a shift on a day off is all extra time");
  eq(shiftOvertimeMinutes(punches[3], roster, tz), 240, "a shift running past midnight is not counted backwards");

  const { section } = buildHrSection({
    staff: [{ id: "s1", uid: "u1", name: "Hana", role: "Assistant", baseSalary: 8000, commissionPercentage: 0, overtimeMultiplier: 1.5, registeredDeviceId: "d", schedule: roster }],
    punches,
    startDate: "2026-10-01",
    endDate: "2026-10-10",
    today: "2026-10-11",
    nowMinutes: 600,
    timeZone: tz,
    geofenceRadiusM: 200,
    monthStart: "2026-10-01",
  });
  const perShift = punches.reduce((s, p) => s + shiftOvertimeMinutes(p, roster, tz), 0);
  eq(section.staff[0].overtimePendingMinutes, perShift, "the per-shift extra time adds up to the engine's pending overtime");
}

// --- 4. The page keeps the promises the libraries make ------------------------------------------
{
  const page = read("src/app/(dashboard)/team/page.tsx");
  ok(
    /commissionByStaff\(/.test(page),
    "the team page computes commission some other way — it has to add up the stored amounts, like Reports does, or a person's profile will disagree with the reports about their own money"
  );
  ok(
    /buildHrSection\(/.test(page),
    "the page keeps its own copy of the payroll sums instead of calling the one the nightly brief uses"
  );
  ok(
    /\.filter\(\(p\) => p\.userId\)/.test(page),
    "the attendance collection also holds patient waiting-room check-ins; without the userId filter they are counted as staff punches"
  );
  ok(/staffRecordFrom\(/.test(page) && /expectedScheduleFor\(/.test(page), "the page parses the staff document itself instead of using the adapter");
  ok(!/<PermissionGuard/.test(page), "a guard here needs a permission key that does not exist, which would lock the page for everyone including the owner");

  const profile = read("src/app/(dashboard)/team/StaffProfile.tsx");
  ok(/scheduleAssumed/.test(profile), "the profile does not say when it is assuming a roster");
  ok(/checkInDistanceM/.test(profile), "the profile does not show how far from the clinic a punch was taken");
  ok(
    /\/settings\/users/.test(profile),
    "permissions must be a LINK to the one editor with the server guards behind it, never a second copy"
  );

  ok(/"\/team"/.test(read("src/lib/aiNavigation.ts")), "the assistant cannot send anybody to the new page");
  ok(/source: "\/attendance\/team", destination: "\/team"/.test(read("next.config.ts")), "old links to /attendance/team (reports, bookmarks) would land on a 404");
  ok(/key: "team", href: "\/team"/.test(read("src/app/(dashboard)/layout.tsx")), "the team page has no entry in the top menu");
  ok(/"attendance", "team"/.test(read("src/components/dashboard/navGroups.ts")), "a nav key missing from every group is silently dropped from the menu");
  ok(
    /href="\/team"/.test(read("src/app/(dashboard)/attendance/page.tsx")),
    "there is no way into the new page from the screen the owner already uses"
  );
}

console.log(`staffProfile: ${checks} checks passed`);
