// Who pays for a visit, and whether the approval that company needs is there (lib/visitPayer).
//
// These pin the ways the desk could be told the wrong thing:
//
//   1. A visit linked to an approval billed to someone other than that approval's company.
//   2. The patient's card overriding what the desk deliberately picked (Private included).
//   3. A contract company with no paper (GASCO) warned about a missing approval it never needs.
//   4. "Upload one" said when there is already an approval on file, or nothing said when there is none.
//   5. The dentist's badge ignoring the visit's own payer.
//
// Run with tsx so the TS modules load directly: npx tsx tests/visitPayer.test.mts
import assert from "node:assert/strict";
import { approvalWarning, effectiveVisitPayer, needsApproval, storedVisitPayer } from "../src/lib/visitPayer";
import { visitInsurer } from "../src/lib/dentistVisit";
import { findPayer, parsePayers } from "../src/lib/payers";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const payers = parsePayers({
  payers: [
    { id: "private", name: "Private", active: true, isDefault: true },
    { id: "metlife-egypt", name: "MetLife Egypt", format: "metlife", active: true },
    { id: "axa-egypt", name: "AXA Egypt", format: "axa", active: true },
    { id: "gasco", name: "GASCO", active: true },
    { id: "old-co", name: "Old Co", format: "nextcare", active: false },
  ],
});
const metlife = findPayer(payers, "metlife-egypt");
const gasco = findPayer(payers, "gasco");

// --- 1 & 2. The order of the answer ---------------------------------------------------------------
eq(
  effectiveVisitPayer({ payers, linkedPayerIds: ["axa-egypt"], picked: "gasco", patientInsurerIds: ["metlife-egypt"] }),
  { payerId: "axa-egypt", source: "approval" },
  "a linked approval decides, whatever was picked or is on the card",
);
eq(
  effectiveVisitPayer({ payers, linkedPayerIds: [], picked: "private", patientInsurerIds: ["metlife-egypt"] }),
  { payerId: "private", source: "picked" },
  "Private picked at the desk beats the patient's card",
);
eq(
  effectiveVisitPayer({ payers, linkedPayerIds: [], picked: "", patientInsurerIds: ["metlife-egypt"] }),
  { payerId: "metlife-egypt", source: "patient" },
  "nothing picked: the patient's insurer",
);
eq(
  effectiveVisitPayer({ payers, linkedPayerIds: [], picked: "", patientInsurerIds: ["old-co"] }),
  { payerId: "private", source: "default" },
  "a retired company on the card is not offered",
);
eq(
  effectiveVisitPayer({ payers, linkedPayerIds: [], picked: "", patientInsurerIds: [] }),
  { payerId: "private", source: "default" },
  "no card, no pick: Private",
);

// --- 3. Who needs paper ---------------------------------------------------------------------------
eq(needsApproval(metlife), true, "MetLife sends approval paper");
eq(needsApproval(gasco), false, "GASCO (no format) never needs one");
eq(needsApproval(findPayer(payers, "private")), false, "Private never needs one");
eq(needsApproval(findPayer(payers, "old-co")), false, "a retired company is not asked about");

// --- 4. What the desk is told ---------------------------------------------------------------------
eq(approvalWarning({ payer: metlife, linked: false, openApprovalPayerIds: [] }), "none", "MetLife, no approval at all");
eq(approvalWarning({ payer: metlife, linked: false, openApprovalPayerIds: ["metlife-egypt"] }), "unlinked", "MetLife approval on file, visit not linked");
eq(approvalWarning({ payer: metlife, linked: false, openApprovalPayerIds: ["axa-egypt"] }), "none", "another company's approval does not count");
eq(approvalWarning({ payer: metlife, linked: true, openApprovalPayerIds: [] }), null, "linked: nothing to say");
eq(approvalWarning({ payer: gasco, linked: false, openApprovalPayerIds: [] }), null, "GASCO: nothing to say");

// --- storedVisitPayer -----------------------------------------------------------------------------
eq(storedVisitPayer({ payerId: "metlife-egypt" }, payers)?.id, "metlife-egypt", "the stored company");
eq(storedVisitPayer({}, payers), null, "a visit from before the picker has none");
eq(storedVisitPayer({ payerId: "old-co" }, payers), null, "a retired company reads as none");

// --- 5. The dentist's badge -----------------------------------------------------------------------
const member = { insurance: { "metlife-egypt": { memberNumber: "987/1" } } };
eq(visitInsurer({ apt: { payerId: "private" }, patient: member, payers, claimPayerIds: {} }), null, "booked Private: no badge despite the card");
eq(visitInsurer({ apt: { payerId: "gasco" }, patient: member, payers, claimPayerIds: {} })?.id, "gasco", "booked GASCO: GASCO's badge");
eq(visitInsurer({ apt: {}, patient: member, payers, claimPayerIds: {} })?.id, "metlife-egypt", "old visit: the card, as before");
eq(
  visitInsurer({ apt: { payerId: "gasco", claimLinks: [{ claimId: "c1", claimLine: 0 }] }, patient: member, payers, claimPayerIds: { c1: "axa-egypt" } })?.id,
  "axa-egypt",
  "a linked approval still wins over the booked payer",
);

console.log(`visitPayer: ${checks} checks passed`);
