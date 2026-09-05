// The arithmetic behind the dentist's own report.
//
// Four things these pin, because each would misstate a dentist's work quietly:
//
//   1. The week. The clinic's week starts Saturday. A Monday week puts Saturday's patients in
//      the wrong bar, and "this week" opens on the wrong day.
//   2. Empty buckets. A month with no work on the 14th still has a 14th; a chart that skips it
//      draws a false slope between the 13th and the 15th.
//   3. Whose money. Another dentist's rows in the same period must not leak into these bars.
//   4. Who is new. A patient is new because they joined the clinic during the period, not
//      because this is the first time this dentist saw them.
//
// Run with tsx so the TS modules load directly: npm run test:dentist-report
import assert from "node:assert/strict";
import {
  weekStart, ymdAdd, periodFor, bucketKey, bucketsFor, moneyByBucket, attendanceByBucket, noShowRate,
  procedureMix, toYmd, patientsByBucket, reportTotals,
} from "../src/lib/dentistReport";
import type { DentistIdentity } from "../src/lib/dentistHome";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}

const me: DentistIdentity = { staffId: "st_nour", name: "Dr. Nour", commissionPct: 40 };
const TODAY = "2026-09-05"; // a Saturday

// --- 1. The week -----------------------------------------------------------------------------------

eq(weekStart("2026-09-05"), "2026-09-05", "a Saturday starts its own week");
eq(weekStart("2026-09-06"), "2026-09-05", "Sunday belongs to the Saturday before it");
eq(weekStart("2026-09-11"), "2026-09-05", "so does Friday, the last day");
eq(weekStart("2026-09-12"), "2026-09-12", "and the next Saturday opens the next week");
eq(ymdAdd("2026-08-31", 1), "2026-09-01", "day arithmetic crosses a month end");
eq(ymdAdd("2026-03-01", -1), "2026-02-28", "and a month start, in a non-leap year");

{
  const w = periodFor("week", "2026-09-09"); // a Wednesday
  eq([w.start, w.end, w.bucket], ["2026-09-05", "2026-09-11", "day"], "this week = Saturday to Friday, by day");
  const m = periodFor("month", "2026-02-10");
  eq([m.start, m.end, m.bucket], ["2026-02-01", "2026-02-28", "day"], "this month, by day, to its real last day");
  const q = periodFor("quarter", "2026-09-05");
  eq([q.start, q.end, q.bucket], ["2026-07-01", "2026-09-30", "week"], "last three months, by week");
  const y = periodFor("year", "2026-09-05");
  eq([y.start, y.end, y.bucket], ["2026-01-01", "2026-12-31", "month"], "this year, by month");
}

eq(bucketKey("2026-09-09", "day"), "2026-09-09", "day key");
eq(bucketKey("2026-09-09", "week"), "2026-09-05", "week key is the Saturday");
eq(bucketKey("2026-09-09", "month"), "2026-09", "month key");

// --- 2. Empty buckets are still buckets ---------------------------------------------------------------

{
  const week = bucketsFor(periodFor("week", TODAY));
  eq(week.length, 7, "seven days in a week, worked or not");
  eq(week.map((b) => b.label), ["5", "6", "7", "8", "9", "10", "11"], "day buckets are labelled by day of month");
  const quarter = bucketsFor(periodFor("quarter", TODAY));
  eq(quarter[0].key, "2026-06-27", "the first week bucket is the Saturday on or before July 1st");
  eq(quarter.at(-1)?.key, "2026-09-26", "and the last is the Saturday on or before September 30th");
  eq(bucketsFor(periodFor("year", TODAY), true).map((b) => b.label).slice(0, 2), ["يناير", "فبراير"], "Arabic month names");
}

// --- 3. Money, mine only, per bucket ---------------------------------------------------------------------

const ledger = [
  { id: "p1", type: "procedure", doctorId: "st_nour", amount: 3000, date: "2026-09-01", serviceName: "Crown" },
  { id: "pay1", type: "payment", doctorId: "st_nour", procedureId: "p1", paid: 1000, amount: 0, date: "2026-09-01", doctorCommissionAmount: 400 },
  { id: "p2", type: "procedure", doctorId: "st_nour", amount: 800, date: "2026-09-03", description: "Filling 25" },
  { id: "pay2", type: "payment", doctorId: "st_nour", procedureId: "p2", paid: 800, date: "2026-09-03", labFee: 100 }, // 40% of 700 = 280
  { id: "p3", type: "procedure", doctorId: "st_omar", amount: 9000, date: "2026-09-03", serviceName: "Implant" },
  { id: "pay3", type: "payment", doctorId: "st_omar", procedureId: "p3", paid: 9000, date: "2026-09-03", doctorCommissionAmount: 3000 },
  { id: "p4", type: "procedure", doctorId: "st_nour", amount: 500, date: "2026-08-30", serviceName: "Scaling" }, // last month
  { id: "x1", type: "expense", cost: 999, date: "2026-09-03" },
];
{
  const money = moneyByBucket(ledger, me, periodFor("week", TODAY));
  // TODAY is Saturday 5 Sep; the week is 5..11 Sep — the September 1st and 3rd rows are last week.
  eq(money.every((p) => p.charged === 0 && p.collected === 0), true, "nothing of mine falls in this week");
  const month = moneyByBucket(ledger, me, periodFor("month", TODAY));
  const d1 = month.find((p) => p.key === "2026-09-01")!;
  const d3 = month.find((p) => p.key === "2026-09-03")!;
  eq([d1.charged, d1.collected, d1.share], [3000, 1000, 400], "1 Sep: charged the crown, collected 1000, stored share");
  eq([d3.charged, d3.collected, d3.share], [800, 800, 280], "3 Sep: Omar's implant is not mine; the share is recomputed after the lab fee");
  eq(month.find((p) => p.key === "2026-09-14")!.charged, 0, "a quiet day is a zero, not a missing bar");
  eq(month.length, 30, "September has thirty bars");
}

// --- 4. Attendance -------------------------------------------------------------------------------------------

const appts = [
  { id: "a1", doctorId: "st_nour", patientId: "pt1", date: "2026-09-01", status: "Completed" },
  { id: "a2", doctorId: "st_nour", patientId: "pt2", date: "2026-09-01", status: "No Show" },
  { id: "a3", doctorId: "st_nour", patientId: "pt3", date: "2026-09-02", status: "Cancelled" },
  { id: "a4", doctorId: "st_nour", patientId: "pt1", date: "2026-09-02", status: "Checking Out" },
  { id: "a5", doctorId: "st_nour", patientId: "pt4", date: "2026-09-20", status: "Confirmed" }, // future, undecided
  { id: "a6", doctorId: "st_omar", patientId: "pt9", date: "2026-09-01", status: "Completed" },
  { id: "a7", doctor: "Dr. Nour", patientId: "pt5", date: "2026-09-04", status: "Completed" }, // old row, name only
];
{
  const att = attendanceByBucket(appts, me, periodFor("month", TODAY));
  const d1 = att.find((p) => p.key === "2026-09-01")!;
  eq([d1.seen, d1.noShow, d1.cancelled], [1, 1, 0], "1 Sep: one seen, one no-show; Omar's does not count");
  const d2 = att.find((p) => p.key === "2026-09-02")!;
  eq([d2.seen, d2.noShow, d2.cancelled], [1, 0, 1], "2 Sep: checking out counts as seen");
  eq(att.find((p) => p.key === "2026-09-04")!.seen, 1, "a row keyed by name only still counts");
  eq(att.find((p) => p.key === "2026-09-20")!.seen, 0, "a future confirmed booking is not an outcome");
  eq(noShowRate(att), 1 / 4, "no-show rate = missed / (seen + missed)");
  eq(noShowRate([]), null, "no decided bookings, no rate");
}

// --- 5. Procedure mix -----------------------------------------------------------------------------------------

{
  const many = [
    ...ledger,
    ...["A", "B", "C", "D", "E", "F"].map((n, i) => ({ id: `m${i}`, type: "procedure", doctorId: "st_nour", amount: 100 - i, date: "2026-09-02", serviceName: n })),
  ];
  const mix = procedureMix(many, me, periodFor("month", TODAY), "Other");
  eq(mix.map((s) => s.name), ["Crown", "Filling 25", "A", "B", "C", "Other"], "top five by money, then Other");
  eq(mix.at(-1), { name: "Other", count: 3, amount: 100 - 3 + 100 - 4 + 100 - 5, other: true }, "Other carries the tail's count and money");
  eq(mix[1].name, "Filling 25", "a free-text description names the slice when there is no service");
  ok(!mix.some((s) => s.name === "Implant" || s.name === "Scaling"), "not Omar's implant, not last month's scaling");
}

// --- 6. Patients, new vs returning ------------------------------------------------------------------------------

eq(toYmd("2026-09-01T10:00:00.000Z"), "2026-09-01", "an ISO string");
eq(toYmd({ toMillis: () => new Date(2026, 8, 3, 12).getTime() }), "2026-09-03", "a Firestore timestamp");
eq(toYmd(undefined), "", "nothing");

{
  const created = new Map([
    ["pt1", "2026-09-01"], // joined this month
    ["pt5", "2024-01-01"], // old patient
    // pt2, pt3 have no record date
  ]);
  const pts = patientsByBucket(appts, created, me, periodFor("month", TODAY));
  const d1 = pts.find((p) => p.key === "2026-09-01")!;
  eq([d1.newPatients, d1.returning], [1, 0], "1 Sep: pt1 seen and new; the no-show is not a patient seen");
  const d2 = pts.find((p) => p.key === "2026-09-02")!;
  eq([d2.newPatients, d2.returning], [1, 0], "2 Sep: pt1 again — new again in a new bucket, and the cancellation is nobody");
  const d4 = pts.find((p) => p.key === "2026-09-04")!;
  eq([d4.newPatients, d4.returning], [0, 1], "4 Sep: an old patient returning");
  const totals = reportTotals(moneyByBucket(ledger, me, periodFor("month", TODAY)), attendanceByBucket(appts, me, periodFor("month", TODAY)), pts);
  // seen = a1 (Completed) + a4 (Checking Out) + a7 (name-only Completed); the no-show, the
  // cancellation, the future booking and Omar's patient are not.
  eq([totals.charged, totals.collected, totals.share, totals.seen, totals.patients, totals.newPatients], [3800, 1800, 680, 3, 3, 2], "the tiles add up the same slices the charts draw");
  eq(totals.noShowRate, 0.25, "and carry the rate");
}

console.log(`dentistReport: ${checks} checks passed`);
