/**
 * AI orthodontics, as pure shapes.
 *
 * Three things matter here. The cephalometric geometry: every angle is computed by code from the
 * landmarks, so a synthetic face built to known angles must read back those angles — and must
 * read the same when the film is mirrored or non-square, because a landmark grid stretched over a
 * 4:3 picture would bend every angle without the aspect correction. The normalisers: an unusable
 * model answer must come back as null (no credits), a sloppy one is cleaned, not rejected. And the
 * review-and-lesson loop: a patch can only touch rows the report has, an edit is a verdict, and a
 * signature is never lost — that separation is what the coaching learns from.
 *
 * Run: npm run test:ortho
 */
import assert from "node:assert/strict";
import {
  addLandmarkDeltas,
  analyzeCeph,
  CEPH_LANDMARK_RESPONSE_SCHEMA,
  CEPH_MEASUREMENTS,
  cephAnalysisToLines,
  landmarkBiasHints,
  landmarkDeltas,
  normalizeCalibration,
  normalizeCephLandmarkResult,
  normalizeLandmarks,
  normalizeNormOverrides,
  type CephLandmarks,
  type CephPoint,
} from "../src/lib/orthoCeph";
import {
  applyReviewPatch,
  buildCephLandmarkPrompt,
  buildDiagnosisPrompt,
  buildPlanPrompt,
  clinicalFindingsToLines,
  coachingBlock,
  correctionLines,
  findingsHaveContent,
  normalizeClinicalFindings,
  normalizeLessonSuggestions,
  normalizeOrthoReport,
  normalizeReviewPatch,
  ORTHO_AI_CREDITS,
  ORTHO_AI_FEATURE_KEY,
  ORTHO_AI_KINDS,
  ORTHO_COACHING_MAX_CHARS,
  ORTHO_SCHEMAS,
  orthoDisclaimer,
  orthoReportToText,
  reviewableKeys,
  type OrthoDiagnosisReport,
  type OrthoLesson,
  type OrthoPlanReport,
} from "../src/lib/orthoAi";
import { imageDimensions } from "../src/lib/imageSize";
import { FEATURE_CATALOG } from "../src/lib/featureCatalog";
import { TIER_LIMITS } from "../src/lib/subscriptions";
import { BIN_COLLECTIONS } from "../src/lib/recycleBin";

// =============================================================================================
// Cephalometrics
// =============================================================================================

// A synthetic face built to known angles: SN horizontal, SNA 82°, SNB 80°, MP at 32° to SN.
const d = (deg: number) => (deg * Math.PI) / 180;
const S: CephPoint = { x: 400, y: 300 };
const N: CephPoint = { x: 600, y: 300 };
const A: CephPoint = { x: N.x - 150 * Math.cos(d(82)), y: N.y + 150 * Math.sin(d(82)) };
const B: CephPoint = { x: N.x - 220 * Math.cos(d(80)), y: N.y + 220 * Math.sin(d(80)) };
const Pog: CephPoint = { x: N.x - 250 * Math.cos(d(80)), y: N.y + 250 * Math.sin(d(80)) };
const Me: CephPoint = { x: Pog.x - 10, y: Pog.y + 15 };
const Go: CephPoint = { x: Me.x - 180, y: Me.y - 180 * Math.tan(d(32)) };
const Po: CephPoint = { x: 380, y: 340 };
const Or: CephPoint = { x: 580, y: 340 };
// A lower incisor standing at exactly 90° to the mandibular plane, and an upper at 103° to SN.
const mpDir = { x: Me.x - Go.x, y: Me.y - Go.y };
const mpLen = Math.hypot(mpDir.x, mpDir.y);
const mpUnit = { x: mpDir.x / mpLen, y: mpDir.y / mpLen };
const mpNormalUp = { x: mpUnit.y, y: -mpUnit.x }; // perpendicular, pointing up (y negative)
const L1A: CephPoint = { x: B.x - 12, y: B.y + 20 };
const L1I: CephPoint = { x: L1A.x + 40 * mpNormalUp.x, y: L1A.y + 40 * mpNormalUp.y };
const U1A: CephPoint = { x: A.x - 5, y: A.y + 5 };
const U1I: CephPoint = { x: U1A.x + 40 * Math.sin(d(103 - 90)), y: U1A.y + 40 * Math.cos(d(103 - 90)) };
const face: CephLandmarks = { S, N, A, B, Pog, Me, Go, Po, Or, L1A, L1I, U1A, U1I };

const val = (a: ReturnType<typeof analyzeCeph>, id: string) => a.measurements.find((m) => m.id === id)!.value;
const near = (actual: number | null, expected: number, tol = 0.3, what = "") => {
  assert.ok(actual !== null, `${what} should be computed`);
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: expected ${expected} ± ${tol}, got ${actual}`);
};

const base = analyzeCeph(face, { aspect: 1 });
near(val(base, "SNA"), 82, 0.2, "SNA");
near(val(base, "SNB"), 80, 0.2, "SNB");
near(val(base, "ANB"), 2, 0.2, "ANB");
near(val(base, "SN_MP"), 32, 0.2, "SN-MP");
near(val(base, "IMPA"), 90, 0.5, "IMPA");
near(val(base, "U1_SN"), 103, 0.5, "U1-SN");
assert.equal(base.facing, "right");
assert.equal(base.interpretation.skeletalClass, "I");
assert.equal(base.interpretation.lowerIncisors, "upright");
assert.equal(base.calibrated, false, "no calibration was given");
assert.equal(base.measurements.find((m) => m.id === "U1_NA_mm")!.status, "unscaled", "linear measures need calibration");
assert.equal(base.measurements.find((m) => m.id === "WITS")!.status, "missing", "Wits needs the molars");
assert.ok(base.missingCore.includes("ANS") && base.missingCore.includes("PNS"), "unplaced core landmarks are named");

// Mirrored film (face to the left): every number identical.
const mirror = (p: CephPoint): CephPoint => ({ x: 1000 - p.x, y: p.y });
const mirrored = analyzeCeph(Object.fromEntries(Object.entries(face).map(([k, p]) => [k, mirror(p)])) as CephLandmarks, { aspect: 1 });
assert.equal(mirrored.facing, "left");
for (const m of base.measurements) {
  const other = mirrored.measurements.find((x) => x.id === m.id)!;
  assert.equal(other.value, m.value, `${m.id} must not change when the film is mirrored`);
}

// A 2:1 picture: the grid squashes x by half; declaring the aspect undoes it exactly.
const squash = (p: CephPoint): CephPoint => ({ x: p.x / 2, y: p.y });
const wide = analyzeCeph(Object.fromEntries(Object.entries(face).map(([k, p]) => [k, squash(p)])) as CephLandmarks, { aspect: 2 });
near(val(wide, "SNA"), 82, 0.2, "SNA on a 2:1 film");
near(val(wide, "SN_MP"), 32, 0.2, "SN-MP on a 2:1 film");
// ...and forgetting the aspect bends the angles, which is the bug the correction exists for.
const bent = analyzeCeph(Object.fromEntries(Object.entries(face).map(([k, p]) => [k, squash(p)])) as CephLandmarks, { aspect: 1 });
assert.ok(Math.abs((val(bent, "SN_MP") as number) - 32) > 5, "an uncorrected aspect must visibly bend SN-MP");

// Calibration: 100 units = 10 mm, so U1-NA in mm is one tenth of the unit distance.
const calibrated = analyzeCeph(face, { aspect: 1, calibration: { a: { x: 100, y: 100 }, b: { x: 100, y: 200 }, mm: 10 } });
assert.equal(calibrated.calibrated, true);
assert.equal(calibrated.mmPerUnit, 0.1);
assert.notEqual(calibrated.measurements.find((m) => m.id === "U1_NA_mm")!.value, null, "calibration unlocks the linear measures");

// The clinic's own norm changes the verdict, and the analysis says which norms were overridden.
const own = analyzeCeph(face, { aspect: 1, norms: { SNA: { mean: 86, sd: 1 } } });
assert.equal(own.measurements.find((m) => m.id === "SNA")!.status, "low", "against a norm of 86 ± 1, SNA 82 is low");
assert.deepEqual(own.normOverrides, ["SNA"]);
assert.deepEqual(normalizeNormOverrides({ SNA: { mean: 86, sd: 1 }, NOPE: { mean: 1, sd: 1 }, SNB: { mean: "x", sd: 2 }, ANB: { mean: 2, sd: 0 } }), { SNA: { mean: 86, sd: 1 } });

// Every norm in the table is a measurement the analysis produces.
assert.deepEqual(
  CEPH_MEASUREMENTS.map((m) => m.id).sort(),
  base.measurements.map((m) => m.id).sort()
);

// A Class II face reads as Class II.
const A2: CephPoint = { x: N.x - 150 * Math.cos(d(86)), y: N.y + 150 * Math.sin(d(86)) };
const classII = analyzeCeph({ ...face, A: A2 }, { aspect: 1 });
near(val(classII, "ANB"), 6, 0.3, "ANB of the Class II face");
assert.equal(classII.interpretation.skeletalClass, "II");
assert.equal(classII.interpretation.maxilla, "prognathic");

// Prompt lines carry values, norms and the categorical reading.
const lines = cephAnalysisToLines(base);
assert.ok(lines.some((l) => l.startsWith("SNA: 82°")), lines.join("\n"));
assert.ok(lines.some((l) => l.includes("skeletal Class I")));
assert.ok(lines.some((l) => l.includes("not calibrated")));

// --- The model's landmark answer ------------------------------------------------------------
assert.equal(normalizeCephLandmarkResult(null), null);
assert.equal(normalizeCephLandmarkResult({ isLateralCeph: false, landmarks: [{ id: "S", x: 1, y: 1, confidence: "high" }] }), null, "not a ceph → nothing to charge for");
assert.equal(normalizeCephLandmarkResult({ isLateralCeph: true, landmarks: [{ id: "S", x: 1, y: 1 }, { id: "N", x: 2, y: 2 }, { id: "A", x: 3, y: 3 }] }), null, "three points is not a tracing");
const lm = normalizeCephLandmarkResult({
  isLateralCeph: true,
  facing: "left",
  quality: "excellent",
  landmarks: [
    { id: "S", x: 400, y: 300, confidence: "high" },
    { id: "S", x: 1, y: 1, confidence: "high" }, // duplicate → first wins
    { id: "N", x: 1200, y: -5, confidence: "low" }, // clamped
    { id: "Bogus", x: 1, y: 1, confidence: "high" }, // dropped
    { id: "A", x: "579", y: "448", confidence: "meh" },
    { id: "B", x: 560, y: 516 },
  ],
  ruler: { found: true, x1: 100, y1: 100, x2: 100, y2: 300, mm: 20 },
});
assert.ok(lm);
assert.equal(lm.facing, "left");
assert.equal(lm.quality, "acceptable", "unknown quality falls back");
assert.deepEqual(lm.landmarks.S, { x: 400, y: 300 });
assert.deepEqual(lm.landmarks.N, { x: 1000, y: 0 });
assert.equal((lm.landmarks as Record<string, unknown>).Bogus, undefined);
assert.equal(lm.confidence.A, "moderate");
assert.deepEqual(lm.ruler, { a: { x: 100, y: 100 }, b: { x: 100, y: 300 }, mm: 20 });
assert.deepEqual(normalizeLandmarks({ S: { x: 1, y: 2 }, X: { x: 1, y: 2 }, N: { x: "a", y: 1 } }), { S: { x: 1, y: 2 } });
assert.equal(normalizeCalibration({ a: { x: 1, y: 1 }, b: { x: 1, y: 1 }, mm: 10 }), null, "two identical points calibrate nothing");
assert.equal(normalizeCalibration({ a: { x: 1, y: 1 }, b: { x: 5, y: 1 }, mm: 0 }), null);
// The schema names every landmark the code knows and nothing else.
assert.deepEqual([...(CEPH_LANDMARK_RESPONSE_SCHEMA.properties.landmarks.items.properties.id.enum as readonly string[])].sort(), Object.keys(face).concat(["ANS", "PNS", "Ar", "Gn", "U6", "L6"]).sort());

// --- Learning where the model puts its dots wrong ------------------------------------------
const model: CephLandmarks = { S: { x: 400, y: 300 }, Go: { x: 300, y: 600 }, N: { x: 600, y: 300 } };
const fixed: CephLandmarks = { S: { x: 400, y: 300 }, Go: { x: 280, y: 630 }, N: { x: 600, y: 300 } };
const deltas = landmarkDeltas(model, fixed, 1);
assert.deepEqual(deltas, { Go: { dx: -20, dy: 30 } }, "only moved landmarks count, x in the anterior-positive frame");
assert.deepEqual(landmarkDeltas(model, fixed, -1).Go, { dx: 20, dy: 30 }, "on a left-facing film the same move is anterior");
let stats = {};
for (let i = 0; i < 3; i++) stats = addLandmarkDeltas(stats, deltas);
assert.deepEqual(stats, { Go: { n: 3, sumDx: -60, sumDy: 90 } });
assert.equal(landmarkBiasHints(addLandmarkDeltas(addLandmarkDeltas({}, deltas), deltas)).length, 0, "two corrections are not yet a habit");
const hints = landmarkBiasHints(stats);
assert.equal(hints.length, 1);
assert.match(hints[0], /Gonion \(Go\).*20 units more posterior and 30 units lower.*3 corrections/);
assert.match(buildCephLandmarkPrompt({ hints }), /CORRECTIONS THIS CLINIC HAS MADE/);
assert.doesNotMatch(buildCephLandmarkPrompt({}), /CORRECTIONS THIS CLINIC/);

// =============================================================================================
// The examination
// =============================================================================================

const f = normalizeClinicalFindings({ molarRight: "II", molarLeft: "IV", overjetMm: "7.5", overbiteMm: 99, crowdingLowerMm: -3, habits: ["thumb_sucking", "smoking"], chiefComplaint: "  teeth stick out ", crossbite: "none" });
assert.equal(f.molarRight, "II");
assert.equal(f.molarLeft, "", "an unknown class is blanked, not kept");
assert.equal(f.overjetMm, 7.5);
assert.equal(f.overbiteMm, 15, "clamped to a plausible range");
assert.deepEqual(f.habits, ["thumb_sucking"]);
assert.equal(findingsHaveContent(f), true);
assert.equal(findingsHaveContent(normalizeClinicalFindings({})), false);
const fl = clinicalFindingsToLines(f);
assert.ok(fl.includes("Chief complaint: teeth stick out"));
assert.ok(fl.includes("Molar relationship: right Class II"), fl.join(" | "));
assert.ok(fl.includes("Arch length: lower spacing 3 mm"));
assert.ok(!fl.some((l) => l.startsWith("Crossbite")), "crossbite: none is not a finding");

// =============================================================================================
// The reports
// =============================================================================================

for (const kind of ORTHO_AI_KINDS) {
  assert.equal(normalizeOrthoReport(kind, null), null);
  assert.equal(normalizeOrthoReport(kind, { summary: "  " }), null, `${kind}: no summary, no report, no charge`);
  // Every required key in the schema is a property the schema declares.
  const schema = ORTHO_SCHEMAS[kind] as { properties: Record<string, unknown>; required: readonly string[] };
  for (const k of schema.required) assert.ok(k in schema.properties, `${kind} schema requires unknown key ${k}`);
  assert.ok(ORTHO_AI_CREDITS[kind] > 0);
}

const diag = normalizeOrthoReport("diagnosis", {
  summary: "Class II div 1 on a mild skeletal II base.",
  angleClass: "II_div1",
  skeletalClass: "2",
  verticalPattern: "normal",
  problems: [
    { area: "dental", problem: "Overjet 7.5 mm", severity: "moderate", evidence: "examination" },
    { area: "cosmic", problem: "Lower crowding 4 mm", severity: "huge" },
    { problem: "" },
    "junk",
  ],
  aetiology: ["retrognathic mandible", 7],
  complexity: "moderate",
  iotn: 9,
  missingInformation: "a string",
  patientSummary: "Your top teeth sit a little ahead of the bottom ones.",
}) as OrthoDiagnosisReport;
assert.ok(diag);
assert.equal(diag.skeletalClass, "unclear", "an unknown enum falls back");
assert.equal(diag.problems.length, 2);
assert.equal(diag.problems[1].area, "other");
assert.equal(diag.problems[1].severity, "moderate");
assert.equal(diag.iotn, 5, "IOTN is clamped to 1–5");
assert.deepEqual(diag.missingInformation, []);

const plan = normalizeOrthoReport("plan", {
  summary: "Two routes.",
  objectives: ["Class I canines"],
  options: [
    { title: "Non-extraction with IPR", approach: "non_extraction", appliance: "Fixed", extractions: [], phases: [{ name: "Alignment", goal: "level", months: 6, steps: ["0.014 NiTi"] }], anchorage: "moderate", durationMonths: 18, retention: "bonded", pros: [], cons: [], risks: [], recommended: true },
    { title: "Extraction of upper 4s", approach: "extraction", appliance: "Fixed", extractions: ["tooth 14", "#24", "99"], phases: [], anchorage: "max", durationMonths: 24, retention: "bonded", pros: [], cons: [], risks: [], recommended: true },
    { title: "" },
  ],
  prerequisites: [],
  recordsNeeded: [],
  patientSummary: "…",
}) as OrthoPlanReport;
assert.ok(plan);
assert.equal(plan.options.length, 2, "an option without a title is dropped");
assert.deepEqual(plan.options[1].extractions, ["14", "24"], "extractions are FDI numbers or nothing");
assert.deepEqual(plan.options.map((o) => o.recommended), [true, false], "exactly one recommendation survives");

const fu = normalizeOrthoReport("followup", { summary: "Slower.", stage: "space_closure", progress: "slower", observations: [], concerns: [{ issue: "Debonded 36", severity: "mild", action: "rebond" }], thisVisit: ["rebond 36"], nextVisitWeeks: 99, remainingMonths: -3, hygieneAndCompliance: [], patientSummary: "" });
assert.ok(fu && "nextVisitWeeks" in fu);
assert.equal(fu.nextVisitWeeks, 26, "an interval is clamped to half a year");
assert.equal(fu.remainingMonths, 0);

// =============================================================================================
// The review: what turns AI text into a clinical document
// =============================================================================================

const keys = reviewableKeys("diagnosis", diag);
assert.ok(keys.includes("problems.0") && keys.includes("problems.1") && !keys.includes("problems.2"));
assert.ok(keys.includes("angleClass"));
const helpers = { normalizeLandmarks, normalizeCalibration };
const patch = normalizeReviewPatch(
  { verdicts: { "problems.0": "confirmed", "problems.7": "confirmed", "problems.1": "maybe", angleClass: "rejected" }, edits: { "problems.1": " Lower crowding 5 mm ", "nope.0": "x" }, chosenOption: 3, sign: true, note: "  ", landmarks: { S: { x: 1, y: 1 } } },
  "diagnosis",
  diag,
  helpers
);
assert.deepEqual(patch.verdicts, { "problems.0": "confirmed", angleClass: "rejected" }, "unknown rows and unknown verdicts are dropped");
assert.deepEqual(patch.edits, { "problems.1": "Lower crowding 5 mm" });
assert.equal(patch.chosenOption, undefined, "chosenOption is a plan thing");
assert.equal(patch.note, undefined, "a blank note is no note");
assert.equal(patch.landmarks, undefined, "landmarks are a ceph thing");
assert.equal(patch.sign, true);

const signer = { uid: "u1", name: "Dr Mona", nowIso: "2026-09-30T10:00:00.000Z" };
const r1 = applyReviewPatch(null, { verdicts: { "problems.0": "confirmed" }, edits: { "problems.1": "Lower crowding 5 mm" } }, signer);
assert.equal(r1.verdicts["problems.1"], "edited", "an edit is a verdict");
assert.equal(r1.signed, false);
const r2 = applyReviewPatch(r1, { sign: true, note: "The model under-called the crowding." }, signer);
assert.equal(r2.signed, true);
assert.equal(r2.signedByName, "Dr Mona");
const r3 = applyReviewPatch(r2, { verdicts: { "problems.0": "rejected" } }, { ...signer, uid: "u2", name: "Someone else" });
assert.equal(r3.signedBy, "u1", "a signature, once given, is kept");
assert.equal(r3.verdicts["problems.1"], "edited", "earlier verdicts survive a later patch");

const planPatch = normalizeReviewPatch({ chosenOption: 1 }, "plan", plan, helpers);
assert.equal(planPatch.chosenOption, 1);
assert.equal(normalizeReviewPatch({ chosenOption: 2 }, "plan", plan, helpers).chosenOption, undefined, "an option that does not exist cannot be chosen");

// The text rendering: rejected rows are gone, edits replace, the disclaimer is always last.
const text = orthoReportToText("diagnosis", diag, "en", r3);
assert.ok(!text.includes("Overjet 7.5 mm"), "a rejected row is left out");
assert.ok(text.includes("Lower crowding 5 mm (Edited)"));
assert.ok(text.trim().endsWith(orthoDisclaimer("en")));
assert.ok(orthoReportToText("plan", plan, "ar", null).includes(orthoDisclaimer("ar")));

// =============================================================================================
// Lessons: the loop that makes the model the clinic's own
// =============================================================================================

const lesson = (id: string, kind: OrthoLesson["kind"], text: string, active = true): OrthoLesson => ({ id, kind, text, source: "manual", active, createdBy: "u1", createdByName: "Dr Mona", createdAt: "2026-09-01T00:00:00.000Z" });
const lessons = [lesson("1", "general", "Report against the clinic's norms."), lesson("2", "plan", "Prefer non-extraction with IPR under 5 mm of lower crowding."), lesson("3", "ceph", "Place Gonion at the tangent intersection."), lesson("4", "plan", "Never suggest headgear.", false)];
const planBlock = coachingBlock(lessons, "plan");
assert.ok(planBlock.includes("Report against the clinic's norms."), "general lessons apply to every kind");
assert.ok(planBlock.includes("Prefer non-extraction"));
assert.ok(!planBlock.includes("Gonion"), "a ceph lesson stays out of a plan prompt");
assert.ok(!planBlock.includes("headgear"), "a paused lesson is not taught");
assert.equal(coachingBlock([], "diagnosis"), "", "no lessons, no block");
const many = Array.from({ length: 100 }, (_, i) => lesson(String(i), "general", `Lesson number ${i} ${"x".repeat(80)}`));
assert.ok(coachingBlock(many, "plan").length <= ORTHO_COACHING_MAX_CHARS + 200, "the block is capped");
assert.ok(buildPlanPrompt({ language: "en", findings: null, diagnosisLines: ["Class II"], age: 14, lessons }).includes("WHAT THIS CLINIC'S ORTHODONTIST HAS TAUGHT YOU"));
assert.ok(buildDiagnosisPrompt({ language: "ar", findings: f, photoCount: 2, lessons: [] }).includes("formal Arabic"));

const corr = correctionLines("diagnosis", diag, r3);
assert.ok(corr.some((l) => l.startsWith('REJECTED (problems.0): "Overjet 7.5 mm')), corr.join("\n"));
assert.ok(corr.some((l) => l.includes('→ dentist wrote "Lower crowding 5 mm"')));
assert.ok(corr.some((l) => l.startsWith("DENTIST'S NOTE")));
assert.deepEqual(correctionLines("diagnosis", diag, { verdicts: { "problems.0": "confirmed" }, edits: {}, signed: false }), [], "confirmations teach nothing");
const chosenOther = applyReviewPatch(null, { chosenOption: 1 }, signer);
assert.ok(correctionLines("plan", plan, chosenOther).some((l) => l.startsWith("CHOSE A DIFFERENT OPTION")));

assert.deepEqual(normalizeLessonSuggestions(null), []);
const sugg = normalizeLessonSuggestions({
  lessons: [
    { text: "Prefer IPR under 5 mm.", why: "the crowding edit", kind: "plan" },
    { text: "prefer ipr under 5 mm.", why: "dup", kind: "plan" },
    { text: "", why: "", kind: "general" },
    { text: "Grade IOTN from the overjet.", why: "…", kind: "nonsense" },
    { text: "Four", why: "", kind: "general" },
    { text: "Five", why: "", kind: "general" },
  ],
});
assert.equal(sugg.length, 3, "at most three, duplicates and blanks dropped");
assert.equal(sugg[1].kind, "general", "an unknown kind becomes general");

// =============================================================================================
// Wiring: the add-on, the bin, the image header reader
// =============================================================================================

assert.ok(FEATURE_CATALOG.some((x) => x.key === ORTHO_AI_FEATURE_KEY), "the add-on is in the catalogue");
assert.equal(typeof TIER_LIMITS.Premium.features.aiOrtho, "boolean");
assert.equal(BIN_COLLECTIONS.ortho_ai_reports?.permission, "clinical.delete", "a bad report is deleted through the bin");

// PNG: signature + IHDR with 640×480.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x80, 0, 0, 1, 0xe0, 8, 2, 0, 0, 0]);
assert.deepEqual(imageDimensions(png), { width: 640, height: 480 });
// JPEG: SOI, an APP0 segment, then SOF0 with height 1500 and width 2000.
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x05, 0xdc, 0x07, 0xd0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda]);
assert.deepEqual(imageDimensions(jpg), { width: 2000, height: 1500 });
assert.equal(imageDimensions(new Uint8Array([1, 2, 3])), null);

console.log("orthoAi: ok");
