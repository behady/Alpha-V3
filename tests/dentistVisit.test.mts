// What the dentist's home says about each booking: new or old patient, new work or follow-up,
// which insurer, what is still to do, and the notes left on the patient.
//
// These pin the ways it could quietly say the wrong thing to a dentist about to treat someone:
//
//   1. A picker value that is not one of ours shown as a tag, or a returning patient called new.
//   2. Finished work listed as still to do, or another patient's work on this one.
//   3. A private patient wearing an insurer's badge, or the wrong insurer's.
//   4. A note that was already handled, or belongs to someone else, shown as open.
//
// Run with tsx so the TS modules load directly: npm run test:dentist-visit
import assert from "node:assert/strict";
import {
  normalizePatientKind, normalizeWorkKind, guessPatientKind, patientKindLabel, workKindLabel,
} from "../src/lib/visitKind";
import { openTreatments, visitInsurer, patientNotes } from "../src/lib/dentistVisit";
import { parsePayers } from "../src/lib/payers";

let checks = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks++;
}
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const TODAY = "2026-11-13";

// --- 1. The two pickers ---------------------------------------------------------------------------

eq(normalizePatientKind("new"), "new", "new patient is kept");
eq(normalizePatientKind("old"), "old", "old patient is kept");
eq(normalizePatientKind("New"), null, "anything else is no answer, not a guess");
eq(normalizePatientKind(undefined), null, "a booking from before the picker has no answer");
eq(normalizeWorkKind("followup"), "followup", "follow-up work is kept");
eq(normalizeWorkKind("new"), "new", "new work is kept");
eq(normalizeWorkKind("old"), null, "the patient's word is not a work answer");

eq(patientKindLabel("new", "en"), "New patient", "English tag, new patient");
eq(patientKindLabel("old", "ar"), "مريض قديم", "Arabic tag, old patient");
eq(workKindLabel("followup", "en"), "Follow-up", "English tag, follow-up");
eq(workKindLabel("new", "ar"), "شغل جديد", "Arabic tag, new work");

eq(guessPatientKind({ isNewPatient: true, visits: [], hasNotes: false, today: TODAY }), "new", "typed in as a new patient: new");
eq(guessPatientKind({ isNewPatient: false, visits: [], hasNotes: false, today: TODAY }), "new", "on file but never seen: new");
eq(
  guessPatientKind({ isNewPatient: false, visits: [{ date: "2026-10-01", status: "Completed" }], hasNotes: false, today: TODAY }),
  "old",
  "a visit that happened: old",
);
eq(
  guessPatientKind({ isNewPatient: false, visits: [{ date: "2026-10-01", status: "No Show" }, { date: "2026-10-08", status: "Cancelled" }], hasNotes: false, today: TODAY }),
  "new",
  "only missed and cancelled visits: still new",
);
eq(
  guessPatientKind({ isNewPatient: false, visits: [{ date: "2026-11-20", status: "Scheduled" }], hasNotes: false, today: TODAY }),
  "new",
  "a first visit that has not happened yet: still new",
);
eq(
  guessPatientKind({ isNewPatient: false, visits: [{ date: TODAY, status: "In Chair" }], hasNotes: false, today: TODAY }),
  "old",
  "in the chair today: no longer new",
);
eq(
  guessPatientKind({ isNewPatient: false, visits: [], hasNotes: true, today: TODAY }),
  "old",
  "treatments on file with no booking (an imported patient): old",
);

// --- 2. What is still to do -----------------------------------------------------------------------

const notes = [
  { id: "n1", patientId: "p1", procedure: "Crown", tooth: "16", status: "Ongoing", date: "2026-10-20" },
  { id: "n2", patientId: "p1", procedure: "Root canal", tooth: "26", status: "Planned", date: "2026-10-01" },
  { id: "n3", patientId: "p1", procedure: "Filling", tooth: "36", status: "Completed", date: "2026-09-01" },
  { id: "n4", patientId: "p2", procedure: "Extraction", tooth: "48", status: "Planned", date: "2026-10-05" },
  { id: "n5", patientId: "p1", procedure: "Scaling", tooth: "Gen", status: "Planned", date: "2026-11-01", payerId: "metlife", payerName: "MetLife" },
  { id: "n6", patientId: "p1", procedure: "  ", status: "Planned", date: "2026-11-02" },
  { id: "n7", patientId: "p1", serviceName: "Whitening", status: "Planned", date: "2026-11-03", payerId: "private", payerName: "Private" },
  // Written by an approval: the insurer's id and no name beside it (seen on real approval rows).
  { id: "n8", patientId: "p1", procedure: "Gingival treatment", tooth: "Gen", status: "Planned", date: "2026-11-04", payerId: "axa" },
];

const todo = openTreatments(notes, "p1");
eq(todo.map((t) => t.id), ["n1", "n2", "n5", "n7", "n8"], "ongoing first, then planned oldest first; done, other patients and nameless rows left out");
eq(todo[0], { id: "n1", name: "Crown", teeth: "16", status: "Ongoing", payerId: null, payerName: null }, "a private treatment names no payer");
eq(todo[2].teeth, "", "a whole-mouth treatment shows no tooth");
eq(todo[2].payerId, "metlife", "an insurer's treatment carries the insurer's id");
eq(todo[2].payerName, "MetLife", "and the name stored beside it");
eq(todo[3].name, "Whitening", "falls back to the service name when no procedure text was typed");
eq(todo[3].payerId, null, "Private is not an insurer");
eq(todo[4].payerId, "axa", "an insurer's row with no name stored still says which insurer");
eq(todo[4].payerName, null, "and never borrows the word Private for it");
eq(openTreatments(notes, "p9"), [], "a patient with nothing on file has nothing to do");
eq(openTreatments(notes, ""), [], "no patient, no list");

// --- 3. Whose badge ---------------------------------------------------------------------------------

const payers = parsePayers({
  payers: [
    { id: "private", name: "Private", active: true },
    { id: "metlife", name: "MetLife", nameAr: "متلايف", active: true, priceListId: "pl_met" },
    { id: "axa", name: "AXA", active: true, priceListId: "pl_axa" },
    { id: "gone", name: "Old Insurer", active: false, priceListId: "pl_gone" },
  ],
});

eq(visitInsurer({ apt: {}, patient: {}, payers, claimPayerIds: {} }), null, "a private patient on a plain visit wears no badge");
eq(
  visitInsurer({ apt: { claimId: "c1", claimLine: 0 }, patient: {}, payers, claimPayerIds: { c1: "metlife" } })?.id,
  "metlife",
  "a visit booked against an approval wears that approval's insurer",
);
eq(
  visitInsurer({
    apt: { claimLinks: [{ claimId: "c2", claimLine: 1 }] },
    patient: { insurance: { metlife: { memberNumber: "55" } } },
    payers,
    claimPayerIds: { c2: "axa" },
  })?.id,
  "axa",
  "the visit's own approval wins over the patient's membership",
);
eq(
  visitInsurer({ apt: {}, patient: { insurance: { metlife: { memberNumber: "55" } } }, payers, claimPayerIds: {} })?.id,
  "metlife",
  "no approval on the visit: the patient's membership",
);
eq(
  visitInsurer({ apt: {}, patient: { defaultPriceListId: "pl_axa" }, payers, claimPayerIds: {} })?.id,
  "axa",
  "no membership: the insurer that owns the patient's price list",
);
eq(
  visitInsurer({ apt: {}, patient: { defaultPriceListId: "pl_gone" }, payers, claimPayerIds: {} }),
  null,
  "a switched-off insurer's list is private work",
);
eq(
  visitInsurer({ apt: {}, patient: { insurance: { gone: { memberNumber: "1" } } }, payers, claimPayerIds: {} }),
  null,
  "membership of a switched-off insurer wears no badge",
);
eq(
  visitInsurer({ apt: { claimId: "c9", claimLine: 0 }, patient: {}, payers, claimPayerIds: {} }),
  null,
  "an approval we could not read names nobody rather than guessing",
);
eq(visitInsurer({ apt: {}, patient: null, payers, claimPayerIds: {} }), null, "no patient record: no badge");

// --- 4. Notes on the patient -----------------------------------------------------------------------

const reminders = [
  { patientId: "p1", status: "open", reason: "Call about the crown shade", fireAtMs: 200 },
  { patientId: "p1", status: "open", reason: "Send the x-ray to the lab", fireAtMs: 100 },
  { patientId: "p1", status: "done", reason: "Confirm the visit", fireAtMs: 50 },
  { patientId: "p2", status: "open", reason: "Somebody else", fireAtMs: 10 },
  { patientId: "p1", status: "open", reason: "   ", fireAtMs: 5 },
];
eq(
  patientNotes(reminders, "p1"),
  ["Send the x-ray to the lab", "Call about the crown shade"],
  "this patient's open notes, earliest first; handled, empty and other patients' left out",
);
eq(patientNotes(reminders, "p9"), [], "a patient with no notes");
eq(patientNotes(reminders, ""), [], "no patient, no notes");

console.log(`dentistVisit: ${checks} checks passed`);
