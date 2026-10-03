// The MetLife approval reader: what the model returns is turned into a typed extraction, then checked.
//
// The paper is a scan read by a model, so the checks are the safety net: a wrong digit in the approval
// number, a line whose gross is not units x price, a total that does not add up. Hard checks stop the save;
// soft ones only warn. The fixture is invented (the real paper holds a real patient); the structure is the
// real sample's.
//
//   npm run test:insurance-metlife

import assert from "node:assert/strict";
import {
  APPROVAL_NUMBER_RE,
  METLIFE_FORMAT,
  METLIFE_RESPONSE_SCHEMA,
  buildMetlifePrompt,
  checkMetlife,
  hasHardFailure,
  normalizeMetlife,
  parseMetlifeDate,
  parseMoney,
  type Check,
  type MetlifeExtraction,
  type MetlifeHeader,
  type MetlifeLine,
} from "../src/lib/insurance/metlife";
import { latinSkeleton, matchPatient, nameSimilarity } from "../src/lib/insurance/matchPatient";
import { metlifeMemberNumber, readInsurance, readMemberNumbers, writeInsurance } from "../src/lib/patientInsurance";
import {
  CLAIM_STATUSES,
  claimDocId,
  claimExtraction,
  claimFromExtraction,
  claimMetlifeFrom,
  claimTotals,
  insuranceEntryToWrite,
  normalizeConfirmed,
  parseClaim,
  treatedDateAfter,
} from "../src/lib/insurance/claims";
import { DEFAULT_METLIFE_WORDING, buildMetlifeStatement } from "../src/lib/insuranceStatementMetlife";
import { SAMPLE_RAW, claimFixture, lineFixture } from "./fixtures/insuranceMetlife.fixture";
import XLSX from "xlsx-js-style";
import { METLIFE_TITLES, metlifeStatementToWorkbook } from "../src/lib/insuranceStatementMetlifeXlsx";
import type { MetlifeStatement } from "../src/lib/insuranceStatementMetlife";

const ctx = { today: "2026-10-03", providerCode: "DNC0001" };

function clone(x: MetlifeExtraction): MetlifeExtraction {
  return JSON.parse(JSON.stringify(x)) as MetlifeExtraction;
}
function only(checks: Check[], id: string, severity: "hard" | "soft"): Check {
  const found = checks.filter((c) => c.id === id && c.severity === severity);
  assert.equal(found.length, 1, `expected exactly one ${severity} "${id}", got ${found.length}: ${JSON.stringify(checks.map((c) => c.id))}`);
  return found[0];
}
function hard(x: MetlifeExtraction, mutate: (h: MetlifeHeader) => void, id: string): Check {
  const y = clone(x);
  mutate(y.header);
  const checks = checkMetlife(y, ctx);
  assert.equal(hasHardFailure(checks), true, `${id}: a hard check must block`);
  return only(checks, id, "hard");
}
function hardLines(x: MetlifeExtraction, mutate: (lines: MetlifeLine[], h: MetlifeHeader) => void, id: string): Check {
  const y = clone(x);
  mutate(y.lines, y.header);
  const checks = checkMetlife(y, ctx);
  assert.equal(hasHardFailure(checks), true, `${id}: a hard check must block`);
  return only(checks, id, "hard");
}
function soft(x: MetlifeExtraction, mutate: (h: MetlifeHeader) => void, id: string): Check {
  const y = clone(x);
  mutate(y.header);
  const checks = checkMetlife(y, ctx);
  assert.equal(hasHardFailure(checks), false, `${id}: a soft check must not block (${JSON.stringify(checks.map((c) => c.id))})`);
  return only(checks, id, "soft");
}
function softLines(x: MetlifeExtraction, mutate: (lines: MetlifeLine[], h: MetlifeHeader) => void, id: string): Check {
  const y = clone(x);
  mutate(y.lines, y.header);
  const checks = checkMetlife(y, ctx);
  assert.equal(hasHardFailure(checks), false, `${id}: a soft check must not block (${JSON.stringify(checks.map((c) => c.id))})`);
  return only(checks, id, "soft");
}

// --- 1. Dates and money, the way the paper prints them ---------------------------------------------
assert.equal(METLIFE_FORMAT, "metlife");
assert.equal(parseMetlifeDate("03/10/2026"), "2026-10-03", "dd/mm/yyyy");
assert.equal(parseMetlifeDate("01/01/1900"), "1900-01-01");
assert.equal(parseMetlifeDate("9999-12-31"), "9999-12-31", "'no end' is kept as it is");
assert.equal(parseMetlifeDate("2026-10-03"), "2026-10-03");
assert.equal(parseMetlifeDate("10-03-2026"), null);
assert.equal(parseMetlifeDate("31/02/2026"), null, "no such day");
assert.equal(parseMetlifeDate(""), null);
assert.equal(parseMetlifeDate(null), null);
assert.equal(parseMetlifeDate(20261003), null);
assert.equal(parseMoney("1,260.0"), 1260);
assert.equal(parseMoney("60"), 60);
assert.equal(parseMoney(60), 60);
assert.equal(parseMoney(" - "), null);
assert.equal(parseMoney(""), null);
assert.equal(parseMoney(null), null);
assert.equal(parseMoney("abc"), null);
assert.equal(parseMoney(NaN), null);
assert.equal(parseMoney("12.345"), 12.35, "rounded to 2 places");
assert.equal(parseMoney("EGP 0.0"), 0);
assert.ok(APPROVAL_NUMBER_RE.test("D6000001"));
assert.ok(!APPROVAL_NUMBER_RE.test("D69257"));
assert.ok(!APPROVAL_NUMBER_RE.test("d6000001"));

// --- 2. Normalising what the model returned --------------------------------------------------------
const x = normalizeMetlife(SAMPLE_RAW);
assert.equal(x.header.approvalNumber, "D6000001");
assert.equal(x.header.policyNumber, "6481234567");
assert.equal(x.header.employer, "EXAMPLE TRAVEL");
assert.equal(x.header.providerCode, "DNC0001");
assert.equal(x.header.physician, "DR. EXAMPLE - DENTAL", "split on the first ' - ' only");
assert.equal(x.header.approvalDate, "2026-10-03");
assert.equal(x.header.terminationDate, "9999-12-31");
assert.equal(x.header.certificateNumber, "987");
assert.equal(x.header.dependentCode, "1");
assert.equal(x.header.estimatedCost, 1260);
assert.equal(x.header.requestedTotal, 1260);
assert.equal(x.header.approvedTotal, 1260);
assert.equal(x.header.patientShareTotal, 0);
assert.equal(x.header.collectNote, 0);
assert.equal(x.header.confidence.approvalNumber, 0.98);
assert.equal(x.lines.length, 5);
assert.equal(x.lines[2].code, "D2650");
assert.equal(x.lines[2].grossTotal, 600);

// Codes are tidied: trimmed and upper-cased.
const tidy = normalizeMetlife({ header: { approvalNumber: " d6000001 ", providerCode: " dnc0001 ", policyNumber: "123" }, lines: [{ code: " d0120 " }] });
assert.equal(tidy.header.approvalNumber, "D6000001");
assert.equal(tidy.header.providerCode, "DNC0001");
assert.equal(tidy.header.physician, "");
assert.equal(tidy.header.policyNumber, "123");
assert.equal(tidy.header.employer, "");
assert.equal(tidy.lines[0].code, "D0120");

// Junk never throws; it yields empty strings, nulls and no lines.
for (const junk of [null, undefined, 5, "text", [], {}, { header: 7, lines: "x" }, { header: null, lines: [null, 3, "x"] }]) {
  const j = normalizeMetlife(junk);
  assert.equal(j.header.approvalNumber, "");
  assert.equal(j.header.approvalDate, null);
  assert.equal(j.header.requestedTotal, null);
  assert.deepEqual(j.header.confidence, {});
  assert.ok(Array.isArray(j.lines));
}
assert.equal(normalizeMetlife({ lines: [null, 3] }).lines.length, 2, "an unreadable row is kept as an empty line, not dropped silently");
assert.equal(normalizeMetlife({ lines: [null] }).lines[0].confidence, 0, "an empty row is not trusted");

// A lone dash is the paper's "empty", not a value.
for (const dash of ["-", " - ", "–", "—"]) {
  const d = normalizeMetlife({ header: { dependentCode: dash, certificateNumber: dash, statusText: dash, comment: dash }, lines: [{ code: dash, comment: dash }] });
  assert.equal(d.header.dependentCode, "");
  assert.equal(d.header.certificateNumber, "");
  assert.equal(d.header.statusText, "");
  assert.equal(d.header.comment, "");
  assert.equal(d.lines[0].code, "");
}

// The split does not depend on the spaces around the dash, and stops at the first one.
{
  const t = normalizeMetlife({ header: { policyNumber: "6481234567-EXAMPLE TRAVEL", providerCode: "DNC0001-DR. EXAMPLE - DENTAL" } });
  assert.equal(t.header.policyNumber, "6481234567");
  assert.equal(t.header.employer, "EXAMPLE TRAVEL");
  assert.equal(t.header.providerCode, "DNC0001");
  assert.equal(t.header.physician, "DR. EXAMPLE - DENTAL");
}

// The Total row is not a service line, wherever the model puts it.
{
  const raw = JSON.parse(JSON.stringify(SAMPLE_RAW));
  raw.lines.push({ code: "", description: "Total", unitsRequested: 5, grossPerUnit: null, grossTotal: 1260, unitsApproved: 5, patientShare: 0, approvedAmount: 1260, comment: "", confidence: 0.9 });
  assert.equal(normalizeMetlife(raw).lines.length, 5);
}

// A number the model could not read (null) counts as 0 and flags that row for a look.
{
  const raw = JSON.parse(JSON.stringify(SAMPLE_RAW));
  raw.lines[1].grossPerUnit = null;
  const n = normalizeMetlife(raw);
  assert.equal(n.lines[1].grossPerUnit, 0);
  assert.equal(n.lines[1].confidence, 0);
  assert.equal(n.lines[0].confidence, 0.95, "the other rows keep theirs");
  const checks = checkMetlife(n, ctx);
  assert.equal(only(checks, "low_confidence", "soft").field, "lines[1]");
  only(checks, "line_gross", "hard"); // 1 x 0 is not 60: the arithmetic catches it as well
}

// Confidence is kept only for the header fields that exist.
assert.deepEqual(normalizeMetlife({ header: { confidence: { approvalNumber: 0.9, bogus: 0.1, statusText: 2 } } }).header.confidence, { approvalNumber: 0.9, statusText: 1 });

// --- 3. The checks ---------------------------------------------------------------------------------
assert.deepEqual(checkMetlife(x, ctx), [], "the clean sample passes");
assert.deepEqual(checkMetlife(x, { ...ctx, matchedPatientName: "EXAMPLE PATIENT NAME", nameScore: 0.9 }), [], "a good name match raises nothing");

// every check speaks in both languages
{
  const bad = hard(x, (h) => (h.approvalNumber = "D69257"), "approval_number");
  assert.equal(bad.field, "approvalNumber");
  assert.ok(bad.en.length > 5);
  assert.ok(/[؀-ۿ]/.test(bad.ar), "the Arabic text is Arabic");
}

// hard rules, each by mutating a copy
hard(x, (h) => (h.approvalNumber = ""), "approval_number");
hard(x, (h) => (h.approvalDate = null), "approval_date");
hard(x, (h) => (h.approvalDate = "2026-10-09"), "approval_date_future"); // today + 1 is still fine
{
  const tomorrow = clone(x);
  tomorrow.header.approvalDate = "2026-10-04";
  assert.deepEqual(checkMetlife(tomorrow, ctx), [], "today + 1 day is still fine");
  const dayAfter = clone(x);
  dayAfter.header.approvalDate = "2026-10-05";
  only(checkMetlife(dayAfter, ctx), "approval_date_future", "hard");
}
hardLines(x, (l) => (l[0].grossTotal = 61), "line_gross"); // 1 x 60 is not 61
assert.equal(hardLines(x, (l) => (l[3].grossTotal = 301), "line_gross").field, "lines[3].grossTotal");
hardLines(x, (l) => (l[4].approvedAmount = 200), "approved_total"); // sum 1220, printed 1260
hardLines(x, (l) => { l[0].grossTotal = 60.5; l[0].grossPerUnit = 60.5; }, "requested_total");
hardLines(x, (l) => (l[1].patientShare = 10), "patient_share_total");
hard(x, (h) => (h.collectNote = 15), "patient_share_total");
hard(x, (h) => (h.certificateNumber = ""), "certificate");
hard(x, (h) => (h.dependentCode = ""), "dependent");
{
  // as the model really returns it: a dash where the paper has nothing
  const raw = JSON.parse(JSON.stringify(SAMPLE_RAW));
  raw.header.dependentCode = "-";
  raw.header.certificateNumber = "-";
  const checks = checkMetlife(normalizeMetlife(raw), ctx);
  only(checks, "dependent", "hard");
  only(checks, "certificate", "hard");
}
{
  // no printed share total, but the "Kindly collect" note was read: the lines are checked against it
  const y = clone(x);
  y.header.patientShareTotal = null;
  y.header.collectNote = 0;
  const clean = checkMetlife(y, ctx);
  assert.equal(hasHardFailure(clean), false);
  assert.equal(only(clean, "low_confidence", "soft").field, "patientShareTotal");
  y.lines[1].patientShare = 10;
  y.lines[1].approvedAmount = 50; // keeps the approved column adding up as printed
  y.header.approvedTotal = 1250;
  const bad = checkMetlife(y, ctx);
  assert.equal(only(bad, "patient_share_total", "hard").field, "collectNote");
  assert.equal(hasHardFailure(bad), true);
}
{
  // a nonsense "today" never throws; it only skips the future-date check
  const future = clone(x);
  future.header.approvalDate = "2030-01-01";
  assert.doesNotThrow(() => checkMetlife(future, { today: "not a date" }));
  assert.equal(checkMetlife(future, { today: "" }).filter((c) => c.id === "approval_date_future").length, 0);
}
{
  const none = clone(x);
  none.lines = [];
  const checks = checkMetlife(none, ctx);
  assert.equal(hasHardFailure(checks), true);
  only(checks, "no_lines", "hard");
}
{
  // a cent either way is rounding, not a misread
  const y = clone(x);
  y.lines[0].grossTotal = 60.01;
  assert.equal(checkMetlife(y, ctx).filter((c) => c.id === "line_gross").length, 0);
  // two bad lines are two checks
  const z = clone(x);
  z.lines[0].grossTotal = 61;
  z.lines[1].grossTotal = 62;
  assert.equal(checkMetlife(z, ctx).filter((c) => c.id === "line_gross").length, 2);
}

// soft rules
soft(x, (h) => (h.statusText = "PENDING"), "status");
{
  const y = clone(x);
  y.header.statusText = "APPROVED";
  assert.deepEqual(checkMetlife(y, ctx), [], "plain APPROVED is fine");
}
soft(x, (h) => (h.providerCode = "DNC9999"), "provider_code");
{
  // no provider code on the payer: nothing to compare against
  assert.deepEqual(checkMetlife(x, { today: ctx.today }), []);
}
assert.equal(soft(x, (h) => (h.confidence.approvalNumber = 0.5), "low_confidence").field, "approvalNumber");
softLines(x, (l) => (l[3].confidence = 0.4), "low_confidence");
softLines(x, (l, h) => { l[2].approvedAmount = 500; h.approvedTotal = 1160; }, "reduced"); // totals still add up, so only the soft check fires
{
  // an ordinary copay is not a cut: MetLife pays 540, the patient 60, the gross 600 is covered
  const y = clone(x);
  y.lines[2].approvedAmount = 540;
  y.lines[2].patientShare = 60;
  y.header.approvedTotal = 1200;
  y.header.patientShareTotal = 60;
  y.header.collectNote = 60;
  assert.deepEqual(checkMetlife(y, ctx), [], "a copay line raises nothing");
  // paying the patient's share on top of the full amount is odd, though
  y.lines[2].approvedAmount = 600;
  y.header.approvedTotal = 1260;
  const checks = checkMetlife(y, ctx);
  assert.equal(hasHardFailure(checks), false);
  assert.equal(only(checks, "share_exceeds", "soft").field, "lines[2]");
  assert.equal(checks.filter((c) => c.id === "reduced").length, 0);
}
softLines(x, (l, h) => { l[0].unitsApproved = 0; l[0].approvedAmount = 0; h.approvedTotal = 1200; }, "reduced");
{
  // a null printed total: that sum is skipped and the field is flagged for a look instead
  const y = clone(x);
  y.header.approvedTotal = null;
  const checks = checkMetlife(y, ctx);
  assert.equal(hasHardFailure(checks), false);
  assert.equal(checks.filter((c) => c.id === "approved_total").length, 0);
  assert.equal(only(checks, "low_confidence", "soft").field, "approvedTotal");
}
{
  // the paper's name against the matched patient's
  const y = clone(x);
  const checks = checkMetlife(y, { ...ctx, matchedPatientName: "SOMEONE ELSE", nameScore: 0.2 });
  assert.equal(hasHardFailure(checks), false);
  only(checks, "name_mismatch", "soft");
  assert.equal(checkMetlife(y, { ...ctx, nameScore: 0.2 }).length, 0, "no matched patient, no name check");
  assert.equal(checkMetlife(y, { ...ctx, matchedPatientName: "X", nameScore: 0.5 }).length, 0, "0.5 is not below 0.5");
}
assert.equal(hasHardFailure([]), false);
assert.equal(hasHardFailure(checkMetlife(normalizeMetlife(null), ctx)), true, "an unreadable page cannot be saved");
{
  const xNoLines = clone(x);
  xNoLines.lines = [];
  assert.equal(hasHardFailure(checkMetlife(xNoLines, ctx)), true);
}

// --- 4. The schema and the prompt handed to the model ---------------------------------------------
{
  const s = METLIFE_RESPONSE_SCHEMA as {
    type: string;
    properties: { header: { type: string; properties: Record<string, { type: string }> }; lines: { type: string; items: { properties: Record<string, unknown> } } };
  };
  assert.equal(s.type, "OBJECT");
  assert.equal(s.properties.header.type, "OBJECT");
  assert.equal(s.properties.lines.type, "ARRAY");
  // the schema asks for exactly what normalise reads: the sample's keys are all in it
  for (const key of Object.keys(SAMPLE_RAW.header)) assert.ok(key in s.properties.header.properties, `schema asks for header.${key}`);
  for (const key of Object.keys(SAMPLE_RAW.lines[0])) assert.ok(key in s.properties.lines.items.properties, `schema asks for lines[].${key}`);
}
{
  const p = buildMetlifePrompt();
  for (const needle of ["MetLife", "dd/mm/yyyy", "9999-12-31", "null", "confidence"]) assert.ok(p.includes(needle), `the prompt mentions ${needle}`);
}

// --- 5. The patient matcher: certificate + dependent first, then a transliteration-tolerant name -----
assert.deepEqual(latinSkeleton("NADER MAGED SALEM"), ["ndr", "mgd", "slm"]);
assert.deepEqual(latinSkeleton("نادر ماجد سالم"), ["ndr", "mgd", "slm"]);
assert.deepEqual(latinSkeleton("محمود محمد"), ["mhmd", "mhmd"]);
assert.deepEqual(latinSkeleton("  "), [], "blank in, no tokens out");
assert.ok(nameSimilarity("AHMED MOHAMED ALI", "أحمد محمد علي") >= 0.99);
assert.ok(nameSimilarity("AHMED MOHAMED ALI", "سارة فتحي") < 0.2);
assert.equal(nameSimilarity("", "نادر ماجد"), 0, "an empty name matches nothing");
assert.ok(nameSimilarity("OMAR KHALED FAHMY", "عمر خالد فهمي") >= 0.99, "kh and the Arabic kha agree");
{
  const fam = [
    { id: "p1", name: "ليلى خالد فهمي", insurance: { metlife: { memberNumber: "8700001/3", certificateNumber: "8700001", dependentCode: "3" } } },
    { id: "p2", name: "عمر خالد فهمي", insurance: { metlife: { memberNumber: "8700001/2", certificateNumber: "8700001", dependentCode: "2" } } },
    { id: "p3", name: "نادر ماجد سالم" },
  ];
  assert.deepEqual(
    matchPatient({ payerId: "metlife", certificateNumber: "8700001", dependentCode: "2", paperPatientName: "OMAR KHALED FAHMY" }, fam),
    { kind: "exact", patientId: "p2" },
  );
  const m = matchPatient({ payerId: "metlife", certificateNumber: "987", dependentCode: "1", paperPatientName: "NADER MAGED SALEM" }, fam);
  assert.equal(m.kind, "candidates");
  if (m.kind === "candidates") assert.equal(m.candidates[0].patientId, "p3");
  assert.equal(matchPatient({ payerId: "metlife", certificateNumber: "9", dependentCode: "9", paperPatientName: "ZZZ QQQ" }, fam).kind, "none");

  // the family case: same certificate, a different dependent, a near-identical name — never a match
  const sibling = matchPatient({ payerId: "metlife", certificateNumber: "8700001", dependentCode: "4", paperPatientName: "OMAR KHALED FAHMY" }, fam);
  assert.equal(sibling.kind, "none", "p1 and p2 hold this certificate under other dependents; neither may be offered");
  // the same certificate printed under another insurer is not this family
  assert.equal(matchPatient({ payerId: "other", certificateNumber: "8700001", dependentCode: "2", paperPatientName: "OMAR KHALED FAHMY" }, fam).kind, "candidates");
  // blank paper identity never claims an exact match
  assert.notEqual(matchPatient({ payerId: "metlife", certificateNumber: "", dependentCode: "", paperPatientName: "OMAR KHALED FAHMY" }, fam).kind, "exact");
  // at most three candidates, best first, ties by name
  const many = [
    { id: "q0", name: "نادر ماجد د" },
    { id: "q1", name: "نادر ماجد ج" },
    { id: "q2", name: "نادر ماجد سالم" },
    { id: "q3", name: "نادر ماجد أ" },
    { id: "q4", name: "نادر" },
  ];
  const top = matchPatient({ payerId: "metlife", certificateNumber: "5", dependentCode: "1", paperPatientName: "NADER MAGED SALEM" }, many);
  assert.equal(top.kind, "candidates");
  if (top.kind === "candidates") assert.deepEqual(top.candidates.map((c) => c.patientId), ["q2", "q3", "q1"], "best first, the tie on 2/3 broken by name, capped at three");

  // two records claim the same certificate and dependent: the desk chooses, best name first
  const twins = [
    { id: "t1", name: "سارة فتحي", insurance: { metlife: { memberNumber: "5/1", certificateNumber: "5", dependentCode: "1" } } },
    { id: "t2", name: "نادر ماجد سالم", insurance: { metlife: { memberNumber: "5/1", certificateNumber: "5", dependentCode: "1" } } },
  ];
  const dup = matchPatient({ payerId: "metlife", certificateNumber: "5", dependentCode: "1", paperPatientName: "NADER MAGED SALEM" }, twins);
  assert.equal(dup.kind, "candidates");
  if (dup.kind === "candidates") assert.deepEqual(dup.candidates.map((c) => c.patientId), ["t2", "t1"]);

  // no dependent code on the paper: the certificate's family is offered, the best name first
  const noDep = matchPatient({ payerId: "metlife", certificateNumber: "8700001", dependentCode: "", paperPatientName: "OMAR KHALED FAHMY" }, fam);
  assert.equal(noDep.kind, "candidates");
  if (noDep.kind === "candidates") assert.deepEqual(noDep.candidates.map((c) => c.patientId), ["p2", "p1"]);
  const noDepStranger = matchPatient({ payerId: "metlife", certificateNumber: "8700001", dependentCode: " ", paperPatientName: "ZZZ QQQ" }, fam);
  assert.equal(noDepStranger.kind, "candidates", "the family is offered even when the name is unreadable");

  // records and papers with fields missing never throw
  assert.doesNotThrow(() =>
    matchPatient(
      { payerId: "metlife", certificateNumber: "5", dependentCode: undefined as unknown as string, paperPatientName: undefined as unknown as string },
      [{ id: "n1", name: undefined as unknown as string, insurance: { metlife: { memberNumber: "5/1", certificateNumber: "5", dependentCode: "1" } } }, { id: "n2", name: undefined as unknown as string }],
    ),
  );
}
// the score does not depend on which side is which
for (const [a, b] of [["AHMED MOHAMED ALI", "أحمد محمد"], ["NADER MAGED SALEM", "نادر ماجد"], ["ABDEL RAHMAN SALEM", "عبد الرحمن"]]) {
  assert.equal(nameSimilarity(a, b), nameSimilarity(b, a), `${a} / ${b}`);
}
// letters and digraphs the first map missed
assert.ok(nameSimilarity("HAFEZ NAZER", "حافظ ناظر") >= 0.99, "ظ is z");
assert.ok(nameSimilarity("THAMER DHAKI", "ثامر ذكي") >= 0.99, "th and dh are one Arabic letter each");
// compound names: written apart in Latin, together in Arabic
assert.ok(nameSimilarity("ABDEL RAHMAN SALEM", "عبدالرحمن سالم") >= 0.99);
assert.ok(nameSimilarity("EL SAYED AHMED", "السيد احمد") >= 0.99);
assert.ok(nameSimilarity("ABDEL RAHMAN", "عبد الرحمن") >= 0.99);
assert.ok(nameSimilarity("ABDEL RAHMAN SALEM", "سارة فتحي") < 0.2, "merging prefixes does not make strangers match");
assert.equal(metlifeMemberNumber("987", "1"), "987/1");
assert.deepEqual(
  readInsurance({ insurance: { metlife: { memberNumber: " 987/1 ", certificateNumber: "987", dependentCode: "1", policyNumber: "  " }, bad: 5, blank: { memberNumber: " " } } }),
  { metlife: { memberNumber: "987/1", certificateNumber: "987", dependentCode: "1" } },
);
assert.deepEqual(readInsurance({}), {});
assert.deepEqual(readInsurance({ insurance: { x: { memberNumber: "A1" } } }), { x: { memberNumber: "A1" } });
assert.deepEqual(
  Object.fromEntries(Object.entries(readInsurance({ insurance: { x: { memberNumber: "A1", dependentCode: "2" } } })).map(([k, v]) => [k, v.memberNumber])),
  readMemberNumbers({ insurance: { x: { memberNumber: "A1", dependentCode: "2" } } }),
  "readInsurance agrees with readMemberNumbers on the member number",
);

// --- 6. Writing the patient's insurance back: plain member numbers and MetLife's three boxes ----------
assert.deepEqual(writeInsurance({ nextcare: " A1B2 ", blank: "  ", "Bad Id": "X" }), { nextcare: { memberNumber: "A1B2" } }, "a string is the plain member number, as before");
assert.deepEqual(writeInsurance({ metlife: { certificateNumber: " 987 ", dependentCode: "1", policyNumber: "6481234567", memberNumber: "" } }), { metlife: { memberNumber: "987/1", certificateNumber: "987", dependentCode: "1", policyNumber: "6481234567" } });
assert.deepEqual(writeInsurance({ nextcare: "A1B2", metlife: { certificateNumber: "", dependentCode: "", memberNumber: "" } }), { nextcare: { memberNumber: "A1B2" } });
// the derived member number wins over a stale typed one
assert.deepEqual(writeInsurance({ metlife: { certificateNumber: "5", dependentCode: "2", memberNumber: "OLD" } }), { metlife: { memberNumber: "5/2", certificateNumber: "5", dependentCode: "2" } });
// blank policy number is left out, never written as ""
assert.deepEqual(writeInsurance({ metlife: { certificateNumber: "5", dependentCode: "0", policyNumber: "  ", memberNumber: "" } }), { metlife: { memberNumber: "5/0", certificateNumber: "5", dependentCode: "0" } });
// no certificate and dependent: only a typed member number survives
assert.deepEqual(writeInsurance({ metlife: { policyNumber: "999", memberNumber: " M7 " } }), { metlife: { memberNumber: "M7", policyNumber: "999" } });
// a policy-only entry is kept, with an empty member number, and survives the round trip into the editor
{
  const stored = writeInsurance({ metlife: { policyNumber: "999", memberNumber: "" } });
  assert.deepEqual(stored, { metlife: { memberNumber: "", policyNumber: "999" } });
  assert.deepEqual(readInsurance({ insurance: stored }), stored);
  assert.deepEqual(readMemberNumbers({ insurance: stored }), {}, "the statement's reader still wants a member number");
}
assert.deepEqual(writeInsurance({ metlife: { policyNumber: " ", memberNumber: "" } }), {}, "all four blank: nothing stored");
// only one of the two: what is there is kept, and nothing is ever undefined
{
  const out = writeInsurance({ metlife: { certificateNumber: "987", dependentCode: " ", memberNumber: "" } });
  assert.deepEqual(out, { metlife: { memberNumber: "", certificateNumber: "987" } });
  assert.ok(Object.values(out.metlife).every((v) => v !== undefined), "Firestore refuses undefined");
  assert.deepEqual(readInsurance({ insurance: out }), out, "a cert-only entry round-trips");
  assert.deepEqual(readMemberNumbers({ insurance: out }), {});
  // ...and it is never an exact match: that needs the certificate and the dependent code
  const m = matchPatient({ payerId: "metlife", certificateNumber: "987", dependentCode: "1", paperPatientName: "ZZ" }, [{ id: "p1", name: "ZZ", insurance: out }]);
  assert.notEqual(m.kind, "exact");
}
// what the editor reads, it can write back unchanged
{
  const stored = { metlife: { memberNumber: "987/1", certificateNumber: "987", dependentCode: "1", policyNumber: "6481234567" }, nextcare: { memberNumber: "A1B2" } };
  assert.deepEqual(writeInsurance(readInsurance({ insurance: stored })), stored);
}

// --- 7. The claim record: one document per approval number ------------------------------------------

{
  // The brief's second case was "D-69/257.66", which strips to d6925766, not d6000001: the case is
  // kept as written in intent (separators are dropped, the digits stay) with digits that do strip to it.
  assert.equal(claimDocId("metlife", " D6000001 "), "metlife_d6000001");
  assert.equal(claimDocId("metlife", "D-60/000.01"), "metlife_d6000001");
  assert.equal(claimDocId("MetLife", "d6000001"), "metlife_d6000001", "the insurer part is tidied too");

  const doc = { path: "clinics/c1/insurance_docs/d1/approval.pdf", contentType: "application/pdf", bytes: 1234, pages: null };
  const c = claimFromExtraction({ payerId: "metlife", extraction: normalizeMetlife(SAMPLE_RAW), patientId: "p3", patientName: "نادر ماجد سالم", status: "treated", treatedDate: "2026-10-03", doc });
  assert.equal(c.approvalDate, "2026-10-03");
  assert.deepEqual(c.totals, { requested: 1260, approved: 1260, patientShare: 0 });
  assert.equal(JSON.stringify(c).includes("undefined"), false);
  assert.equal(parseClaim("x", { ...c, status: "bogus" }), null);

  // nothing in the record is undefined, at any depth: Firestore refuses the whole write for one
  const undefinedAt = (v: unknown, at: string): string | null => {
    if (v === undefined) return at;
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        const found = undefinedAt(x, `${at}.${k}`);
        if (found) return found;
      }
    }
    return null;
  };
  assert.equal(undefinedAt(c, "claim"), null);

  // the record carries what the paper said, minus what sits on the claim itself
  assert.equal(c.insurer, "metlife");
  assert.equal(c.approvalNumber, "D6000001");
  assert.equal(c.paperPatientName, "EXAMPLE PATIENT NAME");
  assert.equal(c.patientName, "نادر ماجد سالم");
  assert.equal(c.metlife.policyNumber, "6481234567");
  assert.equal(c.metlife.employer, "EXAMPLE TRAVEL");
  assert.equal(c.metlife.providerCode, "DNC0001");
  assert.equal(c.metlife.physician, "DR. EXAMPLE - DENTAL");
  assert.equal("approvalNumber" in c.metlife || "confidence" in c.metlife || "paperPatientName" in c.metlife, false);
  assert.equal(c.lines.length, 5);
  assert.deepEqual(c.doc, doc);

  // what is stored reads back as the same claim
  const parsed = parseClaim("metlife_d6000001", JSON.parse(JSON.stringify(c)));
  assert.ok(parsed);
  assert.deepEqual(parsed, { id: "metlife_d6000001", ...c });
  // an approved-not-treated claim keeps a null treated date
  const held = claimFromExtraction({ payerId: "metlife", extraction: normalizeMetlife(SAMPLE_RAW), patientId: "p3", patientName: "x", status: "approved", treatedDate: null, doc });
  assert.equal(parseClaim("y", held)?.treatedDate, null);
  // junk is refused, never half-read
  assert.equal(parseClaim("x", null), null);
  assert.equal(parseClaim("x", { ...c, patientId: "" }), null, "a claim always names its patient");
  assert.equal(parseClaim("x", { ...c, insurer: "nextcare" }), null);
  assert.equal(parseClaim("x", { ...c, treatedDate: "03/10/2026" }), null);
  for (const s of CLAIM_STATUSES) assert.equal(parseClaim("x", { ...c, status: s })?.status, s);

  // totals come from the lines
  const lines = normalizeMetlife(SAMPLE_RAW).lines.map((l, i) => (i === 0 ? { ...l, patientShare: 15, approvedAmount: 45 } : l));
  assert.deepEqual(claimTotals(lines), { requested: 1260, approved: 1245, patientShare: 15 });

  // what the confirm card posts back is the normalised extraction; reading it again changes nothing,
  // and the employer and physician the first pass split off are not lost
  const once = normalizeMetlife(SAMPLE_RAW);
  assert.deepEqual(normalizeConfirmed(JSON.parse(JSON.stringify(once))), once);
  const edited = normalizeConfirmed({ ...once, header: { ...once.header, employer: " NEW CO ", physician: "DR. OTHER" } });
  assert.equal(edited.header.employer, "NEW CO");
  assert.equal(edited.header.physician, "DR. OTHER");
  // a raw model answer still goes through the same way
  assert.deepEqual(normalizeConfirmed(SAMPLE_RAW), once);
  // in the split shape, a policy number typed with a dash is not cut in two again
  const dashed = normalizeConfirmed({ ...once, header: { ...once.header, policyNumber: "648-123", employer: "CO" } });
  assert.equal(dashed.header.policyNumber, "648-123");
  assert.equal(dashed.header.employer, "CO");
}

// --- 8. Editing a claim: the status's treated date, the re-check, the patient's membership -----------

{
  const doc = { path: "clinics/c1/insurance_docs/d1/approval.pdf", contentType: "application/pdf", bytes: 1234, pages: null };
  const claim = { id: "metlife_d6000001", ...claimFromExtraction({ payerId: "metlife", extraction: normalizeMetlife(SAMPLE_RAW), patientId: "p3", patientName: "x", status: "approved", treatedDate: null, doc }) };

  // status → treated date
  const at = (a: Partial<Parameters<typeof treatedDateAfter>[0]>) => treatedDateAfter({ current: null, approvalDate: "2026-10-03", ...a });
  assert.equal(at({ status: "treated" }), "2026-10-03", "treated with no date: the approval date");
  assert.equal(at({ status: "treated", treatedDate: null }), "2026-10-03");
  assert.equal(at({ status: "treated", treatedDate: "2026-10-04" }), "2026-10-04");
  assert.equal(at({ status: "treated", current: "2026-10-05" }), "2026-10-05", "re-marking treated keeps the stored date");
  assert.equal(at({ status: "approved", treatedDate: "2026-10-04", current: "2026-10-05" }), null, "approved is never treated");
  assert.equal(at({ status: "cancelled", current: "2026-10-05" }), undefined, "cancelled leaves it");
  assert.equal(at({ status: "sent" }), undefined);
  assert.equal(at({ status: "sent", treatedDate: "2026-10-06" }), "2026-10-06");
  assert.equal(at({ treatedDate: null, current: "2026-10-05" }), null, "a date cleared on its own");
  assert.equal(at({}), undefined);

  // the claim read back as an extraction passes the same checks it was saved with
  const back = claimExtraction(claim);
  assert.equal(hasHardFailure(checkMetlife(back, ctx)), false);
  assert.deepEqual(claimMetlifeFrom(back.header), claim.metlife, "nothing lost on the way back");
  assert.deepEqual(back.lines, claim.lines);

  // a line whose gross no longer matches its units is refused
  const badLines = claim.lines.map((l, i) => (i === 0 ? { ...l, grossTotal: 70 } : l));
  const badChecks = checkMetlife(claimExtraction(claim, { lines: badLines }), ctx);
  assert.equal(hasHardFailure(badChecks), true);
  assert.ok(badChecks.some((c) => c.id === "line_gross" && c.severity === "hard"));
  // a share moved onto the patient without the printed totals: the sums catch it
  const shared = claim.lines.map((l, i) => (i === 0 ? { ...l, patientShare: 15, approvedAmount: 45 } : l));
  assert.equal(hasHardFailure(checkMetlife(claimExtraction(claim, { lines: shared }), ctx)), true);
  // ...and with the printed totals edited to match, it passes
  const fixed = claimExtraction(claim, { lines: shared, metlife: { approvedTotal: 1245, patientShareTotal: 15, collectNote: 15 } });
  assert.equal(hasHardFailure(checkMetlife(fixed, ctx)), false, JSON.stringify(checkMetlife(fixed, ctx).map((c) => c.id)));
  assert.deepEqual(claimTotals(fixed.lines), { requested: 1260, approved: 1245, patientShare: 15 });
  // a printed total edited out of line with the lines is refused
  assert.equal(hasHardFailure(checkMetlife(claimExtraction(claim, { metlife: { approvedTotal: 1000 } }), ctx)), true);
  // the approval's identity cannot be edited through metlife
  const sneaky = claimExtraction(claim, { metlife: { approvalNumber: "D9999999", paperPatientName: "SOMEONE", employer: "NEW CO" } });
  assert.equal(sneaky.header.approvalNumber, "D6000001");
  assert.equal(sneaky.header.paperPatientName, "EXAMPLE PATIENT NAME");
  assert.equal(sneaky.header.employer, "NEW CO");

  // the patient's membership: written when missing or different, never when the same
  const paper = { certificateNumber: "987", dependentCode: "1", policyNumber: "6481234567" };
  const full = { memberNumber: "987/1", certificateNumber: "987", dependentCode: "1", policyNumber: "6481234567" };
  assert.deepEqual(insuranceEntryToWrite("metlife", paper, {}), full, "missing: written");
  assert.equal(insuranceEntryToWrite("metlife", paper, { insurance: { metlife: full, nextcare: { memberNumber: "A1" } } }), null, "the same: nothing");
  assert.deepEqual(insuranceEntryToWrite("metlife", { ...paper, dependentCode: "2" }, { insurance: { metlife: full } }), { ...full, memberNumber: "987/2", dependentCode: "2" }, "different: written");
  assert.equal(insuranceEntryToWrite("metlife", { ...paper, policyNumber: "" }, { insurance: { metlife: full } }), null, "a blank policy on the paper keeps the typed one");
  assert.deepEqual(insuranceEntryToWrite("metlife", { ...paper, policyNumber: "" }, { insurance: { metlife: { memberNumber: "" , policyNumber: "555" } } }), { ...full, policyNumber: "555" });
  assert.equal(insuranceEntryToWrite("Bad.Id", paper, {}), null, "a payer id that cannot be a field name is never written");
}

// --- 9. The MetLife statement: the month's claims as the sheet MetLife is paid against ---------------
{
  const mk = (n: number, date: string, status: "approved" | "treated" | "sent" | "cancelled", lines = claimFixture().lines) =>
    claimFixture({ id: `metlife_d600000${n}`, approvalNumber: `D600000${n}`, approvalDate: date, status, patientName: `Patient ${n}`, lines });
  const A = mk(1, "2026-01-28", "treated");
  const B = mk(2, "2026-02-27", "sent", [
    lineFixture({ code: "D0120" }),
    lineFixture({ code: "D9999", description: " SOME DESCRIPTION ", grossTotal: 80, approvedAmount: 80 }),
    lineFixture({ code: "D2650", grossTotal: 2700, approvedAmount: 500 }),
    lineFixture({ code: "D0270", unitsApproved: 0, approvedAmount: 0 }),
  ]);
  const C = mk(3, "2026-02-15", "approved");
  const F = mk(9, "2026-02-28", "approved"); // approved but outside the range: not even held back
  const D = mk(4, "2026-01-25", "treated");
  const E = mk(5, "2026-02-01", "cancelled", [lineFixture({ code: "D8888" })]);
  const args = { from: "2026-01-26", to: "2026-02-27", wording: DEFAULT_METLIFE_WORDING };

  const s = buildMetlifeStatement({ claims: [C, A, D, B, E, F], ...args });
  assert.deepEqual(s.cases.map((c) => c.approvalNumber), [A.approvalNumber, B.approvalNumber]);
  assert.deepEqual(s.cases.map((c) => c.serial), [1, 2]);
  assert.equal(s.heldBack, 1);
  assert.deepEqual([s.from, s.to], ["2026-01-26", "2026-02-27"]);
  assert.deepEqual(s.missingWording, ["D9999"], "the cancelled claim's D8888 is not listed, so not missing");
  assert.equal(s.cases[0].lines[0].text, "كشف");
  assert.equal(s.cases[1].lines[1].text, "SOME DESCRIPTION", "no wording: the paper's description, trimmed");
  assert.deepEqual([s.cases[1].lines[2].requested, s.cases[1].lines[2].approved], [2700, 500]);
  assert.deepEqual(s.cases[1].lines[3], { text: "اشعه عاديه", count: 0, requested: 60, approved: 0 }, "a rejected line is still printed");
  assert.equal(s.cases[1].subtotal, 60 + 80 + 500);
  assert.equal(s.cases[0].subtotal, 1260);
  assert.equal(s.total, s.cases[0].subtotal + s.cases[1].subtotal);
  assert.deepEqual(
    [s.cases[0].patientName, s.cases[0].policyNumber, s.cases[0].certificateNumber, s.cases[0].dependentCode, s.cases[0].date],
    ["Patient 1", A.metlife.policyNumber, "987", "1", "2026-01-28"],
  );
  assert.equal(s.cases[0].lines[0].count, 1);

  // the range is inclusive at both ends
  const edge = buildMetlifeStatement({ claims: [A, B, D], from: "2026-01-28", to: "2026-02-27", wording: DEFAULT_METLIFE_WORDING });
  assert.deepEqual(edge.cases.map((c) => c.approvalNumber), [A.approvalNumber, B.approvalNumber]);
  // the same day: approval number decides; a blank wording falls back to the paper
  const same = buildMetlifeStatement({ claims: [mk(7, "2026-02-02", "sent"), mk(6, "2026-02-02", "treated")], from: "2026-02-01", to: "2026-02-03", wording: { D0120: "  " } });
  assert.deepEqual(same.cases.map((c) => c.approvalNumber), ["D6000006", "D6000007"]);
  assert.equal(same.cases[0].lines[0].text, "PERIODIC ORAL EVALUATION");
  assert.deepEqual(same.missingWording, ["D0120", "D0270", "D2650", "D3120", "D4220"], "distinct codes, first-seen order");
  // nothing in range: an empty, zero statement
  const none = buildMetlifeStatement({ claims: [A], from: "2026-03-01", to: "2026-03-31", wording: DEFAULT_METLIFE_WORDING });
  assert.deepEqual([none.cases.length, none.total, none.heldBack, none.missingWording.length], [0, 0, 0, 0]);
  // cents add without floating drift
  const cents = buildMetlifeStatement({
    claims: [mk(8, "2026-02-02", "treated", [lineFixture({ approvedAmount: 0.1 }), lineFixture({ approvedAmount: 0.2 })])],
    ...args,
  });
  assert.equal(cents.cases[0].subtotal, 0.3);
  assert.equal(cents.total, 0.3);
}

// --- 10. The MetLife workbook: the statement as MetLife's sheet, cell for cell ---------------------------------
{
  const L = (text: string, count: number, requested: number, approved: number) => ({ text, count, requested, approved });
  const caseA = { serial: 1, patientName: "Patient 1", policyNumber: "6481234567", certificateNumber: "987", dependentCode: "1", approvalNumber: "D6000001", date: "2026-01-28", lines: [L("كشف", 1, 60, 60), L("اشعه عاديه", 1, 60, 60)], subtotal: 120 };
  const caseB = { serial: 2, patientName: "Patient 2", policyNumber: "6481234567 - EXAMPLE", certificateNumber: "12A", dependentCode: "2", approvalNumber: "D6000002", date: "2026-02-27", lines: [L("كشف", 1, 60, 60), L("حشو كمبوزيت", 2, 2700, 500), L("اشعه عاديه", 0, 60, 0)], subtotal: 560 };
  const st: MetlifeStatement = { from: "2026-01-26", to: "2026-02-27", cases: [caseA, caseB], total: 680, missingWording: [], heldBack: 0 };
  const head = { line1: "Clinic", line2: "Address", line3: "Phones" };

  const wb = metlifeStatementToWorkbook(st, head);
  const back = XLSX.read(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellStyles: true });
  const ws = back.Sheets.Sheet1; // values, types, formulas, merges: what the bytes say
  // styles: a second, never-written build (the reader does not hand fonts back, and the writer rewrites colours to FFrrggbb in place)
  const mem = metlifeStatementToWorkbook(st, head).Sheets.Sheet1;
  const merges = (ws["!merges"] as XLSX.Range[]).map((m) => XLSX.utils.encode_range(m));
  const ref = XLSX.utils.encode_cell;

  // where things land, derived from the fixture: three header rows and the title, then each case's lines and a subtotal
  const aFirst = 4;
  const aLast = aFirst + caseA.lines.length - 1; // 0-based; the subtotal is the next row
  const aSub = aLast + 1;
  const bFirst = aSub + 1;
  const bLast = bFirst + caseB.lines.length - 1;
  const bSub = bLast + 1;
  const footTop = bSub + 1;
  const footEnd = footTop + 2;
  assert.equal(XLSX.utils.decode_range(ws["!ref"] as string).e.r, footEnd, "the sheet ends with the three footer rows");

  assert.deepEqual(wb.SheetNames, ["Sheet1"]);
  assert.equal(METLIFE_TITLES.length, 11);
  for (let c = 0; c < 11; c++) assert.equal(ws[ref({ r: 3, c })].v, METLIFE_TITLES[c]);
  assert.equal(ws.A4.v, "المسلسل");
  assert.equal(ws.K4.v, "الموافق عليه");
  assert.deepEqual([ws.A1.v, ws.A2.v, ws.A3.v], ["Clinic", "Address", "Phones"]);

  // widths, heights, view
  const WIDTHS = [18.8, 35.5, 26.2, 27.8, 19.2, 23.6, 26.0, 40.0, 21.0, 26.1, 29.8];
  assert.deepEqual((wb.Sheets.Sheet1["!cols"] as XLSX.ColInfo[]).map((c) => c.wch), WIDTHS);
  // the writer pads a width by a fraction of a character on the way out, so the bytes read back within half a character
  (ws["!cols"] as XLSX.ColInfo[]).forEach((c, i) => assert.ok(Math.abs((c.wch as number) - WIDTHS[i]) < 0.5, "column " + i + " width " + c.wch));
  assert.ok(Math.abs(((ws["!cols"] as XLSX.ColInfo[])[7].wch as number) - 40) < 0.5);
  const heights = (ws["!rows"] as XLSX.RowInfo[]).map((r) => r.hpt);
  assert.deepEqual(heights.slice(0, 4), [79.5, 30.75, 31.5, 27.75]);
  for (let r = aFirst; r <= bSub; r++) assert.equal(heights[r], 26.25, "case and subtotal rows are 26.25 high (row " + (r + 1) + ")");
  assert.equal(wb.Workbook?.Views?.[0]?.RTL, true);
  assert.equal(back.Workbook?.Views?.[0]?.RTL, true);

  // header and title styles
  for (const a of ["A1", "A2", "A3"]) {
    assert.equal(mem[a].s.font.sz, 22);
    assert.equal(mem[a].s.font.name, "Arial");
    assert.equal(mem[a].s.font.bold, true);
    assert.equal(mem[a].s.border.top.style, "thin");
  }
  assert.equal(mem.A1.s.alignment.wrapText, true);
  assert.equal(mem.A4.s.font.sz, 22);
  assert.equal(mem.A4.s.fill.fgColor.rgb, "938953");
  assert.equal(mem.K4.s.fill.fgColor.rgb, "938953");

  // merges: header lines A:K; each case's details A..G down its lines only (not over the subtotal row)
  for (const m of ["A1:K1", "A2:K2", "A3:K3"]) assert.ok(merges.includes(m), "missing merge " + m + ": " + merges.join(" "));
  for (const [first, last] of [[aFirst, aLast], [bFirst, bLast]]) {
    for (let c = 0; c < 7; c++) {
      const m = XLSX.utils.encode_range({ s: { r: first, c }, e: { r: last, c } });
      assert.ok(merges.includes(m), "missing case merge " + m);
    }
  }
  assert.ok(merges.includes("A5:A6") && merges.includes("G5:G6"), "case A (two lines) merges over its two rows");
  assert.ok(!merges.some((m) => /^[A-G]5:[A-G]7$/.test(m)), "no merge runs over the subtotal row");

  // case A cells: ids are numbers when all digits, text otherwise; the date is a real date shown mm-dd-yy
  assert.equal(ws.A5.v, 1);
  assert.equal(ws.B5.v, "Patient 1");
  assert.equal(ws.C5.t, "n");
  assert.equal(ws.C5.v, 6481234567);
  assert.equal(ws.D5.t, "n");
  assert.equal(ws.D5.v, 987);
  assert.equal(ws.E5.t, "n");
  assert.equal(ws.E5.v, 1);
  assert.equal(ws.F5.v, "D6000001");
  assert.equal(ws.F5.t, "s");
  // pinned: the library hands a date back as a number with a date format (as Excel stores it), a whole day, not a fraction
  assert.equal(ws.G5.t, "n");
  assert.equal(ws.G5.z, "mm-dd-yy");
  assert.equal(ws.G5.v, Date.UTC(2026, 0, 28) / 86_400_000 + 25569);
  assert.equal(Number.isInteger(ws.G5.v), true);
  assert.equal(ws.G5.w, "01-28-26");
  assert.equal(ws[ref({ r: bFirst, c: 6 })].w, "02-27-26");
  // case B: text where the value is not all digits
  assert.equal(ws[ref({ r: bFirst, c: 2 })].t, "s");
  assert.equal(ws[ref({ r: bFirst, c: 2 })].v, "6481234567 - EXAMPLE");
  assert.equal(ws[ref({ r: bFirst, c: 3 })].v, "12A");
  assert.equal(ws[ref({ r: bFirst, c: 4 })].t, "n");
  // case styles
  assert.equal(mem.A5.s.font.sz, 24);
  assert.equal(mem.A5.s.fill.fgColor.rgb, "EEECE1");
  assert.equal(mem.B5.s.fill, undefined);
  assert.equal(mem.B5.s.font.sz, 24);
  assert.equal(mem.G5.s.font.sz, 24);

  // service lines in H..K
  assert.deepEqual([ws.H5.v, ws.I5.v, ws.J5.v, ws.K5.v], ["كشف", 1, 60, 60]);
  assert.deepEqual([ws.H6.v, ws.I6.v, ws.J6.v, ws.K6.v], ["اشعه عاديه", 1, 60, 60]);
  for (const a of ["H5", "I5", "J5", "K5"]) {
    assert.equal(mem[a].s.font.sz, 20);
    assert.equal(mem[a].s.font.bold, true);
    assert.equal(mem[a].s.border.top.style, "thin");
  }
  assert.equal(ws[ref({ r: bFirst + 1, c: 9 })].v, 2700);
  assert.equal(ws[ref({ r: bFirst + 1, c: 10 })].v, 500);
  assert.equal(ws[ref({ r: bFirst + 2, c: 10 })].v, 0, "a rejected line prints 0 approved");

  // subtotal rows: the label in H, a real SUM in K, H..K shaded, A..G bordered but empty
  assert.equal(ws[ref({ r: aSub, c: 7 })].v, "الاجمالي");
  assert.equal(ws[ref({ r: aSub, c: 10 })].f, "SUM(" + ref({ r: aFirst, c: 10 }) + ":" + ref({ r: aLast, c: 10 }) + ")");
  assert.equal(ws.K7.f, "SUM(K5:K6)");
  assert.equal(ws.K7.v, 120);
  assert.equal(ws[ref({ r: bSub, c: 10 })].f, "SUM(" + ref({ r: bFirst, c: 10 }) + ":" + ref({ r: bLast, c: 10 }) + ")");
  assert.equal(ws[ref({ r: bSub, c: 10 })].v, 560);
  for (let c = 7; c <= 10; c++) {
    const cell = mem[ref({ r: aSub, c })];
    assert.equal(cell.s.fill.fgColor.rgb, "938953");
    assert.equal(cell.s.font.sz, 20);
    assert.equal(cell.s.font.bold, true);
  }
  for (let c = 0; c < 7; c++) {
    const cell = mem[ref({ r: aSub, c })];
    assert.ok(cell && cell.s.border.top.style === "thin", "subtotal row A-G is bordered");
    assert.ok(cell.v === "" || cell.v === undefined, "subtotal row A-G is empty");
  }

  // footer: three rows, A:F label (48pt), G..J shaded and empty, K merged with a SUM of every subtotal cell
  assert.ok(merges.includes(XLSX.utils.encode_range({ s: { r: footTop, c: 0 }, e: { r: footEnd, c: 5 } })), "footer A:F merge");
  assert.ok(merges.includes(XLSX.utils.encode_range({ s: { r: footTop, c: 10 }, e: { r: footEnd, c: 10 } })), "footer K merge");
  const footLabel = mem[ref({ r: footTop, c: 0 })];
  assert.equal(footLabel.v, "الاجمالي");
  assert.equal(footLabel.s.font.sz, 48);
  assert.equal(footLabel.s.fill.fgColor.rgb, "938953");
  for (let r = footTop; r <= footEnd; r++) {
    for (let c = 6; c <= 9; c++) {
      const cell = mem[ref({ r, c })];
      assert.equal(cell.s.fill.fgColor.rgb, "938953", "footer G-J is shaded");
      assert.ok(cell.v === "" || cell.v === undefined, "footer G-J is empty");
    }
  }
  const footK = mem[ref({ r: footTop, c: 10 })];
  assert.equal(footK.f, "SUM(" + ref({ r: aSub, c: 10 }) + "," + ref({ r: bSub, c: 10 }) + ")");
  assert.equal(footK.v, 680);
  assert.equal(footK.s.font.sz, 24);
  assert.equal(footK.s.fill.fgColor.rgb, "938953");

  // a statement with no cases is still a valid sheet: header, titles, a footer holding a plain 0
  const none = XLSX.read(XLSX.write(metlifeStatementToWorkbook({ ...st, cases: [], total: 0 }, head), { type: "buffer", bookType: "xlsx" }), { type: "buffer" }).Sheets.Sheet1;
  assert.equal(none.A4.v, "المسلسل");
  assert.equal(none.A5.v, "الاجمالي");
  assert.equal(none.K5.v, 0);
  assert.equal(none.K5.f, undefined, "no subtotal cells, so no formula");
}

console.log("insurance metlife reader: ok");
