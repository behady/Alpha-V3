// The people behind a report figure: one line per patient, folded off the ledger rows.
//
// The drawer under "Instagram · 12 patients" is only worth opening if it lists those twelve and
// nobody else, with the money the figure above was made of. The mistakes that matter:
//
//   - a patient counted twice because they have two rows, so the drawer says 14 under a 12;
//   - money doubled because a procedure's mirrored `paid` was added to the payment that set it;
//   - a patient who had treatment but has not paid yet missing from the list, which is the one
//     person the desk actually needs to see;
//   - a dentist's drawer built on a different name normalisation than the dentist's card.
//
// Run with tsx: npx tsx tests/reportPatients.test.mts
import assert from "node:assert/strict";
import {
  doctorLabel,
  matchesPatient,
  partitionRows,
  rollupPatients,
  rowDate,
  summarize,
} from "../src/lib/reportPatients";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}

const PATIENTS = {
  p1: { id: "p1", name: "Mona Adel", phone: "01001234567" },
  p2: { id: "p2", name: "Karim Said", phone: "01119876543" },
  p3: { id: "p3", name: "Hana Fathy", phone: "" },
};

const PROCEDURES = [
  // Mona: two fillings on two days, with Dr. Omar. Charged 300 + 300.
  { id: "c1", type: "procedure", patientId: "p1", patientName: "Mona Adel", doctorName: "Dr. Omar", serviceName: "Filling", cost: 300, paid: 300, normDate: "2026-09-02" },
  { id: "c2", type: "procedure", patientId: "p1", patientName: "Mona Adel", doctor: "Omar", serviceName: "Filling", cost: 300, paid: 0, normDate: "2026-09-10" },
  // Karim: a crown with Dr. Sara, nothing paid yet.
  { id: "c3", type: "procedure", patientId: "p2", patientName: "Karim Said", doctorName: "Sara", description: "Crown (T: 14) | 1500*1=1500", cost: 1500, paid: 0, normDate: "2026-09-05" },
  // A walk-in typed straight into the ledger with no patient id.
  { id: "c4", type: "procedure", patientId: "", patientName: "Walk-in", doctorName: "Dr. Omar", serviceName: "Consultation", cost: 100, paid: 100, normDate: "2026-09-06" },
];

const PAYMENTS = [
  { id: "y1", type: "payment", patientId: "p1", patientName: "Mona Adel", doctorName: "Dr. Omar", procedureId: "c1", paid: 300, amount: 0, normDate: "2026-09-02" },
  // Hana paid on account with no treatment in the period — she is real money and belongs in the list.
  { id: "y2", type: "payment", patientId: "p3", patientName: "Hana Fathy", paid: 200, normDate: "2026-09-08" },
  { id: "y3", type: "payment", patientId: "", patientName: "Walk-in", doctorName: "Dr. Omar", paid: 100, normDate: "2026-09-06" },
  // An expense never becomes a patient.
  { id: "e1", type: "expense", cost: 5000, description: "Rent", normDate: "2026-09-01" },
];

// --- one line per patient ---------------------------------------------------------------------

const lines = rollupPatients(PROCEDURES, PAYMENTS, PATIENTS);

eq(lines.length, 4, "four people: Mona, Karim, Hana and the walk-in; the expense is nobody");

const mona = lines.find((l) => l.patientId === "p1")!;
eq(mona.name, "Mona Adel", "name comes from the patient file");
eq(mona.phone, "01001234567", "phone comes from the patient file");
eq(mona.procedures, 2, "two treatments");
eq(mona.visits, 2, "two distinct days");
eq(mona.firstDate, "2026-09-02", "first day");
eq(mona.lastDate, "2026-09-10", "last day");
eq(mona.charged, 600, "charged is the sum of procedure prices");
eq(mona.paid, 300, "paid comes off the payment row ONLY — the procedure's mirrored paid is not added");
eq(mona.services, ["Filling"], "the same treatment twice is one name");
eq(mona.doctors, ["Omar"], "\"Dr. Omar\" and \"Omar\" are one dentist");

const karim = lines.find((l) => l.patientId === "p2")!;
eq(karim.paid, 0, "no payment yet");
eq(karim.charged, 1500, "but the work is on the books");
eq(karim.services, ["Crown"], "the description's tooth and formula noise is trimmed");
ok(lines.some((l) => l.patientId === "p2"), "an unpaid patient is still listed — the desk needs them most");

const hana = lines.find((l) => l.patientId === "p3")!;
eq(hana.procedures, 0, "paid on account, no treatment in the period");
eq(hana.paid, 200, "her money still counts");
eq(hana.services, [], "and there is nothing to name");

const walkIn = lines.find((l) => !l.patientId)!;
eq(walkIn.name, "Walk-in", "a row with no patient id is folded by name");
eq(walkIn.procedures, 1, "one consultation");
eq(walkIn.paid, 100, "and the payment folded onto the same line by name");

eq(
  lines.map((l) => l.name),
  ["Mona Adel", "Hana Fathy", "Walk-in", "Karim Said"],
  "sorted by money, so the people the figure is mostly made of come first; ties break on work done",
);

// --- the drawer's heading ---------------------------------------------------------------------

eq(summarize(lines), { patients: 4, visits: 5, paid: 600 }, "the strip states patients, visits and money");

// --- grouping the way the figures group -------------------------------------------------------

const byDentist = partitionRows(PROCEDURES, PAYMENTS, (row) => doctorLabel(row));
eq([...byDentist.keys()].sort(), ["Omar", "Sara", "Unassigned"], "Hana's on-account payment names no dentist");
eq(byDentist.get("Omar")!.procedures.length, 3, "Omar: Mona twice and the walk-in");
eq(byDentist.get("Omar")!.payments.length, 2, "Omar: Mona's payment and the walk-in's");
ok(!byDentist.get("Unassigned")!.payments.some((r) => r.type === "expense"), "expenses never enter a group");

const omarLines = rollupPatients(byDentist.get("Omar")!.procedures, byDentist.get("Omar")!.payments, PATIENTS);
eq(omarLines.map((l) => l.name), ["Mona Adel", "Walk-in"], "Omar's drawer is Omar's patients and nobody else");

const dropped = partitionRows(PROCEDURES, PAYMENTS, (row) => (row.patientId === "p1" ? "keep" : ""));
eq([...dropped.keys()], ["keep"], "a row the grouping cannot place is dropped, not filed under an empty key");

// --- small helpers -----------------------------------------------------------------------------

eq(doctorLabel({ doctorName: "Dr. Omar" }), "Omar", "honorific stripped");
eq(doctorLabel({ doctor: "DR omar" }), "omar", "case-insensitively");
eq(doctorLabel({}), "Unassigned", "the fallback is the Dentist tab's word");
eq(doctorLabel({}, "General"), "General", "and can be the case sheet's");

eq(rowDate({ normDate: "2026-09-02" }), "2026-09-02", "the stamped date wins");
eq(rowDate({ date: "2026-09-02T10:00:00" }), "2026-09-02", "a timestamp string is cut to the day");
eq(rowDate({ date: "yesterday" }), "", "nonsense is empty, not 1970");

ok(matchesPatient(mona, "mona"), "search by name, case-insensitively");
ok(matchesPatient(mona, "0100 123"), "search by phone, ignoring spaces");
ok(!matchesPatient(mona, "karim"), "and not by someone else's name");
ok(matchesPatient(mona, "  "), "blank matches everyone");

// --- names filled in late, and unknown ones named -----------------------------------------------

const late = rollupPatients(
  [{ type: "procedure", patientId: "", patientName: "", cost: 50, normDate: "2026-09-01" }],
  [{ type: "payment", patientId: "", patientName: "", paid: 50, patientPhone: "0100", normDate: "2026-09-01" }],
  {},
  { unknownName: "بدون اسم" },
);
eq(late.length, 1, "two nameless rows fold into one nameless line");
eq(late[0].name, "بدون اسم", "named in the reader's language");
eq(late[0].phone, "0100", "a phone that arrives on a later row is kept");

console.log(`reportPatients: ${checks} checks passed`);
