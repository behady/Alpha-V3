// The arithmetic behind the daily and weekly brief.
//
// These are the figures an owner acts on and a payroll conversation starts from, so the cases
// below pin the three that are easiest to get quietly wrong:
//
//   1. Double-counted revenue. A payment against a procedure is its own ledger row, and the
//      procedure row's `paid` field is a rollup of those payments. Summing both inflates the day's
//      takings by exactly the amount collected — a bug that makes the clinic look twice as good as
//      it is and would never be noticed from the number alone.
//   2. Lateness read on the wrong clock. Punches are stored as instants; the server runs on UTC.
//      Reading the hour off the server clock makes a Cairo receptionist who arrived at 13:00 look
//      two hours early, or two hours late, depending on the season.
//   3. Absence claimed before a shift has begun. An owner opening the brief at nine must not see
//      the evening shift marked absent.
//
// Run with tsx so the TS modules load directly: npm run test:briefing
import assert from "node:assert/strict";
import { buildMoneySection, buildProductionSection } from "../src/lib/automation/briefing/money";
import { buildHrSection, rosteredOn } from "../src/lib/automation/briefing/hr";
import { buildStaleBalances, buildGrowthSection } from "../src/lib/automation/briefing/operations";
import { resolveBriefingAccess, briefingWindow } from "../src/lib/automation/briefing/build";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const TZ = "Africa/Cairo";

type Row = Parameters<typeof buildMoneySection>[0]["rows"][number];

const ledgerRow = (over: Partial<Row>): Row => ({
  id: "r",
  type: "payment",
  date: "2026-08-25",
  description: "",
  category: "General",
  method: "Cash",
  patientId: "p1",
  patientName: "Patient",
  doctorId: "",
  doctorName: "",
  amount: 0,
  paid: 0,
  cost: 0,
  discountAmount: 0,
  labFee: 0,
  doctorCommissionAmount: 0,
  clinicProfit: 0,
  ...over,
});

const moneyArgs = (rows: Row[]) => ({
  rows,
  startDate: "2026-08-25",
  endDate: "2026-08-25",
  previousStart: "2026-08-24",
  previousEnd: "2026-08-24",
  previousLabel: "2026-08-24",
  sameWeekday: "2026-08-18",
});

console.log("money");

check("a procedure paid in full is counted once, not twice", () => {
  // 1000 charged, 1000 paid. The procedure row carries the rollup; the payment row carries the cash.
  const section = buildMoneySection(
    moneyArgs([
      ledgerRow({ id: "proc", type: "procedure", cost: 1000, paid: 1000 }),
      ledgerRow({ id: "pay", type: "payment", paid: 1000 }),
    ])
  );
  assert.equal(section.collected, 1000);
  assert.equal(section.billedUnpaid, 0);
});

check("work billed but only part-paid shows the remainder as receivable", () => {
  const section = buildMoneySection(
    moneyArgs([
      ledgerRow({ id: "proc", type: "procedure", cost: 1000, paid: 400 }),
      ledgerRow({ id: "pay", type: "payment", paid: 400 }),
    ])
  );
  assert.equal(section.collected, 400);
  assert.equal(section.billedUnpaid, 600);
});

check("expenses reduce net cash but never the collected figure", () => {
  const section = buildMoneySection(
    moneyArgs([
      ledgerRow({ type: "payment", paid: 1000 }),
      ledgerRow({ id: "e", type: "expense", cost: 250, category: "Lab" }),
    ])
  );
  assert.equal(section.collected, 1000);
  assert.equal(section.expenses, 250);
  assert.equal(section.netCash, 750);
  assert.deepEqual(
    section.expensesByCategory.map((c) => c.category),
    ["Lab"]
  );
});

check("a comparison period with no rows reads as unknown, not as zero", () => {
  const section = buildMoneySection(moneyArgs([ledgerRow({ type: "payment", paid: 500 })]));
  // Nothing on 2026-08-24 at all — a closed day must not be reported as "down 100%".
  assert.equal(section.comparison.previousCollected, null);
  assert.equal(section.comparison.sameWeekdayCollected, null);
});

check("a comparison period that exists is summed", () => {
  const section = buildMoneySection(
    moneyArgs([
      ledgerRow({ type: "payment", paid: 500 }),
      ledgerRow({ id: "y", type: "payment", paid: 300, date: "2026-08-24" }),
    ])
  );
  assert.equal(section.comparison.previousCollected, 300);
});

console.log("production");

const appt = (over: Record<string, unknown> = {}) => ({
  id: "a",
  date: "2026-08-25",
  time: "10:00 AM",
  patientId: "p1",
  patientName: "Patient",
  doctor: "Dr Ahmed",
  treatment: "",
  status: "Completed",
  duration: 30,
  ...over,
});

const schedule = {
  startHour: 9,
  startMinute: 0,
  endHour: 17,
  endMinute: 0,
  slotDuration: 30,
  offDays: [],
  isConfigured: true,
};

check("collections with no doctor are reported separately, not folded into a name", () => {
  const { section, unattributedCollected } = buildProductionSection({
    appointments: [appt()],
    rows: [
      ledgerRow({ type: "payment", paid: 600, doctorName: "Dr Ahmed" }),
      ledgerRow({ id: "orphan", type: "payment", paid: 400, doctorName: "" }),
    ],
    startDate: "2026-08-25",
    endDate: "2026-08-25",
    schedule,
    includeGap: true,
  });

  assert.equal(unattributedCollected, 400);
  assert.equal(section.doctors.length, 1);
  assert.equal(section.doctors[0].collected, 600);
  // Per-patient revenue still counts every pound, including the unattributed one.
  assert.equal(section.revenuePerPatientSeen, 1000);
});

check("doctor names differing only by spacing and case are one doctor", () => {
  const { section } = buildProductionSection({
    appointments: [appt({ doctor: "Dr  AHMED" })],
    rows: [
      ledgerRow({ type: "payment", paid: 100, doctorName: "Dr Ahmed" }),
      ledgerRow({ id: "b", type: "payment", paid: 100, doctorName: "dr ahmed" }),
    ],
    startDate: "2026-08-25",
    endDate: "2026-08-25",
    schedule,
    includeGap: false,
  });
  assert.equal(section.doctors.length, 1);
  assert.equal(section.doctors[0].collected, 200);
  assert.equal(section.doctors[0].patientsSeen, 1);
});

check("chair utilisation is blank when the clinic never set its hours", () => {
  const { section } = buildProductionSection({
    appointments: [appt()],
    rows: [],
    startDate: "2026-08-25",
    endDate: "2026-08-25",
    schedule: { ...schedule, isConfigured: false },
    includeGap: true,
  });
  assert.equal(section.chairUtilisation, null);
});

check("chair utilisation divides booked minutes by open minutes", () => {
  // Open 09:00-17:00 = 480 minutes. Two 60-minute appointments = 120 = 25%.
  const { section } = buildProductionSection({
    appointments: [appt({ duration: 60 }), appt({ id: "b", time: "02:00 PM", duration: 60 })],
    rows: [],
    startDate: "2026-08-25",
    endDate: "2026-08-25",
    schedule,
    includeGap: true,
  });
  assert.equal(section.chairUtilisation?.openMinutes, 480);
  assert.equal(section.chairUtilisation?.bookedMinutes, 120);
  assert.equal(section.chairUtilisation?.percent, 25);
});

check("a cancelled appointment occupies no chair time", () => {
  const { section } = buildProductionSection({
    appointments: [appt({ duration: 60, status: "Cancelled" })],
    rows: [],
    startDate: "2026-08-25",
    endDate: "2026-08-25",
    schedule,
    includeGap: true,
  });
  assert.equal(section.chairUtilisation?.bookedMinutes, 0);
});

console.log("the floor");

/** 2026-08-25 is a Tuesday. Cairo is UTC+3 in August (summer time). */
const TUESDAY = "2026-08-25";
const at = (hhmm: string, day = TUESDAY) => {
  const [h, m] = hhmm.split(":").map(Number);
  // Build the instant that reads as hh:mm in Cairo: subtract the +3 offset.
  return new Date(`${day}T${String(h - 3).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
};

const staffMember = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  uid: "u1",
  name: "Mona",
  role: "Receptionist",
  baseSalary: 8000,
  commissionPercentage: 0,
  overtimeMultiplier: 1.5,
  registeredDeviceId: "device-1",
  // Tuesday active, 13:00-21:00 — the app's own default shape.
  schedule: { 2: { active: true, start: "13:00", end: "21:00" } },
  ...over,
});

const punch = (over: Record<string, unknown> = {}) => ({
  id: "pn1",
  userId: "u1",
  staffId: "s1",
  userName: "Mona",
  date: TUESDAY,
  checkIn: at("13:00"),
  checkOut: at("21:00"),
  durationMinutes: 480,
  status: "completed",
  overtimeStatus: "",
  checkInDistanceM: 10,
  checkInAccuracyM: 20,
  deviceId: null,
  ...over,
});

const hrArgs = (over: Record<string, unknown> = {}) => ({
  staff: [staffMember()],
  punches: [punch()],
  startDate: TUESDAY,
  endDate: TUESDAY,
  today: TUESDAY,
  nowMinutes: 22 * 60,
  timeZone: TZ,
  geofenceRadiusM: 50,
  monthStart: "2026-08-01",
  ...over,
});

check("arriving on time is not late, read on the clinic's clock rather than the server's", () => {
  // 13:00 Cairo is 10:00 UTC. A server reading its own clock would call this four hours early.
  const { section } = buildHrSection(hrArgs() as Parameters<typeof buildHrSection>[0]);
  assert.equal(section.staff[0].lateDays, 0);
  assert.equal(section.staff[0].lateMinutes, 0);
  assert.equal(section.staff[0].minutesWorked, 480);
});

check("arriving forty minutes after the shift start is late by forty minutes", () => {
  const { section } = buildHrSection(
    hrArgs({
      punches: [punch({ checkIn: at("13:40"), durationMinutes: 440 })],
    }) as Parameters<typeof buildHrSection>[0]
  );
  assert.equal(section.staff[0].lateDays, 1);
  assert.equal(section.staff[0].lateMinutes, 40);
});

check("a three-minute overshoot is imprecision, not lateness", () => {
  const { section } = buildHrSection(
    hrArgs({ punches: [punch({ checkIn: at("13:03") })] }) as Parameters<typeof buildHrSection>[0]
  );
  assert.equal(section.staff[0].lateDays, 0);
});

check("the evening shift is not absent at nine in the morning", () => {
  const { section } = buildHrSection(
    hrArgs({ punches: [], nowMinutes: 9 * 60 }) as Parameters<typeof buildHrSection>[0]
  );
  assert.equal(section.staff[0].absentDays, 0);
});

check("the same missing punch is an absence once the shift is well under way", () => {
  const { section } = buildHrSection(
    hrArgs({ punches: [], nowMinutes: 16 * 60 }) as Parameters<typeof buildHrSection>[0]
  );
  assert.equal(section.staff[0].absentDays, 1);
});

check("someone with no schedule is never judged late or absent", () => {
  const { section } = buildHrSection(
    hrArgs({
      staff: [staffMember({ schedule: null })],
      punches: [punch({ checkIn: at("18:00"), durationMinutes: 120 })],
    }) as Parameters<typeof buildHrSection>[0]
  );
  assert.equal(section.staff[0].hasSchedule, false);
  assert.equal(section.staff[0].lateDays, 0);
  assert.equal(section.staff[0].absentDays, 0);
  assert.equal(section.withoutSchedule, 1);
});

check("overtime nobody has reviewed is pending, not assumed approved", () => {
  // 13:00-23:00 against a 13:00-21:00 roster: 8h regular, 2h overtime.
  const { section } = buildHrSection(
    hrArgs({
      punches: [punch({ checkOut: at("23:00"), durationMinutes: 600 })],
    }) as Parameters<typeof buildHrSection>[0]
  );
  assert.equal(section.staff[0].overtimePendingMinutes, 120);
  assert.equal(section.staff[0].overtimeApprovedMinutes, 0);
  assert.ok(section.overtimePendingCost > 0);
  // Pending overtime is not in the pay estimate — only the eight rostered hours are.
  // The fixture rosters one 8-hour day a week, so expected monthly hours are (480 × 52) / 60 / 12.
  const hourly = 8000 / ((480 * 52) / (12 * 60));
  assert.ok(Math.abs(section.staff[0].estimatedPay - 8 * hourly) < 1);
});

check("approved overtime is paid at the multiplier", () => {
  const base = buildHrSection(hrArgs() as Parameters<typeof buildHrSection>[0]).section.staff[0].estimatedPay;
  const { section } = buildHrSection(
    hrArgs({
      punches: [punch({ checkOut: at("23:00"), durationMinutes: 600, overtimeStatus: "approved" })],
    }) as Parameters<typeof buildHrSection>[0]
  );
  const hourly = base / 8;
  assert.ok(Math.abs(section.staff[0].estimatedPay - (base + 2 * hourly * 1.5)) < 1);
});

check("a shift left open on a day that has ended is flagged, not counted as still working", () => {
  const { section } = buildHrSection(
    hrArgs({
      startDate: "2026-08-24",
      punches: [punch({ date: "2026-08-24", status: "active", checkOut: null, durationMinutes: 0 })],
    }) as Parameters<typeof buildHrSection>[0]
  );
  assert.equal(section.openShifts, 1);
  assert.equal(section.onFloorNow, 0);
});

check("staff with no registered device are flagged", () => {
  const { section } = buildHrSection(
    hrArgs({ staff: [staffMember({ registeredDeviceId: null })] }) as Parameters<typeof buildHrSection>[0]
  );
  assert.ok(section.staff[0].flags.includes("no_device_registered"));
});

check("the roster reads the same schedule the absence check reads", () => {
  assert.deepEqual(rosteredOn([staffMember()] as Parameters<typeof rosteredOn>[0], TUESDAY), ["Mona"]);
  // Wednesday is not configured active.
  assert.deepEqual(rosteredOn([staffMember()] as Parameters<typeof rosteredOn>[0], "2026-08-26"), []);
});

console.log("balances");

check("a balance is charged minus paid, and quiet only after the threshold", () => {
  const rows = [
    ledgerRow({ id: "p", type: "procedure", cost: 1000, date: "2026-01-10", patientId: "p1" }),
    ledgerRow({ id: "q", type: "payment", paid: 200, date: "2026-01-10", patientId: "p1" }),
  ];
  const { balances, total } = buildStaleBalances(rows, new Map([["p1", "Sara"]]), "2026-08-25");
  assert.equal(balances.length, 1);
  assert.equal(balances[0].balance, 800);
  assert.equal(balances[0].patientName, "Sara");
  assert.equal(total, 800);
});

check("an account touched last week is not quiet", () => {
  const rows = [
    ledgerRow({ id: "p", type: "procedure", cost: 1000, date: "2026-08-20", patientId: "p1" }),
  ];
  const { balances } = buildStaleBalances(rows, new Map(), "2026-08-25");
  assert.equal(balances.length, 0);
});

check("a settled account never appears, however long ago it was settled", () => {
  const rows = [
    ledgerRow({ id: "p", type: "procedure", cost: 1000, date: "2026-01-10", patientId: "p1" }),
    ledgerRow({ id: "q", type: "payment", paid: 1000, date: "2026-01-10", patientId: "p1" }),
  ];
  const { balances } = buildStaleBalances(rows, new Map(), "2026-08-25");
  assert.equal(balances.length, 0);
});

console.log("growth");

check("new patients and leads are counted on the clinic's calendar", () => {
  const growth = buildGrowthSection({
    // 2026-08-25T22:30Z is already the 26th in Cairo.
    patientCreatedAt: new Map([
      ["p1", new Date("2026-08-25T10:00:00Z")],
      ["p2", new Date("2026-08-25T22:30:00Z")],
    ]),
    leads: [
      {
        id: "l1",
        name: "Ali",
        source: "Instagram",
        stage: "won",
        followUpDate: "",
        patientId: "p1",
        createdAt: new Date("2026-08-25T10:00:00Z"),
      },
      {
        id: "l2",
        name: "Old",
        source: "Walk-in",
        stage: "new",
        followUpDate: "",
        patientId: "",
        createdAt: new Date("2026-07-01T10:00:00Z"),
      },
    ],
    startDate: "2026-08-25",
    endDate: "2026-08-25",
    timeZone: TZ,
  });

  assert.equal(growth.newPatients, 1);
  assert.equal(growth.newLeads, 1);
  assert.equal(growth.leadsConverted, 1);
  assert.equal(growth.leadsUntouched, 1);
  assert.deepEqual(growth.leadsBySource, [{ source: "Instagram", count: 1 }]);
});

console.log("access");

check("an admin sees everything", () => {
  assert.deepEqual(resolveBriefingAccess("Admin", []), { money: true, hr: true });
});

check("a receptionist with neither permission sees neither section", () => {
  assert.deepEqual(resolveBriefingAccess("Receptionist", ["access.patients"]), { money: false, hr: false });
});

check("finance access alone opens money and nothing else", () => {
  assert.deepEqual(resolveBriefingAccess("Dentist", ["access.finance"]), { money: true, hr: false });
});

check("either attendance.admin or full settings opens the floor", () => {
  assert.equal(resolveBriefingAccess("Dentist", ["attendance.admin"]).hr, true);
  assert.equal(resolveBriefingAccess("Dentist", ["access.settings"]).hr, true);
});

// This assertion is inverted from how it was originally written, and deliberately.
//
// The brief was built against a `hasPermission` that treated a missing permission list as "not
// migrated yet, allow it". That branch was the only one anyone ever took, because nothing wrote
// `clinicPermissions` at the time — so every permission check in the app passed, for everybody,
// always, and the checkboxes on the Users screen only hid buttons in the browser. `permissions.ts`
// has since closed that hole to match firestore.rules: a missing list is an account nobody has
// granted anything, and the safe reading of that is nothing. Admins never consult a list at all,
// so no owner can be locked out of their own clinic by this.
//
// Reverting it would put the clinic's revenue and its staff's lateness in front of whoever opened
// the brief, which is the one place that failure would be least visible.
check("a user with no per-clinic permission record is granted nothing, as the rules now say", () => {
  assert.deepEqual(resolveBriefingAccess("Receptionist", null), { money: false, hr: false });
});

check("an admin is unaffected by a missing permission record", () => {
  assert.deepEqual(resolveBriefingAccess("Admin", null), { money: true, hr: true });
});

// --- 4. Which days a brief covers, and which it compares against ---------------------------------
//
// The owner's home asks for "this month". Month-to-date on the 12th must compare with the 1st to
// the 12th of last month, not with all of last month — or every month reads as a collapse until
// its final day.

check("a day compares with the same weekday last week", () => {
  const w = briefingWindow("day", "2026-09-09");
  assert.equal(w.startDate, "2026-09-09");
  assert.equal(w.sameWeekday, "2026-09-02");
  assert.equal(w.comparisonStart, "2026-09-02");
  assert.equal(w.aheadEnd, "2026-09-10");
});

check("a week is the seven days ending today, against the seven before", () => {
  const w = briefingWindow("week", "2026-09-09");
  assert.equal(w.startDate, "2026-09-03");
  assert.deepEqual([w.previousStart, w.previousEnd], ["2026-08-27", "2026-09-02"]);
  assert.equal(w.sameWeekday, null);
  assert.equal(w.aheadEnd, "2026-09-16");
});

check("a month is month-to-date, against the same number of days at the start of last month", () => {
  const w = briefingWindow("month", "2026-09-12");
  assert.equal(w.startDate, "2026-09-01");
  assert.deepEqual([w.previousStart, w.previousEnd], ["2026-08-01", "2026-08-12"]);
  assert.equal(w.comparisonStart, "2026-08-01", "the ledger read starts where the comparison does");
  assert.equal(w.previousLabel, "2026-08-01 – 2026-08-12");
});

check("a month-to-date longer than last month is clamped to last month's end", () => {
  const w = briefingWindow("month", "2026-03-31");
  assert.deepEqual([w.previousStart, w.previousEnd], ["2026-02-01", "2026-02-28"]);
});

console.log(`\n${passed} checks passed`);
