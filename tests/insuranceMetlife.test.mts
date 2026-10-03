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
import { SAMPLE_RAW } from "./fixtures/insuranceMetlife.fixture";

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

console.log("insurance metlife reader: ok");
