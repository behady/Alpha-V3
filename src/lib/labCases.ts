/**
 * Lab cases — the physical half of lab work.
 *
 * The MONEY half already existed before this module: a service flagged `requiresLab` in the price
 * list carries an `estimatedLabFee`, and `computeProcedurePricing` subtracts it before commission
 * so the lab is never paid out of the dentist's share. What nothing tracked was where the case
 * physically *is* — which crown is at which lab, when it was promised back, and whether the bag
 * that arrived this morning belongs to a patient anybody remembers.
 *
 * A lab case answers that. It carries a short human code (`MAD-0142`) that is printed on the order,
 * encoded as a QR beside it, and written on the bag with a marker — three copies of the same fact,
 * because the trip to the lab and back destroys paper.
 *
 * Deliberately Firebase-free. Every rule here (what a work type needs, whether a case is overdue,
 * how a code is formatted) is arithmetic over plain values, so it can be unit-tested and so the
 * printed order and the board can never disagree about what a case says. Writes live in
 * `labCaseWrite.ts`, the same split `procedurePricing.ts` / `ledgerWrite.ts` already use.
 */

/** Subcollection under clinics/{clinicId}. Governed by the blanket grant in firestore.rules. */
export const LAB_CASES_COLLECTION = "lab_cases";

/**
 * The per-branch code counters.
 *
 * A separate subcollection rather than a field on `settings/counters`, for two reasons the rules
 * and the restore plan each state out loud: `settings/*` is Admin-only to write (the patient-file
 * counter needed its own widening carve-out to let reception mint a number at all), and
 * `settings/counters` is on the restore DENY list, so a counter living there can never be
 * recovered. A plain subcollection falls under the blanket member grant and needs neither.
 */
export const LAB_COUNTERS_COLLECTION = "lab_counters";
export const LAB_COUNTERS_DOC = "branches";

/** The settings singleton holding the lab directory. Admin-only, like branches and price lists. */
export const LABS_DOC = "labs";

// ---------------------------------------------------------------------------
// Paper
// ---------------------------------------------------------------------------

/**
 * Which sheet the clinic prints orders on.
 *
 * A per-clinic setting rather than a fixed choice, because clinics genuinely differ: some keep A4
 * in the tray and want two copies to cut in half, some load A5 and want one. Lives here in the
 * model rather than in the print module so the settings screen can offer the choice without
 * pulling the whole printer — and its QR encoder — into the settings bundle.
 */
export type LabOrderPaper = "a4_two_up" | "a4_full" | "a5";
export const DEFAULT_LAB_PAPER: LabOrderPaper = "a4_two_up";

export function isLabOrderPaper(v: unknown): v is LabOrderPaper {
  return v === "a4_two_up" || v === "a4_full" || v === "a5";
}

export const LAB_PAPER_OPTIONS: Array<{
  id: LabOrderPaper;
  en: string;
  ar: string;
  hintEn: string;
  hintAr: string;
}> = [
  {
    id: "a4_two_up",
    en: "A4 — two copies per sheet",
    ar: "A4 — نسختين في الورقة",
    hintEn: "Cut in half: one travels with the case, one stays signed at the desk.",
    hintAr: "تتقص نصين: واحدة تروح مع الشغل وواحدة تفضل موقّعة عندك.",
  },
  {
    id: "a4_full",
    en: "A4 — one full page",
    ar: "A4 — صفحة كاملة",
    hintEn: "More room for notes. Print twice if you want a copy.",
    hintAr: "مساحة أكبر للملاحظات. اطبع مرتين لو عايز نسخة.",
  },
  {
    id: "a5",
    en: "A5 — half sheet",
    ar: "A5 — نص ورقة",
    hintEn: "Fits a small envelope with the case. Your printer must be set to A5.",
    hintAr: "بتدخل ظرف صغير مع الشغل. الطابعة لازم تكون مظبوطة على A5.",
  },
];

// ---------------------------------------------------------------------------
// Work types
// ---------------------------------------------------------------------------

export type LabWorkTypeId =
  | "zirconia"
  | "emax"
  | "pfm"
  | "pmma"
  | "implant_crown"
  | "surgical_guide"
  | "cobalt_chrome"
  | "full_denture"
  | "partial_denture"
  | "acrylic_repair"
  | "night_guard"
  | "aligner";

/**
 * What each kind of work actually needs on the order.
 *
 * A crown and a surgical guide have almost nothing in common on paper: a guide has no shade at
 * all, and an implant crown without the implant system named is scrap to a technician. One form
 * carrying every possible field would sit mostly empty on every case — and an empty box on a
 * printed order is where a mistake hides. So the form and the printout both read these flags and
 * show only what this work type wants.
 */
export type LabWorkType = {
  id: LabWorkTypeId;
  en: string;
  ar: string;
  /** Body shade — the VITA shade for most of the crown. Absent on metal, guards and guides. */
  bodyShade: boolean;
  /**
   * A separate VITA shade for the cervical third.
   *
   * Not a refinement: a crown built to one flat shade reads as a crown. Natural teeth are darker
   * at the gum, so matching the neighbours means asking for A3 at the cervical and A2 through the
   * body — two shades, on the same guide, for the same tooth.
   *
   * This replaced a stump-shade field, which was in the way: the clinic does not use one.
   */
  cervicalShade: boolean;
  /** Gum shade. A denture with perfect teeth and the wrong pink still looks wrong in the mouth. */
  gumShade: boolean;
  /** Implant system, platform, abutment and retention. */
  implant: boolean;
  /** Guide type, sleeve system, which files were sent. */
  guide: boolean;
  /** Whether a unit count is meaningful (a crown has units; a night guard does not). */
  units: boolean;
  /** Nothing physical leaves the clinic — a scan and a CBCT go out as files. */
  digitalByDefault: boolean;
  /** Try-in is the normal path for this work, not the exception. */
  tryInByDefault: boolean;
};

export const LAB_WORK_TYPES: LabWorkType[] = [
  { id: "zirconia",        en: "Zirconia",              ar: "زيركون",              bodyShade: true,  cervicalShade: true ,  gumShade: false, implant: false, guide: false, units: true,  digitalByDefault: false, tryInByDefault: false },
  { id: "emax",            en: "E.max",                 ar: "إي ماكس",             bodyShade: true,  cervicalShade: true ,  gumShade: false, implant: false, guide: false, units: true,  digitalByDefault: false, tryInByDefault: false },
  { id: "pfm",             en: "PFM",                   ar: "بورسلين على معدن",    bodyShade: true,  cervicalShade: true , gumShade: false, implant: false, guide: false, units: true,  digitalByDefault: false, tryInByDefault: false },
  { id: "pmma",            en: "PMMA temporary",        ar: "مؤقت PMMA",           bodyShade: true,  cervicalShade: false, gumShade: false, implant: false, guide: false, units: true,  digitalByDefault: false, tryInByDefault: false },
  { id: "implant_crown",   en: "Implant crown",         ar: "تاج زرعة",            bodyShade: true,  cervicalShade: true ,  gumShade: false, implant: true,  guide: false, units: true,  digitalByDefault: false, tryInByDefault: false },
  { id: "surgical_guide",  en: "Surgical guide",        ar: "دليل جراحي",          bodyShade: false, cervicalShade: false, gumShade: false, implant: true,  guide: true,  units: false, digitalByDefault: true,  tryInByDefault: false },
  { id: "cobalt_chrome",   en: "Cobalt-chrome frame",   ar: "هيكل كروم كوبالت",    bodyShade: false, cervicalShade: false, gumShade: false, implant: false, guide: false, units: false, digitalByDefault: false, tryInByDefault: true  },
  { id: "full_denture",    en: "Full denture",          ar: "طقم كامل",            bodyShade: true,  cervicalShade: false, gumShade: true,  implant: false, guide: false, units: false, digitalByDefault: false, tryInByDefault: true  },
  { id: "partial_denture", en: "Partial denture",       ar: "طقم جزئي",            bodyShade: true,  cervicalShade: false, gumShade: true,  implant: false, guide: false, units: false, digitalByDefault: false, tryInByDefault: true  },
  { id: "acrylic_repair",  en: "Acrylic repair / reline", ar: "إصلاح أو تبطين",    bodyShade: true,  cervicalShade: false, gumShade: true,  implant: false, guide: false, units: false, digitalByDefault: false, tryInByDefault: false },
  { id: "night_guard",     en: "Night guard",           ar: "واقي ليلي",           bodyShade: false, cervicalShade: false, gumShade: false, implant: false, guide: false, units: false, digitalByDefault: false, tryInByDefault: false },
  { id: "aligner",         en: "Clear aligner",         ar: "تقويم شفاف",          bodyShade: false, cervicalShade: false, gumShade: false, implant: false, guide: false, units: false, digitalByDefault: true,  tryInByDefault: false },
];

const WORK_TYPE_BY_ID = new Map(LAB_WORK_TYPES.map((w) => [w.id, w]));

/** Never returns undefined: an unknown id (an older record, a hand-edited document) reads as zirconia's shape. */
export function workTypeFor(id: string | null | undefined): LabWorkType {
  return WORK_TYPE_BY_ID.get(String(id || "") as LabWorkTypeId) || LAB_WORK_TYPES[0];
}

export function workTypeLabel(id: string | null | undefined, language: "en" | "ar"): string {
  const w = WORK_TYPE_BY_ID.get(String(id || "") as LabWorkTypeId);
  if (!w) return String(id || "").replace(/_/g, " ") || "—";
  return language === "ar" ? w.ar : w.en;
}

// ---------------------------------------------------------------------------
// Shades
// ---------------------------------------------------------------------------

/**
 * The VITA classical guide, which is what Egyptian labs work to, with the bleach range in front.
 *
 * Bleach shades lead deliberately: whitening cases ask for them first, and a list that opens at A1
 * makes the whitest shades the hardest to reach.
 */
export const BLEACH_SHADES = ["BL1", "BL2", "BL3", "BL4"];
export const CLASSICAL_SHADES = [
  "A1", "A2", "A3", "A3.5", "A4",
  "B1", "B2", "B3", "B4",
  "C1", "C2", "C3", "C4",
  "D2", "D3", "D4",
];
export const TOOTH_SHADES = [...BLEACH_SHADES, ...CLASSICAL_SHADES];

/**
 * Body and cervical shades come from the SAME guide.
 *
 * There is no second scale: asking for A3 at the cervical and A2 through the body is two readings
 * off one VITA guide, which is why both fields offer this identical list rather than one of them
 * getting a die-shade range the clinic never uses.
 */
export const CERVICAL_SHADES = TOOTH_SHADES;

/**
 * Gum shades are offered as suggestions rather than a closed list.
 *
 * Unlike tooth shades there is no single guide every lab works to, and inventing a standard the
 * technician does not share would put a code on the order that means nothing at the other end.
 */
export const GUM_SHADE_SUGGESTIONS = ["Pink", "Light pink", "Dark pink", "Veined", "Original"];

export const RETENTION_OPTIONS = [
  { id: "screw", en: "Screw-retained", ar: "بمسمار" },
  { id: "cement", en: "Cement-retained", ar: "بلاصق" },
];

export const ABUTMENT_OPTIONS = [
  { id: "stock", en: "Stock abutment", ar: "دعامة جاهزة" },
  { id: "custom", en: "Custom abutment", ar: "دعامة مخصصة" },
  { id: "tibase", en: "Ti-base", ar: "قاعدة تيتانيوم" },
];

export const GUIDE_TYPE_OPTIONS = [
  { id: "pilot", en: "Pilot guide", ar: "دليل مبدئي" },
  { id: "full", en: "Fully guided", ar: "دليل كامل" },
];

/**
 * Turn a stored option id back into words.
 *
 * These fields store the ID (`screw`, `stock`, `pilot`), never the translated label. Storing the
 * label meant a case raised in Arabic showed an empty box when the same case was opened in
 * English — the value matched no option, and an empty controlled select displays its first option
 * while holding nothing, so the form looked filled in and saved blank.
 *
 * An unrecognised value is returned as-is rather than blanked: cases written before this stored
 * the label, and printing what they actually say beats printing nothing.
 */
export function optionLabel(
  options: Array<{ id: string; en: string; ar: string }>,
  value: string | undefined,
  language: "en" | "ar"
): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const hit = options.find((o) => o.id === raw);
  if (!hit) return raw;
  return language === "ar" ? hit.ar : hit.en;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export type LabCaseStatus =
  | "draft"
  | "at_lab"
  | "tryin_back"
  | "returned_to_lab"
  | "back"
  | "fitted"
  | "cancelled";

export type LabCaseStatusMeta = {
  id: LabCaseStatus;
  en: string;
  ar: string;
  /** The case is physically at the lab, so a due date is meaningful and can run late. */
  atLab: boolean;
  /** Nothing further is expected. Overdue counters skip these. */
  closed: boolean;
  /** Tailwind text/background pair, matching the pill vocabulary used across the app. */
  pill: string;
  dot: string;
};

export const LAB_CASE_STATUSES: LabCaseStatusMeta[] = [
  { id: "draft",           en: "Draft",             ar: "مسودة",             atLab: false, closed: false, pill: "bg-surface-muted text-ink-body",     dot: "bg-slate-400" },
  { id: "at_lab",          en: "At lab",            ar: "في المعمل",         atLab: true,  closed: false, pill: "bg-sky-50 text-sky-700",          dot: "bg-sky-500" },
  { id: "tryin_back",      en: "Try-in back",       ar: "بروفة وصلت",        atLab: false, closed: false, pill: "bg-violet-50 text-violet-700",    dot: "bg-violet-500" },
  { id: "returned_to_lab", en: "Back to lab",       ar: "رجعت للمعمل",       atLab: true,  closed: false, pill: "bg-sky-50 text-sky-700",          dot: "bg-sky-500" },
  { id: "back",            en: "Back at clinic",    ar: "وصلت العيادة",      atLab: false, closed: false, pill: "bg-emerald-50 text-emerald-700",  dot: "bg-emerald-500" },
  { id: "fitted",          en: "Fitted",            ar: "تم التركيب",        atLab: false, closed: true,  pill: "bg-slate-900 text-white",         dot: "bg-slate-900" },
  { id: "cancelled",       en: "Cancelled",         ar: "ملغاة",             atLab: false, closed: true,  pill: "bg-rose-50 text-rose-700",        dot: "bg-rose-400" },
];

const STATUS_BY_ID = new Map(LAB_CASE_STATUSES.map((s) => [s.id, s]));

export function statusFor(id: string | null | undefined): LabCaseStatusMeta {
  return STATUS_BY_ID.get(String(id || "") as LabCaseStatus) || LAB_CASE_STATUSES[0];
}

export function statusLabel(id: string | null | undefined, language: "en" | "ar"): string {
  const s = statusFor(id);
  return language === "ar" ? s.ar : s.en;
}

/**
 * Which stages a case may move to next.
 *
 * Try-in is not a stage every case walks through — a crown goes straight from `at_lab` to `back`
 * in one click, while a denture loops try-in as many times as it needs. So the try-in stages are
 * offered only when the case is marked as needing them, and looping back to the lab is always
 * allowed from a try-in rather than being a one-shot path.
 */
export function nextStatuses(current: LabCaseStatus, needsTryIn: boolean): LabCaseStatus[] {
  switch (current) {
    case "draft":
      return ["at_lab", "cancelled"];
    case "at_lab":
      return needsTryIn ? ["tryin_back", "back", "cancelled"] : ["back", "cancelled"];
    case "tryin_back":
      return ["returned_to_lab", "back", "cancelled"];
    case "returned_to_lab":
      return needsTryIn ? ["tryin_back", "back", "cancelled"] : ["back", "cancelled"];
    case "back":
      return ["fitted", "returned_to_lab"];
    case "fitted":
      return ["returned_to_lab"];
    case "cancelled":
      return ["draft"];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export type LabCaseEvent = {
  /** The status the case moved INTO. */
  status: LabCaseStatus;
  /** ISO timestamp. */
  at: string;
  by?: string;
  note?: string;
};

export type LabCase = {
  id: string;

  /** `MAD-0142` — printed large, QR'd, and written on the bag. */
  code: string;
  /** The bare number behind the code, so the board can sort and search by it. */
  codeNumber: number;
  /** The three letters, kept on the record so a later branch rename cannot rewrite history. */
  branchCode: string;
  branchId: string;
  branchName: string;

  patientId?: string;
  /** Full name, for the board and the search box. Never printed on the order. */
  patientName?: string;
  /** What actually goes on the paper that leaves the building. */
  patientFirstName?: string;
  patientPhone?: string;

  doctorId?: string;
  doctorName?: string;

  /** Set when the case was raised from a saved treatment. Absent for standalone work. */
  clinicalNoteId?: string;
  ledgerId?: string;

  labId: string;
  labName: string;

  workType: LabWorkTypeId;
  /** Free text the technician reads first, e.g. "2 x full crown, 15 and 14". */
  workDescription?: string;
  units?: number;
  /** FDI numbers. Stored as an array because the clinical note only ever keeps a joined string. */
  teeth: number[];

  /** The VITA shade for most of the crown. Read with a `toothShade` fallback for early records. */
  bodyShade?: string;
  /** The VITA shade for the gingival third, so a crown matches its neighbours rather than itself. */
  cervicalShade?: string;
  gumShade?: string;
  material?: string;

  implantSystem?: string;
  implantPlatform?: string;
  abutmentType?: string;
  retention?: string;

  guideType?: string;
  sleeveSystem?: string;

  notes?: string;

  /** What the clinic agreed to pay the lab for this case. */
  agreedPrice: number;

  /** A bag handed to a driver, or a scan sent as files. Decides whether a signature strip prints. */
  sentVia: "driver" | "digital";

  status: LabCaseStatus;
  needsTryIn: boolean;

  /** All ISO date strings (yyyy-mm-dd) except the event log, which carries full timestamps. */
  sentAt?: string;
  dueDate?: string;
  receivedAt?: string;
  fittedAt?: string;

  events?: LabCaseEvent[];

  /** Set on the replacement case; the original keeps its own code and its history. */
  remakeOfId?: string;
  remakeOfCode?: string;
  remakeReason?: string;
  remakeFault?: "lab" | "clinic" | "patient" | "unknown";
  /** 2 for the first remake, 3 for the second. Renders as the `-R2` suffix. */
  remakeRound?: number;

  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
};

/**
 * What a saved treatment hands to the lab-order form.
 *
 * The clinical screen already knows the patient, the teeth, the dentist and what was charged at
 * the moment a crown is saved. Re-asking for all of it is how a prompt gets dismissed, so the
 * form opens with everything filled in and the assistant only supplies what the lab needs.
 *
 * Defined here rather than in the modal so the clinical-notes tree can build one without
 * importing a component — and so it survives the editor unmounting, which it does on every save.
 */
export type LabCaseSeed = {
  patientId?: string;
  patientName?: string;
  patientPhone?: string;
  doctorId?: string;
  doctorName?: string;
  clinicalNoteId?: string;
  ledgerId?: string;
  teeth?: number[];
  workDescription?: string;
  units?: number;
  branchId?: string;
  /** The price list's estimated lab fee, offered as a starting figure the user can correct. */
  agreedPrice?: number;
};

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * A branch's three-letter code, derived from its name when nobody has set one.
 *
 * Egyptian clinics name branches in Arabic as often as not, and there are no Latin letters to take
 * three of. Rather than transliterate — which would invent a spelling the clinic never chose —
 * a branch with no usable letters falls back to `B1`, `B2` by position. The Branches screen shows
 * the derived value as a placeholder so an admin can see what will be printed and override it.
 */
export function deriveBranchCode(name: string, index: number = 0): string {
  const letters = String(name || "").replace(/[^A-Za-z]/g, "");
  if (letters.length >= 2) return letters.slice(0, 3).toUpperCase();
  return `B${index + 1}`;
}

/** The code a branch will actually stamp on its cases: its own if set, else the derived one. */
export function branchCodeFor(
  branch: { name?: string; code?: string } | null | undefined,
  index: number = 0
): string {
  const explicit = String(branch?.code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (explicit) return explicit.slice(0, 4);
  return deriveBranchCode(branch?.name || "", index);
}

/** A clinic with no branches configured at all still needs a prefix. */
export const DEFAULT_BRANCH_CODE = "LAB";

export function formatLabCode(branchCode: string, n: number, remakeRound?: number): string {
  const base = `${branchCode || DEFAULT_BRANCH_CODE}-${String(Math.max(0, Math.floor(n))).padStart(4, "0")}`;
  return remakeRound && remakeRound > 1 ? `${base}-R${remakeRound}` : base;
}

/**
 * What someone typing into the search box probably meant.
 *
 * People type `142`, not `MAD-0142` — the number is what is written on the bag in marker, and the
 * prefix is the part they never say out loud. So a bare number matches a code by its digits.
 */
export function matchesLabCode(caseCode: string, query: string): boolean {
  // Punctuation stripped from both sides, so "MAD 142", "mad-142" and "MAD142" all behave the
  // same as what is actually printed.
  const q = String(query || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!q) return false;
  const code = String(caseCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return false;

  // A substring, not an exact hit. This is a filter box that also searches patient names, so
  // typing "14" while hunting for 0142 should narrow the list rather than empty it — and every
  // row prints its full code, so a near miss costs a glance. The cost of the opposite mistake is
  // a phone call.
  if (code.includes(q)) return true;

  // And a number typed without its padding still finds the case: "1" is not a substring of
  // "MAD0001", but it is the same number.
  const qDigits = q.replace(/\D/g, "");
  const codeDigits = code.replace(/\D/g, "");
  if (!qDigits || !codeDigits) return false;
  return Number(codeDigits) === Number(qDigits);
}

// ---------------------------------------------------------------------------
// Dates and urgency
// ---------------------------------------------------------------------------

export type DueState = "overdue" | "due_today" | "due_soon" | "on_time" | "none";

/**
 * A `yyyy-mm-dd` calendar date as a UTC instant, for arithmetic only.
 *
 * Every date in a lab case is a calendar date somebody wrote down — "due back on the first" — not
 * a moment in time. Doing the arithmetic in UTC keeps it pure calendar counting: no offset, no
 * daylight saving, and the same answer on every machine.
 *
 * `Date.parse("2026-09-01T00:00:00")` is the trap this avoids. With no offset suffix it means
 * LOCAL midnight, so pairing it with `toISOString()` silently loses a day everywhere east of
 * Greenwich — including Egypt at UTC+2/+3. `clinicDate.ts` already carries a comment about the
 * same mistake being made once with attendance, where a shift punched after midnight was filed
 * under the previous day.
 */
function ymdToUtc(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(t) ? null : t;
}

/** Days between two yyyy-mm-dd strings, positive when `due` is in the future. */
export function daysUntil(due: string, today: string): number | null {
  const d = ymdToUtc(due);
  const t = ymdToUtc(today);
  if (d === null || t === null) return null;
  return Math.round((d - t) / 86_400_000);
}

/**
 * How worried to be about a case.
 *
 * Only cases actually AT the lab can be late. A case sitting on the reception desk waiting for the
 * patient is a different problem with a different colour, and painting it red next to genuinely
 * overdue work is how a board stops being read.
 */
export function dueStateFor(
  labCase: Pick<LabCase, "status" | "dueDate">,
  today: string
): DueState {
  const meta = statusFor(labCase.status);
  if (!meta.atLab || !labCase.dueDate) return "none";
  const d = daysUntil(labCase.dueDate, today);
  if (d === null) return "none";
  if (d < 0) return "overdue";
  if (d === 0) return "due_today";
  if (d <= 2) return "due_soon";
  return "on_time";
}

export function addDays(isoDate: string, days: number): string {
  const t = ymdToUtc(isoDate);
  // A malformed date is returned untouched rather than becoming "Invalid Date" on a printed order.
  if (t === null) return isoDate;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The three numbers that belong at the top of the board.
 *
 * "Back and waiting" is the one worth counting: a finished crown nobody has called the patient
 * about is money already spent sitting in a drawer, and it is invisible on every other screen.
 */
export function summarise(cases: LabCase[], today: string) {
  let overdue = 0;
  let dueThisWeek = 0;
  let waitingForPatient = 0;
  let atLab = 0;
  for (const c of cases) {
    if (c.status === "back") waitingForPatient += 1;
    if (statusFor(c.status).atLab) atLab += 1;
    const state = dueStateFor(c, today);
    if (state === "overdue") overdue += 1;
    else if (state !== "none" && state !== "on_time") dueThisWeek += 1;
    else if (state === "on_time" && c.dueDate) {
      const d = daysUntil(c.dueDate, today);
      if (d !== null && d <= 7) dueThisWeek += 1;
    }
  }
  return { overdue, dueThisWeek, waitingForPatient, atLab, total: cases.length };
}


/**
 * Whether the clinic asked to be told when a case comes back.
 *
 * Lives here rather than beside the Firestore write so it can be tested without a database — and
 * because it is a policy, not I/O. Absent reads as OFF: a clinic that has never opened the Alerts
 * screen has not asked to be interrupted, and an alert nobody chose is the kind that teaches
 * people to ignore the bell.
 */
export function wantsLabReadyAlert(
  alertPreferences: { inApp?: { labReady?: boolean } } | null | undefined
): boolean {
  return alertPreferences?.inApp?.labReady === true;
}

// ---------------------------------------------------------------------------
// Teeth
// ---------------------------------------------------------------------------

/**
 * FDI quadrants, for the small chart on the printed order.
 *
 * A fourth copy of these arrays. `TeethChart.tsx`, `diagnosisReportPdf.ts` and the Android chart
 * each hold their own, and extracting a shared one means editing the diagnosis chart and the PDF
 * report in the same change — worth doing, but not inside the change that introduces lab cases.
 *
 * Q1/Q4 are the patient's RIGHT side and print first, because a chart is read as if you were
 * facing the patient, which is how every dentist reads one.
 */
export const FDI_Q1 = [18, 17, 16, 15, 14, 13, 12, 11];
export const FDI_Q2 = [21, 22, 23, 24, 25, 26, 27, 28];
export const FDI_Q4 = [48, 47, 46, 45, 44, 43, 42, 41];
export const FDI_Q3 = [31, 32, 33, 34, 35, 36, 37, 38];

export const FDI_UPPER = [...FDI_Q1, ...FDI_Q2];
export const FDI_LOWER = [...FDI_Q4, ...FDI_Q3];

/**
 * The primary dentition, laid out the same way.
 *
 * A child's crown is as much a lab case as an adult's, and a chart that can only show permanent
 * teeth quietly cannot represent one — the tooth would appear in the written line and nowhere on
 * the diagram, which is the disagreement a technician has no way to resolve.
 */
export const FDI_PRIMARY_Q5 = [55, 54, 53, 52, 51];
export const FDI_PRIMARY_Q6 = [61, 62, 63, 64, 65];
export const FDI_PRIMARY_Q8 = [85, 84, 83, 82, 81];
export const FDI_PRIMARY_Q7 = [71, 72, 73, 74, 75];

export const FDI_PRIMARY_UPPER = [...FDI_PRIMARY_Q5, ...FDI_PRIMARY_Q6];
export const FDI_PRIMARY_LOWER = [...FDI_PRIMARY_Q8, ...FDI_PRIMARY_Q7];

/** Whether any of these teeth are primary — the test for showing the second grid. */
export function hasPrimaryTeeth(teeth: number[] | undefined): boolean {
  return (teeth || []).some((t) => t >= 51 && t <= 85);
}

// ---------------------------------------------------------------------------
// Palmer notation
// ---------------------------------------------------------------------------

/**
 * Teeth are STORED as FDI and READ as Palmer.
 *
 * FDI stays the storage because the rest of the app speaks it: the odontogram, the clinical note
 * a case is seeded from, the Android chart. Changing that would break the link between a lab case
 * and the treatment that raised it.
 *
 * But Palmer is what Egyptian dental schools teach and what this clinic works in, and a lab order
 * is read by a technician, not by a database. "15" and "5┘" are the same tooth; only one of them
 * is the one anybody here says out loud. So every screen and every printed page renders Palmer.
 *
 * The bracket is a quadrant, drawn as the corner of the chart's cross as seen facing the patient —
 * so the patient's upper right sits on the LEFT of the page and takes `┘`, the corner made by the
 * midline on its right and the occlusal line below it.
 */
export type PalmerQuadrant = "UR" | "UL" | "LL" | "LR";

const PALMER_BY_FDI_QUADRANT: Record<number, { quadrant: PalmerQuadrant; symbol: string; symbolFirst: boolean; primary: boolean }> = {
  1: { quadrant: "UR", symbol: "┘", symbolFirst: false, primary: false },
  2: { quadrant: "UL", symbol: "└", symbolFirst: true, primary: false },
  3: { quadrant: "LL", symbol: "┌", symbolFirst: true, primary: false },
  4: { quadrant: "LR", symbol: "┐", symbolFirst: false, primary: false },
  5: { quadrant: "UR", symbol: "┘", symbolFirst: false, primary: true },
  6: { quadrant: "UL", symbol: "└", symbolFirst: true, primary: true },
  7: { quadrant: "LL", symbol: "┌", symbolFirst: true, primary: true },
  8: { quadrant: "LR", symbol: "┐", symbolFirst: false, primary: true },
};

const PRIMARY_LETTERS = ["A", "B", "C", "D", "E"];

export type PalmerTooth = {
  fdi: number;
  quadrant: PalmerQuadrant;
  /** `6` for a permanent tooth, `A`-`E` for a primary one. */
  position: string;
  symbol: string;
  /** `6┘` — the plain-text form, for a search box or a log line. */
  label: string;
  /** `UR6` — typeable, unambiguous, and what goes in an input somebody edits by hand. */
  shorthand: string;
  /**
   * Which sides of the number the bracket is drawn on.
   *
   * Palmer's bracket is not a character sitting beside the digit — it is the corner of the chart's
   * cross, and the number belongs INSIDE it. Rendered as a box-drawing glyph it reads as two
   * separate marks; rendered as borders on the number itself it reads as the notation. Both the
   * screen and the printed order use these.
   */
  sides: { top: boolean; bottom: boolean; left: boolean; right: boolean };
};

export function toPalmer(fdi: number): PalmerTooth | null {
  const n = Number(fdi);
  if (!Number.isFinite(n)) return null;
  const q = Math.floor(n / 10);
  const idx = n % 10;
  const meta = PALMER_BY_FDI_QUADRANT[q];
  if (!meta || idx < 1) return null;
  if (meta.primary && idx > 5) return null;
  if (!meta.primary && idx > 8) return null;

  const position = meta.primary ? PRIMARY_LETTERS[idx - 1] : String(idx);

  // Drawn facing the patient: an upper-right tooth sits in the top-left of the cross, so its two
  // lines are the midline on its RIGHT and the occlusal line BELOW it.
  const upper = meta.quadrant === "UR" || meta.quadrant === "UL";
  const patientRight = meta.quadrant === "UR" || meta.quadrant === "LR";

  return {
    fdi: n,
    quadrant: meta.quadrant,
    position,
    symbol: meta.symbol,
    label: meta.symbolFirst ? `${meta.symbol}${position}` : `${position}${meta.symbol}`,
    shorthand: `${meta.quadrant}${position}`,
    sides: {
      top: !upper,
      bottom: upper,
      right: patientRight,
      left: !patientRight,
    },
  };
}

/** `UR3, UL3` — the form that goes in a box somebody types into. */
export function formatPalmerShorthand(teeth: number[] | undefined): string {
  if (!teeth || teeth.length === 0) return "";
  return teeth
    .map((t) => toPalmer(t)?.shorthand)
    .filter(Boolean)
    .join(", ");
}

/** `5┘ 4┘` — the order the teeth were chosen, so it reads as the dentist entered it. */
export function formatPalmer(teeth: number[] | undefined, language: "en" | "ar" = "en"): string {
  if (!teeth || teeth.length === 0) return language === "ar" ? "غير محدد" : "Not specified";
  return teeth
    .map((t) => toPalmer(t)?.label)
    .filter(Boolean)
    .join(" ");
}

/**
 * Read a typed tooth list, in whichever notation came to hand.
 *
 * Accepts FDI (`15`), the written Palmer shorthand every clinic uses on paper (`UR5`, `LL7`,
 * `URA`), and the bracket form itself if somebody pastes it (`5┘`). All of it comes back as FDI,
 * because that is what everything downstream stores.
 *
 * Deliberately permissive: this box is prefilled from the chart in FDI when a case is raised from
 * a treatment, and typed by hand in Palmer when it is not. Refusing one of the two would make the
 * field wrong half the time.
 */
const SYMBOL_TO_QUADRANT: Record<string, PalmerQuadrant> = { "┘": "UR", "└": "UL", "┌": "LL", "┐": "LR" };
const QUADRANT_TO_FDI: Record<PalmerQuadrant, { permanent: number; primary: number }> = {
  UR: { permanent: 10, primary: 50 },
  UL: { permanent: 20, primary: 60 },
  LL: { permanent: 30, primary: 70 },
  LR: { permanent: 40, primary: 80 },
};

export function parseToothInput(raw: string): number[] {
  const out: number[] = [];
  const push = (n: number) => {
    if (toPalmer(n) && !out.includes(n)) out.push(n);
  };

  const text = String(raw || "").toUpperCase();
  // Split on anything that is not part of a token: commas, spaces, slashes, semicolons.
  for (const token of text.split(/[\s,;/|]+/)) {
    if (!token) continue;

    // Palmer with a bracket, either side of the position: "5┘" or "└5".
    const symbol = [...token].find((ch) => SYMBOL_TO_QUADRANT[ch]);
    if (symbol) {
      const quadrant = SYMBOL_TO_QUADRANT[symbol];
      const position = token.replace(symbol, "").trim();
      pushPalmer(quadrant, position, push);
      continue;
    }

    // Written Palmer shorthand: UR6, LL7, URA.
    const written = /^(UR|UL|LL|LR)\s*([1-8A-E])$/.exec(token);
    if (written) {
      pushPalmer(written[1] as PalmerQuadrant, written[2], push);
      continue;
    }

    // Bare FDI.
    const digits = token.replace(/\D/g, "");
    if (digits.length === 2) push(Number(digits));
  }

  return out;
}

function pushPalmer(quadrant: PalmerQuadrant, position: string, push: (n: number) => void): void {
  const base = QUADRANT_TO_FDI[quadrant];
  if (!base) return;
  const letter = PRIMARY_LETTERS.indexOf(position);
  if (letter >= 0) {
    push(base.primary + letter + 1);
    return;
  }
  const n = Number(position);
  if (Number.isFinite(n) && n >= 1 && n <= 8) push(base.permanent + n);
}

/**
 * Read a clinical note's `tooth` string into FDI numbers.
 *
 * Three things this must survive, all of them real records in the database:
 *   - `"Gen"`, the magic string a note carries when no tooth was selected. It is not empty, and
 *     printing it puts the word "Gen" on a lab order.
 *   - primary teeth (51-85), which the permanent-only `ALL_TEETH` filter elsewhere silently drops.
 *     A paediatric case is still a lab case.
 *   - separators of every kind, since the string was built by joining whatever was selected.
 */
export function parseTeeth(raw: unknown): number[] {
  const text = String(raw ?? "").trim();
  if (!text || text.toLowerCase() === "gen") return [];
  const out: number[] = [];
  for (const token of text.split(/[\s,;/|-]+/)) {
    const n = parseInt(token, 10);
    if (!Number.isNaN(n) && n >= 11 && n <= 85) {
      if (!out.includes(n)) out.push(n);
    }
  }
  return out;
}

/** `15, 14` — the order teeth were chosen, not sorted, so it reads as the dentist entered it. */
export function formatTeeth(teeth: number[] | undefined, language: "en" | "ar"): string {
  if (!teeth || teeth.length === 0) return language === "ar" ? "غير محدد" : "Not specified";
  return teeth.join(", ");
}

// ---------------------------------------------------------------------------
// Sanitising what comes back from Firestore
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A stored document read into a `LabCase`.
 *
 * Every optional field arrives as `undefined` rather than `""` when it is absent, because that is
 * what the write path stores: Firestore rejects an explicit `undefined` in a write and the browser
 * SDK reports it as an error that reads exactly like a rules denial, so optional fields are
 * omitted with a conditional spread instead of being set empty.
 */
export function toLabCase(id: string, data: Record<string, unknown>): LabCase {
  const teeth = Array.isArray(data.teeth)
    ? (data.teeth as unknown[]).map((t) => Number(t)).filter((n) => Number.isFinite(n))
    : [];
  const events = Array.isArray(data.events)
    ? (data.events as unknown[])
        .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
        .map((e) => ({
          status: str(e.status) as LabCaseStatus,
          at: str(e.at),
          ...(str(e.by) ? { by: str(e.by) } : {}),
          ...(str(e.note) ? { note: str(e.note) } : {}),
        }))
    : [];

  return {
    id,
    code: str(data.code),
    codeNumber: num(data.codeNumber),
    branchCode: str(data.branchCode),
    branchId: str(data.branchId),
    branchName: str(data.branchName),
    patientId: str(data.patientId) || undefined,
    patientName: str(data.patientName) || undefined,
    patientFirstName: str(data.patientFirstName) || undefined,
    patientPhone: str(data.patientPhone) || undefined,
    doctorId: str(data.doctorId) || undefined,
    doctorName: str(data.doctorName) || undefined,
    clinicalNoteId: str(data.clinicalNoteId) || undefined,
    ledgerId: str(data.ledgerId) || undefined,
    labId: str(data.labId),
    labName: str(data.labName),
    workType: (str(data.workType) || "zirconia") as LabWorkTypeId,
    workDescription: str(data.workDescription) || undefined,
    units: data.units == null ? undefined : num(data.units),
    teeth,
    // `toothShade` is what the first version wrote, before the shade was split into body and
    // cervical. Read as a fallback so those cases still print a shade rather than a blank.
    bodyShade: str(data.bodyShade) || str(data.toothShade) || undefined,
    cervicalShade: str(data.cervicalShade) || undefined,
    gumShade: str(data.gumShade) || undefined,
    material: str(data.material) || undefined,
    implantSystem: str(data.implantSystem) || undefined,
    implantPlatform: str(data.implantPlatform) || undefined,
    abutmentType: str(data.abutmentType) || undefined,
    retention: str(data.retention) || undefined,
    guideType: str(data.guideType) || undefined,
    sleeveSystem: str(data.sleeveSystem) || undefined,
    notes: str(data.notes) || undefined,
    agreedPrice: num(data.agreedPrice),
    sentVia: data.sentVia === "digital" ? "digital" : "driver",
    status: (str(data.status) || "draft") as LabCaseStatus,
    needsTryIn: data.needsTryIn === true,
    sentAt: str(data.sentAt) || undefined,
    dueDate: str(data.dueDate) || undefined,
    receivedAt: str(data.receivedAt) || undefined,
    fittedAt: str(data.fittedAt) || undefined,
    events,
    remakeOfId: str(data.remakeOfId) || undefined,
    remakeOfCode: str(data.remakeOfCode) || undefined,
    remakeReason: str(data.remakeReason) || undefined,
    remakeFault: (str(data.remakeFault) || undefined) as LabCase["remakeFault"],
    remakeRound: data.remakeRound == null ? undefined : num(data.remakeRound),
    createdAt: str(data.createdAt) || undefined,
    createdBy: str(data.createdBy) || undefined,
    updatedAt: str(data.updatedAt) || undefined,
  };
}
