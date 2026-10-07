/**
 * The NextCare dental approval reader — NextCare approving on behalf of an insurer (Misr Insurance on
 * the first sample). Pure: no Gemini, no Firestore, no SDK import, as metlife.ts.
 *
 * NextCare's paper is not MetLife's, but what the clinic does with it is the same: save the approval,
 * put the approved services in the patient's file, give each a dentist and a state, collect the
 * patient's share, bill the insurer monthly. So the reader turns NextCare's page into the SAME record
 * MetLife's reader produces (`MetlifeExtraction`), and everything downstream works unchanged:
 *
 *   - card number          → `certificateNumber` (what finds the patient again next time)
 *   - beneficiary code     → `dependentCode`
 *   - contract / product   → `employer` / `productName`
 *   - provider             → `physician`; diagnosis → `diagnosisCode`; policy end → `terminationDate`
 *   - insurer's share      → each line's `approvedAmount` (what the insurer pays, as on MetLife)
 *   - price each           → `grossPerUnit`; asked × price → `grossTotal`
 *   - refusal reason       → the line's `comment`; special conditions → the header's `comment`
 *
 * plus four header fields MetLife has no use for (`validUntil`, `insurerName`, `productName`,
 * `memberCode` — the 4-character code the monthly sheet prints before the name) and each line's teeth.
 *
 * The paper prints the teeth only in its special conditions, in quadrant shorthand ("L.R 4-6" = lower
 * right 4 and 6 = FDI 44, 46). `quadrantTeeth` reads them; `assignConditionTeeth` gives a group to the
 * service approved for exactly that many units and guesses nothing else. The desk corrects the rest.
 *
 * The national ID number printed on the paper is never asked for and never stored.
 */
import { parseMoney, type Check, type MetlifeExtraction, type MetlifeHeader, type MetlifeLine } from "./metlife";

export const NEXTCARE_FORMAT = "nextcare";

/** `C0013224779/1`: a letter or two, at least seven digits, an optional `/n`. */
export const NEXTCARE_APPROVAL_RE = /^[A-Z]{1,3}\d{7,}(\/\d+)?$/;

/** Four groups of four hex characters: `3C40-FD1B-02E6-412C`. */
const CARD_RE = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;

// --- What the model is asked for ------------------------------------------------------------------

const CONFIDENCE_FIELDS = [
  "approvalNumber",
  "approvalDate",
  "validUntil",
  "cardNumber",
  "paperPatientName",
  "approvedPriceTotal",
  "patientShareTotal",
  "insuranceShareTotal",
] as const;

const str = { type: "STRING" } as const;
const strOrNull = { type: "STRING", nullable: true } as const;
const numOrNull = { type: "NUMBER", nullable: true } as const;
const num = { type: "NUMBER" } as const;

const HEADER_KEYS = [
  "approvalNumber",
  "approvalDate",
  "validUntil",
  "insurerName",
  "providerName",
  "paperPatientName",
  "paperPatientNameAr",
  "policyNumber",
  "contractName",
  "productName",
  "cardNumber",
  "beneficiaryCode",
  "policyEndDate",
  "diagnosis",
  "conditions",
  "approvedPriceTotal",
  "patientShareTotal",
  "insuranceShareTotal",
  "confidence",
];
const LINE_KEYS = ["code", "description", "unitsRequested", "unitsApproved", "unitPrice", "approvedPrice", "patientShare", "insuranceShare", "reason", "confidence"];

/** The JSON schema handed to Gemini. Plain data; the strings match the SDK's SchemaType names. */
export const NEXTCARE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    header: {
      type: "OBJECT",
      properties: {
        approvalNumber: str,
        approvalDate: strOrNull,
        validUntil: strOrNull,
        insurerName: str,
        providerName: str,
        paperPatientName: str,
        paperPatientNameAr: str,
        policyNumber: str,
        contractName: str,
        productName: str,
        cardNumber: str,
        beneficiaryCode: str,
        policyEndDate: strOrNull,
        diagnosis: str,
        conditions: str,
        approvedPriceTotal: numOrNull,
        patientShareTotal: numOrNull,
        insuranceShareTotal: numOrNull,
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
          unitsApproved: numOrNull,
          unitPrice: numOrNull,
          approvedPrice: numOrNull,
          patientShare: numOrNull,
          insuranceShare: numOrNull,
          reason: str,
          confidence: num,
        },
        required: LINE_KEYS,
      },
    },
  },
  required: ["header", "lines"],
};

export function buildNextcarePrompt(): string {
  return [
    "You are reading a NextCare dental approval (موافقة) issued by NextCare on behalf of an insurance company. It is a PDF page or a photo of the paper, bilingual Arabic and English.",
    "The page may be skewed, rotated, folded, photographed at an angle or faint. Read it carefully anyway.",
    "",
    "Return the header fields and the service table as JSON in the schema you were given.",
    "- approvalNumber: the number after موافقة رقم at the top, for example C0013224779/1 (a letter, digits, a slash and a digit). Read it character by character, twice; if any character is not crisp, lower its confidence well below 0.7.",
    "- approvalDate: the date beside التاريخ. validUntil: the date beside هذه الموافقة صالحة للاستخدام حتى تاريخ. policyEndDate: تاريخ انتهاء الوثيقة. Dates are printed like 04-Jul-2026; copy them as printed.",
    "- insurerName: the company NextCare acts for, from the line 'NEXtCARE بالنيابة عن شركة …' (for example Misr Insurance). providerName: the line beside مقدم الخدمة.",
    "- paperPatientName: the insured's name (إسم المؤمن) as printed in Latin letters. paperPatientNameAr: the same name written in Arabic the way an Egyptian dental clinic writes patient names, common spellings, no diacritics.",
    "- policyNumber: رقم الوثيقة. contractName: اسم العقد. productName: إسم المنتج. cardNumber: رقم البطاقة, four groups of four letters/digits joined by dashes. beneficiaryCode: رمز المستفيد.",
    "- Do NOT return the national ID number (رقم الهوية) or the date of birth anywhere.",
    "- diagnosis: the medical diagnosis line (التشخيص الطبي), code and words, for example K02.9 Dental caries, unspecified.",
    "- conditions: every line of the special conditions (شروط خاصة بالموافقة) and any handwritten tooth notes near the bottom, one per line, exactly as written (for example L.R 4-6, refer back if exceeds 1673.25 le).",
    "- The service table: copy it row by row in the order printed, one entry per row: code (الرمز), description (إسم الخدمة, English and Arabic as printed), unitsRequested (الكمية المطلوبة), unitsApproved (الكمية الموافق عليها), unitPrice (سعر الوحدة), approvedPrice (السعر الموافق عليه), patientShare (حصة المريض), insuranceShare (حصة التأمين), reason (السبب, for example Not authorized).",
    "- The total row (المجموع) is not a service line: never return it as a row; its three figures go in approvedPriceTotal, patientShareTotal and insuranceShareTotal.",
    "- Do not do arithmetic and do not merge, skip or reorder rows: copy the printed numbers. A dash or a blank means empty: an empty string for text, null for a number or date.",
    "- If you cannot read something, return null (or an empty string) rather than guessing. A wrong number is worse than a missing one.",
    "- confidence: a number from 0 to 1 for each header field you were asked to rate, and for every table row. Use a low number for anything faint, cut off, smudged or ambiguous.",
  ].join("\n");
}

// --- Small readers ----------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const LONE_DASH = /^[-–—]$/;

function text(v: unknown): string {
  if (typeof v === "string") {
    const t = v.trim();
    return LONE_DASH.test(t) ? "" : t;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoIfReal(y: number, m: number, d: number): string | null {
  if (!(y >= 1000 && y <= 9999)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** `04-Jul-2026` (as NextCare prints), `04/07/2026` or `2026-07-04` → ISO. Anything else → null. */
export function parseNextcareDate(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  let m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    return month ? isoIfReal(Number(m[3]), month, Number(m[1])) : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return isoIfReal(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return isoIfReal(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

// --- Teeth ----------------------------------------------------------------------------------------------

/** Quadrant numbers, FDI: upper right 1, upper left 2, lower left 3, lower right 4 (milk teeth +4). */
const QUADRANT: Record<string, number> = { UR: 1, UL: 2, LL: 3, LR: 4 };

/** A real FDI tooth code: permanent 11–48, milk 51–85. */
export function isFdiTooth(code: string): boolean {
  const m = /^([1-8])([1-8])$/.exec(code);
  if (!m) return false;
  const q = Number(m[1]);
  const p = Number(m[2]);
  return q <= 4 ? p <= 8 : p <= 5;
}

/**
 * Every tooth group written in the insurer's shorthand, in order: `L.R 4-6` → [["44","46"]].
 * The dashes separate teeth (4-5-6 is three teeth, 4-6 is two), as on the paper; letters A–E are milk
 * teeth. Text that is not a quadrant ("refer back if exceeds 1673.25") yields nothing.
 */
export function quadrantTeeth(conditions: string): string[][] {
  const out: string[][] = [];
  const re = /\b([UL])\s*\.?\s*([RL])\s*\.?\s*([1-8A-E](?:\s*-\s*[1-8A-E])*)(?![0-9A-Za-z])/gi;
  for (const m of String(conditions ?? "").matchAll(re)) {
    const quadrant = QUADRANT[`${m[1]}${m[2]}`.toUpperCase()];
    if (!quadrant) continue;
    const group: string[] = [];
    for (const raw of m[3].split("-").map((s) => s.trim().toUpperCase())) {
      const code = /[A-E]/.test(raw) ? `${quadrant + 4}${"ABCDE".indexOf(raw) + 1}` : `${quadrant}${raw}`;
      if (isFdiTooth(code) && !group.includes(code)) group.push(code);
    }
    if (group.length) out.push(group);
  }
  return out;
}

/**
 * Teeth for each line, from the conditions' groups: a group goes to the first line approved for exactly
 * that many units that has no teeth yet. Lines approved for nothing, or for a count no group matches,
 * get none — a wrong tooth on a claim is worse than a blank the desk fills in.
 */
export function assignConditionTeeth(lines: ReadonlyArray<{ unitsApproved: number }>, groups: string[][]): string[][] {
  const used = new Set<number>();
  return lines.map((l) => {
    const n = Math.round(Number(l.unitsApproved) || 0);
    if (n <= 0) return [];
    const k = groups.findIndex((g, i) => !used.has(i) && g.length === n);
    if (k < 0) return [];
    used.add(k);
    return [...groups[k]];
  });
}

function cleanTeeth(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    const code = String(t ?? "").trim();
    if (/^\d{2}$/.test(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

// --- Normalising ----------------------------------------------------------------------------------------

/**
 * The model's NextCare-shaped JSON → the shared record's shape (still raw values: strings may hold
 * "1,610.0", dates "04-Jul-2026"). `normalizeNextcare` then tidies it. Kept apart so the confirm card
 * and the server, which post and re-read the shared shape, never go through this mapping twice.
 */
export function fromNextcareModel(raw: unknown): Record<string, unknown> {
  const root = isRecord(raw) ? raw : {};
  const h = isRecord(root.header) ? root.header : {};
  const rawLines = Array.isArray(root.lines) ? root.lines : [];
  const lines = rawLines.map((r) => {
    const l = isRecord(r) ? r : {};
    const requested = parseMoney(l.unitsRequested);
    const price = parseMoney(l.unitPrice);
    const share = parseMoney(l.patientShare);
    const approvedPrice = parseMoney(l.approvedPrice);
    let insurer = parseMoney(l.insuranceShare);
    let confidence = typeof l.confidence === "number" ? l.confidence : 0;
    if (insurer === null && approvedPrice !== null) insurer = round2(approvedPrice - (share ?? 0));
    // The three printed figures must agree; a row where they do not is flagged for a look.
    if (insurer !== null && approvedPrice !== null && Math.abs(round2(insurer + (share ?? 0)) - approvedPrice) > 0.01) confidence = 0;
    return {
      code: l.code,
      description: l.description,
      unitsRequested: requested ?? l.unitsRequested,
      unitsApproved: l.unitsApproved,
      grossPerUnit: price ?? l.unitPrice,
      grossTotal: requested !== null && price !== null ? round2(requested * price) : null,
      patientShare: share ?? (text(l.reason) ? 0 : l.patientShare),
      approvedAmount: insurer ?? (text(l.reason) ? 0 : l.insuranceShare),
      comment: l.reason,
      confidence,
    };
  });
  const conditions = text(h.conditions);
  const approvedPriceTotal = parseMoney(h.approvedPriceTotal);
  const shareTotal = parseMoney(h.patientShareTotal);
  let insurerTotal = parseMoney(h.insuranceShareTotal);
  if (insurerTotal === null && approvedPriceTotal !== null) insurerTotal = round2(approvedPriceTotal - (shareTotal ?? 0));
  const confidence = isRecord(h.confidence) ? h.confidence : {};
  return {
    header: {
      approvalNumber: h.approvalNumber,
      approvalDate: h.approvalDate,
      validUntil: h.validUntil,
      insurerName: h.insurerName,
      policyNumber: h.policyNumber,
      employer: h.contractName,
      productName: h.productName,
      certificateNumber: h.cardNumber,
      dependentCode: h.beneficiaryCode,
      paperPatientName: h.paperPatientName,
      paperPatientNameAr: h.paperPatientNameAr,
      providerCode: "",
      physician: h.providerName,
      statusText: "",
      diagnosisCode: h.diagnosis,
      estimatedCost: null,
      requestedTotal: null,
      approvedTotal: insurerTotal,
      patientShareTotal: shareTotal,
      collectNote: null,
      terminationDate: h.policyEndDate,
      comment: conditions,
      memberCode: "",
      confidence: {
        approvalNumber: confidence.approvalNumber,
        approvalDate: confidence.approvalDate,
        validUntil: confidence.validUntil,
        certificateNumber: confidence.cardNumber,
        paperPatientName: confidence.paperPatientName,
        approvedTotal: confidence.insuranceShareTotal,
        patientShareTotal: confidence.patientShareTotal,
      },
    },
    lines,
    // Teeth come from the conditions, once, at read time; after that they are the desk's.
    teethFromConditions: assignConditionTeeth(
      lines.map((l) => ({ unitsApproved: parseMoney(l.unitsApproved) ?? 0 })),
      quadrantTeeth(conditions),
    ),
  };
}

const HEADER_CONFIDENCE = ["approvalNumber", "approvalDate", "validUntil", "certificateNumber", "paperPatientName", "approvedTotal", "patientShareTotal"];

function normalizeConfidence(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(v)) return out;
  for (const k of HEADER_CONFIDENCE) {
    const raw = v[k];
    if (typeof raw === "number" && Number.isFinite(raw)) out[k] = Math.min(1, Math.max(0, raw));
  }
  return out;
}

function moneyOr0(v: unknown): number {
  return parseMoney(v) ?? 0;
}

/** The total row (المجموع / Total) is not a service. */
function isTotalRow(l: { code: string; description: string }): boolean {
  const d = l.description.trim().toLowerCase();
  return l.code === "" && (d === "total" || d === "المجموع" || d === "الإجمالي" || d === "الاجمالي");
}

function normalizeLine(raw: unknown, conditionTeeth: string[] | undefined): MetlifeLine {
  const r = isRecord(raw) ? raw : {};
  let c = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  if ([r.unitsRequested, r.grossPerUnit, r.unitsApproved, r.patientShare, r.approvedAmount].some((n) => parseMoney(n) === null)) c = 0;
  const unitsRequested = moneyOr0(r.unitsRequested);
  const grossPerUnit = moneyOr0(r.grossPerUnit);
  return {
    code: text(r.code).toUpperCase(),
    description: text(r.description).replace(/\s+/g, " "),
    unitsRequested,
    grossPerUnit,
    // Never printed on NextCare's paper: always asked × price each, so it cannot disagree.
    grossTotal: round2(unitsRequested * grossPerUnit),
    unitsApproved: moneyOr0(r.unitsApproved),
    patientShare: moneyOr0(r.patientShare),
    approvedAmount: moneyOr0(r.approvedAmount),
    comment: text(r.comment),
    confidence: c,
    teeth: Array.isArray(r.teeth) ? cleanTeeth(r.teeth) : conditionTeeth ?? [],
  };
}

/** The card number's first group: the code the monthly sheet prints before the patient's name. */
export function memberCodeFromCard(card: string): string {
  const first = String(card ?? "").trim().split("-")[0] ?? "";
  return /^[0-9A-F]{4}$/i.test(first) ? first.toUpperCase() : "";
}

/**
 * The shared record's shape → typed and tidy. Accepts both the mapped model output (`fromNextcareModel`)
 * and an already-normalised extraction (what the card posts, what a stored claim holds): it is idempotent.
 */
export function normalizeNextcare(raw: unknown): MetlifeExtraction {
  const root = isRecord(raw) ? raw : {};
  const h = isRecord(root.header) ? root.header : {};
  const conditionTeeth = Array.isArray(root.teethFromConditions) ? (root.teethFromConditions as unknown[]) : null;
  const card = text(h.certificateNumber).replace(/\s+/g, "").toUpperCase();
  const typedCode = text(h.memberCode).toUpperCase();
  const header: MetlifeHeader = {
    approvalNumber: text(h.approvalNumber).replace(/\s+/g, "").toUpperCase(),
    approvalDate: parseNextcareDate(h.approvalDate),
    policyNumber: text(h.policyNumber),
    employer: text(h.employer),
    certificateNumber: card,
    dependentCode: text(h.dependentCode).replace(/\s+/g, "").toUpperCase(),
    paperPatientName: text(h.paperPatientName).replace(/\s+/g, " "),
    paperPatientNameAr: text(h.paperPatientNameAr).replace(/\s+/g, " "),
    providerCode: "",
    physician: text(h.physician),
    statusText: "",
    diagnosisCode: text(h.diagnosisCode),
    estimatedCost: null,
    requestedTotal: null,
    approvedTotal: parseMoney(h.approvedTotal),
    patientShareTotal: parseMoney(h.patientShareTotal),
    collectNote: null,
    terminationDate: parseNextcareDate(h.terminationDate),
    comment: typeof h.comment === "string" ? h.comment.trim() : "",
    confidence: normalizeConfidence(h.confidence),
    validUntil: parseNextcareDate(h.validUntil),
    insurerName: text(h.insurerName),
    productName: text(h.productName),
    memberCode: typedCode || memberCodeFromCard(card),
  };
  const rawLines = Array.isArray(root.lines) ? root.lines : [];
  const lines = rawLines
    .map((l, i) => normalizeLine(l, conditionTeeth ? cleanTeeth(conditionTeeth[i]) : undefined))
    .filter((l) => !isTotalRow(l));
  return { header, lines };
}

// --- Checking it -----------------------------------------------------------------------------------------

type Text = { en: string; ar: string };

const CHECK_TEXT: Record<string, Text> = {
  approval_number: { en: "Approval number must look like C0013224779/1", ar: "رقم الموافقة لازم يكون زي C0013224779/1" },
  approval_date: { en: "Approval date could not be read", ar: "تاريخ الموافقة مش مقروء" },
  approval_date_future: { en: "Approval date is in the future", ar: "تاريخ الموافقة في المستقبل" },
  card: { en: "Card number is missing", ar: "رقم البطاقة ناقص" },
  card_format: { en: "Card number does not look like 3C40-FD1B-02E6-412C", ar: "رقم البطاقة مش شبه 3C40-FD1B-02E6-412C" },
  no_lines: { en: "No service lines were read", ar: "مفيش بنود خدمة اتقرأت" },
  approved_total_missing: { en: "Type the insurer's total from the paper", ar: "اكتب إجمالي حصة التأمين من الورقة" },
  sum_mismatch: { en: "The lines add up to {got} but the printed {field} is {printed}", ar: "البنود مجموعها {got} لكن {field} المطبوع {printed}" },
  expired: { en: "This approval was valid until {date}: it has expired", ar: "الموافقة دي كانت صالحة لحد {date}: خلصت" },
  policy_ended: { en: "The policy ended on {date}, before this approval", ar: "الوثيقة خلصت يوم {date}، قبل الموافقة" },
  low_confidence: { en: "The {field} was hard to read: please check it", ar: "{field} كان صعب القراءة: راجعه" },
  reduced: { en: "{line}: approved less than requested", ar: "{line}: اتوافق على أقل من المطلوب" },
  over_price: { en: "{line}: the approved amount is more than price each x units approved", ar: "{line}: المبلغ الموافق عليه أكبر من سعر الوحدة × الكمية الموافق عليها" },
  teeth: { en: "{line}: {tooth} is not a tooth number", ar: "{line}: {tooth} مش رقم سنة" },
  name_mismatch: { en: "The name on the paper does not look like {name}", ar: "الاسم في الورقة مش شبه {name}" },
};

const FIELD_LABEL: Record<string, Text> = {
  approvalNumber: { en: "approval number", ar: "رقم الموافقة" },
  approvalDate: { en: "approval date", ar: "تاريخ الموافقة" },
  validUntil: { en: "valid-until date", ar: "تاريخ صلاحية الموافقة" },
  certificateNumber: { en: "card number", ar: "رقم البطاقة" },
  paperPatientName: { en: "patient name", ar: "اسم المريض" },
  approvedTotal: { en: "insurer's total", ar: "إجمالي حصة التأمين" },
  patientShareTotal: { en: "patient share total", ar: "إجمالي حصة المريض" },
};

function say(key: string, vars: Record<string, string | Text> = {}): Text {
  const t = CHECK_TEXT[key];
  const fill = (lang: "en" | "ar") =>
    t[lang].replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = vars[k];
      return v === undefined ? "" : typeof v === "string" ? v : v[lang];
    });
  return { en: fill("en"), ar: fill("ar") };
}

function make(severity: "hard" | "soft", id: string, field: string, key: string, vars?: Record<string, string | Text>): Check {
  return { id, severity, field, ...say(key, vars) };
}

function lineLabel(i: number, l: MetlifeLine): Text {
  return { en: `Line ${i + 1} (${l.code || "none"})`, ar: `البند ${i + 1} (${l.code || "بدون"})` };
}

function label(field: string): Text {
  return FIELD_LABEL[field] ?? { en: field, ar: field };
}

function nextDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

const TOLERANCE = 0.01;
const LOW_CONFIDENCE = 0.7;
const NAME_MATCH_FLOOR = 0.5;

export type NextcareCheckContext = { today: string; matchedPatientName?: string; nameScore?: number };

/**
 * Hard checks block the save, soft ones warn — the same contract as `checkMetlife`. The approval's
 * identity (number, date, card) and its money (the insurer's lines add up to the printed total) are
 * hard; an expired approval, a refused or reduced service, an odd tooth are worth a look.
 */
export function checkNextcare(x: MetlifeExtraction, ctx: NextcareCheckContext): Check[] {
  const checks: Check[] = [];
  const h = x.header;
  const today = parseNextcareDate(ctx.today);

  if (!NEXTCARE_APPROVAL_RE.test(h.approvalNumber)) checks.push(make("hard", "approval_number", "approvalNumber", "approval_number"));
  if (!h.approvalDate) checks.push(make("hard", "approval_date", "approvalDate", "approval_date"));
  else if (today && h.approvalDate > nextDay(today)) checks.push(make("hard", "approval_date_future", "approvalDate", "approval_date_future"));
  if (!h.certificateNumber) checks.push(make("hard", "card", "certificateNumber", "card"));

  if (x.lines.length === 0) checks.push(make("hard", "no_lines", "lines", "no_lines"));
  if (x.lines.length > 0) {
    const insurer = round2(x.lines.reduce((t, l) => t + l.approvedAmount, 0));
    const share = round2(x.lines.reduce((t, l) => t + l.patientShare, 0));
    if (h.approvedTotal === null) checks.push(make("hard", "approved_total_missing", "approvedTotal", "approved_total_missing"));
    else if (Math.abs(insurer - h.approvedTotal) > TOLERANCE + 1e-9) {
      checks.push(make("hard", "approved_total", "approvedTotal", "sum_mismatch", { got: String(insurer), printed: String(h.approvedTotal), field: label("approvedTotal") }));
    }
    if (h.patientShareTotal !== null && Math.abs(share - h.patientShareTotal) > TOLERANCE + 1e-9) {
      checks.push(make("hard", "patient_share_total", "patientShareTotal", "sum_mismatch", { got: String(share), printed: String(h.patientShareTotal), field: label("patientShareTotal") }));
    }
  }

  // Soft.
  if (h.certificateNumber && !CARD_RE.test(h.certificateNumber)) checks.push(make("soft", "card_format", "certificateNumber", "card_format"));
  if (today && h.validUntil && h.validUntil < today) checks.push(make("soft", "expired", "validUntil", "expired", { date: h.validUntil }));
  if (h.terminationDate && h.approvalDate && h.terminationDate < h.approvalDate) {
    checks.push(make("soft", "policy_ended", "terminationDate", "policy_ended", { date: h.terminationDate }));
  }
  for (const [field, c] of Object.entries(h.confidence)) {
    if (c < LOW_CONFIDENCE) checks.push(make("soft", "low_confidence", field, "low_confidence", { field: label(field) }));
  }
  x.lines.forEach((l, i) => {
    const line = lineLabel(i, l);
    if (l.confidence < LOW_CONFIDENCE) checks.push(make("soft", "low_confidence", `lines[${i}]`, "low_confidence", { field: line }));
    if (l.unitsApproved < l.unitsRequested) checks.push(make("soft", "reduced", `lines[${i}]`, "reduced", { line }));
    if (round2(l.approvedAmount + l.patientShare) - round2(l.grossPerUnit * l.unitsApproved) > TOLERANCE + 1e-9) {
      checks.push(make("soft", "over_price", `lines[${i}]`, "over_price", { line }));
    }
    const wrong = (l.teeth ?? []).find((t) => !isFdiTooth(t));
    if (wrong) checks.push(make("soft", "teeth", `lines[${i}].teeth`, "teeth", { line, tooth: wrong }));
  });
  if (ctx.matchedPatientName && typeof ctx.nameScore === "number" && ctx.nameScore < NAME_MATCH_FLOOR) {
    checks.push(make("soft", "name_mismatch", "paperPatientName", "name_mismatch", { name: ctx.matchedPatientName }));
  }
  return checks;
}
