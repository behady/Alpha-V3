/**
 * The MetLife Egypt dental pre-approval reader — the shape of one approval, and the pure functions
 * around it.
 *
 * A dentist drops a scan (PDF or photo) of the approval paper. The route sends it to Gemini with
 * `METLIFE_RESPONSE_SCHEMA` and `buildMetlifePrompt()`, then runs the model's JSON through
 * `normalizeMetlife` (tidy strings, real numbers, ISO dates) and `checkMetlife` (does it add up?).
 * The browser runs the same two functions again on every edit, so the confirm card and the server
 * agree on what blocks a save.
 *
 * Everything here is pure: no Gemini, no Firestore, no SDK import. The schema is plain data with the
 * SDK's `SchemaType` names written as strings (the route casts it at the call site), as
 * `xrayReport.ts` does.
 *
 * A scan read by a model is a guess until the numbers prove it. Hard checks are the proof: if a
 * line's gross is not units x price, or the lines do not add up to the printed total, something was
 * misread and the claim must not be saved until a person fixes it. Soft checks only warn.
 */

export const METLIFE_FORMAT = "metlife";

/** Pre-Approval ID: `D` followed by seven digits. */
export const APPROVAL_NUMBER_RE = /^D\d{7}$/;

export type MetlifeLine = {
  /** CPT service code, e.g. `D0120`. */
  code: string;
  description: string;
  unitsRequested: number;
  grossPerUnit: number;
  grossTotal: number;
  unitsApproved: number;
  patientShare: number;
  approvedAmount: number;
  comment: string;
  /** 0–1, the model's own confidence in the whole row. */
  confidence: number;
  /**
   * FDI tooth codes this service is for ("44", "46"). NextCare's lines carry them (read from the
   * paper's conditions, then the desk's); MetLife's paper names no teeth, so its lines never set it.
   */
  teeth?: string[];
};

export type MetlifeHeader = {
  approvalNumber: string;
  /** ISO `yyyy-mm-dd`, or null when the paper's date could not be read. */
  approvalDate: string | null;
  /** The number part of "6481234567 - EXAMPLE TRAVEL EGYPT". */
  policyNumber: string;
  /** The employer part of the same string. */
  employer: string;
  certificateNumber: string;
  dependentCode: string;
  paperPatientName: string;
  /** The same name in Arabic, as an Egyptian clinic would write it: what the statement prints. */
  paperPatientNameAr: string;
  /** The code part of "DNC0001 - DR. EXAMPLE - DENTAL". */
  providerCode: string;
  /** The rest of the same string. */
  physician: string;
  statusText: string;
  diagnosisCode: string;
  estimatedCost: number | null;
  requestedTotal: number | null;
  approvedTotal: number | null;
  patientShareTotal: number | null;
  /** The figure in "Kindly collect the patient share of EGP x". */
  collectNote: number | null;
  /** ISO date; `9999-12-31` means "no end". */
  terminationDate: string | null;
  comment: string;
  /** 0–1 per header field, keyed by the field's name here. A field the model did not rate is absent. */
  confidence: Record<string, number>;
  // NextCare's paper (lib/insurance/nextcare.ts) fills these; MetLife's never does, so they stay absent.
  /** ISO date the approval may be used until. */
  validUntil?: string | null;
  /** The insurer NextCare approves for, e.g. "Misr Insurance". */
  insurerName?: string;
  productName?: string;
  /** The 4-character code the monthly sheet prints before the name: `(3C40)name`. */
  memberCode?: string;
  // AXA's claim form (lib/insurance/axa.ts) fills these three; the other papers never do.
  /** The portal's claim number, printed beside the approval number. */
  claimNumber?: string;
  /** The "Dental Cop %" printed on the paper: what the patient pays of each line. */
  copayPercent?: number | null;
  /** "Limit Surpass (Over Limit)": the part above the policy's limit, if any. */
  overLimit?: number | null;
};

export type MetlifeExtraction = { header: MetlifeHeader; lines: MetlifeLine[] };

export type Check = { id: string; severity: "hard" | "soft"; field: string; en: string; ar: string };

// --- What the model is asked for ------------------------------------------------------------------

/** Header fields the model rates with a confidence. Names match `MetlifeHeader`. */
const CONFIDENCE_FIELDS = [
  "approvalNumber",
  "approvalDate",
  "policyNumber",
  "certificateNumber",
  "dependentCode",
  "paperPatientName",
  "providerCode",
  "statusText",
  "estimatedCost",
  "requestedTotal",
  "approvedTotal",
  "patientShareTotal",
  "collectNote",
] as const;

const str = { type: "STRING" } as const;
const strOrNull = { type: "STRING", nullable: true } as const;
const numOrNull = { type: "NUMBER", nullable: true } as const;
const num = { type: "NUMBER" } as const;

const LINE_KEYS = ["code", "description", "unitsRequested", "grossPerUnit", "grossTotal", "unitsApproved", "patientShare", "approvedAmount", "comment", "confidence"];
const HEADER_KEYS = [
  "approvalNumber",
  "approvalDate",
  "policyNumber",
  "certificateNumber",
  "dependentCode",
  "paperPatientName",
  "providerCode",
  "statusText",
  "diagnosisCode",
  "estimatedCost",
  "requestedTotal",
  "approvedTotal",
  "patientShareTotal",
  "collectNote",
  "terminationDate",
  "comment",
  "confidence",
];

/**
 * The JSON schema handed to Gemini as `responseSchema`. Plain data, so this module has no SDK
 * dependency; the string values match the SDK's SchemaType names. `policyNumber` and `providerCode`
 * are the printed strings whole ("6481234567 - EXAMPLE TRAVEL EGYPT"); `normalizeMetlife` splits them.
 */
export const METLIFE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    header: {
      type: "OBJECT",
      properties: {
        approvalNumber: str,
        approvalDate: strOrNull,
        policyNumber: str,
        certificateNumber: str,
        dependentCode: str,
        paperPatientName: str,
        paperPatientNameAr: str,
        providerCode: str,
        statusText: str,
        diagnosisCode: str,
        estimatedCost: numOrNull,
        requestedTotal: numOrNull,
        approvedTotal: numOrNull,
        patientShareTotal: numOrNull,
        collectNote: numOrNull,
        terminationDate: strOrNull,
        comment: str,
        confidence: {
          type: "OBJECT",
          properties: Object.fromEntries(CONFIDENCE_FIELDS.map((k) => [k, num])),
          required: [...CONFIDENCE_FIELDS],
        },
      },
      required: HEADER_KEYS,
    },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          code: str,
          description: str,
          unitsRequested: numOrNull,
          grossPerUnit: numOrNull,
          grossTotal: numOrNull,
          unitsApproved: numOrNull,
          patientShare: numOrNull,
          approvedAmount: numOrNull,
          comment: str,
          confidence: num,
        },
        required: LINE_KEYS,
      },
    },
  },
  required: ["header", "lines"],
};

export function buildMetlifePrompt(): string {
  return [
    "You are reading a scanned MetLife Egypt dental pre-approval (a PDF page or a photo of the paper).",
    "The page may be skewed, rotated, photographed at an angle or faint. Read it carefully anyway.",
    "",
    "Return the header fields and the service table as JSON in the schema you were given.",
    "- approvalNumber: the Pre-Approval ID, the letter D followed by seven digits. This is the most important field on the page: read it digit by digit, twice. On a faint scan 6 and 0, 8 and 3, 1 and 7 are easily confused; if any digit is not crisp, lower its confidence well below 0.7.",
    "- approvalDate and terminationDate: dates are printed dd/mm/yyyy. Copy them as printed. A termination date of 9999-12-31 means there is no end.",
    "- policyNumber: the Policy Number line as printed, number then employer, for example \"6481234567 - EXAMPLE TRAVEL EGYPT\".",
    "- providerCode: the Provider line as printed, for example \"DNC0001 - DR. EXAMPLE - DENTAL\".",
    "- certificateNumber and dependentCode: as printed. paperPatientName: the patient's name as printed, in capitals.",
    "- paperPatientNameAr: the same name written in Arabic the way an Egyptian dental clinic writes patient names (for example OMAR KHALED FAHMY -> عمر خالد فهمي, MOHAMED ABDEL RAHMAN -> محمد عبدالرحمن). Common Egyptian spellings, no diacritics.",
    "- statusText: the Status line, for example AUTO APPROVED.",
    "- estimatedCost, requestedTotal, approvedTotal, patientShareTotal: the figures in the Total row and the header. collectNote: the figure in the sentence \"Kindly collect the patient share of EGP x\".",
    "- A dash (-) or a blank means empty: use an empty string for text, null for a number or date.",
    "- The Total row at the bottom of the table is not a service line: never return it as a row; its figures go in requestedTotal, approvedTotal and patientShareTotal.",
    "- Copy the service table row by row, in the order printed, one entry per row, with each row's code, description, submitted units, gross per unit, gross for the code, approved units, patient share, MetLife approved amount and comment. Do not merge, skip or reorder rows, and do not do arithmetic: copy the printed numbers.",
    "- If you cannot read something, return null (or an empty string for text) rather than guessing. A wrong number is worse than a missing one.",
    "- confidence: a number from 0 to 1 for each header field you were asked to rate, and for every table row. Use a low number for anything faint, cut off, smudged or ambiguous.",
  ].join("\n");
}

// --- Normalising what came back -------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The paper prints a lone dash for "empty"; a dash is not a value. */
const LONE_DASH = /^[-\u2013\u2014]$/;

function text(v: unknown): string {
  if (typeof v === "string") {
    const t = v.trim();
    return LONE_DASH.test(t) ? "" : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** Codes are compared and stored upper-case; a model may return them in either case. */
function code(v: unknown): string {
  return text(v).toUpperCase();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Real calendar day? (31/02 and month 13 are misreads, not dates.) */
function isoIfReal(y: number, m: number, d: number): string | null {
  if (!(y >= 1000 && y <= 9999)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `03/10/2026` (dd/mm/yyyy, as MetLife prints) or `2026-10-03` → ISO. Anything else → null. */
export function parseMetlifeDate(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return isoIfReal(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return isoIfReal(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** `1,260.0` → 1260, `60` → 60, `" - "` or `""` → null. Rounded to 2 places. */
export function parseMoney(s: unknown): number | null {
  if (typeof s === "number") return Number.isFinite(s) ? round2(s) : null;
  if (typeof s !== "string") return null;
  const t = s.replace(/^\s*EGP\b/i, "").replace(/,/g, "").trim();
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? round2(n) : null;
}

/** "6481234567 - EXAMPLE TRAVEL" → [number, rest]: split at the first dash after the leading token, spaces or not. */
function splitDash(s: string): [string, string] {
  const m = /^\s*([A-Z0-9]+)\s*-\s*(.*)$/i.exec(s);
  if (!m) return [s.trim(), ""];
  return [m[1], m[2].trim()];
}

function moneyOr0(v: unknown): number {
  return parseMoney(v) ?? 0;
}

function normalizeConfidence(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const k of CONFIDENCE_FIELDS) {
    const raw = v[k];
    if (typeof raw === "number" && Number.isFinite(raw)) out[k] = Math.min(1, Math.max(0, raw));
  }
  return out;
}

function normalizeLine(raw: unknown): MetlifeLine {
  const r = isRecord(raw) ? raw : {};
  let c = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  // A number the model could not read becomes 0 (the sums will catch it) and the row is flagged for a look.
  if ([r.unitsRequested, r.grossPerUnit, r.grossTotal, r.unitsApproved, r.patientShare, r.approvedAmount].some((n) => parseMoney(n) === null)) c = 0;
  return {
    code: code(r.code),
    description: text(r.description),
    unitsRequested: moneyOr0(r.unitsRequested),
    grossPerUnit: moneyOr0(r.grossPerUnit),
    grossTotal: moneyOr0(r.grossTotal),
    unitsApproved: moneyOr0(r.unitsApproved),
    patientShare: moneyOr0(r.patientShare),
    approvedAmount: moneyOr0(r.approvedAmount),
    comment: text(r.comment),
    // A row the model gave no confidence for (or an unreadable one) is not trusted.
    confidence: c,
  };
}

/** The table's Total row is not a service; a model sometimes copies it as a row. */
/** The table's Total row is not a service: dropped before lines are numbered, by the server and the card alike. */
export function isTotalRow(l: MetlifeLine): boolean {
  return l.code === "" && l.description.toLowerCase() === "total";
}

/** Turns the model's JSON into a typed extraction. Tolerates anything: junk gives empty strings, nulls and no lines. */
export function normalizeMetlife(raw: unknown): MetlifeExtraction {
  const root = isRecord(raw) ? raw : {};
  const h = isRecord(root.header) ? root.header : {};
  const [policyNumber, employer] = splitDash(text(h.policyNumber));
  const [providerCode, physician] = splitDash(text(h.providerCode));
  return {
    header: {
      approvalNumber: code(h.approvalNumber),
      approvalDate: parseMetlifeDate(h.approvalDate),
      policyNumber,
      employer,
      certificateNumber: code(h.certificateNumber),
      dependentCode: code(h.dependentCode),
      paperPatientName: text(h.paperPatientName).replace(/\s+/g, " "),
      paperPatientNameAr: text(h.paperPatientNameAr).replace(/\s+/g, " "),
      providerCode: providerCode.toUpperCase(),
      physician,
      statusText: code(h.statusText),
      diagnosisCode: text(h.diagnosisCode),
      estimatedCost: parseMoney(h.estimatedCost),
      requestedTotal: parseMoney(h.requestedTotal),
      approvedTotal: parseMoney(h.approvedTotal),
      patientShareTotal: parseMoney(h.patientShareTotal),
      collectNote: parseMoney(h.collectNote),
      terminationDate: parseMetlifeDate(h.terminationDate),
      comment: text(h.comment),
      confidence: normalizeConfidence(h.confidence),
    },
    lines: Array.isArray(root.lines) ? root.lines.map(normalizeLine).filter((l) => !isTotalRow(l)) : [],
  };
}

// --- Checking it ----------------------------------------------------------------------------------

const TOLERANCE = 0.01;
const LOW_CONFIDENCE = 0.7;
const NAME_MATCH_FLOOR = 0.5;

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE + 1e-9;
}

function sum(lines: MetlifeLine[], pick: (l: MetlifeLine) => number): number {
  return round2(lines.reduce((t, l) => t + pick(l), 0));
}

/** The day after an ISO date, as ISO. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Names of header fields in both languages, for the messages. */
const FIELD_LABEL: Record<string, Text> = {
  approvalNumber: { en: "approval number", ar: "رقم الموافقة" },
  approvalDate: { en: "approval date", ar: "تاريخ الموافقة" },
  policyNumber: { en: "policy number", ar: "رقم البوليصة" },
  certificateNumber: { en: "certificate number", ar: "رقم الشهادة" },
  dependentCode: { en: "dependent code", ar: "كود التابع" },
  paperPatientName: { en: "patient name", ar: "اسم المريض" },
  paperPatientNameAr: { en: "patient name in Arabic", ar: "اسم المريض بالعربي" },
  providerCode: { en: "provider code", ar: "كود مقدم الخدمة" },
  statusText: { en: "status", ar: "الحالة" },
  estimatedCost: { en: "estimated cost", ar: "التكلفة التقديرية" },
  requestedTotal: { en: "requested total", ar: "إجمالي المطلوب" },
  approvedTotal: { en: "approved total", ar: "إجمالي الموافقة" },
  patientShareTotal: { en: "patient share total", ar: "إجمالي حصة المريض" },
  collectNote: { en: "patient share in the note", ar: "حصة المريض في الملاحظة" },
};

type Text = { en: string; ar: string };

function label(field: string): Text {
  return FIELD_LABEL[field] ?? { en: field, ar: field };
}

/**
 * Every message a check can show, in both languages, in one place. `{name}` is filled from the values
 * the check passes; a value is a plain string or an en/ar pair (field names, line labels).
 */
const CHECK_TEXT: Record<string, Text> = {
  approval_number: { en: "Approval number must be D followed by 7 digits", ar: "رقم الموافقة لازم يكون D و7 أرقام" },
  approval_date: { en: "Approval date could not be read", ar: "تاريخ الموافقة مش مقروء" },
  approval_date_future: { en: "Approval date is in the future", ar: "تاريخ الموافقة في المستقبل" },
  certificate: { en: "Certificate number is missing", ar: "رقم الشهادة ناقص" },
  dependent: { en: "Dependent code is missing", ar: "كود التابع ناقص" },
  no_lines: { en: "No service lines were read", ar: "مفيش بنود خدمة اتقرأت" },
  approved_total_missing: { en: "Type the approved total from the paper", ar: "اكتب إجمالي الموافقة من الورقة" },
  line_gross: { en: "{line}: gross must equal units x price per unit", ar: "{line}: الإجمالي لازم يساوي العدد × سعر الوحدة" },
  sum_mismatch: { en: "The lines add up to {got} but the printed {field} is {printed}", ar: "البنود مجموعها {got} لكن {field} المطبوع {printed}" },
  collect_note: { en: "The note says collect {printed} but the lines' patient share adds up to {got}", ar: "الملاحظة بتقول تحصيل {printed} لكن حصة المريض في البنود مجموعها {got}" },
  collect_note_total: { en: "The note says collect {printed} but the patient share total is {got}", ar: "الملاحظة بتقول تحصيل {printed} لكن إجمالي حصة المريض {got}" },
  status: { en: 'Status is "{status}", not approved', ar: 'الحالة "{status}" مش موافقة' },
  provider_code: { en: "Provider code {provider} differs from the clinic's {clinic}", ar: "كود مقدم الخدمة {provider} مختلف عن كود العيادة {clinic}" },
  low_confidence: { en: "The {field} was hard to read: please check it", ar: "{field} كان صعب القراءة: راجعه" },
  reduced: { en: "{line}: MetLife approved less than requested", ar: "{line}: ميتلايف وافقت على أقل من المطلوب" },
  share_exceeds: { en: "{line}: approved amount plus patient share is more than the gross", ar: "{line}: مبلغ الموافقة مع حصة المريض أكبر من الإجمالي" },
  name_mismatch: { en: "The name on the paper does not look like {name}", ar: "الاسم في الورقة مش شبه {name}" },
};

const EMPTY_WORD: Text = { en: "empty", ar: "فاضية" };
const NONE_WORD: Text = { en: "none", ar: "بدون" };

function say(key: string, vars: Record<string, string | Text> = {}): Text {
  const t = CHECK_TEXT[key];
  const fill = (lang: "en" | "ar") =>
    t[lang].replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = vars[k];
      return v === undefined ? "" : typeof v === "string" ? v : v[lang];
    });
  return { en: fill("en"), ar: fill("ar") };
}

function make(severity: "hard" | "soft", id: string, field: string, textKey: string, vars?: Record<string, string | Text>): Check {
  return { id, severity, field, ...say(textKey, vars) };
}

function lineLabel(i: number, l: MetlifeLine): Text {
  return { en: `Line ${i + 1} (${l.code || NONE_WORD.en})`, ar: `البند ${i + 1} (${l.code || NONE_WORD.ar})` };
}

export type MetlifeCheckContext = {
  /** Today as ISO `yyyy-mm-dd`, passed in so the checks stay pure. A malformed value skips the future-date check. */
  today: string;
  /** The payer's provider code in the clinic's settings. */
  providerCode?: string;
  matchedPatientName?: string;
  /** 0–1 similarity between the paper's name and the matched patient's. */
  nameScore?: number;
};

/** Hard checks block the save; soft checks warn. Money is compared to the cent (±0.01). */
export function checkMetlife(x: MetlifeExtraction, ctx: MetlifeCheckContext): Check[] {
  const checks: Check[] = [];
  const h = x.header;
  const today = parseMetlifeDate(ctx.today);

  // Hard: identity of the approval.
  if (!APPROVAL_NUMBER_RE.test(h.approvalNumber)) checks.push(make("hard", "approval_number", "approvalNumber", "approval_number"));
  if (!h.approvalDate) {
    checks.push(make("hard", "approval_date", "approvalDate", "approval_date"));
  } else if (today && h.approvalDate > nextDay(today)) {
    checks.push(make("hard", "approval_date_future", "approvalDate", "approval_date_future"));
  }
  if (!h.certificateNumber) checks.push(make("hard", "certificate", "certificateNumber", "certificate"));
  if (!h.dependentCode) checks.push(make("hard", "dependent", "dependentCode", "dependent"));

  // Hard: the service table and its sums.
  if (x.lines.length === 0) checks.push(make("hard", "no_lines", "lines", "no_lines"));
  x.lines.forEach((l, i) => {
    if (!close(l.grossTotal, round2(l.unitsRequested * l.grossPerUnit))) {
      checks.push(make("hard", "line_gross", `lines[${i}].grossTotal`, "line_gross", { line: lineLabel(i, l) }));
    }
  });

  if (x.lines.length > 0) {
    const sums: { id: string; field: "requestedTotal" | "approvedTotal" | "patientShareTotal"; got: number }[] = [
      { id: "requested_total", field: "requestedTotal", got: sum(x.lines, (l) => l.grossTotal) },
      { id: "approved_total", field: "approvedTotal", got: sum(x.lines, (l) => l.approvedAmount) },
      { id: "patient_share_total", field: "patientShareTotal", got: sum(x.lines, (l) => l.patientShare) },
    ];
    for (const s of sums) {
      const printed = h[s.field];
      if (printed === null && s.field === "approvedTotal") {
        // The approved total is what MetLife pays: without it a page read upside down, or a scan that
        // missed the Total row, would save with only some of its lines. A person must type it in.
        checks.push(make("hard", s.id, s.field, "approved_total_missing"));
      } else if (printed === null) {
        // Nothing to compare against: a person should look at that field.
        checks.push(lowConfidence(s.field));
        // The "Kindly collect" figure is the same number as the patient share total: check against it instead.
        if (s.field === "patientShareTotal" && h.collectNote !== null && !close(s.got, h.collectNote)) {
          checks.push(make("hard", "patient_share_total", "collectNote", "collect_note", { printed: String(h.collectNote), got: String(s.got) }));
        }
      } else if (!close(s.got, printed)) {
        checks.push(make("hard", s.id, s.field, "sum_mismatch", { got: String(s.got), printed: String(printed), field: label(s.field) }));
      }
    }
  }
  if (h.collectNote !== null && h.patientShareTotal !== null && !close(h.collectNote, h.patientShareTotal)) {
    checks.push(make("hard", "patient_share_total", "collectNote", "collect_note_total", { printed: String(h.collectNote), got: String(h.patientShareTotal) }));
  }

  // Soft: worth a look, never blocks.
  if (h.statusText !== "AUTO APPROVED" && h.statusText !== "APPROVED") {
    checks.push(make("soft", "status", "statusText", "status", { status: h.statusText || EMPTY_WORD }));
  }
  if (ctx.providerCode && h.providerCode !== ctx.providerCode.trim().toUpperCase()) {
    checks.push(make("soft", "provider_code", "providerCode", "provider_code", { provider: h.providerCode || `(${EMPTY_WORD.en})`, clinic: ctx.providerCode }));
  }
  for (const [field, c] of Object.entries(h.confidence)) {
    // A null printed total already raised this above: one check per field.
    if (c < LOW_CONFIDENCE && !checks.some((k) => k.id === "low_confidence" && k.field === field)) checks.push(lowConfidence(field));
  }
  x.lines.forEach((l, i) => {
    const line = lineLabel(i, l);
    if (l.confidence < LOW_CONFIDENCE) checks.push(make("soft", "low_confidence", `lines[${i}]`, "low_confidence", { field: line }));
    // MetLife covers part of the gross and the patient the rest; only a gap is a cut.
    const covered = round2(l.approvedAmount + l.patientShare);
    if (l.unitsApproved < l.unitsRequested || l.grossTotal - covered > TOLERANCE + 1e-9) {
      checks.push(make("soft", "reduced", `lines[${i}]`, "reduced", { line }));
    }
    if (covered - l.grossTotal > TOLERANCE + 1e-9) checks.push(make("soft", "share_exceeds", `lines[${i}]`, "share_exceeds", { line }));
  });
  if (ctx.matchedPatientName && typeof ctx.nameScore === "number" && ctx.nameScore < NAME_MATCH_FLOOR) {
    checks.push(make("soft", "name_mismatch", "paperPatientName", "name_mismatch", { name: ctx.matchedPatientName }));
  }
  return checks;
}

function lowConfidence(field: string): Check {
  return make("soft", "low_confidence", field, "low_confidence", { field: label(field) });
}

export function hasHardFailure(checks: Check[]): boolean {
  return checks.some((c) => c.severity === "hard");
}
