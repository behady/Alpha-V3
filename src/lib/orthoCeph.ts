/**
 * Cephalometric analysis as pure geometry.
 *
 * The model's job is to find landmarks on a lateral cephalogram — nothing more. Every angle and
 * distance in the analysis is computed HERE, by code, from those points, so a number on the screen
 * is always the same function of the same dots the dentist can see and drag. A model that reports
 * "SNA 84°" straight from the picture cannot be checked; a model that says "A point is here" can
 * be corrected with one drag, and the correction re-derives every measurement that used it.
 *
 * Coordinates: landmarks are stored in the image's own frame on a 0–1000 scale per axis (the
 * convention Gemini localises in, y down). That frame is NOT isotropic on a non-square picture —
 * a 1000×1000 grid over a 2000×1500 film stretches x by a third and would bend every angle — so
 * everything here first converts to isotropic units using the image's aspect ratio. Linear
 * measurements come out in those units and are turned into millimetres only when a calibration
 * (two points a known distance apart, usually the ruler on the film) is supplied; otherwise they
 * are reported as unscaled and compared to no norm.
 *
 * Nothing here talks to Gemini or Firestore, so the tests can import it as-is.
 */

export type CephPoint = { x: number; y: number };

export type CephLandmarkId =
  | "S" // Sella — centre of the sella turcica
  | "N" // Nasion — frontonasal suture
  | "Or" // Orbitale — lowest point of the orbit
  | "Po" // Porion — top of the external auditory meatus
  | "Ar" // Articulare
  | "Go" // Gonion
  | "Me" // Menton
  | "Gn" // Gnathion
  | "Pog" // Pogonion
  | "B" // B point (supramentale)
  | "A" // A point (subspinale)
  | "ANS" // Anterior nasal spine
  | "PNS" // Posterior nasal spine
  | "U1I" // Upper incisor incisal edge
  | "U1A" // Upper incisor root apex
  | "L1I" // Lower incisor incisal edge
  | "L1A" // Lower incisor root apex
  | "U6" // Upper first molar mesio-buccal cusp
  | "L6"; // Lower first molar mesio-buccal cusp

export interface CephLandmarkInfo {
  id: CephLandmarkId;
  en: string;
  ar: string;
  /** Where to put the dot, for the model and for the dentist's tooltip. */
  hint: string;
  /** The analysis is thin without these; the rest only add measurements. */
  core: boolean;
}

export const CEPH_LANDMARKS: CephLandmarkInfo[] = [
  { id: "S", en: "Sella", ar: "سيلا (S)", hint: "geometric centre of the sella turcica (pituitary fossa)", core: true },
  { id: "N", en: "Nasion", ar: "نازيون (N)", hint: "most anterior point of the frontonasal suture", core: true },
  { id: "Or", en: "Orbitale", ar: "أوربيتال (Or)", hint: "lowest point on the inferior margin of the orbit", core: true },
  { id: "Po", en: "Porion", ar: "بوريون (Po)", hint: "most superior point of the external auditory meatus (the ear rod ring is NOT porion)", core: true },
  { id: "Ar", en: "Articulare", ar: "أرتيكيولار (Ar)", hint: "intersection of the posterior border of the condyle and the inferior border of the cranial base", core: false },
  { id: "Go", en: "Gonion", ar: "جونيون (Go)", hint: "most posterior-inferior point on the angle of the mandible, where the ramus tangent meets the lower border tangent", core: true },
  { id: "Me", en: "Menton", ar: "منتون (Me)", hint: "lowest point on the symphysis", core: true },
  { id: "Gn", en: "Gnathion", ar: "ناثيون (Gn)", hint: "most anterior-inferior point on the symphysis, between Pog and Me", core: true },
  { id: "Pog", en: "Pogonion", ar: "بوجونيون (Pog)", hint: "most anterior point of the bony chin", core: true },
  { id: "B", en: "B point", ar: "نقطة B", hint: "deepest point of the anterior concavity of the mandibular symphysis", core: true },
  { id: "A", en: "A point", ar: "نقطة A", hint: "deepest point of the anterior concavity of the maxilla between ANS and the alveolar crest", core: true },
  { id: "ANS", en: "Anterior nasal spine", ar: "الشوكة الأنفية الأمامية (ANS)", hint: "tip of the anterior nasal spine", core: true },
  { id: "PNS", en: "Posterior nasal spine", ar: "الشوكة الأنفية الخلفية (PNS)", hint: "tip of the posterior nasal spine of the palatine bone", core: true },
  { id: "U1I", en: "Upper incisor edge", ar: "حافة القاطع العلوي (U1I)", hint: "incisal edge of the most labial upper central incisor", core: true },
  { id: "U1A", en: "Upper incisor apex", ar: "ذروة القاطع العلوي (U1A)", hint: "root apex of the same upper central incisor", core: true },
  { id: "L1I", en: "Lower incisor edge", ar: "حافة القاطع السفلي (L1I)", hint: "incisal edge of the most labial lower central incisor", core: true },
  { id: "L1A", en: "Lower incisor apex", ar: "ذروة القاطع السفلي (L1A)", hint: "root apex of the same lower central incisor", core: true },
  { id: "U6", en: "Upper first molar", ar: "الضرس الأول العلوي (U6)", hint: "mesio-buccal cusp tip of the upper first molar", core: false },
  { id: "L6", en: "Lower first molar", ar: "الضرس الأول السفلي (L6)", hint: "mesio-buccal cusp tip of the lower first molar", core: false },
];

export const CEPH_LANDMARK_IDS: CephLandmarkId[] = CEPH_LANDMARKS.map((l) => l.id);
const LANDMARK_SET = new Set<string>(CEPH_LANDMARK_IDS);

export type CephLandmarks = Partial<Record<CephLandmarkId, CephPoint>>;

/** The reference lines the viewer draws. Derived points (OP) are computed, not stored. */
export const CEPH_LINES: { id: string; from: CephLandmarkId | "OP1" | "OP2"; to: CephLandmarkId | "OP1" | "OP2"; color: string }[] = [
  { id: "SN", from: "S", to: "N", color: "#38bdf8" },
  { id: "FH", from: "Po", to: "Or", color: "#a78bfa" },
  { id: "MP", from: "Go", to: "Me", color: "#fb923c" },
  { id: "PP", from: "PNS", to: "ANS", color: "#34d399" },
  { id: "NA", from: "N", to: "A", color: "#f472b6" },
  { id: "NB", from: "N", to: "B", color: "#f472b6" },
  { id: "NPog", from: "N", to: "Pog", color: "#fde047" },
  { id: "U1", from: "U1A", to: "U1I", color: "#f87171" },
  { id: "L1", from: "L1A", to: "L1I", color: "#f87171" },
  { id: "OP", from: "OP1", to: "OP2", color: "#e2e8f0" },
];

// ----------------------------------------------------------------------------------------------
// Norms
// ----------------------------------------------------------------------------------------------

export type CephMeasurementId =
  | "SNA"
  | "SNB"
  | "ANB"
  | "SN_MP"
  | "FMA"
  | "IMPA"
  | "FMIA"
  | "U1_SN"
  | "U1_NA_deg"
  | "U1_NA_mm"
  | "L1_NB_deg"
  | "L1_NB_mm"
  | "INTERINCISAL"
  | "Y_AXIS"
  | "FACIAL_ANGLE"
  | "CONVEXITY"
  | "SN_PP"
  | "SN_OP"
  | "WITS"
  | "OVERJET"
  | "OVERBITE"
  | "SADDLE"
  | "ARTICULAR"
  | "GONIAL"
  | "BJORK_SUM"
  | "JARABAK"
  | "LAFH_RATIO";

export type CephUnit = "°" | "mm" | "%";

export interface CephNorm {
  mean: number;
  sd: number;
}

export interface CephMeasurementInfo {
  id: CephMeasurementId;
  en: string;
  ar: string;
  unit: CephUnit;
  /** Steiner, Tweed, Downs, Jacobson (Wits), Björk/Jarabak — adult norms; see below. */
  source: string;
  norm: CephNorm | null;
  needs: CephLandmarkId[];
  /** Only computed when the picture is calibrated. */
  linear?: boolean;
}

/**
 * Default adult norms. They are the textbook (largely Caucasian) figures every orthodontist was
 * taught; a clinic may override them from the coaching screen — Egyptian samples run a degree or
 * two more bimaxillary-protrusive on the incisor angles — and the override travels with the
 * analysis so the report says which norms it was judged against.
 */
export const CEPH_MEASUREMENTS: CephMeasurementInfo[] = [
  { id: "SNA", en: "SNA", ar: "SNA", unit: "°", source: "Steiner", norm: { mean: 82, sd: 2 }, needs: ["S", "N", "A"] },
  { id: "SNB", en: "SNB", ar: "SNB", unit: "°", source: "Steiner", norm: { mean: 80, sd: 2 }, needs: ["S", "N", "B"] },
  { id: "ANB", en: "ANB", ar: "ANB", unit: "°", source: "Steiner", norm: { mean: 2, sd: 2 }, needs: ["S", "N", "A", "B"] },
  { id: "SN_MP", en: "SN–MP (Go-Me)", ar: "SN–MP", unit: "°", source: "Steiner", norm: { mean: 32, sd: 5 }, needs: ["S", "N", "Go", "Me"] },
  { id: "FMA", en: "FMA (FH–MP)", ar: "FMA", unit: "°", source: "Tweed", norm: { mean: 25, sd: 3 }, needs: ["Po", "Or", "Go", "Me"] },
  { id: "IMPA", en: "IMPA (L1–MP)", ar: "IMPA", unit: "°", source: "Tweed", norm: { mean: 90, sd: 3 }, needs: ["L1I", "L1A", "Go", "Me"] },
  { id: "FMIA", en: "FMIA (L1–FH)", ar: "FMIA", unit: "°", source: "Tweed", norm: { mean: 65, sd: 3 }, needs: ["Po", "Or", "Go", "Me", "L1I", "L1A"] },
  { id: "U1_SN", en: "U1–SN", ar: "U1–SN", unit: "°", source: "Steiner", norm: { mean: 103, sd: 2 }, needs: ["S", "N", "U1I", "U1A"] },
  { id: "U1_NA_deg", en: "U1–NA", ar: "U1–NA", unit: "°", source: "Steiner", norm: { mean: 22, sd: 2 }, needs: ["N", "A", "U1I", "U1A"] },
  { id: "U1_NA_mm", en: "U1–NA", ar: "U1–NA", unit: "mm", source: "Steiner", norm: { mean: 4, sd: 2 }, needs: ["N", "A", "U1I"], linear: true },
  { id: "L1_NB_deg", en: "L1–NB", ar: "L1–NB", unit: "°", source: "Steiner", norm: { mean: 25, sd: 2 }, needs: ["N", "B", "L1I", "L1A"] },
  { id: "L1_NB_mm", en: "L1–NB", ar: "L1–NB", unit: "mm", source: "Steiner", norm: { mean: 4, sd: 2 }, needs: ["N", "B", "L1I"], linear: true },
  { id: "INTERINCISAL", en: "Interincisal angle", ar: "الزاوية بين القواطع", unit: "°", source: "Steiner", norm: { mean: 131, sd: 5 }, needs: ["U1I", "U1A", "L1I", "L1A"] },
  { id: "Y_AXIS", en: "Y-axis (S-Gn to FH)", ar: "محور Y", unit: "°", source: "Downs", norm: { mean: 59, sd: 3 }, needs: ["S", "Gn", "Po", "Or"] },
  { id: "FACIAL_ANGLE", en: "Facial angle (N-Pog to FH)", ar: "الزاوية الوجهية", unit: "°", source: "Downs", norm: { mean: 88, sd: 3 }, needs: ["N", "Pog", "Po", "Or"] },
  { id: "CONVEXITY", en: "Angle of convexity (N-A-Pog)", ar: "زاوية التحدب", unit: "°", source: "Downs", norm: { mean: 0, sd: 5 }, needs: ["N", "A", "Pog"] },
  { id: "SN_PP", en: "SN–Palatal plane", ar: "SN–المستوى الحنكي", unit: "°", source: "Steiner", norm: { mean: 8, sd: 3 }, needs: ["S", "N", "ANS", "PNS"] },
  { id: "SN_OP", en: "SN–Occlusal plane", ar: "SN–المستوى الإطباقي", unit: "°", source: "Steiner", norm: { mean: 14, sd: 3 }, needs: ["S", "N", "U1I", "L1I", "U6", "L6"] },
  { id: "WITS", en: "Wits appraisal (AO–BO)", ar: "تقييم Wits", unit: "mm", source: "Jacobson", norm: { mean: 0, sd: 2 }, needs: ["A", "B", "U1I", "L1I", "U6", "L6"], linear: true },
  { id: "OVERJET", en: "Overjet", ar: "الأوفرجيت", unit: "mm", source: "—", norm: { mean: 2.5, sd: 1 }, needs: ["U1I", "L1I", "U6", "L6"], linear: true },
  { id: "OVERBITE", en: "Overbite", ar: "الأوفربايت", unit: "mm", source: "—", norm: { mean: 2.5, sd: 1 }, needs: ["U1I", "L1I", "U6", "L6"], linear: true },
  { id: "SADDLE", en: "Saddle angle (N-S-Ar)", ar: "زاوية السرج", unit: "°", source: "Björk", norm: { mean: 123, sd: 5 }, needs: ["N", "S", "Ar"] },
  { id: "ARTICULAR", en: "Articular angle (S-Ar-Go)", ar: "الزاوية المفصلية", unit: "°", source: "Björk", norm: { mean: 143, sd: 6 }, needs: ["S", "Ar", "Go"] },
  { id: "GONIAL", en: "Gonial angle (Ar-Go-Me)", ar: "زاوية الفك", unit: "°", source: "Björk", norm: { mean: 130, sd: 7 }, needs: ["Ar", "Go", "Me"] },
  { id: "BJORK_SUM", en: "Björk sum", ar: "مجموع Björk", unit: "°", source: "Björk", norm: { mean: 396, sd: 6 }, needs: ["N", "S", "Ar", "Go", "Me"] },
  { id: "JARABAK", en: "Jarabak ratio (S-Go / N-Me)", ar: "نسبة Jarabak", unit: "%", source: "Jarabak", norm: { mean: 63.5, sd: 2.5 }, needs: ["S", "Go", "N", "Me"] },
  { id: "LAFH_RATIO", en: "Lower face height (ANS-Me / N-Me)", ar: "نسبة ارتفاع الوجه السفلي", unit: "%", source: "—", norm: { mean: 55, sd: 2 }, needs: ["ANS", "Me", "N"] },
];

export const CEPH_MEASUREMENT_IDS: CephMeasurementId[] = CEPH_MEASUREMENTS.map((m) => m.id);

export type CephNormOverrides = Partial<Record<CephMeasurementId, CephNorm>>;

/** Cleans a norms map from the database or a form: unknown ids and unusable numbers are dropped. */
export function normalizeNormOverrides(raw: unknown): CephNormOverrides {
  const out: CephNormOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!CEPH_MEASUREMENT_IDS.includes(k as CephMeasurementId)) continue;
    if (!v || typeof v !== "object") continue;
    const mean = Number((v as any).mean);
    const sd = Number((v as any).sd);
    if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0 || sd > 50 || Math.abs(mean) > 500) continue;
    out[k as CephMeasurementId] = { mean: Math.round(mean * 10) / 10, sd: Math.round(sd * 10) / 10 };
  }
  return out;
}

// ----------------------------------------------------------------------------------------------
// Geometry
// ----------------------------------------------------------------------------------------------

const deg = (rad: number) => (rad * 180) / Math.PI;
const sub = (a: CephPoint, b: CephPoint): CephPoint => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: CephPoint) => Math.hypot(v.x, v.y);
const dist = (a: CephPoint, b: CephPoint) => len(sub(a, b));
const mid = (a: CephPoint, b: CephPoint): CephPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Unsigned angle between two vectors, 0–180. */
export function vectorAngle(u: CephPoint, v: CephPoint): number {
  const lu = len(u);
  const lv = len(v);
  if (lu === 0 || lv === 0) return NaN;
  const c = Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv)));
  return deg(Math.acos(c));
}

/** The angle at vertex V between VP and VQ, 0–180. */
export function angleAt(p: CephPoint, v: CephPoint, q: CephPoint): number {
  return vectorAngle(sub(p, v), sub(q, v));
}

/** The acute angle between two lines (directions are irrelevant), 0–90. */
export function lineAngle(a1: CephPoint, a2: CephPoint, b1: CephPoint, b2: CephPoint): number {
  const t = vectorAngle(sub(a2, a1), sub(b2, b1));
  return Number.isNaN(t) ? NaN : Math.min(t, 180 - t);
}

/** Perpendicular distance of p from the line through a and b. Unsigned. */
export function distanceToLine(p: CephPoint, a: CephPoint, b: CephPoint): number {
  const d = sub(b, a);
  const l = len(d);
  if (l === 0) return NaN;
  return Math.abs(d.x * (p.y - a.y) - d.y * (p.x - a.x)) / l;
}

/** Where p falls along the line a→b, in the line's own units (0 at a, positive towards b). */
function projectionParam(p: CephPoint, a: CephPoint, b: CephPoint): number {
  const d = sub(b, a);
  const l = len(d);
  if (l === 0) return NaN;
  return ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l;
}

/** +1 when the face points to the right of the picture, −1 when to the left. */
export function facingSign(lm: CephLandmarks): 1 | -1 {
  const pairs: [CephLandmarkId, CephLandmarkId][] = [
    ["S", "N"],
    ["Po", "Or"],
    ["PNS", "ANS"],
    ["Go", "Pog"],
  ];
  for (const [back, front] of pairs) {
    const b = lm[back];
    const f = lm[front];
    if (b && f && Math.abs(f.x - b.x) > 1e-6) return f.x > b.x ? 1 : -1;
  }
  return 1;
}

/**
 * Signed distance of p from the line through a and b: positive when p lies on the anterior side.
 * Meant for the near-vertical reference lines (NA, NB, N-Pog) where "anterior" is a side.
 */
function anteriorDistance(p: CephPoint, a: CephPoint, b: CephPoint, facing: 1 | -1): number {
  const d = sub(b, a);
  const l = len(d);
  if (l === 0) return NaN;
  // Cross product sign tells which side; orient so that +x (after facing) reads as anterior.
  const cross = d.x * (p.y - a.y) - d.y * (p.x - a.x);
  // For a downward line (d.y > 0) a point to the right has cross < 0.
  const rightOfLine = d.y >= 0 ? -cross : cross;
  return (facing * rightOfLine) / l;
}

// ----------------------------------------------------------------------------------------------
// The analysis
// ----------------------------------------------------------------------------------------------

export type CephStatus = "low" | "normal" | "high" | "unscaled" | "missing";

export interface CephMeasurement {
  id: CephMeasurementId;
  en: string;
  ar: string;
  unit: CephUnit;
  source: string;
  /** Rounded to one decimal. Null when a landmark it needs is absent, or when linear and unscaled. */
  value: number | null;
  norm: CephNorm | null;
  /** (value − mean) / sd, one decimal. Null without a value or a norm. */
  z: number | null;
  status: CephStatus;
  /** The landmarks that were absent, when status is "missing". */
  missing: CephLandmarkId[];
}

export type SkeletalClass = "I" | "II" | "III";
export type VerticalPattern = "normal" | "high_angle" | "low_angle";
export type Inclination = "proclined" | "upright" | "retroclined";
export type JawPosition = "prognathic" | "normal" | "retrognathic";
export type ProfileType = "convex" | "straight" | "concave";

export interface CephInterpretation {
  skeletalClass: SkeletalClass | null;
  /** ANB judged against Wits when both exist and disagree — flagged rather than silently picked. */
  skeletalNote: "anb_wits_agree" | "anb_wits_disagree" | "anb_only" | "none";
  maxilla: JawPosition | null;
  mandible: JawPosition | null;
  vertical: VerticalPattern | null;
  upperIncisors: Inclination | null;
  lowerIncisors: Inclination | null;
  profile: ProfileType | null;
  growthRotation: "clockwise" | "neutral" | "counterclockwise" | null;
}

export interface CephAnalysis {
  measurements: CephMeasurement[];
  interpretation: CephInterpretation;
  facing: "right" | "left";
  calibrated: boolean;
  /** Millimetres per isotropic unit (one thousandth of the image height); null when unscaled. */
  mmPerUnit: number | null;
  /** Ids of the norms the clinic overrode, so the report can say so. */
  normOverrides: CephMeasurementId[];
  /** Core landmarks that were not placed. */
  missingCore: CephLandmarkId[];
}

export interface CephCalibration {
  a: CephPoint;
  b: CephPoint;
  mm: number;
}

export interface CephAnalysisOptions {
  /** width / height of the picture. 1 when unknown — angles are then only right on a square film. */
  aspect: number;
  calibration?: CephCalibration | null;
  norms?: CephNormOverrides | null;
}

/** 0–1000 per axis → isotropic units where one unit is a thousandth of the image height. */
function toIso(p: CephPoint, aspect: number): CephPoint {
  return { x: p.x * aspect, y: p.y };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function analyzeCeph(landmarks: CephLandmarks, opts: CephAnalysisOptions): CephAnalysis {
  const aspect = Number.isFinite(opts.aspect) && opts.aspect > 0 ? opts.aspect : 1;
  const P: CephLandmarks = {};
  for (const id of CEPH_LANDMARK_IDS) {
    const p = landmarks[id];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) P[id] = toIso(p, aspect);
  }
  const facing = facingSign(P);
  const overrides = normalizeNormOverrides(opts.norms || {});

  let mmPerUnit: number | null = null;
  if (opts.calibration && opts.calibration.mm > 0) {
    const a = toIso(opts.calibration.a, aspect);
    const b = toIso(opts.calibration.b, aspect);
    const d = dist(a, b);
    if (d > 1) mmPerUnit = opts.calibration.mm / d;
  }

  // The occlusal plane: from the molar contact to the incisor overlap, each a midpoint.
  const op1 = P.U6 && P.L6 ? mid(P.U6, P.L6) : null;
  const op2 = P.U1I && P.L1I ? mid(P.U1I, P.L1I) : null;
  const opDir = op1 && op2 ? sub(op2, op1) : null; // posterior → anterior

  const raw: Partial<Record<CephMeasurementId, number>> = {};
  const has = (...ids: CephLandmarkId[]) => ids.every((id) => !!P[id]);

  if (has("S", "N", "A")) raw.SNA = angleAt(P.S!, P.N!, P.A!);
  if (has("S", "N", "B")) raw.SNB = angleAt(P.S!, P.N!, P.B!);
  if (raw.SNA !== undefined && raw.SNB !== undefined) raw.ANB = raw.SNA - raw.SNB;
  if (has("S", "N", "Go", "Me")) raw.SN_MP = lineAngle(P.S!, P.N!, P.Go!, P.Me!);
  if (has("Po", "Or", "Go", "Me")) raw.FMA = lineAngle(P.Po!, P.Or!, P.Go!, P.Me!);
  // Apex→edge against the posterior-pointing mandibular plane: upright reads 90, proclined more.
  if (has("L1I", "L1A", "Go", "Me")) raw.IMPA = vectorAngle(sub(P.L1I!, P.L1A!), sub(P.Go!, P.Me!));
  if (raw.FMA !== undefined && raw.IMPA !== undefined) raw.FMIA = 180 - raw.FMA - raw.IMPA;
  // Apex→edge against N→S: perpendicular reads 90, a proclined upper incisor more.
  if (has("S", "N", "U1I", "U1A")) raw.U1_SN = vectorAngle(sub(P.U1I!, P.U1A!), sub(P.S!, P.N!));
  if (has("N", "A", "U1I", "U1A")) raw.U1_NA_deg = vectorAngle(sub(P.U1I!, P.U1A!), sub(P.A!, P.N!));
  if (has("N", "B", "L1I", "L1A")) raw.L1_NB_deg = vectorAngle(sub(P.L1I!, P.L1A!), sub(P.N!, P.B!));
  if (has("U1I", "U1A", "L1I", "L1A")) raw.INTERINCISAL = vectorAngle(sub(P.U1A!, P.U1I!), sub(P.L1A!, P.L1I!));
  if (has("S", "Gn", "Po", "Or")) raw.Y_AXIS = lineAngle(P.S!, P.Gn!, P.Po!, P.Or!);
  // N→Pog against the posterior-pointing FH: a forward chin reads above 90.
  if (has("N", "Pog", "Po", "Or")) raw.FACIAL_ANGLE = vectorAngle(sub(P.Pog!, P.N!), sub(P.Po!, P.Or!));
  if (has("N", "A", "Pog")) {
    const bend = 180 - angleAt(P.N!, P.A!, P.Pog!);
    const side = anteriorDistance(P.A!, P.N!, P.Pog!, facing);
    raw.CONVEXITY = side >= 0 ? bend : -bend;
  }
  if (has("S", "N", "ANS", "PNS")) raw.SN_PP = lineAngle(P.S!, P.N!, P.PNS!, P.ANS!);
  if (op1 && op2 && has("S", "N")) raw.SN_OP = lineAngle(P.S!, P.N!, op1, op2);
  if (has("N", "S", "Ar")) raw.SADDLE = angleAt(P.N!, P.S!, P.Ar!);
  if (has("S", "Ar", "Go")) raw.ARTICULAR = angleAt(P.S!, P.Ar!, P.Go!);
  if (has("Ar", "Go", "Me")) raw.GONIAL = angleAt(P.Ar!, P.Go!, P.Me!);
  if (raw.SADDLE !== undefined && raw.ARTICULAR !== undefined && raw.GONIAL !== undefined) {
    raw.BJORK_SUM = raw.SADDLE + raw.ARTICULAR + raw.GONIAL;
  }
  if (has("S", "Go", "N", "Me")) {
    const nme = dist(P.N!, P.Me!);
    if (nme > 0) raw.JARABAK = (dist(P.S!, P.Go!) / nme) * 100;
  }
  if (has("ANS", "Me", "N")) {
    const nme = dist(P.N!, P.Me!);
    if (nme > 0) raw.LAFH_RATIO = (dist(P.ANS!, P.Me!) / nme) * 100;
  }

  // Linear: computed in units, converted when calibrated.
  const linearUnits: Partial<Record<CephMeasurementId, number>> = {};
  if (has("N", "A", "U1I")) linearUnits.U1_NA_mm = anteriorDistance(P.U1I!, P.N!, P.A!, facing);
  if (has("N", "B", "L1I")) linearUnits.L1_NB_mm = anteriorDistance(P.L1I!, P.N!, P.B!, facing);
  if (op1 && op2 && opDir && has("A", "B")) {
    linearUnits.WITS = projectionParam(P.A!, op1, op2) - projectionParam(P.B!, op1, op2);
  }
  if (op1 && op2 && opDir && has("U1I", "L1I")) {
    const l = len(opDir);
    if (l > 0) {
      const u = { x: opDir.x / l, y: opDir.y / l }; // anterior along the occlusal plane
      const d = sub(P.U1I!, P.L1I!);
      linearUnits.OVERJET = d.x * u.x + d.y * u.y;
      // Perpendicular to the plane, positive downward (the upper edge below the lower edge).
      const n = { x: -u.y, y: u.x };
      const down = n.y >= 0 ? n : { x: -n.x, y: -n.y };
      linearUnits.OVERBITE = d.x * down.x + d.y * down.y;
    }
  }

  const measurements: CephMeasurement[] = CEPH_MEASUREMENTS.map((info) => {
    const norm = overrides[info.id] || info.norm;
    const missing = info.needs.filter((id) => !P[id]);
    const base = { id: info.id, en: info.en, ar: info.ar, unit: info.unit, source: info.source, norm, missing };
    if (missing.length) return { ...base, value: null, z: null, status: "missing" as const };
    let value: number | undefined;
    if (info.linear) {
      const units = linearUnits[info.id];
      if (units === undefined || !Number.isFinite(units)) return { ...base, value: null, z: null, status: "missing" as const };
      if (mmPerUnit === null) return { ...base, value: null, z: null, status: "unscaled" as const };
      value = units * mmPerUnit;
    } else {
      value = raw[info.id];
    }
    if (value === undefined || !Number.isFinite(value)) return { ...base, value: null, z: null, status: "missing" as const };
    const v = r1(value);
    if (!norm) return { ...base, value: v, z: null, status: "normal" as const };
    const z = r1((v - norm.mean) / norm.sd);
    const status: CephStatus = z > 1 ? "high" : z < -1 ? "low" : "normal";
    return { ...base, value: v, z, status };
  });

  const byId = Object.fromEntries(measurements.map((m) => [m.id, m])) as Record<CephMeasurementId, CephMeasurement>;
  const interpretation = interpretCeph(byId);

  return {
    measurements,
    interpretation,
    facing: facing === 1 ? "right" : "left",
    calibrated: mmPerUnit !== null,
    mmPerUnit: mmPerUnit === null ? null : Math.round(mmPerUnit * 10000) / 10000,
    normOverrides: (Object.keys(overrides) as CephMeasurementId[]).filter((id) => byId[id]?.value !== null),
    missingCore: CEPH_LANDMARKS.filter((l) => l.core && !P[l.id]).map((l) => l.id),
  };
}

/** The categorical reading of the numbers. Thresholds are the ones taught with the norms above. */
export function interpretCeph(m: Record<CephMeasurementId, CephMeasurement>): CephInterpretation {
  const v = (id: CephMeasurementId) => (m[id] && m[id].value !== null ? (m[id].value as number) : null);
  const s = (id: CephMeasurementId) => (m[id] && m[id].value !== null ? m[id].status : null);

  const anb = v("ANB");
  const wits = v("WITS");
  let skeletalClass: SkeletalClass | null = null;
  let skeletalNote: CephInterpretation["skeletalNote"] = "none";
  if (anb !== null) {
    skeletalClass = anb > 4 ? "II" : anb < 0 ? "III" : "I";
    skeletalNote = "anb_only";
    if (wits !== null) {
      const byWits: SkeletalClass = wits > 2 ? "II" : wits < -2 ? "III" : "I";
      skeletalNote = byWits === skeletalClass ? "anb_wits_agree" : "anb_wits_disagree";
    }
  }

  const jaw = (id: CephMeasurementId): JawPosition | null => {
    const st = s(id);
    return st === null ? null : st === "high" ? "prognathic" : st === "low" ? "retrognathic" : "normal";
  };
  const incl = (id: CephMeasurementId): Inclination | null => {
    const st = s(id);
    return st === null ? null : st === "high" ? "proclined" : st === "low" ? "retroclined" : "upright";
  };

  let vertical: VerticalPattern | null = null;
  const vsigns = [s("SN_MP"), s("FMA")].filter((x): x is CephStatus => x !== null);
  if (vsigns.length) {
    vertical = vsigns.includes("high") ? "high_angle" : vsigns.includes("low") ? "low_angle" : "normal";
  }

  const conv = v("CONVEXITY");
  const profile: ProfileType | null = conv === null ? null : conv > 5 ? "convex" : conv < -5 ? "concave" : "straight";

  const jar = v("JARABAK");
  const growthRotation = jar === null ? null : jar < 59 ? "clockwise" : jar > 68 ? "counterclockwise" : "neutral";

  return {
    skeletalClass,
    skeletalNote,
    maxilla: jaw("SNA"),
    mandible: jaw("SNB"),
    vertical,
    upperIncisors: incl("U1_SN") ?? incl("U1_NA_deg"),
    lowerIncisors: incl("IMPA") ?? incl("L1_NB_deg"),
    profile,
    growthRotation,
  };
}

// ----------------------------------------------------------------------------------------------
// What the model returns, and cleaning it
// ----------------------------------------------------------------------------------------------

/**
 * Gemini's answer for a ceph: the landmarks it could place, each on the 0–1000 grid with a
 * confidence, plus what kind of picture it decided it was looking at. Plain data, cast at the
 * call site like XRAY_RESPONSE_SCHEMA.
 */
export const CEPH_LANDMARK_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    isLateralCeph: { type: "BOOLEAN" },
    facing: { type: "STRING", enum: ["right", "left"], format: "enum" },
    quality: { type: "STRING", enum: ["good", "acceptable", "poor"], format: "enum" },
    qualityNotes: { type: "STRING" },
    landmarks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", enum: CEPH_LANDMARK_IDS, format: "enum" },
          y: { type: "INTEGER" },
          x: { type: "INTEGER" },
          confidence: { type: "STRING", enum: ["high", "moderate", "low"], format: "enum" },
        },
        required: ["id", "y", "x", "confidence"],
      },
    },
    ruler: {
      type: "OBJECT",
      properties: {
        found: { type: "BOOLEAN" },
        y1: { type: "INTEGER" },
        x1: { type: "INTEGER" },
        y2: { type: "INTEGER" },
        x2: { type: "INTEGER" },
        mm: { type: "NUMBER" },
      },
      required: ["found"],
    },
  },
  required: ["isLateralCeph", "facing", "quality", "landmarks"],
} as const;

export type CephConfidence = "high" | "moderate" | "low";

export interface CephLandmarkResult {
  isLateralCeph: boolean;
  facing: "right" | "left";
  quality: "good" | "acceptable" | "poor";
  qualityNotes: string;
  landmarks: CephLandmarks;
  confidence: Partial<Record<CephLandmarkId, CephConfidence>>;
  /** A calibration the model read off the film's ruler, if it saw one. Never trusted blindly. */
  ruler: CephCalibration | null;
}

const clamp1000 = (n: unknown): number | null => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1000, Math.round(v)));
};

/**
 * Turns the model's JSON into a landmark set. Returns null when it says the picture is not a
 * lateral ceph, or when it placed fewer than four points — nothing worth charging for. Duplicate
 * ids keep the first; ids it does not know are dropped.
 */
export function normalizeCephLandmarkResult(raw: unknown): CephLandmarkResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.landmarks) ? r.landmarks : [];
  const landmarks: CephLandmarks = {};
  const confidence: CephLandmarkResult["confidence"] = {};
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const id = typeof it.id === "string" ? it.id.trim() : "";
    if (!LANDMARK_SET.has(id) || landmarks[id as CephLandmarkId]) continue;
    const x = clamp1000(it.x);
    const y = clamp1000(it.y);
    if (x === null || y === null) continue;
    landmarks[id as CephLandmarkId] = { x, y };
    confidence[id as CephLandmarkId] =
      it.confidence === "high" || it.confidence === "low" ? it.confidence : "moderate";
  }
  const placed = Object.keys(landmarks).length;
  if (r.isLateralCeph === false || placed < 4) return null;

  let ruler: CephCalibration | null = null;
  const rl = r.ruler as Record<string, unknown> | undefined;
  if (rl && rl.found === true) {
    const x1 = clamp1000(rl.x1), y1 = clamp1000(rl.y1), x2 = clamp1000(rl.x2), y2 = clamp1000(rl.y2);
    const mm = Number(rl.mm);
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null && Number.isFinite(mm) && mm >= 5 && mm <= 300) {
      ruler = { a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, mm };
    }
  }

  return {
    isLateralCeph: true,
    facing: r.facing === "left" ? "left" : "right",
    quality: r.quality === "good" || r.quality === "poor" ? r.quality : "acceptable",
    qualityNotes: typeof r.qualityNotes === "string" ? r.qualityNotes.trim().slice(0, 500) : "",
    landmarks,
    confidence,
    ruler,
  };
}

/** A landmark map from the database or a form: unknown ids and unusable points are dropped. */
export function normalizeLandmarks(raw: unknown): CephLandmarks {
  const out: CephLandmarks = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!LANDMARK_SET.has(k) || !v || typeof v !== "object") continue;
    const x = clamp1000((v as any).x);
    const y = clamp1000((v as any).y);
    if (x === null || y === null) continue;
    out[k as CephLandmarkId] = { x, y };
  }
  return out;
}

export function normalizeCalibration(raw: unknown): CephCalibration | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const a = c.a as Record<string, unknown> | undefined;
  const b = c.b as Record<string, unknown> | undefined;
  const mm = Number(c.mm);
  if (!a || !b || !Number.isFinite(mm) || mm <= 0 || mm > 500) return null;
  const ax = clamp1000(a.x), ay = clamp1000(a.y), bx = clamp1000(b.x), by = clamp1000(b.y);
  if (ax === null || ay === null || bx === null || by === null) return null;
  if (ax === bx && ay === by) return null;
  return { a: { x: ax, y: ay }, b: { x: bx, y: by }, mm: Math.round(mm * 10) / 10 };
}

// ----------------------------------------------------------------------------------------------
// Learning from corrections: where the model habitually puts a dot in the wrong place
// ----------------------------------------------------------------------------------------------

/**
 * Per-landmark running sums of (dentist − model) after every signed correction, x already
 * flipped so that positive means "more anterior" whichever way the face pointed. Kept as sums so
 * an update is one increment per landmark and the mean is derived on read.
 */
export type LandmarkBiasStats = Partial<Record<CephLandmarkId, { n: number; sumDx: number; sumDy: number }>>;

/** The deltas one review contributes, in the same anterior-positive frame. */
export function landmarkDeltas(model: CephLandmarks, corrected: CephLandmarks, facing: 1 | -1): Partial<Record<CephLandmarkId, { dx: number; dy: number }>> {
  const out: Partial<Record<CephLandmarkId, { dx: number; dy: number }>> = {};
  for (const id of CEPH_LANDMARK_IDS) {
    const a = model[id];
    const b = corrected[id];
    if (!a || !b) continue;
    const dx = (b.x - a.x) * facing;
    const dy = b.y - a.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    out[id] = { dx, dy };
  }
  return out;
}

export function addLandmarkDeltas(stats: LandmarkBiasStats, deltas: ReturnType<typeof landmarkDeltas>): LandmarkBiasStats {
  const next: LandmarkBiasStats = { ...stats };
  for (const [id, d] of Object.entries(deltas) as [CephLandmarkId, { dx: number; dy: number }][]) {
    const cur = next[id] || { n: 0, sumDx: 0, sumDy: 0 };
    next[id] = { n: cur.n + 1, sumDx: cur.sumDx + d.dx, sumDy: cur.sumDy + d.dy };
  }
  return next;
}

export function normalizeLandmarkBias(raw: unknown): LandmarkBiasStats {
  const out: LandmarkBiasStats = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!LANDMARK_SET.has(k) || !v || typeof v !== "object") continue;
    const n = Number((v as any).n), sumDx = Number((v as any).sumDx), sumDy = Number((v as any).sumDy);
    if (!Number.isInteger(n) || n <= 0 || !Number.isFinite(sumDx) || !Number.isFinite(sumDy)) continue;
    out[k as CephLandmarkId] = { n, sumDx, sumDy };
  }
  return out;
}

/**
 * The hints that go into the next landmarking prompt: only landmarks corrected at least `minN`
 * times, and only when the average shift is big enough to be a habit rather than noise. Written
 * as instructions the model can act on, in image terms it understands (0–1000 units, anterior /
 * posterior / higher / lower).
 */
export function landmarkBiasHints(stats: LandmarkBiasStats, minN = 3, minShift = 12): string[] {
  const hints: string[] = [];
  for (const info of CEPH_LANDMARKS) {
    const s = stats[info.id];
    if (!s || s.n < minN) continue;
    const mx = s.sumDx / s.n;
    const my = s.sumDy / s.n;
    const parts: string[] = [];
    if (Math.abs(mx) >= minShift) parts.push(`${Math.round(Math.abs(mx))} units more ${mx > 0 ? "anterior" : "posterior"}`);
    if (Math.abs(my) >= minShift) parts.push(`${Math.round(Math.abs(my))} units ${my > 0 ? "lower" : "higher"}`);
    if (!parts.length) continue;
    hints.push(`${info.en} (${info.id}): the orthodontist has moved your placement ${parts.join(" and ")} on average across ${s.n} corrections — place it there.`);
  }
  return hints;
}

// ----------------------------------------------------------------------------------------------
// Rendering helpers shared by the screen, the prompt and the PDF
// ----------------------------------------------------------------------------------------------

export const CEPH_LABELS = {
  status: {
    low: { en: "Below norm", ar: "أقل من الطبيعي" },
    normal: { en: "Within norm", ar: "ضمن الطبيعي" },
    high: { en: "Above norm", ar: "أعلى من الطبيعي" },
    unscaled: { en: "Needs calibration", ar: "يحتاج معايرة" },
    missing: { en: "Landmark missing", ar: "نقطة ناقصة" },
  },
  skeletalClass: { I: { en: "Skeletal Class I", ar: "هيكلي صنف أول" }, II: { en: "Skeletal Class II", ar: "هيكلي صنف ثاني" }, III: { en: "Skeletal Class III", ar: "هيكلي صنف ثالث" } },
  vertical: {
    normal: { en: "Normal vertical pattern", ar: "نمط عمودي طبيعي" },
    high_angle: { en: "High angle (hyperdivergent)", ar: "زاوية مرتفعة (hyperdivergent)" },
    low_angle: { en: "Low angle (hypodivergent)", ar: "زاوية منخفضة (hypodivergent)" },
  },
  jaw: { prognathic: { en: "prognathic", ar: "بارز" }, normal: { en: "normally placed", ar: "في وضع طبيعي" }, retrognathic: { en: "retrognathic", ar: "متراجع" } },
  inclination: { proclined: { en: "proclined", ar: "مائلة للأمام" }, upright: { en: "upright", ar: "قائمة" }, retroclined: { en: "retroclined", ar: "مائلة للخلف" } },
  profile: { convex: { en: "Convex profile", ar: "بروفايل محدب" }, straight: { en: "Straight profile", ar: "بروفايل مستقيم" }, concave: { en: "Concave profile", ar: "بروفايل مقعر" } },
} as const;

/** One line per available measurement, for the prompt that interprets the analysis. */
export function cephAnalysisToLines(a: CephAnalysis): string[] {
  const lines: string[] = [];
  for (const m of a.measurements) {
    if (m.value === null) {
      if (m.status === "unscaled") lines.push(`${m.en}: not computed (picture not calibrated)`);
      continue;
    }
    const norm = m.norm ? ` (norm ${m.norm.mean} ± ${m.norm.sd}${a.normOverrides.includes(m.id) ? ", clinic's own norm" : ""}; ${m.status}${m.z !== null ? `, z ${m.z}` : ""})` : "";
    lines.push(`${m.en}: ${m.value}${m.unit}${norm}`);
  }
  const i = a.interpretation;
  const read: string[] = [];
  if (i.skeletalClass) read.push(`skeletal Class ${i.skeletalClass}${i.skeletalNote === "anb_wits_disagree" ? " by ANB (Wits disagrees — check SN inclination and the occlusal plane)" : ""}`);
  if (i.maxilla) read.push(`maxilla ${i.maxilla}`);
  if (i.mandible) read.push(`mandible ${i.mandible}`);
  if (i.vertical) read.push(i.vertical.replace("_", " "));
  if (i.upperIncisors) read.push(`upper incisors ${i.upperIncisors}`);
  if (i.lowerIncisors) read.push(`lower incisors ${i.lowerIncisors}`);
  if (i.profile) read.push(`${i.profile} profile`);
  if (i.growthRotation) read.push(`${i.growthRotation} growth rotation (Jarabak)`);
  if (read.length) lines.push(`Code's categorical reading: ${read.join("; ")}.`);
  if (a.missingCore.length) lines.push(`Core landmarks not placed: ${a.missingCore.join(", ")}.`);
  if (!a.calibrated) lines.push("The picture is not calibrated: every linear measurement (mm) is absent.");
  return lines;
}
