/**
 * The AXA Egypt dental approval reader.
 *
 * AXA's dental network runs on the Yodawy portal, and what the clinic keeps is the portal's "Service
 * Claim Reference" (claim form) printed once the service is approved and performed: a header of
 * request / approval / dispense / claim numbers, the policy and 12-character card, the Dental Cop %,
 * the provider, the deciding doctor and the diagnosis; then one row per service with its tooth, the
 * quantities asked, approved and performed, the price, a discount and the net; then the totals and
 * the split "By Patient" / "By Insurer".
 *
 * It is read onto the SAME record MetLife's reader produces (`MetlifeExtraction`), as NextCare's paper
 * is, so saving, the patient file, dentists, collecting the share and the booking popup all work
 * unchanged:
 *   - approval number      → `approvalNumber` (the claim id); claim number kept beside it
 *   - service date         → `approvalDate` (the paper is printed the day the work is done)
 *   - card number          → `certificateNumber` (the card alone finds the patient again)
 *   - employee code        → `dependentCode` (usually a dash: empty)
 *   - By Insurer           → `approvedTotal`; By Patient → `patientShareTotal`
 *   - each line's net      → split by the Dental Cop % into `approvedAmount` and `patientShare`
 *   - tags                 → the line's `comment`; provider note → the header's `comment`
 *   - Tooth No (LR7)       → the line's `teeth` (FDI 47)
 *
 * AXA prints no service codes: `code` stays empty and the paper's own service name is the description.
 * Only one sample exists and it is 0% co-pay, so the per-line split is the simplest rule that fits;
 * the two printed totals are hard checks, so a paper the rule gets wrong is caught before it is saved.
 */
import { parseMoney, type Check, type MetlifeExtraction, type MetlifeHeader, type MetlifeLine } from "./metlife";
import { isFdiTooth, quadrantTeeth } from "./nextcare";

export const AXA_FORMAT = "axa";

/** `13242928`: digits only, at least six of them. */
export const AXA_APPROVAL_RE = /^\d{6,}$/;

/** Twelve hex characters: `5110298267E0`. */
const CARD_RE = /^[0-9A-F]{12}$/;

// --- What the model is asked for ------------------------------------------------------------------

const CONFIDENCE_FIELDS = ["approvalNumber", "serviceDate", "cardNumber", "policyNumber", "paperPatientName", "byInsurer", "byPatient"] as const;

const str = { type: "STRING" } as const;
const strOrNull = { type: "STRING", nullable: true } as const;
const numOrNull = { type: "NUMBER", nullable: true } as const;
const num = { type: "NUMBER" } as const;

const HEADER_KEYS = [
  "approvalNumber",
  "requestNumber",
  "dispenseNumber",
  "claimNumber",
  "serviceDate",
  "statusText",
  "payerName",
  "paperPatientName",
  "paperPatientNameAr",
  "policyNumber",
  "cardNumber",
  "employeeCode",
  "copayPercent",
  "providerName",
  "decisionBy",
  "diagnosis",
  "payerNote",
  "providerNote",
  "totalPerformed",
  "discountTotal",
  "totalNet",
  "overLimit",
  "copayTotal",
  "byPatient",
  "byInsurer",
  "confidence",
];
const LINE_KEYS = ["serviceName", "toothNo", "qty", "unitPrice", "totalPrice", "approvedQty", "totalApproved", "performedQty", "totalPerformed", "discount", "netAmount", "tags", "confidence"];

/** The JSON schema handed to Gemini. Plain data; the strings match the SDK's SchemaType names. */
export const AXA_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    header: {
      type: "OBJECT",
      properties: {
        approvalNumber: str,
        requestNumber: str,
        dispenseNumber: str,
        claimNumber: str,
        serviceDate: strOrNull,
        statusText: str,
        payerName: str,
        paperPatientName: str,
        paperPatientNameAr: str,
        policyNumber: str,
        cardNumber: str,
        employeeCode: str,
        copayPercent: str,
        providerName: str,
        decisionBy: str,
        diagnosis: str,
        payerNote: str,
        providerNote: str,
        totalPerformed: strOrNull,
        discountTotal: strOrNull,
        totalNet: strOrNull,
        overLimit: strOrNull,
        copayTotal: strOrNull,
        byPatient: strOrNull,
        byInsurer: strOrNull,
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
          serviceName: str,
          toothNo: str,
          qty: numOrNull,
          unitPrice: numOrNull,
          totalPrice: numOrNull,
          approvedQty: numOrNull,
          totalApproved: numOrNull,
          performedQty: numOrNull,
          totalPerformed: numOrNull,
          discount: numOrNull,
          netAmount: numOrNull,
          tags: str,
          confidence: num,
        },
        required: LINE_KEYS,
      },
    },
  },
  required: ["header", "lines"],
};

export function buildAxaPrompt(): string {
  return [
    "You are reading an AXA Egypt dental claim form: the 'Service Claim Reference CR (claim form)' printed from the Yodawy portal for one patient's visit. It is a PDF page or a photo of the paper, in English.",
    "The page may be skewed, rotated, folded, photographed at an angle, faint or partly covered. Read it carefully anyway.",
    "",
    "Return the header fields and the service table as JSON in the schema you were given.",
    "- approvalNumber: the digits beside 'Approval Number' in the top-right box. requestNumber: beside 'Request Number'. dispenseNumber: beside 'Dispense Number'. claimNumber: beside 'Claim Number' in the left box. Read each number digit by digit, twice; 6 and 8, 1 and 7, 3 and 8, 0 and 9 are easily confused on a photo. If any digit is not crisp, lower its confidence well below 0.7.",
    "- serviceDate: the text beside 'Service Time/Date', copied as printed (for example 17/08/2026 09:43:50 PM). The year has four digits: read them one by one, twice (2024 and 2026 are easily confused on a photo), and lower the confidence if the last digit is not crisp.",
    "- statusText: the status line under the title (for example 'Status completed'). payerName: the text beside 'Payer' (for example axa).",
    "- paperPatientName: the patient's name printed in Latin capitals near the top-left. paperPatientNameAr: the same name written in Arabic the way an Egyptian dental clinic writes patient names, common spellings, no diacritics.",
    "- policyNumber: beside 'Policy Number', with its slashes (for example 2025/12995001/01). Read every digit the same careful way.",
    "- cardNumber: beside 'Card Number': twelve characters, each a digit 0-9 or a letter A-F. It is what finds this patient again, so read it character by character, twice. D and 0, B and 8, 6 and 8, E and F, C and 0 are easily confused: look at each one; if any character is not crisp, lower its confidence well below 0.7.",
    "- employeeCode: beside 'Employee Code' (a dash means empty). copayPercent: beside 'Dental Cop%' as printed (for example 0% or 20%).",
    "- providerName: beside 'Provider Name'. decisionBy: beside 'Decision By'. diagnosis: beside 'Diagnosis', code and words (for example K02 - dental caries).",
    "- payerNote and providerNote: the text beside 'Payer Note' and 'Provider Note' (empty when blank).",
    "- The service table: copy it row by row in the order printed, one entry per row. serviceName: the 'Service Name' text (without the 'Tooth No' line). toothNo: the text after 'Tooth No:' on that row, as printed (for example LR7; empty when blank). qty, unitPrice, totalPrice, approvedQty, totalApproved, performedQty, totalPerformed, discount, netAmount: the row's columns Qty, Unit Price, Total Price, Approved Qty, Total Approved, Perf. Qty, Total Perf, Discount, Net Amount. tags: the 'Tags:' line printed under the row (for example Service Requires Manual Review; empty when blank).",
    "- The totals box at the bottom: totalPerformed ('Total Performed'), discountTotal ('Discount'), totalNet ('Total Net'), overLimit ('Limit Surpass (Over Limit)'), copayTotal ('Dental Cop'), byPatient ('By Patient'), byInsurer ('By Insurer'). Copy the figures as printed, EGP and all; never return a total as a service row.",
    "- Do not do arithmetic and do not merge, skip or reorder rows: copy the printed numbers. A dash or a blank means empty: an empty string for text, null for a number or date.",
    "- Do NOT return any national ID number or date of birth anywhere.",
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

/** `17/08/2026 09:43:50 PM` (as the portal prints), `17-08-2026`, or `2026-08-17` → ISO; the clock is dropped. */
export function parseAxaDate(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  let m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[\sT].*)?$/.exec(t);
  if (m) return isoIfReal(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[\sT].*)?$/.exec(t);
  if (m) return isoIfReal(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** `0%`, `20 %`, `20` → 20; anything else → null. */
export function parsePercent(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? round2(v) : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/%/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return round2(Number(t));
}

/** The portal's "2,951.00 EGP" / "0.00EGP" → a number; `parseMoney` already strips a leading EGP. */
function money(v: unknown): number | null {
  if (typeof v === "string") return parseMoney(v.replace(/\s*EGP\s*$/i, "").trim());
  return parseMoney(v);
}

/** `LR7`, `LR 6-7`, `LR7, UR6`, `URE` → FDI codes, in the order written. The same shorthand NextCare uses. */
export function axaTeeth(toothNo: unknown): string[] {
  const t = text(toothNo);
  if (!t) return [];
  const out: string[] = [];
  for (const code of quadrantTeeth(t).flat()) if (!out.includes(code)) out.push(code);
  return out;
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
 * The model's AXA-shaped JSON → the shared record's shape (still raw values). `normalizeAxa` then tidies
 * it. Kept apart so the confirm card and the server, which post and re-read the shared shape, never go
 * through this mapping twice.
 */
export function fromAxaModel(raw: unknown): Record<string, unknown> {
  const root = isRecord(raw) ? raw : {};
  const h = isRecord(root.header) ? root.header : {};
  const rawLines = Array.isArray(root.lines) ? root.lines : [];
  const copay = parsePercent(h.copayPercent) ?? 0;
  const lines = rawLines.map((r) => {
    const l = isRecord(r) ? r : {};
    const qty = money(l.qty);
    const price = money(l.unitPrice);
    const approvedQty = money(l.approvedQty);
    const totalApproved = money(l.totalApproved);
    const discount = money(l.discount) ?? 0;
    let net = money(l.netAmount);
    // Nothing approved pays nothing; otherwise the net is the approved total less the discount.
    if (net === null && approvedQty === 0) net = 0;
    if (net === null && totalApproved !== null) net = round2(totalApproved - discount);
    const share = net === null ? null : round2((net * copay) / 100);
    return {
      code: "",
      description: l.serviceName,
      teeth: axaTeeth(l.toothNo),
      unitsRequested: qty ?? l.qty,
      grossPerUnit: price ?? l.unitPrice,
      grossTotal: money(l.totalPrice) ?? (qty !== null && price !== null ? round2(qty * price) : null),
      unitsApproved: approvedQty ?? l.approvedQty,
      patientShare: share,
      approvedAmount: net === null ? null : round2(net - share!),
      comment: l.tags,
      confidence: l.confidence,
    };
  });
  const confidence = isRecord(h.confidence) ? h.confidence : {};
  const notes = [text(h.providerNote)].filter(Boolean);
  return {
    header: {
      approvalNumber: h.approvalNumber,
      claimNumber: h.claimNumber,
      approvalDate: h.serviceDate,
      insurerName: text(h.payerName).toUpperCase() || "AXA",
      policyNumber: h.policyNumber,
      employer: "",
      certificateNumber: h.cardNumber,
      dependentCode: h.employeeCode,
      paperPatientName: h.paperPatientName,
      paperPatientNameAr: h.paperPatientNameAr,
      providerCode: "",
      physician: h.providerName,
      statusText: h.statusText,
      diagnosisCode: h.diagnosis,
      estimatedCost: null,
      requestedTotal: money(h.totalPerformed),
      approvedTotal: money(h.byInsurer),
      patientShareTotal: money(h.byPatient),
      collectNote: null,
      terminationDate: null,
      comment: notes.join("\n"),
      copayPercent: copay,
      overLimit: money(h.overLimit),
      memberCode: "",
      confidence: {
        approvalNumber: confidence.approvalNumber,
        approvalDate: confidence.serviceDate,
        certificateNumber: confidence.cardNumber,
        policyNumber: confidence.policyNumber,
        paperPatientName: confidence.paperPatientName,
        approvedTotal: confidence.byInsurer,
        patientShareTotal: confidence.byPatient,
      },
    },
    lines,
  };
}

const HEADER_CONFIDENCE = ["approvalNumber", "approvalDate", "certificateNumber", "policyNumber", "paperPatientName", "approvedTotal", "patientShareTotal"];

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

function normalizeLine(raw: unknown): MetlifeLine {
  const r = isRecord(raw) ? raw : {};
  let c = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
  if ([r.unitsRequested, r.grossPerUnit, r.unitsApproved, r.patientShare, r.approvedAmount].some((n) => parseMoney(n) === null)) c = 0;
  const unitsRequested = moneyOr0(r.unitsRequested);
  const grossPerUnit = moneyOr0(r.grossPerUnit);
  const printedGross = parseMoney(r.grossTotal);
  return {
    code: text(r.code).toUpperCase(),
    description: text(r.description).replace(/\s+/g, " "),
    unitsRequested,
    grossPerUnit,
    grossTotal: printedGross ?? round2(unitsRequested * grossPerUnit),
    unitsApproved: moneyOr0(r.unitsApproved),
    patientShare: moneyOr0(r.patientShare),
    approvedAmount: moneyOr0(r.approvedAmount),
    comment: text(r.comment),
    confidence: c,
    teeth: cleanTeeth(r.teeth),
  };
}

/** "Status completed" / "Completed" → "completed"; the word the checks look for. */
function statusWord(v: unknown): string {
  return text(v).replace(/^status\s*:?\s*/i, "").trim().toLowerCase();
}

/**
 * The shared record's shape → typed and tidy. Accepts both the mapped model output (`fromAxaModel`) and
 * an already-normalised extraction (what the card posts, what a stored claim holds): it is idempotent.
 */
export function normalizeAxa(raw: unknown): MetlifeExtraction {
  const root = isRecord(raw) ? raw : {};
  const h = isRecord(root.header) ? root.header : {};
  const header: MetlifeHeader = {
    approvalNumber: text(h.approvalNumber).replace(/\s+/g, ""),
    approvalDate: parseAxaDate(h.approvalDate),
    policyNumber: text(h.policyNumber).replace(/\s+/g, ""),
    employer: text(h.employer),
    certificateNumber: text(h.certificateNumber).replace(/[\s-]+/g, "").toUpperCase(),
    dependentCode: text(h.dependentCode).replace(/\s+/g, "").toUpperCase(),
    paperPatientName: text(h.paperPatientName).replace(/\s+/g, " "),
    paperPatientNameAr: text(h.paperPatientNameAr).replace(/\s+/g, " "),
    providerCode: "",
    physician: text(h.physician).replace(/\s+/g, " "),
    statusText: statusWord(h.statusText),
    diagnosisCode: text(h.diagnosisCode).replace(/\s+/g, " "),
    estimatedCost: null,
    requestedTotal: parseMoney(h.requestedTotal),
    approvedTotal: parseMoney(h.approvedTotal),
    patientShareTotal: parseMoney(h.patientShareTotal),
    collectNote: null,
    terminationDate: null,
    comment: typeof h.comment === "string" ? h.comment.trim() : "",
    confidence: normalizeConfidence(h.confidence),
    insurerName: text(h.insurerName) || "AXA",
    memberCode: text(h.memberCode).toUpperCase(),
    claimNumber: text(h.claimNumber).replace(/\s+/g, ""),
    copayPercent: parsePercent(h.copayPercent),
    overLimit: parseMoney(h.overLimit),
  };
  const rawLines = Array.isArray(root.lines) ? root.lines : [];
  return { header, lines: rawLines.map(normalizeLine) };
}

// --- Checking it -----------------------------------------------------------------------------------------

type Text = { en: string; ar: string };

const CHECK_TEXT: Record<string, Text> = {
  approval_number: { en: "Approval number must be digits, like 13242928", ar: "رقم الموافقة لازم يكون أرقام، زي 13242928" },
  approval_date: { en: "Service date could not be read", ar: "تاريخ الخدمة مش مقروء" },
  approval_date_future: { en: "Service date is in the future", ar: "تاريخ الخدمة في المستقبل" },
  approval_date_old: { en: "Service date is {date}, more than six months ago: check the year", ar: "تاريخ الخدمة {date}، من أكتر من 6 شهور: راجع السنة" },
  card: { en: "Card number is missing", ar: "رقم البطاقة ناقص" },
  card_format: { en: "Card number does not look like 5110298267E0 (12 characters)", ar: "رقم البطاقة مش شبه 5110298267E0 (12 خانة)" },
  no_lines: { en: "No service lines were read", ar: "مفيش بنود خدمة اتقرأت" },
  approved_total_missing: { en: "Type the 'By Insurer' total from the paper", ar: "اكتب إجمالي By Insurer من الورقة" },
  sum_mismatch: { en: "The lines add up to {got} but the printed {field} is {printed}", ar: "البنود مجموعها {got} لكن {field} المطبوع {printed}" },
  status: { en: "The paper is not marked completed ({status}): the service may not be dispensed yet", ar: "الورقة مش مكتوب عليها completed ({status}): يمكن الخدمة لسه ما اتصرفتش" },
  over_limit: { en: "The paper shows {amount} over the limit: check who pays it", ar: "الورقة فيها {amount} فوق الحد: اتأكد مين بيدفعه" },
  manual_review: { en: "{line} is tagged for manual review by the insurer", ar: "{line} عليه علامة مراجعة يدوية من شركة التأمين" },
  low_confidence: { en: "The {field} was hard to read: please check it", ar: "{field} كان صعب القراءة: راجعه" },
  reduced: { en: "{line}: approved less than requested", ar: "{line}: اتوافق على أقل من المطلوب" },
  over_price: { en: "{line}: the approved amount is more than price each x units approved", ar: "{line}: المبلغ الموافق عليه أكبر من سعر الوحدة × الكمية الموافق عليها" },
  teeth: { en: "{line}: {tooth} is not a tooth number", ar: "{line}: {tooth} مش رقم سنة" },
  name_mismatch: { en: "The name on the paper does not look like {name}", ar: "الاسم في الورقة مش شبه {name}" },
};

const FIELD_LABEL: Record<string, Text> = {
  approvalNumber: { en: "approval number", ar: "رقم الموافقة" },
  approvalDate: { en: "service date", ar: "تاريخ الخدمة" },
  certificateNumber: { en: "card number", ar: "رقم البطاقة" },
  policyNumber: { en: "policy number", ar: "رقم الوثيقة" },
  paperPatientName: { en: "patient name", ar: "اسم المريض" },
  approvedTotal: { en: "'By Insurer' total", ar: "إجمالي By Insurer" },
  patientShareTotal: { en: "'By Patient' total", ar: "إجمالي By Patient" },
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
  const name = l.description || l.code || "";
  return { en: `Line ${i + 1}${name ? ` (${name})` : ""}`, ar: `البند ${i + 1}${name ? ` (${name})` : ""}` };
}

function label(field: string): Text {
  return FIELD_LABEL[field] ?? { en: field, ar: field };
}

function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function nextDay(iso: string): string {
  return shiftDays(iso, 1);
}

const OLD_PAPER_DAYS = 183;

const TOLERANCE = 0.01;
const LOW_CONFIDENCE = 0.7;
const NAME_MATCH_FLOOR = 0.5;

export type AxaCheckContext = { today: string; matchedPatientName?: string; nameScore?: number };

/**
 * Hard checks block the save, soft ones warn — the same contract as `checkMetlife`. The approval's
 * identity (number, date, card) and its money (the lines add up to By Insurer and By Patient) are hard;
 * a paper not marked completed, an over-limit amount, a manual-review tag, a reduced line, an odd tooth
 * are worth a look.
 */
export function checkAxa(x: MetlifeExtraction, ctx: AxaCheckContext): Check[] {
  const checks: Check[] = [];
  const h = x.header;
  const today = parseAxaDate(ctx.today);

  if (!AXA_APPROVAL_RE.test(h.approvalNumber)) checks.push(make("hard", "approval_number", "approvalNumber", "approval_number"));
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
  if (h.statusText && h.statusText !== "completed") checks.push(make("soft", "status", "statusText", "status", { status: h.statusText }));
  // A claim form is printed the day the work is done, so an old date is usually a misread year.
  if (today && h.approvalDate && h.approvalDate < shiftDays(today, -OLD_PAPER_DAYS)) checks.push(make("soft", "approval_date_old", "approvalDate", "approval_date_old", { date: h.approvalDate }));
  if ((h.overLimit ?? 0) > 0) checks.push(make("soft", "over_limit", "overLimit", "over_limit", { amount: String(h.overLimit) }));
  for (const [field, c] of Object.entries(h.confidence)) {
    if (c < LOW_CONFIDENCE) checks.push(make("soft", "low_confidence", field, "low_confidence", { field: label(field) }));
  }
  x.lines.forEach((l, i) => {
    const line = lineLabel(i, l);
    if (l.confidence < LOW_CONFIDENCE) checks.push(make("soft", "low_confidence", `lines[${i}]`, "low_confidence", { field: line }));
    if (/manual review/i.test(l.comment)) checks.push(make("soft", "manual_review", `lines[${i}]`, "manual_review", { line }));
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
