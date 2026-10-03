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
  /** The code part of "DNC8144 - DR. AHMED ROSHDY - DENTAL". */
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
          unitsRequested: num,
          grossPerUnit: num,
          grossTotal: num,
          unitsApproved: num,
          patientShare: num,
          approvedAmount: num,
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
    "- approvalNumber: the Pre-Approval ID, the letter D followed by seven digits.",
    "- approvalDate and terminationDate: dates are printed dd/mm/yyyy. Copy them as printed. A termination date of 9999-12-31 means there is no end.",
    "- policyNumber: the Policy Number line as printed, number then employer, for example \"6481234567 - EXAMPLE TRAVEL EGYPT\".",
    "- providerCode: the Provider line as printed, for example \"DNC8144 - DR. AHMED ROSHDY - DENTAL\".",
    "- certificateNumber and dependentCode: as printed. paperPatientName: the patient's name as printed, in capitals.",
    "- statusText: the Status line, for example AUTO APPROVED.",
    "- estimatedCost, requestedTotal, approvedTotal, patientShareTotal: the figures in the Total row and the header. collectNote: the figure in the sentence \"Kindly collect the patient share of EGP x\".",
    "- A dash (-) or a blank means empty: use an empty string for text, null for a number or date.",
    "- Copy the service table row by row, in the order printed, one entry per row, with each row's code, description, submitted units, gross per unit, gross for the code, approved units, patient share, MetLife approved amount and comment. Do not merge, skip or reorder rows, and do not do arithmetic: copy the printed numbers.",
    "- If you cannot read something, return null (or an empty string for text) rather than guessing. A wrong number is worse than a missing one.",
    "- confidence: a number from 0 to 1 for each header field you were asked to rate, and for every table row. Use a low number for anything faint, cut off, smudged or ambiguous.",
  ].join("\n");
}

// --- Normalising what came back -------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string {
  if (typeof v === "string") return v.trim();
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

/** "number - rest" → [number, rest], split on the first " - " only. */
function splitDash(s: string): [string, string] {
  const i = s.indexOf(" - ");
  if (i < 0) return [s.trim(), ""];
  return [s.slice(0, i).trim(), s.slice(i + 3).trim()];
}

function moneyOr0(v: unknown): number {
  return parseMoney(v) ?? 0;
}

function normalizeConfidence(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const [k, raw] of Object.entries(v)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[k] = Math.min(1, Math.max(0, raw));
  }
  return out;
}

function normalizeLine(raw: unknown): MetlifeLine {
  const r = isRecord(raw) ? raw : {};
  const c = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
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
    lines: Array.isArray(root.lines) ? root.lines.map(normalizeLine) : [],
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
const FIELD_LABEL: Record<string, { en: string; ar: string }> = {
  approvalNumber: { en: "approval number", ar: "رقم الموافقة" },
  approvalDate: { en: "approval date", ar: "تاريخ الموافقة" },
  policyNumber: { en: "policy number", ar: "رقم البوليصة" },
  certificateNumber: { en: "certificate number", ar: "رقم الشهادة" },
  dependentCode: { en: "dependent code", ar: "كود التابع" },
  paperPatientName: { en: "patient name", ar: "اسم المريض" },
  providerCode: { en: "provider code", ar: "كود مقدم الخدمة" },
  statusText: { en: "status", ar: "الحالة" },
  estimatedCost: { en: "estimated cost", ar: "التكلفة التقديرية" },
  requestedTotal: { en: "requested total", ar: "إجمالي المطلوب" },
  approvedTotal: { en: "approved total", ar: "إجمالي الموافقة" },
  patientShareTotal: { en: "patient share total", ar: "إجمالي حصة المريض" },
  collectNote: { en: "the patient share in the note", ar: "حصة المريض في الملاحظة" },
};

function label(field: string): { en: string; ar: string } {
  return FIELD_LABEL[field] ?? { en: field, ar: field };
}

function hardCheck(id: string, field: string, en: string, ar: string): Check {
  return { id, severity: "hard", field, en, ar };
}
function softCheck(id: string, field: string, en: string, ar: string): Check {
  return { id, severity: "soft", field, en, ar };
}

export type MetlifeCheckContext = {
  /** Today as ISO `yyyy-mm-dd`, passed in so the checks stay pure. */
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

  // Hard: identity of the approval.
  if (!APPROVAL_NUMBER_RE.test(h.approvalNumber)) {
    checks.push(hardCheck("approval_number", "approvalNumber", "Approval number must be D followed by 7 digits", "رقم الموافقة لازم يكون D و7 أرقام"));
  }
  if (!h.approvalDate) {
    checks.push(hardCheck("approval_date", "approvalDate", "Approval date could not be read", "تاريخ الموافقة مش مقروء"));
  } else if (h.approvalDate > nextDay(ctx.today)) {
    checks.push(hardCheck("approval_date_future", "approvalDate", "Approval date is in the future", "تاريخ الموافقة في المستقبل"));
  }
  if (!h.certificateNumber) {
    checks.push(hardCheck("certificate", "certificateNumber", "Certificate number is missing", "رقم الشهادة ناقص"));
  }
  if (!h.dependentCode) {
    checks.push(hardCheck("dependent", "dependentCode", "Dependent code is missing", "كود التابع ناقص"));
  }

  // Hard: the service table and its sums.
  if (x.lines.length === 0) {
    checks.push(hardCheck("no_lines", "lines", "No service lines were read", "مفيش بنود خدمة اتقرأت"));
  }
  x.lines.forEach((l, i) => {
    if (!close(l.grossTotal, round2(l.unitsRequested * l.grossPerUnit))) {
      checks.push(
        hardCheck(
          "line_gross",
          `lines[${i}].grossTotal`,
          `Line ${i + 1} (${l.code || "no code"}): gross must equal units x price per unit`,
          `البند ${i + 1} (${l.code || "بدون كود"}): الإجمالي لازم يساوي العدد × سعر الوحدة`,
        ),
      );
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
      if (printed === null) {
        // Nothing to compare against: a person should look at that field.
        checks.push(lowConfidence(s.field, label(s.field)));
      } else if (!close(s.got, printed)) {
        checks.push(
          hardCheck(
            s.id,
            s.field,
            `The lines add up to ${s.got} but the printed ${label(s.field).en} is ${printed}`,
            `البنود مجموعها ${s.got} لكن ${label(s.field).ar} المطبوع ${printed}`,
          ),
        );
      }
    }
  }
  if (h.collectNote !== null && h.patientShareTotal !== null && !close(h.collectNote, h.patientShareTotal)) {
    checks.push(
      hardCheck(
        "patient_share_total",
        "collectNote",
        `The note says collect ${h.collectNote} but the patient share total is ${h.patientShareTotal}`,
        `الملاحظة بتقول تحصيل ${h.collectNote} لكن إجمالي حصة المريض ${h.patientShareTotal}`,
      ),
    );
  }

  // Soft: worth a look, never blocks.
  if (h.statusText !== "AUTO APPROVED" && h.statusText !== "APPROVED") {
    checks.push(
      softCheck(
        "status",
        "statusText",
        `Status is "${h.statusText || "empty"}", not approved`,
        `الحالة "${h.statusText || "فاضية"}" مش موافقة`,
      ),
    );
  }
  if (ctx.providerCode && h.providerCode !== ctx.providerCode.trim().toUpperCase()) {
    checks.push(
      softCheck(
        "provider_code",
        "providerCode",
        `Provider code ${h.providerCode || "(empty)"} differs from the clinic's ${ctx.providerCode}`,
        `كود مقدم الخدمة ${h.providerCode || "(فاضي)"} مختلف عن كود العيادة ${ctx.providerCode}`,
      ),
    );
  }
  for (const [field, c] of Object.entries(h.confidence)) {
    // A null printed total already raised this above: one check per field.
    if (c < LOW_CONFIDENCE && !checks.some((k) => k.id === "low_confidence" && k.field === field)) checks.push(lowConfidence(field, label(field)));
  }
  x.lines.forEach((l, i) => {
    if (l.confidence < LOW_CONFIDENCE) {
      checks.push(
        softCheck(
          "low_confidence",
          `lines[${i}]`,
          `Line ${i + 1} (${l.code || "no code"}) was hard to read: please check it`,
          `البند ${i + 1} (${l.code || "بدون كود"}) كان صعب القراءة: راجعه`,
        ),
      );
    }
    if (l.unitsApproved < l.unitsRequested || l.approvedAmount < l.grossTotal) {
      checks.push(
        softCheck(
          "reduced",
          `lines[${i}]`,
          `Line ${i + 1} (${l.code || "no code"}): MetLife approved less than requested`,
          `البند ${i + 1} (${l.code || "بدون كود"}): ميتلايف وافقت على أقل من المطلوب`,
        ),
      );
    }
  });
  if (ctx.matchedPatientName && typeof ctx.nameScore === "number" && ctx.nameScore < NAME_MATCH_FLOOR) {
    checks.push(
      softCheck(
        "name_mismatch",
        "paperPatientName",
        `The name on the paper does not look like ${ctx.matchedPatientName}`,
        `الاسم في الورقة مش شبه ${ctx.matchedPatientName}`,
      ),
    );
  }
  return checks;
}

function lowConfidence(field: string, l: { en: string; ar: string }): Check {
  return softCheck("low_confidence", field, `The ${l.en} was hard to read: please check it`, `${l.ar} كان صعب القراءة: راجعه`);
}

export function hasHardFailure(checks: Check[]): boolean {
  return checks.some((c) => c.severity === "hard");
}
