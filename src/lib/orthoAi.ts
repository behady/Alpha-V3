/**
 * AI orthodontics — the pure half.
 *
 * Four kinds of report, all for a colleague to confirm rather than a patient to read:
 *
 *   ceph       a lateral cephalogram: the model places landmarks, code computes the analysis
 *              (lib/orthoCeph.ts), the model then reads the numbers into a short interpretation
 *   diagnosis  the orthodontic problem list from the clinical findings the dentist entered, the
 *              ceph analysis if there is one, and any intraoral / facial photographs
 *   plan       treatment options — extraction vs not, appliance, phases, duration, retention —
 *              built on the confirmed diagnosis
 *   followup   a progress check at a visit: is the case where it should be for the months in,
 *              what to do this visit, when to see the patient next
 *
 * And the loop that makes it the clinic's own: every report keeps the model's text untouched and
 * the dentist's corrections beside it (`review`), and a correction can be turned into a LESSON —
 * a sentence the clinic's orthodontist teaches the model, injected into every later prompt.
 * Lessons are the dentist's words (or the model's distillation of a correction, which the dentist
 * approves before it is saved); the model never learns anything nobody signed off.
 *
 * Nothing here talks to Gemini or Firestore. The route builds prompts and normalises answers with
 * these functions; the browser renders the same objects.
 */

import { cephAnalysisToLines, type CephAnalysis, type CephCalibration, type CephLandmarks } from "@/lib/orthoCeph";

/** The subscription add-on. Sits beside `aiXray`; needs `ortho` for the page and `aiChat` for credits. */
export const ORTHO_AI_FEATURE_KEY = "aiOrtho";

/** Server-only writes; see firestore.rules. One collection, `kind` tells the reports apart. */
export const ORTHO_AI_REPORTS_COLLECTION = "ortho_ai_reports";
/** The lessons, the clinic's norms and the landmark-bias tally. Server-only writes. */
export const ORTHO_COACHING_COLLECTION = "ortho_coaching";
/** Fixed document ids inside ORTHO_COACHING_COLLECTION; every other id is a lesson. */
export const ORTHO_COACHING_NORMS_DOC = "norms";
export const ORTHO_COACHING_BIAS_DOC = "landmark_bias";

export type OrthoAiKind = "ceph" | "diagnosis" | "plan" | "followup";
export const ORTHO_AI_KINDS: OrthoAiKind[] = ["ceph", "diagnosis", "plan", "followup"];

/**
 * Credits per report. A ceph is one image call plus one short text call; a diagnosis or a
 * follow-up with photographs is one image-bearing call; a plan is a long structured answer.
 * Deep mode runs the Pro model at triple, like the x-ray reading.
 */
export const ORTHO_AI_CREDITS: Record<OrthoAiKind, number> = { ceph: 3, diagnosis: 2, plan: 3, followup: 2 };
export const ORTHO_PHOTO_EXTRA_CREDITS = 1;
export const ORTHO_DEEP_MULTIPLIER = 3;
/** Distilling a correction into lessons is one short text call. */
export const ORTHO_LESSON_CREDITS = 1;
/** The feature strings the credit log files each kind under. */
export const ORTHO_AI_LOG_FEATURE: Record<OrthoAiKind, string> = {
  ceph: "ortho_ceph",
  diagnosis: "ortho_diagnosis",
  plan: "ortho_plan",
  followup: "ortho_followup",
};
export const ORTHO_LESSON_LOG_FEATURE = "ortho_coach";

/** Photographs a diagnosis or a follow-up may carry: five intraoral views plus a profile. */
export const ORTHO_MAX_PHOTOS = 6;

export type Lang = "ar" | "en";

// ----------------------------------------------------------------------------------------------
// What the dentist enters: the clinical examination
// ----------------------------------------------------------------------------------------------

export type OcclusionClass = "I" | "II" | "III" | "";
export type Crossbite = "none" | "anterior" | "posterior_unilateral" | "posterior_bilateral" | "anterior_and_posterior" | "";

export interface OrthoClinicalFindings {
  chiefComplaint: string;
  dentition: "primary" | "mixed" | "permanent" | "";
  growth: "growing" | "nearly_complete" | "complete" | "";
  molarRight: OcclusionClass;
  molarLeft: OcclusionClass;
  canineRight: OcclusionClass;
  canineLeft: OcclusionClass;
  /** mm; a negative overjet is a reverse overjet. */
  overjetMm: number | null;
  /** mm; a negative overbite is an open bite. */
  overbiteMm: number | null;
  /** mm of arch length discrepancy; negative means spacing. */
  crowdingUpperMm: number | null;
  crowdingLowerMm: number | null;
  midline: "coincident" | "upper_left" | "upper_right" | "lower_left" | "lower_right" | "";
  crossbite: Crossbite;
  profile: "straight" | "convex" | "concave" | "";
  lips: "competent" | "incompetent" | "";
  habits: string[];
  missingTeeth: string;
  impactedTeeth: string;
  oralHygiene: "good" | "fair" | "poor" | "";
  periodontal: string;
  tmj: string;
  notes: string;
}

export const ORTHO_HABITS = ["thumb_sucking", "mouth_breathing", "tongue_thrust", "nail_biting", "lip_biting", "bruxism"] as const;

export const EMPTY_FINDINGS: OrthoClinicalFindings = {
  chiefComplaint: "",
  dentition: "",
  growth: "",
  molarRight: "",
  molarLeft: "",
  canineRight: "",
  canineLeft: "",
  overjetMm: null,
  overbiteMm: null,
  crowdingUpperMm: null,
  crowdingLowerMm: null,
  midline: "",
  crossbite: "",
  profile: "",
  lips: "",
  habits: [],
  missingTeeth: "",
  impactedTeeth: "",
  oralHygiene: "",
  periodontal: "",
  tmj: "",
  notes: "",
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const num = (v: unknown, min: number, max: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n * 10) / 10));
};
const intOrNull = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
};

const OCC: OcclusionClass[] = ["I", "II", "III", ""];

/** Anything from a form or the database becomes a complete findings object; junk fields are blanked. */
export function normalizeClinicalFindings(raw: unknown): OrthoClinicalFindings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    chiefComplaint: str(r.chiefComplaint, 500),
    dentition: oneOf(r.dentition, ["primary", "mixed", "permanent", ""] as const, ""),
    growth: oneOf(r.growth, ["growing", "nearly_complete", "complete", ""] as const, ""),
    molarRight: oneOf(r.molarRight, OCC, ""),
    molarLeft: oneOf(r.molarLeft, OCC, ""),
    canineRight: oneOf(r.canineRight, OCC, ""),
    canineLeft: oneOf(r.canineLeft, OCC, ""),
    overjetMm: num(r.overjetMm, -15, 20),
    overbiteMm: num(r.overbiteMm, -15, 15),
    crowdingUpperMm: num(r.crowdingUpperMm, -20, 25),
    crowdingLowerMm: num(r.crowdingLowerMm, -20, 25),
    midline: oneOf(r.midline, ["coincident", "upper_left", "upper_right", "lower_left", "lower_right", ""] as const, ""),
    crossbite: oneOf(r.crossbite, ["none", "anterior", "posterior_unilateral", "posterior_bilateral", "anterior_and_posterior", ""] as const, ""),
    profile: oneOf(r.profile, ["straight", "convex", "concave", ""] as const, ""),
    lips: oneOf(r.lips, ["competent", "incompetent", ""] as const, ""),
    habits: strList(r.habits, 8, 40).filter((h) => (ORTHO_HABITS as readonly string[]).includes(h)),
    missingTeeth: str(r.missingTeeth, 200),
    impactedTeeth: str(r.impactedTeeth, 200),
    oralHygiene: oneOf(r.oralHygiene, ["good", "fair", "poor", ""] as const, ""),
    periodontal: str(r.periodontal, 300),
    tmj: str(r.tmj, 300),
    notes: str(r.notes, 1500),
  };
}

/** True when the form says anything at all — an empty examination is not worth a diagnosis. */
export function findingsHaveContent(f: OrthoClinicalFindings): boolean {
  return Object.entries(f).some(([k, v]) => {
    if (k === "habits") return Array.isArray(v) && v.length > 0;
    return v !== "" && v !== null;
  });
}

/** The examination as lines for a prompt. Only what was filled in; blanks are not "normal". */
export function clinicalFindingsToLines(f: OrthoClinicalFindings): string[] {
  const lines: string[] = [];
  const cls = (v: OcclusionClass) => (v ? `Class ${v}` : "");
  if (f.chiefComplaint) lines.push(`Chief complaint: ${f.chiefComplaint}`);
  if (f.dentition) lines.push(`Dentition: ${f.dentition}`);
  if (f.growth) lines.push(`Growth: ${f.growth.replace("_", " ")}`);
  const molars = [cls(f.molarRight) && `right ${cls(f.molarRight)}`, cls(f.molarLeft) && `left ${cls(f.molarLeft)}`].filter(Boolean);
  if (molars.length) lines.push(`Molar relationship: ${molars.join(", ")}`);
  const canines = [cls(f.canineRight) && `right ${cls(f.canineRight)}`, cls(f.canineLeft) && `left ${cls(f.canineLeft)}`].filter(Boolean);
  if (canines.length) lines.push(`Canine relationship: ${canines.join(", ")}`);
  if (f.overjetMm !== null) lines.push(`Overjet: ${f.overjetMm} mm${f.overjetMm < 0 ? " (reverse)" : ""}`);
  if (f.overbiteMm !== null) lines.push(`Overbite: ${f.overbiteMm} mm${f.overbiteMm < 0 ? " (open bite)" : ""}`);
  const crowd = (v: number | null, arch: string) => (v === null ? "" : v >= 0 ? `${arch} crowding ${v} mm` : `${arch} spacing ${-v} mm`);
  const crowding = [crowd(f.crowdingUpperMm, "upper"), crowd(f.crowdingLowerMm, "lower")].filter(Boolean);
  if (crowding.length) lines.push(`Arch length: ${crowding.join(", ")}`);
  if (f.midline) lines.push(`Midline: ${f.midline.replace("_", " shifted ")}`);
  if (f.crossbite && f.crossbite !== "none") lines.push(`Crossbite: ${f.crossbite.replace(/_/g, " ")}`);
  if (f.profile) lines.push(`Profile: ${f.profile}`);
  if (f.lips) lines.push(`Lips: ${f.lips}`);
  if (f.habits.length) lines.push(`Habits: ${f.habits.map((h) => h.replace(/_/g, " ")).join(", ")}`);
  if (f.missingTeeth) lines.push(`Missing teeth: ${f.missingTeeth}`);
  if (f.impactedTeeth) lines.push(`Impacted / unerupted: ${f.impactedTeeth}`);
  if (f.oralHygiene) lines.push(`Oral hygiene: ${f.oralHygiene}`);
  if (f.periodontal) lines.push(`Periodontal: ${f.periodontal}`);
  if (f.tmj) lines.push(`TMJ: ${f.tmj}`);
  if (f.notes) lines.push(`Examiner's notes: ${f.notes}`);
  return lines;
}

// ----------------------------------------------------------------------------------------------
// The reports
// ----------------------------------------------------------------------------------------------

export type Severity = "mild" | "moderate" | "severe";
const SEVERITIES: Severity[] = ["mild", "moderate", "severe"];

export interface OrthoCephReport {
  summary: string;
  skeletal: string;
  dental: string;
  vertical: string;
  softTissue: string;
  keyFindings: string[];
  treatmentImplications: string[];
  limitations: string;
  patientSummary: string;
}

export type AngleClass = "I" | "II_div1" | "II_div2" | "III" | "unclear";
export type ProblemArea = "skeletal" | "dental" | "vertical" | "transverse" | "soft_tissue" | "functional" | "habit" | "periodontal" | "other";
const PROBLEM_AREAS: ProblemArea[] = ["skeletal", "dental", "vertical", "transverse", "soft_tissue", "functional", "habit", "periodontal", "other"];

export interface OrthoProblem {
  area: ProblemArea;
  problem: string;
  severity: Severity;
  evidence: string;
}

export interface OrthoDiagnosisReport {
  summary: string;
  angleClass: AngleClass;
  skeletalClass: "I" | "II" | "III" | "unclear";
  verticalPattern: "normal" | "high_angle" | "low_angle" | "unclear";
  problems: OrthoProblem[];
  aetiology: string[];
  complexity: "simple" | "moderate" | "complex";
  /** IOTN dental health component, 1 (no need) to 5 (very great need); 0 when not estimable. */
  iotn: number;
  missingInformation: string[];
  patientSummary: string;
}

export type PlanApproach = "non_extraction" | "extraction" | "interceptive" | "growth_modification" | "camouflage" | "orthognathic" | "limited";
const APPROACHES: PlanApproach[] = ["non_extraction", "extraction", "interceptive", "growth_modification", "camouflage", "orthognathic", "limited"];

export interface OrthoPlanPhase {
  name: string;
  goal: string;
  months: number;
  steps: string[];
}

export interface OrthoPlanOption {
  title: string;
  approach: PlanApproach;
  appliance: string;
  /** FDI numbers, empty when nothing is extracted. */
  extractions: string[];
  phases: OrthoPlanPhase[];
  anchorage: string;
  durationMonths: number;
  retention: string;
  pros: string[];
  cons: string[];
  risks: string[];
  recommended: boolean;
}

export interface OrthoPlanReport {
  summary: string;
  objectives: string[];
  options: OrthoPlanOption[];
  prerequisites: string[];
  recordsNeeded: string[];
  patientSummary: string;
}

export type TreatmentStage = "alignment" | "leveling" | "space_closure" | "finishing" | "retention" | "unclear";
export type Progress = "on_track" | "slower" | "faster" | "concern";

export interface OrthoConcern {
  issue: string;
  severity: Severity;
  action: string;
}

export interface OrthoFollowupReport {
  summary: string;
  stage: TreatmentStage;
  progress: Progress;
  observations: string[];
  concerns: OrthoConcern[];
  thisVisit: string[];
  nextVisitWeeks: number;
  /** 0 when the model cannot say. */
  remainingMonths: number;
  hygieneAndCompliance: string[];
  patientSummary: string;
}

export type OrthoReport = OrthoCephReport | OrthoDiagnosisReport | OrthoPlanReport | OrthoFollowupReport;

// --- Schemas (plain data; the route casts them for the SDK) ------------------------------------

const S = { type: "STRING" } as const;
const SL = { type: "ARRAY", items: { type: "STRING" } } as const;

export const ORTHO_CEPH_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: S,
    skeletal: S,
    dental: S,
    vertical: S,
    softTissue: S,
    keyFindings: SL,
    treatmentImplications: SL,
    limitations: S,
    patientSummary: S,
  },
  required: ["summary", "skeletal", "dental", "vertical", "keyFindings", "treatmentImplications", "limitations", "patientSummary"],
} as const;

export const ORTHO_DIAGNOSIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: S,
    angleClass: { type: "STRING", enum: ["I", "II_div1", "II_div2", "III", "unclear"], format: "enum" },
    skeletalClass: { type: "STRING", enum: ["I", "II", "III", "unclear"], format: "enum" },
    verticalPattern: { type: "STRING", enum: ["normal", "high_angle", "low_angle", "unclear"], format: "enum" },
    problems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          area: { type: "STRING", enum: PROBLEM_AREAS, format: "enum" },
          problem: S,
          severity: { type: "STRING", enum: SEVERITIES, format: "enum" },
          evidence: S,
        },
        required: ["area", "problem", "severity", "evidence"],
      },
    },
    aetiology: SL,
    complexity: { type: "STRING", enum: ["simple", "moderate", "complex"], format: "enum" },
    iotn: { type: "INTEGER" },
    missingInformation: SL,
    patientSummary: S,
  },
  required: ["summary", "angleClass", "skeletalClass", "verticalPattern", "problems", "aetiology", "complexity", "iotn", "missingInformation", "patientSummary"],
} as const;

export const ORTHO_PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: S,
    objectives: SL,
    options: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: S,
          approach: { type: "STRING", enum: APPROACHES, format: "enum" },
          appliance: S,
          extractions: SL,
          phases: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { name: S, goal: S, months: { type: "INTEGER" }, steps: SL },
              required: ["name", "goal", "months", "steps"],
            },
          },
          anchorage: S,
          durationMonths: { type: "INTEGER" },
          retention: S,
          pros: SL,
          cons: SL,
          risks: SL,
          recommended: { type: "BOOLEAN" },
        },
        required: ["title", "approach", "appliance", "extractions", "phases", "anchorage", "durationMonths", "retention", "pros", "cons", "risks", "recommended"],
      },
    },
    prerequisites: SL,
    recordsNeeded: SL,
    patientSummary: S,
  },
  required: ["summary", "objectives", "options", "prerequisites", "recordsNeeded", "patientSummary"],
} as const;

export const ORTHO_FOLLOWUP_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: S,
    stage: { type: "STRING", enum: ["alignment", "leveling", "space_closure", "finishing", "retention", "unclear"], format: "enum" },
    progress: { type: "STRING", enum: ["on_track", "slower", "faster", "concern"], format: "enum" },
    observations: SL,
    concerns: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { issue: S, severity: { type: "STRING", enum: SEVERITIES, format: "enum" }, action: S },
        required: ["issue", "severity", "action"],
      },
    },
    thisVisit: SL,
    nextVisitWeeks: { type: "INTEGER" },
    remainingMonths: { type: "INTEGER" },
    hygieneAndCompliance: SL,
    patientSummary: S,
  },
  required: ["summary", "stage", "progress", "observations", "concerns", "thisVisit", "nextVisitWeeks", "remainingMonths", "hygieneAndCompliance", "patientSummary"],
} as const;

export const ORTHO_SCHEMAS: Record<OrthoAiKind, unknown> = {
  ceph: ORTHO_CEPH_SCHEMA,
  diagnosis: ORTHO_DIAGNOSIS_SCHEMA,
  plan: ORTHO_PLAN_SCHEMA,
  followup: ORTHO_FOLLOWUP_SCHEMA,
};

// --- Normalising ------------------------------------------------------------------------------

/**
 * Whatever the model returned, or null when there is no summary — a failed call, never charged.
 * Tolerant everywhere else: a missing list is an empty list, an unknown enum is its fallback.
 */
export function normalizeOrthoReport(kind: "ceph", raw: unknown): OrthoCephReport | null;
export function normalizeOrthoReport(kind: "diagnosis", raw: unknown): OrthoDiagnosisReport | null;
export function normalizeOrthoReport(kind: "plan", raw: unknown): OrthoPlanReport | null;
export function normalizeOrthoReport(kind: "followup", raw: unknown): OrthoFollowupReport | null;
export function normalizeOrthoReport(kind: OrthoAiKind, raw: unknown): OrthoReport | null;
export function normalizeOrthoReport(kind: OrthoAiKind, raw: unknown): OrthoReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const summary = str(r.summary, 2500);
  if (!summary) return null;
  const patientSummary = str(r.patientSummary, 1200);

  if (kind === "ceph") {
    return {
      summary,
      skeletal: str(r.skeletal, 1200),
      dental: str(r.dental, 1200),
      vertical: str(r.vertical, 1000),
      softTissue: str(r.softTissue, 800),
      keyFindings: strList(r.keyFindings, 15, 300),
      treatmentImplications: strList(r.treatmentImplications, 12, 300),
      limitations: str(r.limitations, 800),
      patientSummary,
    };
  }

  if (kind === "diagnosis") {
    const problems: OrthoProblem[] = Array.isArray(r.problems)
      ? r.problems
          .map((p): OrthoProblem | null => {
            if (!p || typeof p !== "object") return null;
            const pp = p as Record<string, unknown>;
            const problem = str(pp.problem, 300);
            if (!problem) return null;
            return {
              area: oneOf(pp.area, PROBLEM_AREAS, "other"),
              problem,
              severity: oneOf(pp.severity, SEVERITIES, "moderate"),
              evidence: str(pp.evidence, 400),
            };
          })
          .filter((p): p is OrthoProblem => p !== null)
          .slice(0, 20)
      : [];
    const iotn = intOrNull(r.iotn, 0, 5);
    return {
      summary,
      angleClass: oneOf(r.angleClass, ["I", "II_div1", "II_div2", "III", "unclear"] as const, "unclear"),
      skeletalClass: oneOf(r.skeletalClass, ["I", "II", "III", "unclear"] as const, "unclear"),
      verticalPattern: oneOf(r.verticalPattern, ["normal", "high_angle", "low_angle", "unclear"] as const, "unclear"),
      problems,
      aetiology: strList(r.aetiology, 10, 300),
      complexity: oneOf(r.complexity, ["simple", "moderate", "complex"] as const, "moderate"),
      iotn: iotn ?? 0,
      missingInformation: strList(r.missingInformation, 10, 300),
      patientSummary,
    };
  }

  if (kind === "plan") {
    const options: OrthoPlanOption[] = Array.isArray(r.options)
      ? r.options
          .map((o): OrthoPlanOption | null => {
            if (!o || typeof o !== "object") return null;
            const oo = o as Record<string, unknown>;
            const title = str(oo.title, 160);
            if (!title) return null;
            const phases: OrthoPlanPhase[] = Array.isArray(oo.phases)
              ? oo.phases
                  .map((ph): OrthoPlanPhase | null => {
                    if (!ph || typeof ph !== "object") return null;
                    const p = ph as Record<string, unknown>;
                    const name = str(p.name, 120);
                    if (!name) return null;
                    return { name, goal: str(p.goal, 300), months: intOrNull(p.months, 0, 60) ?? 0, steps: strList(p.steps, 12, 300) };
                  })
                  .filter((p): p is OrthoPlanPhase => p !== null)
                  .slice(0, 8)
              : [];
            return {
              title,
              approach: oneOf(oo.approach, APPROACHES, "non_extraction"),
              appliance: str(oo.appliance, 300),
              extractions: strList(oo.extractions, 8, 20).map(normalizeToothNumber).filter(Boolean),
              phases,
              anchorage: str(oo.anchorage, 300),
              durationMonths: intOrNull(oo.durationMonths, 0, 72) ?? 0,
              retention: str(oo.retention, 400),
              pros: strList(oo.pros, 8, 250),
              cons: strList(oo.cons, 8, 250),
              risks: strList(oo.risks, 8, 250),
              recommended: oo.recommended === true,
            };
          })
          .filter((o): o is OrthoPlanOption => o !== null)
          .slice(0, 4)
      : [];
    // Exactly one recommendation, or none: two "recommended" options is no recommendation.
    if (options.filter((o) => o.recommended).length > 1) options.forEach((o, i) => (o.recommended = i === options.findIndex((x) => x.recommended)));
    return {
      summary,
      objectives: strList(r.objectives, 10, 250),
      options,
      prerequisites: strList(r.prerequisites, 10, 250),
      recordsNeeded: strList(r.recordsNeeded, 10, 200),
      patientSummary,
    };
  }

  const concerns: OrthoConcern[] = Array.isArray(r.concerns)
    ? r.concerns
        .map((c): OrthoConcern | null => {
          if (!c || typeof c !== "object") return null;
          const cc = c as Record<string, unknown>;
          const issue = str(cc.issue, 300);
          if (!issue) return null;
          return { issue, severity: oneOf(cc.severity, SEVERITIES, "moderate"), action: str(cc.action, 300) };
        })
        .filter((c): c is OrthoConcern => c !== null)
        .slice(0, 12)
    : [];
  return {
    summary,
    stage: oneOf(r.stage, ["alignment", "leveling", "space_closure", "finishing", "retention", "unclear"] as const, "unclear"),
    progress: oneOf(r.progress, ["on_track", "slower", "faster", "concern"] as const, "on_track"),
    observations: strList(r.observations, 15, 300),
    concerns,
    thisVisit: strList(r.thisVisit, 12, 300),
    nextVisitWeeks: intOrNull(r.nextVisitWeeks, 1, 26) ?? 4,
    remainingMonths: intOrNull(r.remainingMonths, 0, 60) ?? 0,
    hygieneAndCompliance: strList(r.hygieneAndCompliance, 8, 250),
    patientSummary,
  };
}

/** "tooth 14", "#14", "14 (UR4)" → "14"; anything without an FDI number is dropped. */
export function normalizeToothNumber(v: string): string {
  const m = v.match(/\b([1-8][1-8])\b/);
  if (!m) return "";
  const n = Number(m[1]);
  const q = Math.floor(n / 10);
  const t = n % 10;
  return t >= 1 && t <= 8 && ((q >= 1 && q <= 4) || (q >= 5 && q <= 8 && t <= 5)) ? m[1] : "";
}

// ----------------------------------------------------------------------------------------------
// Prompts
// ----------------------------------------------------------------------------------------------

function languageLine(language: Lang): string {
  return language === "ar"
    ? "Write every free-text field in formal Arabic as an Egyptian orthodontist would write in a case file; orthodontic terms and measurement names may stay in English where specialists say them that way (Class II, overjet, IMPA). Tooth numbers stay as FDI digits."
    : "Write every free-text field in clear, professional clinical English.";
}

const BASE_ROLE =
  "You are a consultant orthodontist writing for a colleague — the treating dentist — inside a dental clinic's record system. Everything you write is decision support for a licensed clinician who will confirm it against the patient; do not address the patient except in patientSummary. Do not add a disclaimer; the system adds its own. NEVER invent a finding or a measurement that is not in the data you were given: when something is unknown, say it is unknown and name what would settle it.";

/**
 * The lessons block. Lessons are the clinic's orthodontist's own words and outrank the textbook:
 * a clinic that treats borderline crowding without extractions wants every plan to start there.
 */
export function coachingBlock(lessons: OrthoLesson[], kind: OrthoAiKind, extraHints: string[] = []): string {
  const relevant = lessons.filter((l) => l.active && (l.kind === kind || l.kind === "general"));
  const lines = [...relevant.map((l) => `- ${l.text}`), ...extraHints.map((h) => `- ${h}`)];
  if (!lines.length) return "";
  let block = "";
  for (const line of lines) {
    if (block.length + line.length + 1 > ORTHO_COACHING_MAX_CHARS) break;
    block += `${line}\n`;
  }
  return `\nWHAT THIS CLINIC'S ORTHODONTIST HAS TAUGHT YOU — follow these over textbook defaults, and when a lesson applies say so in the relevant field ("as this clinic prefers…"):\n${block}`;
}
export const ORTHO_COACHING_MAX_CHARS = 4000;

/** Step 1 of a ceph: the landmarks. English only — the output is numbers. */
export function buildCephLandmarkPrompt(opts: { hints?: string[]; note?: string }): string {
  const hints = opts.hints && opts.hints.length ? `\nCORRECTIONS THIS CLINIC HAS MADE TO YOUR EARLIER PLACEMENTS (apply them):\n${opts.hints.map((h) => `- ${h}`).join("\n")}\n` : "";
  const note = (opts.note || "").trim();
  return `You are an orthodontist tracing a lateral cephalometric radiograph. Locate the following cephalometric landmarks on the picture and return their positions on a 0–1000 grid of THIS image (x from the left edge, y from the top; 0,0 is top-left, 1000,1000 is bottom-right).

LANDMARKS (return the id exactly as written):
${CEPH_LANDMARK_HINT_LINES}

HOW TO WORK:
- First decide whether this is a lateral cephalogram at all (a true lateral skull film with the profile in view). If it is not — a panoramic, a periapical, a photograph, a PA ceph — set isLateralCeph to false, leave landmarks empty and stop.
- Say which way the face points (facing: "right" when the nose is towards the right edge of the picture).
- Place every landmark you can see with reasonable certainty. Do NOT guess a landmark that is outside the film, hidden by the ear rods or obscured by a double contour; omit it instead — an omitted point costs one measurement, a wrong point corrupts several. Be exact: the clinic computes SNA, SNB, FMA, IMPA and the rest from these coordinates, and a 20-unit error on Gonion changes the mandibular plane by degrees.
- Bilateral structures (Po, Or, Go) appear doubled when the sides do not superimpose: use the midpoint between the two images.
- The incisor apices are faint; follow the root canal from the crown. Use the MOST LABIAL central incisor in each arch.
- Judge quality (exposure, head rotation — shown by double contours, ear-rod position, motion, cropping).
- If the film carries a ruler or a scale with millimetre marks, report two points on it that are a known distance apart (ruler.found = true, the two points and the distance in mm — choose the longest clearly readable span). If there is none or it is unreadable, ruler.found = false.${hints}${note ? `\nThe dentist's note for this tracing (reference only): "${note.slice(0, 300)}"\n` : ""}`;
}

const CEPH_LANDMARK_HINT_LINES = [
  "S — Sella: geometric centre of the sella turcica",
  "N — Nasion: most anterior point of the frontonasal suture",
  "Or — Orbitale: lowest point on the inferior orbital margin",
  "Po — Porion: top of the external auditory meatus (anatomical porion, not the ear-rod ring)",
  "Ar — Articulare: where the posterior border of the condyle crosses the inferior surface of the cranial base",
  "Go — Gonion: the angle of the mandible, where the ramus tangent meets the lower-border tangent",
  "Me — Menton: lowest point of the symphysis",
  "Gn — Gnathion: most anterior-inferior point of the symphysis, between Pog and Me",
  "Pog — Pogonion: most anterior point of the bony chin",
  "B — B point: deepest point of the anterior concavity of the symphysis",
  "A — A point: deepest point of the anterior concavity of the maxilla between ANS and prosthion",
  "ANS — tip of the anterior nasal spine",
  "PNS — tip of the posterior nasal spine",
  "U1I — incisal edge of the most labial upper central incisor",
  "U1A — root apex of that upper central incisor",
  "L1I — incisal edge of the most labial lower central incisor",
  "L1A — root apex of that lower central incisor",
  "U6 — mesio-buccal cusp tip of the upper first molar",
  "L6 — mesio-buccal cusp tip of the lower first molar",
].join("\n");

/** Step 2 of a ceph: the reading of the numbers code computed. No image — it reads the analysis. */
export function buildCephInterpretationPrompt(opts: {
  language: Lang;
  analysis: CephAnalysis;
  findings?: OrthoClinicalFindings | null;
  quality: string;
  qualityNotes: string;
  lessons: OrthoLesson[];
  landmarkHints?: string[];
  note?: string;
}): string {
  const findings = opts.findings ? clinicalFindingsToLines(opts.findings) : [];
  const note = (opts.note || "").trim();
  return `${BASE_ROLE}

You are interpreting a lateral cephalometric analysis. The landmarks were traced on the film and EVERY number below was computed by the clinic's software from those landmarks against the norms shown; you are reading the numbers, not the picture. Film quality: ${opts.quality}${opts.qualityNotes ? ` — ${opts.qualityNotes}` : ""}.

MEASUREMENTS:
${opts.analysis.measurements.length ? cephAnalysisToLines(opts.analysis).map((l) => `- ${l}`).join("\n") : "- none"}
${findings.length ? `\nCLINICAL EXAMINATION (entered by the dentist):\n${findings.map((l) => `- ${l}`).join("\n")}\n` : ""}
HOW TO WRITE:
- summary: three to five sentences a colleague can read in the corridor — the skeletal pattern, the dental compensation, the vertical, and what it means for treatment.
- skeletal: sagittal (SNA/SNB/ANB, Wits when present, convexity) — say which jaw is at fault, and note when ANB and Wits disagree or when SN inclination might be misleading ANB.
- dental: incisor inclination and position (U1-SN, U1-NA, L1-NB, IMPA, FMIA, interincisal), and what dental compensation is present.
- vertical: SN-MP, FMA, Y-axis, Jarabak, face-height ratio — the growth pattern and its consequence for mechanics (bite opening vs deepening, extraction tendency).
- softTissue: only what the numbers imply (profile convexity); say nothing about lips you cannot see.
- keyFindings: the five to eight numbers that matter, each with its value and what it means.
- treatmentImplications: concrete consequences for planning (anchorage needs, extraction tendency, growth modification window, incisor targets) — not a plan.
- limitations: what the analysis cannot tell (uncalibrated linear measures, missing landmarks, quality issues).
- patientSummary: two to four warm, plain sentences for the patient — no numbers, no jargon.
- Treat a measurement flagged as the clinic's own norm as the norm to judge against.${coachingBlock(opts.lessons, "ceph", opts.landmarkHints)}${note ? `\nThe dentist's question for this reading (reference only): "${note.slice(0, 500)}"` : ""}
- ${languageLine(opts.language)}`;
}

export function buildDiagnosisPrompt(opts: {
  language: Lang;
  findings: OrthoClinicalFindings;
  cephLines?: string[];
  photoCount: number;
  photoCategories?: string[];
  priorReports?: string[];
  lessons: OrthoLesson[];
  note?: string;
  deep?: boolean;
}): string {
  const findings = clinicalFindingsToLines(opts.findings);
  const note = (opts.note || "").trim();
  return `${BASE_ROLE}

You are writing the orthodontic DIAGNOSIS for one patient from: the clinical examination the dentist entered, a cephalometric analysis when one exists, and ${opts.photoCount ? `${opts.photoCount} photograph${opts.photoCount === 1 ? "" : "s"} attached (intraoral views and/or the face in profile${opts.photoCategories?.length ? `; filed as ${opts.photoCategories.join(", ")}` : ""})` : "no photographs"}.

CLINICAL EXAMINATION:
${findings.length ? findings.map((l) => `- ${l}`).join("\n") : "- nothing entered"}
${opts.cephLines?.length ? `\nCEPHALOMETRIC ANALYSIS (computed from a traced lateral ceph, dentist-confirmed):\n${opts.cephLines.map((l) => `- ${l}`).join("\n")}\n` : "\nNo cephalometric analysis is available.\n"}${opts.priorReports?.length ? `\nEARLIER AI REPORTS ON THIS PATIENT (reference only, newest first):\n${opts.priorReports.map((l) => `- ${l}`).join("\n")}\n` : ""}
HOW TO DIAGNOSE:
- angleClass: from the molar and canine relationships and the overjet/incisor pattern (II_div1 = increased overjet with proclined upper incisors; II_div2 = retroclined upper centrals with deep bite). "unclear" when the examination does not settle it.
- skeletalClass / verticalPattern: from the ceph analysis when present; otherwise from the profile and the examination, and say in the summary that they are clinical impressions.
- problems: the PROBLEM LIST, one entry per problem, most important first, in the five-area habit (skeletal, dental — sagittal/crowding/spacing/midline, vertical, transverse, soft tissue), plus functional, habit and periodontal problems. Each has the evidence it rests on — a measurement, a photograph, a line of the examination. If a photograph shows something the examination did not record (a crossbite, a peg lateral, gingival recession, a rotated tooth by FDI number), list it and say it came from the picture.
- severity: mild / moderate / severe by treatment weight.
- aetiology: the likely causes (skeletal pattern, habits, early loss, crowding of hereditary pattern) — as hypotheses.
- complexity: simple (aligners or limited fixed, no extractions, no growth issue), moderate, complex (skeletal discrepancy, extractions likely, impactions, surgical candidate).
- iotn: the IOTN Dental Health Component grade 1–5 you would assign; 0 when the data cannot support one.
- missingInformation: what would sharpen the diagnosis (a ceph, a panoramic for impactions, study models for a space analysis, a photograph you did not get).
- patientSummary: two to four warm, plain sentences telling the patient what is going on with their bite, without numbers or jargon.${opts.deep ? "\n- DEEP READ: be exhaustive — every problem in every area, every differential, every discriminating test." : ""}${coachingBlock(opts.lessons, "diagnosis")}${note ? `\nThe dentist's note for this diagnosis (reference only): "${note.slice(0, 500)}"` : ""}
- ${languageLine(opts.language)}`;
}

export function buildPlanPrompt(opts: {
  language: Lang;
  findings: OrthoClinicalFindings | null;
  diagnosisLines: string[];
  cephLines?: string[];
  age: number | null;
  lessons: OrthoLesson[];
  note?: string;
  deep?: boolean;
}): string {
  const findings = opts.findings ? clinicalFindingsToLines(opts.findings) : [];
  const note = (opts.note || "").trim();
  return `${BASE_ROLE}

You are writing the orthodontic TREATMENT PLAN for one patient${opts.age !== null ? `, aged ${opts.age}` : ""}, from the confirmed diagnosis below.

DIAGNOSIS:
${opts.diagnosisLines.length ? opts.diagnosisLines.map((l) => `- ${l}`).join("\n") : "- none recorded"}
${findings.length ? `\nCLINICAL EXAMINATION:\n${findings.map((l) => `- ${l}`).join("\n")}\n` : ""}${opts.cephLines?.length ? `\nCEPHALOMETRIC ANALYSIS:\n${opts.cephLines.map((l) => `- ${l}`).join("\n")}\n` : ""}
HOW TO PLAN:
- objectives: what treatment must achieve, in order (Class I canines, ideal overjet/overbite, coincident midlines, level curve of Spee, a stable and healthy result, the patient's own complaint answered).
- options: two or three genuine alternatives, the first being the one you recommend (recommended = true on exactly one). At least one non-extraction route must be considered and, if rejected, its cons must say why. Each option names the approach, the appliance (fixed labial metal/ceramic, aligners, functional appliance, expander, TADs, headgear, surgery), the extractions by FDI number (empty when none), the phases in order with realistic months and the steps in each, the anchorage plan, the total duration, the retention protocol (bonded retainer, vacuum-formed, Hawley, wear schedule), pros, cons and risks (root resorption, decalcification, relapse, profile change, black triangles, need for surgery).
- Respect the growth status: a growing Class II patient gets a growth-modification option; an adult skeletal discrepancy is camouflage versus orthognathic, stated honestly.
- Sequence is mechanics, not marketing: space analysis before choosing extractions; leveling before space closure; finishing before retention.
- prerequisites: what must be done first (caries, periodontal stabilisation, extractions of hopeless teeth, habit cessation, a referral).
- recordsNeeded: records the plan still needs before starting (study models or scan, panoramic, ceph, photographs).
- patientSummary: two to four warm sentences for the patient about what treatment will involve and roughly how long — no tooth numbers, no jargon, no prices.${opts.deep ? "\n- DEEP PLAN: three options, every phase itemised, and for the recommended option a month-by-month expectation." : ""}${coachingBlock(opts.lessons, "plan")}${note ? `\nThe dentist's constraints or wishes for this plan (reference only, but honour them): "${note.slice(0, 500)}"` : ""}
- ${languageLine(opts.language)}`;
}

export function buildFollowupPrompt(opts: {
  language: Lang;
  planLines: string[];
  visitLines: string[];
  monthsIn: number | null;
  status: string;
  photoCount: number;
  lessons: OrthoLesson[];
  note?: string;
}): string {
  const note = (opts.note || "").trim();
  return `${BASE_ROLE}

You are reviewing the PROGRESS of an orthodontic case at a follow-up visit. The case has been in treatment for ${opts.monthsIn !== null ? `${opts.monthsIn} month${opts.monthsIn === 1 ? "" : "s"}` : "an unknown time"} (status: ${opts.status || "Active"}), and you have ${opts.photoCount ? `${opts.photoCount} photograph${opts.photoCount === 1 ? "" : "s"} from today` : "no photographs from today"}.

THE PLAN:
${opts.planLines.length ? opts.planLines.map((l) => `- ${l}`).join("\n") : "- no written plan; judge against the usual sequence for the appliance in use"}

VISITS SO FAR (oldest first):
${opts.visitLines.length ? opts.visitLines.map((l) => `- ${l}`).join("\n") : "- none recorded"}

HOW TO REVIEW:
- stage: where the case is in the usual sequence (alignment → leveling → space closure → finishing → retention), from the visit notes and the photographs.
- progress: on_track when the stage fits the months in and the plan; slower / faster when it does not; concern when something needs the dentist's attention regardless of pace (a broken appliance unmended for weeks, decalcification, gingival overgrowth, a tooth not moving, root exposure, a bite opening unexpectedly, poor compliance with elastics or aligners).
- observations: what the record and the photographs show, plainly, with FDI numbers where a tooth is named. If a photograph shows something (white spot lesions, plaque, a debonded bracket, an aligner not seating) say it came from the picture.
- concerns: each with its severity and the concrete action.
- thisVisit: what to do today (archwire change and size, elastics and configuration, bends, IPR, aligner stage, repair, hygiene reinforcement, records to take).
- nextVisitWeeks: the interval you would set (aligners 6–10, fixed 4–8, retention 12–26).
- remainingMonths: your estimate to debond, 0 when you cannot say.
- hygieneAndCompliance: what to tell the patient about brushing, elastics, wear time, diet.
- patientSummary: two or three warm sentences for the patient on how it is going and what to do until next time.${coachingBlock(opts.lessons, "followup")}${note ? `\nThe dentist's note from today's chair (reference only): "${note.slice(0, 500)}"` : ""}
- ${languageLine(opts.language)}`;
}

// ----------------------------------------------------------------------------------------------
// The dentist's review
// ----------------------------------------------------------------------------------------------

export type Verdict = "confirmed" | "rejected" | "edited";
const VERDICTS: Verdict[] = ["confirmed", "rejected", "edited"];

/**
 * Stored on the report as `review`, written only by /api/ai/ortho/review. Items are addressed by
 * a path into the report ("problems.2", "options.0", "keyFindings.4", "concerns.1", "thisVisit.0");
 * the lists are never reordered after normalisation so an index survives an edit.
 */
export interface OrthoReview {
  verdicts: Record<string, Verdict>;
  edits: Record<string, string>;
  /** The dentist's summary, when they rewrote the model's. */
  summary?: string;
  patientSummary?: string;
  /** Ceph only: the corrected landmarks and calibration, and the analysis recomputed from them. */
  landmarks?: CephLandmarks;
  calibration?: CephCalibration | null;
  analysis?: CephAnalysis;
  /** Plan only: the option the dentist chose. */
  chosenOption?: number;
  /** Free text: what the model got wrong and why. The seed for a lesson. */
  note?: string;
  signed: boolean;
  signedBy?: string;
  signedByName?: string;
  /** ISO. */
  signedAt?: string;
}

export const EMPTY_REVIEW: OrthoReview = { verdicts: {}, edits: {}, signed: false };

/** Every path the review may address on this report. */
export function reviewableKeys(kind: OrthoAiKind, report: OrthoReport): string[] {
  const keys: string[] = [];
  const list = (name: string, n: number) => {
    for (let i = 0; i < n; i++) keys.push(`${name}.${i}`);
  };
  if (kind === "ceph") {
    const r = report as OrthoCephReport;
    list("keyFindings", r.keyFindings.length);
    list("treatmentImplications", r.treatmentImplications.length);
    keys.push("skeletal", "dental", "vertical", "softTissue");
  } else if (kind === "diagnosis") {
    const r = report as OrthoDiagnosisReport;
    list("problems", r.problems.length);
    list("aetiology", r.aetiology.length);
    keys.push("angleClass", "skeletalClass", "verticalPattern");
  } else if (kind === "plan") {
    const r = report as OrthoPlanReport;
    list("options", r.options.length);
    list("objectives", r.objectives.length);
    list("prerequisites", r.prerequisites.length);
  } else {
    const r = report as OrthoFollowupReport;
    list("observations", r.observations.length);
    list("concerns", r.concerns.length);
    list("thisVisit", r.thisVisit.length);
    keys.push("progress", "stage", "nextVisitWeeks");
  }
  return keys;
}

export type OrthoReviewPatch = Partial<Pick<OrthoReview, "verdicts" | "edits" | "summary" | "patientSummary" | "landmarks" | "calibration" | "chosenOption" | "note">> & {
  sign?: boolean;
};

/**
 * Cleans a client patch against the report it belongs to: unknown paths, unknown verdicts and
 * an option index that does not exist are dropped rather than stored.
 */
export function normalizeReviewPatch(raw: unknown, kind: OrthoAiKind, report: OrthoReport, helpers: {
  normalizeLandmarks: (v: unknown) => CephLandmarks;
  normalizeCalibration: (v: unknown) => CephCalibration | null;
}): OrthoReviewPatch {
  const out: OrthoReviewPatch = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const allowed = new Set(reviewableKeys(kind, report));
  if (r.verdicts && typeof r.verdicts === "object") {
    const m: Record<string, Verdict> = {};
    for (const [k, v] of Object.entries(r.verdicts as Record<string, unknown>)) {
      if (allowed.has(k) && typeof v === "string" && (VERDICTS as string[]).includes(v)) m[k] = v as Verdict;
    }
    out.verdicts = m;
  }
  if (r.edits && typeof r.edits === "object") {
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.edits as Record<string, unknown>)) {
      const s = str(v, 800);
      if (allowed.has(k) && s) m[k] = s;
    }
    out.edits = m;
  }
  const summary = str(r.summary, 2500);
  if (summary) out.summary = summary;
  const ps = str(r.patientSummary, 1200);
  if (ps) out.patientSummary = ps;
  const note = str(r.note, 1000);
  if (note) out.note = note;
  if (kind === "ceph") {
    if (r.landmarks !== undefined) {
      const lm = helpers.normalizeLandmarks(r.landmarks);
      if (Object.keys(lm).length >= 4) out.landmarks = lm;
    }
    if (r.calibration !== undefined) out.calibration = helpers.normalizeCalibration(r.calibration);
  }
  if (kind === "plan" && r.chosenOption !== undefined) {
    const n = Number(r.chosenOption);
    if (Number.isInteger(n) && n >= 0 && n < (report as OrthoPlanReport).options.length) out.chosenOption = n;
  }
  if (r.sign === true) out.sign = true;
  return out;
}

/** Merges a patch onto the stored review. A signature, once given, is kept. */
export function applyReviewPatch(current: OrthoReview | null | undefined, patch: OrthoReviewPatch, signer: { uid: string; name: string; nowIso: string }): OrthoReview {
  const base: OrthoReview = current ? { ...EMPTY_REVIEW, ...current, verdicts: { ...current.verdicts }, edits: { ...current.edits } } : { ...EMPTY_REVIEW, verdicts: {}, edits: {} };
  if (patch.verdicts) Object.assign(base.verdicts, patch.verdicts);
  if (patch.edits) {
    Object.assign(base.edits, patch.edits);
    // An edit is a verdict: a row the dentist rewrote is "edited" unless they also rejected it.
    for (const k of Object.keys(patch.edits)) if (base.verdicts[k] !== "rejected") base.verdicts[k] = "edited";
  }
  if (patch.summary !== undefined) base.summary = patch.summary;
  if (patch.patientSummary !== undefined) base.patientSummary = patch.patientSummary;
  if (patch.landmarks !== undefined) base.landmarks = patch.landmarks;
  if (patch.calibration !== undefined) base.calibration = patch.calibration;
  if (patch.chosenOption !== undefined) base.chosenOption = patch.chosenOption;
  if (patch.note !== undefined) base.note = patch.note;
  if (patch.sign && !base.signed) {
    base.signed = true;
    base.signedBy = signer.uid;
    base.signedByName = signer.name;
    base.signedAt = signer.nowIso;
  }
  return base;
}

/** The text at a path, as the dentist left it: their edit when there is one, else the model's. */
export function itemText(kind: OrthoAiKind, report: OrthoReport, path: string): string {
  const [name, idx] = path.split(".");
  const r = report as unknown as Record<string, unknown>;
  const v = idx === undefined ? r[name] : Array.isArray(r[name]) ? (r[name] as unknown[])[Number(idx)] : undefined;
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  const o = v as Record<string, unknown>;
  if (kind === "diagnosis" && name === "problems") return `${o.problem}${o.evidence ? ` — ${o.evidence}` : ""}`;
  if (kind === "plan" && name === "options") return `${o.title} (${o.approach}; ${o.appliance}; ${o.durationMonths} months)`;
  if (kind === "followup" && name === "concerns") return `${o.issue}${o.action ? ` → ${o.action}` : ""}`;
  return JSON.stringify(v);
}

// ----------------------------------------------------------------------------------------------
// Lessons — how the dentist teaches the model
// ----------------------------------------------------------------------------------------------

export type LessonKind = OrthoAiKind | "general";
export const LESSON_KINDS: LessonKind[] = ["general", "ceph", "diagnosis", "plan", "followup"];
export const ORTHO_LESSON_MAX_CHARS = 400;
/** The block is capped by characters; this caps the count so the screen stays readable. */
export const ORTHO_LESSON_MAX_COUNT = 80;

export interface OrthoLesson {
  id: string;
  kind: LessonKind;
  text: string;
  /** Typed by the dentist, or distilled by the model from a correction and approved. */
  source: "manual" | "correction";
  /** The report whose correction taught it, when there is one. */
  reportId?: string;
  active: boolean;
  createdBy: string;
  createdByName: string;
  /** ISO. */
  createdAt: string;
}

export function normalizeLessonText(v: unknown): string {
  return str(v, ORTHO_LESSON_MAX_CHARS).replace(/\s+/g, " ");
}

export function normalizeLessonKind(v: unknown): LessonKind {
  return oneOf(v, LESSON_KINDS, "general");
}

/** A lesson from the database: rows without text are dropped by the caller. */
export function normalizeLesson(id: string, raw: unknown): OrthoLesson | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = normalizeLessonText(r.text);
  if (!text) return null;
  const createdAt = (r.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toISOString() ?? (typeof r.createdAt === "string" ? r.createdAt : "");
  return {
    id,
    kind: normalizeLessonKind(r.kind),
    text,
    source: r.source === "correction" ? "correction" : "manual",
    ...(typeof r.reportId === "string" && r.reportId ? { reportId: r.reportId } : {}),
    active: r.active !== false,
    createdBy: str(r.createdBy, 128),
    createdByName: str(r.createdByName, 120),
    createdAt,
  };
}

/**
 * What the dentist changed on a report, as lines the distilling prompt can read: the model's
 * text beside the dentist's, and the rejected rows, and their note.
 */
export function correctionLines(kind: OrthoAiKind, report: OrthoReport, review: OrthoReview): string[] {
  const lines: string[] = [];
  for (const [path, verdict] of Object.entries(review.verdicts)) {
    const original = itemText(kind, report, path);
    if (!original) continue;
    if (verdict === "rejected") lines.push(`REJECTED (${path}): "${original}"`);
    else if (verdict === "edited" && review.edits[path]) lines.push(`CHANGED (${path}): model wrote "${original}" → dentist wrote "${review.edits[path]}"`);
  }
  if (review.summary && review.summary !== report.summary) lines.push(`SUMMARY REWRITTEN: model wrote "${report.summary.slice(0, 600)}" → dentist wrote "${review.summary.slice(0, 600)}"`);
  if (kind === "plan" && review.chosenOption !== undefined) {
    const opts = (report as OrthoPlanReport).options;
    const chosen = opts[review.chosenOption];
    const recommended = opts.find((o) => o.recommended);
    if (chosen && recommended && chosen !== recommended) lines.push(`CHOSE A DIFFERENT OPTION: model recommended "${recommended.title}" (${recommended.approach}); dentist chose "${chosen.title}" (${chosen.approach})`);
  }
  if (kind === "ceph" && review.landmarks) lines.push("LANDMARKS were moved by the dentist (the landmark tally records where).");
  if (review.note) lines.push(`DENTIST'S NOTE: "${review.note}"`);
  return lines;
}

export const LESSON_DISTILL_SCHEMA = {
  type: "OBJECT",
  properties: {
    lessons: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { text: S, why: S, kind: { type: "STRING", enum: LESSON_KINDS, format: "enum" } },
        required: ["text", "why", "kind"],
      },
    },
  },
  required: ["lessons"],
} as const;

/** Turns one report's corrections into candidate lessons for the dentist to approve. */
export function buildLessonDistillPrompt(opts: { kind: OrthoAiKind; corrections: string[]; existing: OrthoLesson[] }): string {
  const existing = opts.existing.filter((l) => l.active).map((l) => `- [${l.kind}] ${l.text}`);
  return `You help an orthodontist teach an AI assistant. The assistant wrote a ${opts.kind} report; the orthodontist corrected it. From the corrections below, write ONE to THREE reusable lessons — general rules the assistant should follow on FUTURE patients of this clinic — not a restatement of this patient's case.

CORRECTIONS:
${opts.corrections.map((c) => `- ${c}`).join("\n")}
${existing.length ? `\nLESSONS THE CLINIC ALREADY TAUGHT (do not repeat these; a correction already covered by one yields no new lesson):\n${existing.join("\n")}\n` : ""}
RULES:
- A lesson is one sentence, imperative, at most 300 characters, about a preference, a threshold, a convention or a habit ("Prefer non-extraction with interproximal reduction when lower crowding is under 5 mm", "Report IMPA against the clinic's norm of 95°", "Never recommend headgear; use a Carriere or Class II elastics instead", "Place Gonion at the tangent intersection, not on the cortex").
- kind: which report type the lesson applies to, or "general" when it applies to all.
- why: one sentence quoting the correction it came from.
- If the corrections are patient-specific and teach nothing general, return an empty list.
- English only; the orthodontist will edit the wording before saving.`;
}

export interface LessonSuggestion {
  text: string;
  why: string;
  kind: LessonKind;
}

export function normalizeLessonSuggestions(raw: unknown): LessonSuggestion[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>).lessons;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: LessonSuggestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const text = normalizeLessonText(it.text);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push({ text, why: str(it.why, 300), kind: normalizeLessonKind(it.kind) });
    if (out.length >= 3) break;
  }
  return out;
}

// ----------------------------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------------------------

/** Added by code to every rendering. Never optional, never written by the model. */
export function orthoDisclaimer(language: Lang): string {
  return language === "ar"
    ? "تحليل بمساعدة الذكاء الاصطناعي — ليس تشخيصاً ولا خطة علاج نهائية. يجب مراجعته وتأكيده من أخصائي التقويم المعالج مع الفحص السريري."
    : "AI-assisted analysis — not a diagnosis or a final treatment plan. It must be reviewed and confirmed by the treating orthodontist together with the clinical examination.";
}

export const ORTHO_LABELS = {
  kind: {
    ceph: { en: "Cephalometric analysis", ar: "تحليل سيفالومتري" },
    diagnosis: { en: "Diagnosis", ar: "التشخيص" },
    plan: { en: "Treatment plan", ar: "خطة العلاج" },
    followup: { en: "Follow-up", ar: "المتابعة" },
  },
  lessonKind: {
    general: { en: "Everything", ar: "الكل" },
    ceph: { en: "Ceph", ar: "السيفالو" },
    diagnosis: { en: "Diagnosis", ar: "التشخيص" },
    plan: { en: "Planning", ar: "التخطيط" },
    followup: { en: "Follow-up", ar: "المتابعة" },
  },
  angleClass: {
    I: { en: "Angle Class I", ar: "صنف أول (Class I)" },
    II_div1: { en: "Class II division 1", ar: "صنف ثاني قسم 1" },
    II_div2: { en: "Class II division 2", ar: "صنف ثاني قسم 2" },
    III: { en: "Class III", ar: "صنف ثالث" },
    unclear: { en: "Unclear", ar: "غير محدد" },
  },
  skeletalClass: {
    I: { en: "Skeletal I", ar: "هيكلي أول" },
    II: { en: "Skeletal II", ar: "هيكلي ثاني" },
    III: { en: "Skeletal III", ar: "هيكلي ثالث" },
    unclear: { en: "Unclear", ar: "غير محدد" },
  },
  verticalPattern: {
    normal: { en: "Normal vertical", ar: "عمودي طبيعي" },
    high_angle: { en: "High angle", ar: "زاوية مرتفعة" },
    low_angle: { en: "Low angle", ar: "زاوية منخفضة" },
    unclear: { en: "Unclear", ar: "غير محدد" },
  },
  severity: { mild: { en: "Mild", ar: "بسيط" }, moderate: { en: "Moderate", ar: "متوسط" }, severe: { en: "Severe", ar: "شديد" } },
  area: {
    skeletal: { en: "Skeletal", ar: "هيكلي" },
    dental: { en: "Dental", ar: "سني" },
    vertical: { en: "Vertical", ar: "عمودي" },
    transverse: { en: "Transverse", ar: "عرضي" },
    soft_tissue: { en: "Soft tissue", ar: "أنسجة رخوة" },
    functional: { en: "Functional", ar: "وظيفي" },
    habit: { en: "Habit", ar: "عادة" },
    periodontal: { en: "Periodontal", ar: "لثوي" },
    other: { en: "Other", ar: "أخرى" },
  },
  complexity: { simple: { en: "Simple", ar: "بسيطة" }, moderate: { en: "Moderate", ar: "متوسطة" }, complex: { en: "Complex", ar: "معقدة" } },
  approach: {
    non_extraction: { en: "Non-extraction", ar: "بدون خلع" },
    extraction: { en: "Extraction", ar: "مع خلع" },
    interceptive: { en: "Interceptive", ar: "اعتراضي" },
    growth_modification: { en: "Growth modification", ar: "تعديل النمو" },
    camouflage: { en: "Camouflage", ar: "تمويه (Camouflage)" },
    orthognathic: { en: "Orthognathic surgery", ar: "جراحة الفكين" },
    limited: { en: "Limited treatment", ar: "علاج محدود" },
  },
  stage: {
    alignment: { en: "Alignment", ar: "الرصف" },
    leveling: { en: "Leveling", ar: "التسوية" },
    space_closure: { en: "Space closure", ar: "إغلاق المسافات" },
    finishing: { en: "Finishing", ar: "الإنهاء" },
    retention: { en: "Retention", ar: "التثبيت" },
    unclear: { en: "Unclear", ar: "غير محدد" },
  },
  progress: {
    on_track: { en: "On track", ar: "على المسار" },
    slower: { en: "Slower than planned", ar: "أبطأ من المخطط" },
    faster: { en: "Ahead of plan", ar: "أسرع من المخطط" },
    concern: { en: "Needs attention", ar: "يحتاج انتباه" },
  },
  verdict: { confirmed: { en: "Confirmed", ar: "مؤكد" }, rejected: { en: "Rejected", ar: "مرفوض" }, edited: { en: "Edited", ar: "معدّل" } },
} as const;

type LabelGroup = Record<string, { en: string; ar: string }>;
export function orthoLabel(group: keyof typeof ORTHO_LABELS, value: string, language: Lang): string {
  const g = ORTHO_LABELS[group] as LabelGroup;
  return (g[value] || { en: value, ar: value })[language];
}

/** The report as plain text, for a note or a message. Rejected rows are left out; edits replace. */
export function orthoReportToText(kind: OrthoAiKind, report: OrthoReport, language: Lang, review?: OrthoReview | null): string {
  const ar = language === "ar";
  const L = (g: keyof typeof ORTHO_LABELS, v: string) => orthoLabel(g, v, language);
  const rv = review || EMPTY_REVIEW;
  const row = (path: string, text: string): string | null => {
    const verdict = rv.verdicts[path];
    if (verdict === "rejected") return null;
    const body = verdict === "edited" && rv.edits[path] ? rv.edits[path] : text;
    return `- ${body}${verdict ? ` (${L("verdict", verdict)})` : ""}`;
  };
  const rows = (name: string, items: string[]) => items.map((t, i) => row(`${name}.${i}`, t)).filter((x): x is string => x !== null);
  const lines: string[] = [`${L("kind", kind)}`, ""];
  lines.push(`${ar ? "الملخص" : "Summary"}:`, rv.summary || report.summary, "");

  if (kind === "ceph") {
    const r = report as OrthoCephReport;
    for (const [k, label] of [["skeletal", ar ? "هيكلي" : "Skeletal"], ["dental", ar ? "سني" : "Dental"], ["vertical", ar ? "عمودي" : "Vertical"], ["softTissue", ar ? "أنسجة رخوة" : "Soft tissue"]] as const) {
      const t = rv.verdicts[k] === "edited" && rv.edits[k] ? rv.edits[k] : (r as any)[k];
      if (t && rv.verdicts[k] !== "rejected") lines.push(`${label}: ${t}`);
    }
    const kf = rows("keyFindings", r.keyFindings);
    if (kf.length) lines.push("", ar ? "أهم القياسات:" : "Key findings:", ...kf);
    const ti = rows("treatmentImplications", r.treatmentImplications);
    if (ti.length) lines.push("", ar ? "الانعكاسات على العلاج:" : "Treatment implications:", ...ti);
    if (r.limitations) lines.push("", `${ar ? "حدود التحليل" : "Limitations"}: ${r.limitations}`);
  } else if (kind === "diagnosis") {
    const r = report as OrthoDiagnosisReport;
    lines.push(`${L("angleClass", rv.edits.angleClass || r.angleClass)} · ${L("skeletalClass", rv.edits.skeletalClass || r.skeletalClass)} · ${L("verticalPattern", rv.edits.verticalPattern || r.verticalPattern)} · ${L("complexity", r.complexity)}${r.iotn ? ` · IOTN ${r.iotn}` : ""}`);
    const pr = rows("problems", r.problems.map((p) => `[${L("area", p.area)} · ${L("severity", p.severity)}] ${p.problem}${p.evidence ? ` — ${p.evidence}` : ""}`));
    if (pr.length) lines.push("", ar ? "قائمة المشاكل:" : "Problem list:", ...pr);
    const ae = rows("aetiology", r.aetiology);
    if (ae.length) lines.push("", ar ? "الأسباب المحتملة:" : "Aetiology:", ...ae);
    if (r.missingInformation.length) lines.push("", ar ? "معلومات ناقصة:" : "Missing information:", ...r.missingInformation.map((m) => `- ${m}`));
  } else if (kind === "plan") {
    const r = report as OrthoPlanReport;
    const ob = rows("objectives", r.objectives);
    if (ob.length) lines.push(ar ? "الأهداف:" : "Objectives:", ...ob, "");
    r.options.forEach((o, i) => {
      const path = `options.${i}`;
      if (rv.verdicts[path] === "rejected") return;
      const chosen = rv.chosenOption === i;
      lines.push(`${ar ? "الخيار" : "Option"} ${i + 1}: ${o.title} [${L("approach", o.approach)}]${chosen ? ` — ${ar ? "المختار" : "chosen"}` : o.recommended ? ` — ${ar ? "موصى به" : "recommended"}` : ""}`);
      if (rv.edits[path]) lines.push(`  ${ar ? "تعديل الطبيب" : "Dentist's edit"}: ${rv.edits[path]}`);
      lines.push(`  ${ar ? "الجهاز" : "Appliance"}: ${o.appliance}`);
      if (o.extractions.length) lines.push(`  ${ar ? "الخلع" : "Extractions"}: ${o.extractions.join(", ")}`);
      o.phases.forEach((p) => lines.push(`  ${p.name} (${p.months} ${ar ? "شهر" : "mo"}): ${p.goal}${p.steps.length ? ` — ${p.steps.join("; ")}` : ""}`));
      lines.push(`  ${ar ? "المدة" : "Duration"}: ${o.durationMonths} ${ar ? "شهر" : "months"} · ${ar ? "التثبيت" : "Retention"}: ${o.retention}`);
      if (o.risks.length) lines.push(`  ${ar ? "المخاطر" : "Risks"}: ${o.risks.join("; ")}`);
      lines.push("");
    });
    const pre = rows("prerequisites", r.prerequisites);
    if (pre.length) lines.push(ar ? "قبل البدء:" : "Before starting:", ...pre);
  } else {
    const r = report as OrthoFollowupReport;
    lines.push(`${L("stage", r.stage)} · ${L("progress", rv.edits.progress || r.progress)} · ${ar ? "الزيارة القادمة بعد" : "Next visit in"} ${rv.edits.nextVisitWeeks || r.nextVisitWeeks} ${ar ? "أسبوع" : "weeks"}`);
    const obs = rows("observations", r.observations);
    if (obs.length) lines.push("", ar ? "الملاحظات:" : "Observations:", ...obs);
    const con = rows("concerns", r.concerns.map((c) => `[${L("severity", c.severity)}] ${c.issue}${c.action ? ` → ${c.action}` : ""}`));
    if (con.length) lines.push("", ar ? "نقاط تحتاج انتباه:" : "Concerns:", ...con);
    const tv = rows("thisVisit", r.thisVisit);
    if (tv.length) lines.push("", ar ? "في الزيارة دي:" : "This visit:", ...tv);
    if (r.hygieneAndCompliance.length) lines.push("", ar ? "تعليمات للمريض:" : "For the patient:", ...r.hygieneAndCompliance.map((h) => `- ${h}`));
  }
  lines.push("", orthoDisclaimer(language));
  return lines.join("\n");
}

/** The lines a later prompt gets about an earlier signed report: what the dentist confirmed. */
export function reportToPromptLines(kind: OrthoAiKind, report: OrthoReport, review?: OrthoReview | null): string[] {
  const text = orthoReportToText(kind, report, "en", review);
  return text
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("AI-assisted analysis"))
    .slice(0, 60)
    .map((l) => l.slice(0, 300));
}
