// The AXA approval reader: the model's JSON for a scanned AXA claim form (the Yodawy "Service Claim
// Reference") becomes the same approval record MetLife's and NextCare's readers produce, so saving, the
// patient file, dentists, collecting the share and the booking popup all work unchanged, with AXA's own
// checks and its per-line tooth.
import assert from "node:assert/strict";
import { AXA_RAW } from "./fixtures/insuranceAxa.fixture";
import { AXA_RESPONSE_SCHEMA, axaTeeth, buildAxaPrompt, checkAxa, fromAxaModel, normalizeAxa, parseAxaDate } from "../src/lib/insurance/axa";
import { hasHardFailure } from "../src/lib/insurance/metlife";
import { cardIdentifiesPatient, checkApproval, readerFor } from "../src/lib/insurance/formats";
import { claimFromExtraction, insuranceEntryToWrite, insuranceTreatmentRows, membershipFromPaper, normalizeConfirmed, normalizeLinesFor, parseClaim } from "../src/lib/insurance/claims";
import { buildNextcareStatement } from "../src/lib/insuranceStatementNextcare";
import { INSURER_FORMATS, isInsurerFormat } from "../src/lib/payers";

const ctx = { today: "2026-08-20" };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const read = (raw: unknown = AXA_RAW) => normalizeAxa(fromAxaModel(raw));
const ids = (checks: { id: string; severity: string }[], severity: string) => checks.filter((c) => c.severity === severity).map((c) => c.id);

// --- 1. dates: the service time/date, with or without the clock ---------------------------------------
assert.equal(parseAxaDate("17/08/2026 09:43:50 PM"), "2026-08-17");
assert.equal(parseAxaDate("17/08/2026"), "2026-08-17");
assert.equal(parseAxaDate("17-08-2026 21:43"), "2026-08-17");
assert.equal(parseAxaDate("2026-08-17"), "2026-08-17");
assert.equal(parseAxaDate("31/02/2026"), null, "not a real day");
assert.equal(parseAxaDate(""), null);

// --- 2. the tooth box ----------------------------------------------------------------------------------
assert.deepEqual(axaTeeth("LR7"), ["47"], "lower right 7");
assert.deepEqual(axaTeeth("UL3"), ["23"]);
assert.deepEqual(axaTeeth("LR 6-7"), ["46", "47"]);
assert.deepEqual(axaTeeth("LR7, UR6"), ["47", "16"]);
assert.deepEqual(axaTeeth("URE"), ["55"], "milk teeth as letters");
assert.deepEqual(axaTeeth(""), []);
assert.deepEqual(axaTeeth("-"), []);

// --- 3. reading the paper --------------------------------------------------------------------------------
const x = read();
assert.equal(x.header.approvalNumber, "13200001");
assert.equal(x.header.claimNumber, "1200001", "the claim number is kept beside the approval number");
assert.equal(x.header.approvalDate, "2026-08-17", "the service date is the approval date");
assert.equal(x.header.certificateNumber, "51102982A7E0", "the card, upper-case, in the certificate's place");
assert.equal(x.header.dependentCode, "", "a lone dash for the employee code means none");
assert.equal(x.header.policyNumber, "2025/12345678/01");
assert.equal(x.header.copayPercent, 0);
assert.equal(x.header.statusText, "completed");
assert.equal(x.header.physician, "Dr Example Dentist Clinic - Cairo");
assert.equal(x.header.diagnosisCode, "K02 - dental caries");
assert.equal(x.header.insurerName, "AXA");
assert.equal(x.header.approvedTotal, 2951, "what the insurer pays");
assert.equal(x.header.patientShareTotal, 0);
assert.equal(x.header.requestedTotal, 2951, "total performed");
assert.equal(x.header.memberCode, "", "AXA has no monthly sheet code");
assert.equal(x.lines.length, 5);
const [consult, xray, rct, post, composite] = x.lines;
assert.equal(consult.code, "", "AXA prints no service codes");
assert.equal(consult.description, "Dental Consultation");
assert.deepEqual(consult.teeth, []);
assert.deepEqual(xray.teeth, ["47"]);
assert.equal(rct.grossPerUnit, 1646);
assert.equal(rct.grossTotal, 1646, "the printed line total");
assert.equal(rct.approvedAmount, 1646);
assert.equal(rct.patientShare, 0);
assert.equal(rct.comment, "Service Requires Manual Review");
assert.equal(post.unitsApproved, 1);
assert.equal(composite.approvedAmount, 581);
assert.deepEqual(normalizeAxa(clone(x)), x, "idempotent, field for field");
assert.equal(normalizeAxa(null).lines.length, 0, "junk in, empty out");

// a co-pay plan: each line's net is split by the printed Dental Cop %
const copay = clone(AXA_RAW);
copay.header.copayPercent = "20%";
copay.header.byPatient = "590.20 EGP";
copay.header.byInsurer = "2360.80 EGP";
const y = read(copay);
assert.equal(y.header.copayPercent, 20);
assert.equal(y.lines[2].patientShare, 329.2, "20% of 1646");
assert.equal(y.lines[2].approvedAmount, 1316.8);
assert.deepEqual(ids(checkAxa(y, ctx), "hard"), [], "the split adds up to both printed totals");

// a discount on a line: the net, not the gross, is what is paid
const discounted = clone(AXA_RAW);
(discounted.lines[2] as Record<string, unknown>).discount = 146;
(discounted.lines[2] as Record<string, unknown>).netAmount = 1500;
assert.equal(read(discounted).lines[2].approvedAmount, 1500);

// a service approved for nothing pays nothing
const refused = clone(AXA_RAW);
(refused.lines[3] as Record<string, unknown>).approvedQty = 0;
(refused.lines[3] as Record<string, unknown>).totalApproved = 0;
(refused.lines[3] as Record<string, unknown>).netAmount = null;
assert.equal(read(refused).lines[3].approvedAmount, 0);

// --- 4. checks ---------------------------------------------------------------------------------------------
assert.deepEqual(ids(checkAxa(x, ctx), "hard"), [], "the clean paper passes every hard check");
assert.ok(ids(checkAxa(x, ctx), "soft").includes("manual_review"), "a line tagged for manual review is worth a look");
assert.ok(!hasHardFailure(checkAxa(x, ctx)));

const bad = (mut: (y: ReturnType<typeof read>) => void) => {
  const z = clone(x);
  mut(z);
  return ids(checkAxa(z, ctx), "hard");
};
assert.deepEqual(bad((z) => (z.header.approvalNumber = "")), ["approval_number"]);
assert.deepEqual(bad((z) => (z.header.approvalNumber = "12A")), ["approval_number"], "digits only, and enough of them");
assert.deepEqual(bad((z) => (z.header.approvalDate = null)), ["approval_date"]);
assert.deepEqual(bad((z) => (z.header.approvalDate = "2026-09-01")), ["approval_date_future"]);
assert.deepEqual(bad((z) => (z.header.certificateNumber = "")), ["card"]);
assert.deepEqual(bad((z) => (z.lines = [])), ["no_lines"]);
assert.deepEqual(bad((z) => (z.header.approvedTotal = null)), ["approved_total_missing"]);
assert.deepEqual(bad((z) => (z.lines[2].approvedAmount = 1600)), ["approved_total"], "the lines must add up to By Insurer");
assert.deepEqual(bad((z) => (z.lines[3].patientShare = 10)), ["patient_share_total"], "and to By Patient");

const soft = (mut: (y: ReturnType<typeof read>) => void) => {
  const z = clone(x);
  mut(z);
  return ids(checkAxa(z, ctx), "soft");
};
assert.ok(soft((z) => (z.header.certificateNumber = "ABC")).includes("card_format"), "a card that is not 12 hex characters is questioned, not blocked");
assert.ok(soft((z) => (z.header.statusText = "pending")).includes("status"), "a paper not marked completed is questioned");
assert.ok(soft((z) => (z.header.approvalDate = "2024-08-17")).includes("approval_date_old"), "a year read as 2024 on a fresh paper is questioned, not blocked");
assert.ok(!soft((z) => z).includes("approval_date_old"));
assert.ok(!soft((z) => (z.header.statusText = "completed")).includes("status"));
assert.ok(soft((z) => (z.lines[2].teeth = ["47", "99"])).includes("teeth"));
assert.ok(soft((z) => (z.lines[2].unitsApproved = 0)).includes("reduced"));
assert.ok(soft((z) => (z.header.confidence.certificateNumber = 0.3)).includes("low_confidence"));
assert.ok(ids(checkAxa(x, { ...ctx, matchedPatientName: "محمد", nameScore: 0.1 }), "soft").includes("name_mismatch"));

// --- 5. the schema and the prompt ------------------------------------------------------------------------
assert.ok(!JSON.stringify(AXA_RESPONSE_SCHEMA).toLowerCase().includes("national"));
assert.ok(buildAxaPrompt().includes("character by character"), "the card is read character by character");
assert.ok(buildAxaPrompt().includes("By Insurer"));

// --- 6. the format switch ---------------------------------------------------------------------------------
assert.ok(isInsurerFormat("axa"));
assert.ok(INSURER_FORMATS.some((f) => f.id === "axa"));
assert.ok(cardIdentifiesPatient("axa"), "an AXA card belongs to one person");
assert.equal(readerFor("axa").schema, AXA_RESPONSE_SCHEMA);
assert.deepEqual(readerFor("axa").normalize(AXA_RAW), x);
assert.deepEqual(checkApproval("axa", x, ctx), checkAxa(x, ctx));
assert.deepEqual(membershipFromPaper("axa", x.header), { memberNumber: "", certificateNumber: "51102982A7E0", dependentCode: "", policyNumber: "2025/12345678/01" });
assert.equal(normalizeLinesFor("axa", [clone(x.lines[1])])[0].teeth?.[0], "47", "teeth survive the line normaliser");

// --- 7. the approval record ---------------------------------------------------------------------------------
const confirmed = normalizeConfirmed(clone(x), "axa");
assert.deepEqual(confirmed, x, "the server reads the card's posting back unchanged");
const stored = claimFromExtraction({
  payerId: "axa",
  format: "axa",
  extraction: confirmed,
  patientId: "p1",
  patientName: "مثال اسم مريض",
  status: "treated",
  treatedDate: "2026-08-17",
  doc: { path: "", contentType: "", bytes: 0, pages: null },
});
assert.equal(stored.insurer, "axa");
assert.equal(stored.metlife.claimNumber, "1200001", "AXA's own fields are kept on the record");
assert.equal(stored.metlife.copayPercent, 0);
assert.ok(!Object.values(stored.metlife).includes(undefined as never), "nothing undefined (Firestore refuses it)");
const parsed = parseClaim("axa_13200001", JSON.parse(JSON.stringify(stored)));
assert.ok(parsed, "a stored AXA record reads back");
assert.equal(parsed!.insurer, "axa");
assert.deepEqual(parsed!.lines[2].teeth, ["47"], "teeth survive the round trip");
assert.equal(parsed!.metlife.claimNumber, "1200001");

// the patient's membership: the card for matching; a member number the clinic typed is kept
const entry = insuranceEntryToWrite("axa", confirmed.header, {}, "axa");
assert.deepEqual(entry, { memberNumber: "", certificateNumber: "51102982A7E0", policyNumber: "2025/12345678/01" });
const kept = insuranceEntryToWrite("axa", confirmed.header, { insurance: { axa: { memberNumber: "M-9", certificateNumber: "OLD" } } }, "axa");
assert.equal(kept?.memberNumber, "M-9");

// treatment rows carry the tooth and the paper's wording
const rows = insuranceTreatmentRows({
  claimId: "axa_13200001",
  claim: { ...parsed!, dentists: {}, lineStatus: {} },
  payerName: "AXA",
  wording: {},
  actor: { uid: "u", name: "Desk", role: "admin" },
});
assert.equal(rows.length, 5);
assert.equal(rows[0].note.tooth, "Gen", "the consultation names no tooth");
assert.equal(rows[2].note.tooth, "47");
assert.match(String(rows[2].charge.description), /Root Canal Treatment/);

// --- 8. the sheet: no AXA layout exists, so NextCare's writer takes the same record ------------------------
const st = buildNextcareStatement({ claims: [parsed!], payerId: "axa", payerName: "AXA", from: "2026-08-01", to: "2026-08-31", wording: {} });
assert.equal(st.cases.length, 1);
assert.equal(st.cases[0].subtotal, 2951);
assert.equal(st.cases[0].lines[2].text, "Root Canal Treatment Posterior Teeth (rotary) رقم 7", "no code, no Arabic: the paper's own name");

console.log("insurance axa: all checks passed");
