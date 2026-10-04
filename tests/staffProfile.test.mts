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
import XLSX from "xlsx-js-style";
import { commissionFileName, commissionWorkbook } from "../src/lib/staffCommissionXlsx";
import type { StaffInsuranceWork } from "../src/lib/staffInsurance";

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

// --- 2b. Insurance payments are not private commission ----------------------------------------
// The owner's screenshot (2026-10-04): a dentist with no private patients had a "Commission from
// each payment" table full of "MetLife Egypt paid - approval …" rows at 0%. The share for that
// work is earned on the approved amount and shown in its own table, so those rows only read as
// commission the dentist had been denied.
{
  const rows = [
    // The claims route stamps its own payments (insurer's cheque, patient's share) with claimId.
    { id: "ins1", type: "payment", date: "2026-10-04", doctorId: "s_hana", paid: 600, claimId: "metlife_D6925760", doctorCommissionPercentage: 0, doctorCommissionAmount: 0, description: "MetLife Egypt paid - approval D6925760" },
    { id: "ins2", type: "payment", date: "2026-10-04", doctorId: "s_hana", paid: 60, claimId: "metlife_D6925760", doctorCommissionAmount: 0 },
    // A payment taken in Finance on a treatment row written from an approval carries no claimId;
    // its treatment row does.
    { id: "chg1", type: "procedure", date: "2026-10-03", doctorId: "s_hana", claimId: "metlife_D7000104", cost: 60 },
    { id: "fin1", type: "payment", date: "2026-10-04", doctorId: "s_hana", paid: 20, procedureId: "chg1", doctorCommissionAmount: 0 },
    // …and when that treatment row is dated before the period, the claim names it instead.
    { id: "fin2", type: "payment", date: "2026-10-04", doctorId: "s_hana", paid: 30, procedureId: "chg_september", doctorCommissionAmount: 0 },
    // Private work is untouched.
    { id: "priv", type: "payment", date: "2026-10-02", doctorId: "s_hana", paid: 1000, procedureId: "chg2", doctorCommissionPercentage: 10, doctorCommissionAmount: 100 },
    { id: "blank", type: "payment", date: "2026-10-02", doctorId: "s_hana", paid: 500, claimId: "  ", doctorCommissionAmount: 50 },
    // A rate typed by hand on an insurer's payment is real money Reports already counts: it stays.
    { id: "byhand", type: "payment", date: "2026-10-04", doctorId: "s_hana", paid: 100, claimId: "metlife_D1", doctorCommissionPercentage: 10, doctorCommissionAmount: 10 },
  ];
  const hana = commissionByStaff(rows, STAFF, new Set(["chg_september"])).get("s_hana")!;
  eq(hana.entries.map((e) => e.id).sort(), ["blank", "byhand", "priv"], "only private payments are listed; a blank claimId is not a claim; a hand-set rate is kept");
  eq(hana.payments, 3, "and only they are counted");
  eq(hana.total, 160, "the total still agrees with Reports, which sums every stamped amount");

  const onlyInsurance = commissionByStaff(rows.slice(0, 2), STAFF);
  eq(onlyInsurance.has("s_hana"), false, "a dentist with only insurance payments has no private commission rows at all");

  const page = read("src/app/(dashboard)/team/page.tsx");
  ok(/c\.ledgerIds/.test(page) && /commissionByStaff\([^;]*insuranceRowIds\)/.test(page), "the page must hand the claims' treatment rows to the commission list, or a payment on an older approval reappears as 0% private work");
}

// --- 2c. The Excel download says what the page says --------------------------------------------
{
  const commission = commissionByStaff(
    [
      { id: "p2", type: "payment", date: "2026-10-03", doctorId: "s_hana", paid: 2000, labFee: 500, doctorCommissionPercentage: 20, doctorCommissionAmount: 300, patientName: "Mona", serviceName: "Crown" },
      { id: "p1", type: "payment", date: "2026-10-01", doctorId: "s_hana", paid: 1000, doctorCommissionPercentage: 10, doctorCommissionAmount: 100, patientName: "Ahmed", serviceName: "Filling" },
      { id: "old", type: "payment", date: "2026-10-02", doctorId: "s_hana", paid: 400, patientName: "Old", serviceName: "Scaling" },
    ],
    STAFF,
  ).get("s_hana")!;
  const insurance: StaffInsuranceWork = {
    total: 30,
    approved: 300,
    entries: [
      { claimId: "c1", lineIndex: 0, date: "2026-10-03", patientName: "ميرنا", payerId: "metlife", approvalNumber: "D6925760", service: "كشف", approved: 60, rate: 10, share: 6 },
      { claimId: "c1", lineIndex: 1, date: "2026-10-03", patientName: "ميرنا", payerId: "metlife", approvalNumber: "D6925760", service: "علاج لثة", approved: 240, rate: 10, share: 24 },
    ],
  };
  // Read the BYTES back: the library drops some settings on write, so the in-memory object proves nothing.
  const readBack = (isAr: boolean, c = commission, i = insurance) => {
    const buf = XLSX.write(commissionWorkbook({ dentistName: "Dr. Hana", start: "2026-10-01", end: "2026-10-04", commission: c, insurance: i, isAr }), { type: "buffer", bookType: "xlsx" });
    const wb = XLSX.read(buf, { type: "buffer", cellFormula: true, cellNF: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
    return { wb, ws, grid };
  };

  const { wb, ws, grid } = readBack(false);
  const rowOf = (label: string, from = 0) => grid.findIndex((r, i) => i >= from && r[0] === label);
  eq(grid[0][0], "Commission — Dr. Hana", "the sheet says whose commission it is");
  eq(grid[1][0], "Period: 01/10/2026 to 04/10/2026", "and for which days");

  const privHead = rowOf("Date");
  eq(grid[privHead], ["Date", "Patient", "Treatment", "Lab fee", "Paid", "%", "Their share"], "private columns, in order");
  eq(grid.slice(privHead + 1, privHead + 4).map((r) => r[1]), ["Ahmed", "Old", "Mona"], "oldest payment first, like a statement");
  eq(grid[privHead + 1][0], 46296, "the date is a real Excel date (1 Oct 2026), not text, so it sorts and filters");
  eq(ws[XLSX.utils.encode_cell({ r: privHead + 1, c: 0 })].z, "dd/mm/yyyy", "and it is shown day first, the way the clinic writes dates");
  eq(grid[privHead + 2][5], "—", "a payment from before rates were stamped says so rather than claiming 0%");
  eq(grid[privHead + 3].slice(3), [500, 2000, 20, 300], "lab fee, paid, rate and share are numbers, as stored");
  const privTotal = rowOf("Total");
  eq([grid[privTotal][4], grid[privTotal][6]], [3400, 400], "the private total matches the page");
  eq(ws[XLSX.utils.encode_cell({ r: privTotal, c: 6 })].f, `SUM(G${privHead + 2}:G${privHead + 4})`, "and is a live SUM over its rows");

  const insHead = rowOf("Date", privTotal);
  eq(grid[insHead], ["Date", "Patient", "Service", "Approval no.", "Approved", "%", "Their share"], "insurance columns line up: amount, rate, share in the same places");
  eq(grid[insHead + 2].slice(2), ["علاج لثة", "D6925760", 240, 10, 24], "an insurance line is the one on the page");
  const insTotal = rowOf("Total", insHead);
  eq([grid[insTotal][4], grid[insTotal][6]], [300, 30], "the insurance total matches the page");

  const grand = rowOf("Total commission");
  eq(grid[grand][6], 430, "the bottom line is private plus insurance");
  eq(ws[XLSX.utils.encode_cell({ r: grand, c: 6 })].f, `G${privTotal + 1}+G${insTotal + 1}`, "and adds the two totals rather than a typed figure");
  ok(!wb.Workbook?.Views?.[0]?.RTL, "an English sheet reads left to right");

  const ar = readBack(true);
  eq(ar.wb.Workbook?.Views?.[0]?.RTL, true, "an Arabic sheet opens right to left");
  eq(ar.grid[0][0], "عمولة Dr. Hana", "with Arabic headings");

  // The owner's case: insurance work, no private payments. The file must still be worth opening.
  const only = readBack(false, { total: 0, payments: 0, entries: [] }).grid;
  ok(only.some((r) => r[0] === "No private payments in this period."), "an empty private half says so instead of printing an empty table");
  eq(only.find((r) => r[0] === "Total commission")![6], 30, "and the bottom line is the insurance share");
  const noInsurance = readBack(false, commission, { total: 0, approved: 0, entries: [] }).grid;
  ok(!noInsurance.some((r) => r[0] === "Insurance work"), "no insurance heading when there is no insurance work, as on the page");

  eq(commissionFileName("Dr. Hana Mostafa", "2026-10-01", "2026-10-04"), "commission-dr-hana-mostafa-2026-10-01-to-2026-10-04.xlsx", "a readable ASCII file name");
  eq(commissionFileName("د. أحمد", "2026-10-01", "2026-10-31"), "commission-2026-10-01-to-2026-10-31.xlsx", "an Arabic name drops out rather than becoming a row of dashes");
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
