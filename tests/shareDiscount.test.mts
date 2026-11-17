// A discount on the patient's share of an insurance service, and the dentist-pay rule that came
// with it (owner's decisions, 2026-11-16).
//
// These pin the ways it could quietly move the wrong money:
//
//   1. The insurer's approved part changing — the company must be billed exactly what it approved.
//   2. A discount bigger than the share, or surviving an edit that shrank the share.
//   3. A dentist stamped BEFORE the new rule having their figure moved (payroll already signed).
//   4. A dentist stamped under the new rule NOT sharing the discount at their rate.
//   5. A rebuilt treatment row losing the discount, its reason, or the insurer's own gap.
//
// Run with tsx so the TS modules load directly: npx tsx tests/shareDiscount.test.mts
import assert from "node:assert/strict";
import {
  dentistBase, insuranceTreatmentRows, lineCharge, lineDentistFor, parseLineDentists, parseShareDiscounts,
  reshareLineDentists, shareDiscountOf, shareDiscountReason, type LineDentist,
} from "../src/lib/insurance/claims";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

// A crown asked at 2,700, MetLife approves 500, the patient pays 100.
const crown = {
  code: "D2740", description: "Crown", unitsRequested: 1, grossPerUnit: 2700, grossTotal: 2700,
  unitsApproved: 1, patientShare: 100, approvedAmount: 500, comment: "", confidence: 1,
};

// --- 1 & 2. The price ---------------------------------------------------------------------------
eq(lineCharge(crown), 600, "no discount: approved + share");
eq(lineCharge(crown, 40), 560, "a share discount comes off the price");
eq(lineCharge(crown, 100), 500, "the whole share off: the insurer's part is left");
eq(lineCharge(crown, 900), 500, "never more than the share — the insurer's part is untouched");
eq(lineCharge(crown, -5), 600, "a negative discount is no discount");

const stored = parseShareDiscounts({ 0: { amount: 250, reason: "Friend", by: "u1", at: "2026-11-16" }, 3: { amount: 10 }, 1: { amount: 0 } }, [crown, crown]);
eq(stored[0]?.amount, 100, "read back capped at the line's share");
eq(stored[3], undefined, "an index past the lines is dropped");
eq(stored[1], undefined, "a zero discount is no discount");
eq(shareDiscountOf({ shareDiscounts: stored }, 0), 100, "shareDiscountOf reads it");
eq(shareDiscountOf({}, 0), 0, "a claim from before discounts has none");

// --- 3 & 4. Dentist pay ---------------------------------------------------------------------------
eq(dentistBase(crown, undefined), 500, "old rule: the approved amount only");
eq(dentistBase(crown, undefined, 100), 500, "old rule: a share discount does not touch it");
eq(dentistBase(crown, "charge"), 600, "new rule: approved + share");
eq(dentistBase(crown, "charge", 40), 560, "new rule: less the share discount");

const staff = { id: "s1", name: "Dr. Test", commissionPercentage: 25 };
const fresh = lineDentistFor(crown, staff, "metlife-egypt");
eq(fresh.basis, "charge", "every new pick is stamped under the new rule");
eq(fresh.share, 150, "25% of 600");
eq(lineDentistFor(crown, staff, "metlife-egypt", undefined, 100).share, 125, "25% of 500 after a 100 share discount");

const old: LineDentist = { staffId: "s1", name: "Dr. Old", rate: 25, share: 125 };
const now: LineDentist = { staffId: "s2", name: "Dr. New", rate: 25, share: 150, basis: "charge" };
const editedLine = { ...crown, approvedAmount: 400, patientShare: 60 };
const reshared = reshareLineDentists([editedLine, editedLine], { 0: old, 1: now }, { 1: { amount: 20, reason: "", by: "", at: "" } });
eq(reshared[0].share, 100, "old entry after an edit: 25% of the new approved 400 only");
eq(reshared[0].basis, undefined, "old entry keeps its rule");
eq(reshared[1].share, 110, "new entry after an edit: 25% of (400 + 60 − 20)");

const parsed = parseLineDentists({ 0: { staffId: "s2", name: "x", rate: 25, share: 150, basis: "charge" }, 1: { staffId: "s1", rate: 25, share: 125, basis: "other" } }, 2);
eq(parsed[0].basis, "charge", "the rule survives a read");
eq(parsed[1].basis, undefined, "an unknown rule is the old rule");

// --- 5. The treatment row an approval writes --------------------------------------------------------
const claim = {
  payerId: "metlife-egypt", approvalNumber: "A1", approvalDate: "2026-11-16", treatedDate: "2026-11-16",
  patientId: "p1", patientName: "TEST", lines: [crown], dentists: { 0: { ...now, share: 125 } }, lineStatus: {},
  shareDiscounts: { 0: { amount: 100, reason: "Staff family", by: "u1", at: "2026-11-16" } },
};
const [row] = insuranceTreatmentRows({ claimId: "c1", claim, payerName: "MetLife Egypt", wording: {}, actor: { uid: "u1", name: "Test", role: "Dentist" } });
eq(row.charge.cost, 500, "row price: approved + share − discount");
eq(row.charge.amount, 500, "amount follows cost");
eq(row.charge.insurerCovered, 500, "the insurer's part is what it approved");
eq(row.charge.patientShare, 100, "the paper's share is kept as the paper said");
eq(row.charge.shareDiscount, 100, "the clinic's discount is on the row");
eq(row.charge.shareDiscountReason, "Staff family", "with its reason");
eq(row.charge.discountAmount, 2200, "total off the list price: the insurer's gap (2,100) + the share discount (100)");
eq(row.charge.discountReason, "MetLife Egypt approved 500 of 2700; Patient share discount 100: Staff family", "both reasons named");
eq(row.charge.doctorCommissionAmount, 125, "the dentist's stamped share");
eq(row.charge.clinicProfit, 375, "the clinic keeps the rest");
eq(row.note.cost, 500, "the clinical note agrees with the charge");

const [plain] = insuranceTreatmentRows({ claimId: "c1", claim: { ...claim, shareDiscounts: {} }, payerName: "MetLife Egypt", wording: {}, actor: { uid: "u1", name: "Test", role: "Dentist" } });
eq(plain.charge.cost, 600, "no discount: as before");
eq(plain.charge.shareDiscount, null, "no discount field");
eq(plain.charge.discountReason, "MetLife Egypt approved 500 of 2700", "only the insurer's gap, worded as before");

const zeroApproved = { ...crown, approvedAmount: 0, grossTotal: 100, patientShare: 100 };
const [fullyOff] = insuranceTreatmentRows({ claimId: "c1", claim: { ...claim, lines: [zeroApproved], dentists: {} }, payerName: "MetLife Egypt", wording: {}, actor: { uid: "u1", name: "Test", role: "Dentist" } });
eq(fullyOff?.charge.cost, 0, "a share discounted to nothing still has its row (the work was done)");

eq(shareDiscountReason({ insurerGap: 0, approvalText: "x", shareOff: 0, shareReason: "" }), null, "nothing to say");
eq(shareDiscountReason({ insurerGap: 0, approvalText: "x", shareOff: 50, shareReason: "" }), "Patient share discount 50", "a discount with no reason still says what it is");

console.log(`shareDiscount: ${checks} checks passed`);
