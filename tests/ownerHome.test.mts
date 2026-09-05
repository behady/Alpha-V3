// The live pieces of the owner's home — small functions, but each one is a number an owner acts on.
//
// Run with tsx so the TS modules load directly: npm run test:owner
import assert from "node:assert/strict";
import { waitingRoom, cashToday, attendanceByDoctor, sourcesOf, leadsFunnel, labChase, periodStart } from "../src/lib/ownerHome";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const NOW = 10_000_000;
const min = (n: number) => ({ toMillis: () => NOW - n * 60_000 });

// --- Waiting room --------------------------------------------------------------------------------------

{
  const appts = [
    { id: "a", status: "Checked In", patientName: "Mariam", doctor: "Dr. Nour", checkInTime: min(18) },
    { id: "b", status: "Checked In", patientName: "Ahmed", doctor: "Dr. Omar", checkInTime: min(9) },
    { id: "c", status: "In Chair", patientName: "Sara", doctor: "Dr. Nour" },
    { id: "d", status: "Confirmed", patientName: "Not here yet" },
    { id: "e", status: "Checked In", patientName: "No stamp" },
  ];
  const room = waitingRoom(appts, NOW);
  eq(room.waiting.map((w) => w.name), ["Mariam", "Ahmed", "No stamp"], "longest wait first; a missing stamp sorts last, not first");
  eq(room.longest, 18, "the longest wait in minutes");
  eq(room.inChair, 1, "one chair in use");
  eq(waitingRoom([], NOW), { waiting: [], longest: null, inChair: 0 }, "an empty room has no longest wait");
}

// --- Cash today --------------------------------------------------------------------------------------------

{
  const ledger = [
    { type: "payment", date: "2026-09-05", paid: 1000, amount: 0 },
    { type: "income", date: "2026-09-05", paid: 200 },
    { type: "expense", date: "2026-09-05", amount: 150, cost: 150 },
    { type: "procedure", date: "2026-09-05", amount: 9999 }, // a charge is not cash
    { type: "payment", date: "2026-09-04", paid: 5000 }, // yesterday
  ];
  eq(cashToday(ledger, "2026-09-05"), { collected: 1200, expenses: 150, net: 1050 }, "payments and income in, expenses out, charges ignored, yesterday ignored");
}

// --- Attendance per dentist ----------------------------------------------------------------------------------

{
  const appts = [
    { doctor: "Dr. Hana", status: "Completed" },
    { doctor: "Dr. Hana", status: "No Show" },
    { doctor: "Dr. Hana", status: "No Show" },
    { doctor: "Dr. Nour", status: "Completed" },
    { doctor: "Dr. Nour", status: "Checking Out" },
    { doctor: "Dr. Nour", status: "Cancelled" },
    { doctor: "Dr. Nour", status: "Confirmed" }, // undecided
    { status: "Completed" }, // no doctor recorded
  ];
  const { doctors, overall } = attendanceByDoctor(appts);
  eq(doctors.map((d) => d.doctor), ["Dr. Hana", "Dr. Nour", "—"], "worst no-show rate first; the nameless bucket is last");
  eq(doctors[0].rate, 2 / 3, "Hana: two misses out of three decided");
  eq(doctors[1], { doctor: "Dr. Nour", seen: 2, missed: 0, cancelled: 1, rate: 0 }, "Nour: a cancellation is counted but not held against her");
  eq(overall.rate, 2 / 6, "overall: 2 missed of 6 decided; the confirmed booking is not decided");
}

// --- Sources, leads, lab ---------------------------------------------------------------------------------------

eq(
  sourcesOf([{ source: "Facebook" }, { source: "Facebook" }, { source: " " }, { source: "Google" }, {}]),
  [{ source: "Facebook", count: 2 }, { source: "Unknown", count: 2 }, { source: "Google", count: 1 }],
  "most common first; blank and missing both read as Unknown"
);

eq(
  leadsFunnel([{ stage: "new" }, { stage: "NEW" }, { stage: "contacted" }, { stage: "booked" }, { stage: "won" }, { stage: "lost" }, {}]),
  { asked: 7, replied: 4, booked: 2, untouched: 3 },
  "asked = all; replied = past new; booked = booked or won; a missing stage is new"
);

eq(
  labChase(
    [
      { status: "at_lab", dueDate: "2026-09-01" },
      { status: "at_lab", dueDate: "2026-09-05" },
      { status: "at_lab", dueDate: "2026-09-20" },
      { status: "back", dueDate: "2026-09-01" }, // back already — nothing to chase
      { status: "at_lab" }, // no due date
    ],
    "2026-09-05"
  ),
  { late: 1, dueToday: 1 },
  "only cases still at the lab can be late or due"
);

eq(periodStart("day", "2026-09-05"), "2026-09-05", "day");
eq(periodStart("week", "2026-09-05"), "2026-08-30", "the seven days ending today");
eq(periodStart("month", "2026-09-05"), "2026-09-01", "month to date");

console.log(`ownerHome: ${checks} checks passed`);
