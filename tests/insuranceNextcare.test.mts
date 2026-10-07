// The NextCare approval reader: the model's JSON for a scanned approval becomes the same approval record
// MetLife's reader produces (so saving, the patient file, dentists, collecting the share and the booking
// popup all work unchanged), with NextCare's own checks, its teeth notation and its monthly sheet.
import assert from "node:assert/strict";
import { NEXTCARE_RAW } from "./fixtures/insuranceNextcare.fixture";
import {
  assignConditionTeeth,
  checkNextcare,
  fromNextcareModel,
  NEXTCARE_RESPONSE_SCHEMA,
  buildNextcarePrompt,
  normalizeNextcare,
  parseNextcareDate,
  quadrantTeeth,
} from "../src/lib/insurance/nextcare";
import { hasHardFailure } from "../src/lib/insurance/metlife";
import { buildNextcareStatement, DEFAULT_NEXTCARE_WORDING } from "../src/lib/insuranceStatementNextcare";
import { claimFromExtraction, normalizeConfirmed, parseClaim, insuranceTreatmentRows, insuranceEntryToWrite } from "../src/lib/insurance/claims";

const ctx = { today: "2026-07-10" };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const read = (raw: unknown = NEXTCARE_RAW) => normalizeNextcare(fromNextcareModel(raw));
const ids = (checks: { id: string; severity: string }[], severity: string) => checks.filter((c) => c.severity === severity).map((c) => c.id);

// --- 1. dates -------------------------------------------------------------------------------------
assert.equal(parseNextcareDate("04-Jul-2026"), "2026-07-04");
assert.equal(parseNextcareDate("4-jul-2026"), "2026-07-04", "case and a single-digit day");
assert.equal(parseNextcareDate("04/07/2026"), "2026-07-04", "dd/mm/yyyy too");
assert.equal(parseNextcareDate("2026-07-04"), "2026-07-04");
assert.equal(parseNextcareDate("31-Feb-2026"), null, "not a real day");
assert.equal(parseNextcareDate("04-Jux-2026"), null);
assert.equal(parseNextcareDate(""), null);

// --- 2. teeth in the insurer's quadrant shorthand ----------------------------------------------------
assert.deepEqual(quadrantTeeth("L.R 4-6"), [["44", "46"]], "lower right 4 and 6 (a list, not a range)");
assert.deepEqual(quadrantTeeth("L.R 4-5-6\nU.L 7"), [["44", "45", "46"], ["27"]]);
assert.deepEqual(quadrantTeeth("UR3 , LL 8"), [["13"], ["38"]], "no dots, no spaces");
assert.deepEqual(quadrantTeeth("L.L E-D"), [["75", "74"]], "milk teeth as letters");
assert.deepEqual(quadrantTeeth("refer back if exceeds 1673.25 le"), [], "money is not a tooth");
assert.deepEqual(
  assignConditionTeeth([{ unitsApproved: 0 }, { unitsApproved: 2 }, { unitsApproved: 1 }], [["44", "46"], ["44", "45", "46"]]),
  [[], ["44", "46"], []],
  "a group goes to the line approved for exactly that many units; nothing is guessed for the rest",
);

// --- 3. reading the paper -----------------------------------------------------------------------------
const x = read();
assert.equal(x.header.approvalNumber, "C0099887766/1");
assert.equal(x.header.approvalDate, "2026-07-04");
assert.equal(x.header.validUntil, "2026-08-04");
assert.equal(x.header.insurerName, "Misr Insurance");
assert.equal(x.header.certificateNumber, "AB12-CD34-EF56-7890", "the card number, upper-case, in the certificate's place");
assert.equal(x.header.dependentCode, "EXAMPLE-12345678", "the beneficiary code in the dependent's place");
assert.equal(x.header.memberCode, "AB12", "the sheet's bracket code defaults to the card's first group");
assert.equal(x.header.policyNumber, "4100");
assert.equal(x.header.employer, "EXAMPLE");
assert.equal(x.header.productName, "EXAMPLE Spouses B");
assert.equal(x.header.terminationDate, "2027-01-01");
assert.equal(x.header.physician, "Dr Example Dentist Cairo - HO");
assert.equal(x.header.diagnosisCode, "K02.9 Dental caries, unspecified");
assert.equal(x.header.approvedTotal, 1673.25, "what the insurer pays");
assert.equal(x.header.patientShareTotal, 0);
assert.equal(x.lines.length, 4, "the total row is not a service");
const [consult, crown, composite, xray] = x.lines;
assert.equal(crown.code, "DEN-27");
assert.equal(crown.grossPerUnit, 3450);
assert.equal(crown.grossTotal, 10350, "requested = price each x units asked");
assert.equal(crown.approvedAmount, 0, "a blank insurer share on a refused row is 0");
assert.equal(crown.comment, "Not authorized");
assert.equal(composite.approvedAmount, 1610);
assert.deepEqual(composite.teeth, ["44", "46"], "the conditions' teeth reach the composite approved for two");
assert.deepEqual(xray.teeth, []);
assert.deepEqual(consult.teeth, []);
assert.equal(normalizeNextcare(clone(x)).lines.length, 4, "idempotent: the card and the server read it again");
assert.deepEqual(normalizeNextcare(clone(x)), x, "idempotent, field for field");
assert.equal(normalizeNextcare(null).lines.length, 0, "junk in, empty out");

// insurer share missing but the approved price and patient share are printed: worked out
const derived = clone(NEXTCARE_RAW);
(derived.lines[2] as Record<string, unknown>).insuranceShare = null;
(derived.lines[2] as Record<string, unknown>).patientShare = 322;
(derived.lines[2] as Record<string, unknown>).approvedPrice = 1610;
assert.equal(read(derived).lines[2].approvedAmount, 1288, "1610 approved, 322 from the patient");

// --- 4. checks -------------------------------------------------------------------------------------------
assert.deepEqual(ids(checkNextcare(x, ctx), "hard"), [], "the clean paper passes every hard check");
assert.ok(ids(checkNextcare(x, ctx), "soft").includes("reduced"), "refused services are worth a look");
assert.ok(!hasHardFailure(checkNextcare(x, ctx)));

const bad = (mut: (y: ReturnType<typeof read>) => void) => {
  const y = clone(x);
  mut(y);
  return ids(checkNextcare(y, ctx), "hard");
};
assert.deepEqual(bad((y) => (y.header.approvalNumber = "")), ["approval_number"]);
assert.deepEqual(bad((y) => (y.header.approvalNumber = "C00/1")), ["approval_number"], "too short to be an approval number");
assert.deepEqual(bad((y) => (y.header.approvalDate = null)), ["approval_date"]);
assert.deepEqual(bad((y) => (y.header.approvalDate = "2026-08-01")), ["approval_date_future"]);
assert.deepEqual(bad((y) => (y.header.certificateNumber = "")), ["card"]);
assert.deepEqual(bad((y) => (y.lines = [])), ["no_lines"]);
assert.deepEqual(bad((y) => (y.header.approvedTotal = null)), ["approved_total_missing"]);
assert.deepEqual(bad((y) => (y.lines[2].approvedAmount = 1600)), ["approved_total"], "the lines must add up to the printed total");
assert.deepEqual(bad((y) => (y.lines[3].patientShare = 10)), ["patient_share_total"]);

const expired = ids(checkNextcare(x, { today: "2026-08-05" }), "soft");
assert.ok(expired.includes("expired"), "past the valid-until date: warned, not blocked");
assert.ok(!ids(checkNextcare(x, ctx), "soft").includes("expired"));
const oddTooth = clone(x);
oddTooth.lines[2].teeth = ["44", "99"];
assert.ok(ids(checkNextcare(oddTooth, ctx), "soft").includes("teeth"), "a tooth that does not exist is flagged");

// --- 5. the schema never asks for the national id --------------------------------------------------------
assert.ok(!JSON.stringify(NEXTCARE_RESPONSE_SCHEMA).toLowerCase().includes("national"));
assert.ok(buildNextcarePrompt().includes("national ID"), "the prompt says not to copy it");

// --- 6. the approval record ---------------------------------------------------------------------------------
const confirmed = normalizeConfirmed(clone(x), "nextcare");
assert.deepEqual(confirmed, x, "the server reads the card's posting back unchanged");
const stored = claimFromExtraction({
  payerId: "nextcare",
  format: "nextcare",
  extraction: confirmed,
  patientId: "p1",
  patientName: "مثال اسم مريض",
  status: "treated",
  treatedDate: "2026-07-06",
  doc: { path: "", contentType: "", bytes: 0, pages: null },
});
assert.equal(stored.insurer, "nextcare");
assert.equal(stored.metlife.validUntil, "2026-08-04", "NextCare's own fields are kept on the record");
assert.equal(stored.metlife.memberCode, "AB12");
assert.ok(!Object.values(stored.metlife).includes(undefined as never), "nothing undefined (Firestore refuses it)");
const parsed = parseClaim("nextcare_c00998877661", JSON.parse(JSON.stringify(stored)));
assert.ok(parsed, "a stored NextCare record reads back");
assert.equal(parsed!.insurer, "nextcare");
assert.deepEqual(parsed!.lines[2].teeth, ["44", "46"], "teeth survive the round trip");
assert.equal(parsed!.metlife.memberCode, "AB12");

// the patient's membership: the card for matching, the bracket code for the sheet
const entry = insuranceEntryToWrite("nextcare", confirmed.header, {}, "nextcare");
assert.deepEqual(entry, { memberNumber: "AB12", certificateNumber: "AB12-CD34-EF56-7890", policyNumber: "4100" });

// treatment rows carry the teeth
const rows = insuranceTreatmentRows({
  claimId: "nextcare_c00998877661",
  claim: { ...parsed!, dentists: {}, lineStatus: {} },
  payerName: "NextCare",
  wording: {},
  actor: { uid: "u", name: "Desk", role: "admin" },
});
assert.equal(rows.length, 2, "refused services write nothing");
assert.equal(rows[0].note.tooth, "44,46");
assert.match(String(rows[0].charge.description), /\(T: 44,46\)/);
assert.equal(rows[1].note.tooth, "Gen", "the X-ray names no tooth");

// --- 7. the monthly sheet, from approvals ---------------------------------------------------------------------
const claim = parsed!;
const other = { ...claim, id: "nextcare_c2", approvalNumber: "C0099887767/1", patientId: "p2", patientName: "مريض تاني", treatedDate: "2026-07-20", metlife: { ...claim.metlife, memberCode: "" } };
const held = { ...claim, id: "nextcare_c3", status: "approved" as const, treatedDate: null };
const elsewhere = { ...claim, id: "nextcare_c4", treatedDate: "2026-08-02" };
const st = buildNextcareStatement({ claims: [other, held, claim, elsewhere], payerId: "nextcare", payerName: "NextCare", from: "2026-07-01", to: "2026-07-31", wording: {} });
assert.equal(st.cases.length, 2, "treated in July only; an approval not treated yet is not billed");
assert.equal(st.cases[0].patientName, "مثال اسم مريض", "by treatment date");
assert.equal(st.cases[0].memberNumber, "AB12");
assert.deepEqual(
  st.cases[0].lines.map((l) => [l.text, l.amount]),
  [
    ["2حشو كمبوزيت رقم 4-6", 1610],
    ["اشعه عاديه", 63.25],
  ],
  "refused services are left out; count, the clinic's wording and the teeth, as the sheet writes them",
);
assert.equal(st.cases[0].subtotal, 1673.25, "each visit totals exactly what NextCare approved");
assert.equal(st.total, 3346.5);
assert.deepEqual(st.missingMemberNumber.map((m) => m.patientId), ["p2"]);
assert.equal(st.month, "2026-07");
assert.equal(DEFAULT_NEXTCARE_WORDING["DEN-14"], "حشو كمبوزيت");

// the clinic's own wording wins, and a co-pay patient is billed the insurer's part only
const copay = { ...claim, lines: claim.lines.map((l, i) => (i === 2 ? { ...l, approvedAmount: 1288, patientShare: 322 } : l)) };
const st2 = buildNextcareStatement({ claims: [copay], payerId: "nextcare", payerName: "NextCare", from: "2026-07-01", to: "2026-07-31", wording: { "DEN-14": "حشو ضوئي" } });
assert.deepEqual(st2.cases[0].lines[0], { text: "2حشو ضوئي رقم 4-6", amount: 1288, rowId: "nextcare_c00998877661#2" });

console.log("insurance nextcare: all checks passed");
