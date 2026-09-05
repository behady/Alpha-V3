// The arithmetic and the ordering behind a dentist's home screen.
//
// Every figure on that screen is money or a patient's name in front of a dentist, so these pin
// the ways it could quietly say the wrong thing:
//
//   1. Another dentist's patient, money or lab case appearing as mine. Rows are matched on the
//      staff id, and only fall back to the display name when no id was ever written.
//   2. A payment read as free. Several write paths store a placeholder `0` in the field they do
//      not use, so the money must be read the way the debtors list reads it, not with `??`.
//   3. The wrong "next" patient. A patient in the waiting room outranks one who has not arrived,
//      whatever their booked times.
//   4. A mid-treatment patient listed as forgotten when someone already booked them.
//
// Run with tsx so the TS modules load directly: npm run test:dentist
import assert from "node:assert/strict";
import {
  isMine, isDone, sortDay, pickChair, waitingMinutes, rowMoney, moneyToday, owedByMyPatients,
  owedByPatient, labReturns, openPlans, daysBetween, type DentistIdentity,
} from "../src/lib/dentistHome";

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const me: DentistIdentity = { staffId: "st_nour", name: "Dr. Nour Adel", commissionPct: 40 };
const other: DentistIdentity = { staffId: "st_omar", name: "Dr. Omar", commissionPct: 30 };
const TODAY = "2026-09-05";

// --- 1. Whose row is it ---------------------------------------------------------------------------

ok(isMine({ doctorId: "st_nour" }, me), "the staff id is the match");
ok(!isMine({ doctorId: "st_omar", doctor: "Dr. Nour Adel" }, me), "an id that disagrees with the name wins over the name");
ok(isMine({ doctor: "dr. nour adel " }, me), "no id at all: the display name matches, case- and space-insensitively");
ok(isMine({ doctorName: "Dr. Nour Adel" }, me), "the older doctorName spelling is honoured too");
ok(!isMine({}, me), "a row naming nobody is nobody's");
ok(!isMine({ doctor: "" }, { staffId: "x", name: "", commissionPct: 0 }), "an empty name never matches an empty name");

// --- 2. The day and the chair -----------------------------------------------------------------------

const day = [
  { id: "a", time: "11:15 AM", status: "Confirmed", patientName: "Omar" },
  { id: "b", time: "09:00 AM", status: "Completed", patientName: "Yousef" },
  { id: "c", time: "10:30 AM", status: "Checked In", patientName: "Mariam", checkInTime: { toMillis: () => 1000 } },
  { id: "d", status: "Scheduled", patientName: "No time" },
  { id: "e", time: "12:00 PM", status: "Scheduled", patientName: "Karim" },
];

eq(sortDay(day).map((a) => a.id), ["b", "c", "a", "e", "d"], "the day runs by time, a row with no time last");
ok(isDone("Completed") && isDone("Checking Out") && isDone("No Show") && isDone("Cancelled"), "done statuses");
ok(!isDone("In Chair") && !isDone("Checked In") && !isDone(undefined), "open statuses");

{
  const { current, next, after } = pickChair(day);
  eq(current, null, "nobody is in the chair");
  eq(next?.id, "c", "the checked-in patient is next even though she is not the earliest open booking");
  eq(after?.id, "a", "then the earliest of the rest");
}
{
  const withChair = [...day, { id: "f", time: "10:00 AM", status: "In Chair", patientName: "Salma" }];
  const { current, next } = pickChair(withChair);
  eq(current?.id, "f", "a patient In Chair is the current one");
  eq(next?.id, "c", "and the checked-in patient is next");
}
{
  const twoWaiting = [
    { id: "x", time: "11:00 AM", status: "Checked In" },
    { id: "y", time: "10:00 AM", status: "Checked In" },
  ];
  eq(pickChair(twoWaiting).next?.id, "y", "two waiting: the earlier booking goes first");
}
eq(pickChair([{ id: "z", status: "Completed" }]).next, null, "a finished day has no next");

eq(waitingMinutes({ toMillis: () => 100_000 }, 100_000 + 6 * 60_000 + 20_000), 6, "a Firestore timestamp gives whole minutes");
eq(waitingMinutes(new Date(50_000), 50_000 + 90_000), 2, "a Date works too (rounded)");
eq(waitingMinutes(undefined, 1), null, "no check-in stamp, no wait");
eq(waitingMinutes({ toMillis: () => 5_000_000 }, 1), 0, "a stamp in the future reads as zero, never negative");

// --- 3. Money -------------------------------------------------------------------------------------------

eq(rowMoney({ type: "payment", amount: 0, paid: 300 }), 300, "a payment's money is in paid, even when amount holds a placeholder 0");
eq(rowMoney({ type: "payment", amount: 250 }), 250, "an older payment with only amount");
eq(rowMoney({ type: "procedure", amount: 1200, cost: 1200 }), 1200, "a charge's money is its amount");
eq(rowMoney({ type: "procedure", cost: 900 }), 900, "or cost when amount is absent");

const ledger = [
  // Nour's crown: charged 3000, paid 1000 today (share stored), 500 last week (share recomputed)
  { id: "p1", type: "procedure", doctorId: "st_nour", patientId: "pt1", amount: 3000, date: "2026-08-20" },
  { id: "pay1", type: "payment", doctorId: "st_nour", patientId: "pt1", procedureId: "p1", paid: 1000, amount: 0, date: TODAY, doctorCommissionAmount: 400 },
  { id: "pay2", type: "payment", doctorId: "st_nour", patientId: "pt1", procedureId: "p1", paid: 500, amount: 0, date: "2026-08-28" },
  // Nour's filling: charged 800, fully paid today, no stored share, lab fee 100 -> 40% of 600
  { id: "p2", type: "procedure", doctorId: "st_nour", patientId: "pt2", amount: 800, date: "2026-09-01" },
  { id: "pay3", type: "payment", doctorId: "st_nour", patientId: "pt2", procedureId: "p2", paid: 700, date: TODAY, labFee: 100 },
  // Overpaid on p2 by 100 — must not reduce what pt1 owes
  { id: "pay4", type: "payment", doctorId: "st_nour", patientId: "pt2", procedureId: "p2", paid: 200, date: "2026-09-02" },
  // Omar's, today — never Nour's
  { id: "p3", type: "procedure", doctorId: "st_omar", patientId: "pt3", amount: 5000, date: TODAY },
  { id: "pay5", type: "payment", doctorId: "st_omar", patientId: "pt3", procedureId: "p3", paid: 5000, date: TODAY, doctorCommissionAmount: 1500 },
  // An expense row, and a payment on account with no procedure
  { id: "x1", type: "expense", cost: 999, date: TODAY },
  { id: "pay6", type: "payment", doctorId: "st_nour", patientId: "pt1", paid: 50, date: TODAY },
];

{
  const m = moneyToday(ledger, me, TODAY);
  eq(m.paid, 1750, "paid today = 1000 + 700 + 50 on account; not Omar's 5000, not yesterday's, never the expense");
  // 400 stored + 40% of (700 - 100) = 240 + 40% of 50 on account = 20
  eq(m.share, 660, "share = stored amount where written, else recomputed from the dentist's percentage after the lab fee");
  eq(moneyToday(ledger, other, TODAY), { paid: 5000, share: 1500 }, "Omar sees only Omar's");
  eq(moneyToday(ledger, me, "2026-01-01"), { paid: 0, share: 0 }, "a day with nothing is zero, not an error");
}
{
  // pt1 owes 3000 - 1500 = 1500; pt2's overpayment (900 on 800) clamps to 0 and never offsets pt1
  eq(owedByMyPatients(ledger, me), 1500, "owed = each of my charges less its own payments, never below zero per charge");
  eq(owedByMyPatients(ledger, other), 0, "Omar's patient paid in full");
  eq(owedByPatient(ledger, me, "pt1"), 1500, "one patient's balance");
  eq(owedByPatient(ledger, me, "pt2"), 0, "an overpaid patient owes nothing");
}

// --- 4. The lab --------------------------------------------------------------------------------------------

const cases = [
  { id: "l1", doctorId: "st_nour", status: "back", patientName: "Hana" },
  { id: "l2", doctorId: "st_nour", status: "tryin_back", patientName: "Ahmed" },
  { id: "l3", doctorId: "st_nour", status: "at_lab", dueDate: "2026-09-03", patientName: "Mona" },
  { id: "l4", doctorId: "st_nour", status: "at_lab", dueDate: TODAY, patientName: "Sara" },
  { id: "l5", doctorId: "st_nour", status: "at_lab", dueDate: "2026-09-20", patientName: "Not yet" },
  { id: "l6", doctorId: "st_nour", status: "fitted", patientName: "Done" },
  { id: "l7", doctorId: "st_nour", status: "cancelled", patientName: "Gone" },
  { id: "l8", doctorId: "st_omar", status: "back", patientName: "Omar's" },
  { id: "l9", doctorId: "st_nour", status: "at_lab", patientName: "No due date" },
];
{
  const out = labReturns(cases, me, TODAY);
  eq(out.map((c) => c.id), ["l3", "l4", "l1", "l2"], "late first, then due today, then back, then try-in; nothing else");
  eq(out.map((c) => c.kind), ["late", "due_today", "back", "tryin"], "each carries why it is listed");
}

// --- 5. Plans left open ------------------------------------------------------------------------------------

const notes = [
  { id: "n1", doctorId: "st_nour", patientId: "pt1", status: "Ongoing", procedures: ["Root canal"], tooth: "46", date: "2026-08-10" },
  { id: "n2", doctorId: "st_nour", patientId: "pt1", status: "Completed", procedure: "Scaling", date: "2026-08-25" },
  { id: "n3", doctorId: "st_nour", patientId: "pt2", status: "Ongoing", serviceName: "Implant", tooth: "36", date: "2026-07-01" },
  { id: "n4", doctorId: "st_nour", patientId: "pt2", status: "Ongoing", serviceName: "Crown", tooth: "36", date: "2026-07-20" },
  { id: "n5", doctorId: "st_nour", patientId: "pt3", status: "Planned", serviceName: "Veneer", date: "2026-08-01" },
  { id: "n6", doctorId: "st_nour", patientId: "pt4", status: "Ongoing", serviceName: "Ortho", date: "2026-06-01" },
  { id: "n7", doctorId: "st_omar", patientId: "pt5", status: "Ongoing", serviceName: "Omar's", date: "2026-06-01" },
];
const future = [
  { patientId: "pt4", date: "2026-09-12", status: "Scheduled" }, // booked — not forgotten
  { patientId: "pt2", date: "2026-09-10", status: "Cancelled" }, // cancelled does not count as booked
  { patientId: "pt1", date: "2026-09-01", status: "Scheduled" }, // in the past — not a next visit
];
{
  const plans = openPlans(notes, future, me, TODAY);
  eq(plans.map((p) => p.patientId), ["pt2", "pt1"], "only Ongoing, only mine, only patients with nothing booked ahead; longest-unseen first");
  const pt1 = plans.find((p) => p.patientId === "pt1")!;
  eq(pt1.ongoing, 1, "one open note on pt1");
  eq(pt1.procedure, "Root canal · 46", "the open procedure, with its tooth");
  eq(pt1.lastNoteDate, "2026-08-25", "last seen counts the completed scaling, not only the open note");
  const pt2 = plans.find((p) => p.patientId === "pt2")!;
  eq(pt2.ongoing, 2, "two open notes on pt2");
  eq(pt2.procedure, "Crown · 36", "the most recent open one names the row");
  ok(!plans.some((p) => p.patientId === "pt3"), "Planned is not started, so it is not left open");
  ok(!plans.some((p) => p.patientId === "pt4"), "a future booking, with anyone, takes the patient off the list");
}

eq(daysBetween("2026-08-25", TODAY), 11, "whole days");
eq(daysBetween("", TODAY), null, "no date, no age");

console.log(`dentistHome: ${checks} checks passed`);
