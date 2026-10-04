/**
 * The insurance claim record: one document per insurer approval, in
 * `clinics/{clinicId}/insurance_claims/{claimId}`.
 *
 * The id is the approval number itself (`metlife_d6000001`), so the same paper can never be saved
 * twice — from two tabs, or by two receptionists — and a re-read of a saved paper finds its claim.
 *
 * Pure: no Firestore, no SDK. The claims route (`/api/insurance/claims`) builds the record here and
 * adds the stamps (`createdAt`, `updatedAt`, `sentAt`, who) itself.
 */

import { normalizeMetlife, type MetlifeExtraction, type MetlifeHeader, type MetlifeLine } from "./metlife";
import { commissionRateFor, type CommissionRates } from "@/lib/payers";
import { readInsurance, writeInsurance, type PatientInsuranceEntry } from "../patientInsurance";

export const CLAIMS_COLLECTION = "insurance_claims";
export const DOCS_COLLECTION = "insurance_docs";
export const WORDING_DOC = "insurance_wording";

export type ClaimStatus = "approved" | "treated" | "sent" | "cancelled";
export const CLAIM_STATUSES: readonly ClaimStatus[] = ["approved", "treated", "sent", "cancelled"];

/** The paper's header fields that live in `metlife` on the claim; the rest sit on the claim itself. */
export type ClaimMetlife = Omit<MetlifeHeader, "approvalNumber" | "approvalDate" | "paperPatientName" | "confidence">;

export type InsuranceClaim = {
  id: string;
  payerId: string;
  insurer: "metlife";
  approvalNumber: string;
  approvalDate: string;
  status: ClaimStatus;
  treatedDate: string | null;
  patientId: string;
  patientName: string;
  paperPatientName: string;
  metlife: ClaimMetlife;
  lines: MetlifeLine[];
  totals: { requested: number; approved: number; patientShare: number };
  doc: { path: string; contentType: string; bytes: number; pages: number | null };
  /**
   * Who did each service line, keyed by the line's index, with the rate and share stamped at
   * assignment time — a payroll figure that moved when a setting changed is a figure nobody
   * can sign. Lines with no entry are unassigned. Never printed on the insurer's sheet.
   */
  dentists: Record<number, LineDentist>;
  /**
   * Where each service line stands, keyed by the line's index, as the clinical editor words it.
   * A line with no entry is `Completed` (`lineStatusOf`), so a claim saved before states existed
   * reads exactly as it did. Only Completed lines go on the insurer's sheet and into payroll.
   */
  lineStatus: Record<number, LineStatus>;
  /** The patient's share, once the desk took it as cash; null until then. */
  shareCollected: ShareCollected | null;
  /**
   * The treatment rows this approval wrote into the patient's file, keyed by line index: the
   * clinical note and its ledger charge. Lines the insurer rejected outright (nothing approved,
   * no patient share) have no row.
   */
  ledgerIds: Record<number, LineLedger>;
  /** Stamped when the insurer's payment was recorded against those rows; null until then. */
  insurerPaid: InsurerPaid | null;
};

/** A service line's state, in the clinical editor's own words (the note's `status`). */
export type LineStatus = "Completed" | "Planned" | "Ongoing";
export const LINE_STATUSES: readonly LineStatus[] = ["Completed", "Planned", "Ongoing"];

export type LineLedger = { ledgerId: string; noteId: string };
export type InsurerPaid = { date: string; amount: number };

export type LineDentist = { staffId: string; name: string; rate: number; share: number };
export type ShareCollected = { ledgerId: string; amount: number; date: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isClaimStatus(v: unknown): v is ClaimStatus {
  return typeof v === "string" && (CLAIM_STATUSES as readonly string[]).includes(v);
}

/** A real `yyyy-mm-dd` calendar day? */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** `("metlife", " D-6000001 ")` → `metlife_d6000001`: lower-case, non-alphanumerics stripped. */
export function claimDocId(insurer: string, approvalNumber: string): string {
  const tidy = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${tidy(insurer)}_${tidy(approvalNumber)}`;
}

/** What the statement adds up: the lines, never a printed total the model may have misread. */
export function claimTotals(lines: readonly MetlifeLine[]): InsuranceClaim["totals"] {
  const sum = (pick: (l: MetlifeLine) => number) => round2(lines.reduce((t, l) => t + pick(l), 0));
  return { requested: sum((l) => l.grossTotal), approved: sum((l) => l.approvedAmount), patientShare: sum((l) => l.patientShare) };
}

function trimmed(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The paper's lone dash means "empty", as in the reader. */
const LONE_DASH = /^[-–—]$/;

function plain(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
  return LONE_DASH.test(t) ? "" : t;
}

/**
 * The extraction the confirm card posts back, read again on the server.
 *
 * `normalizeMetlife` splits the printed "6481234567 - EXAMPLE TRAVEL" into number and employer, so on
 * an already-normalised extraction the employer (and the physician, from the provider line) would
 * come back empty, and a policy number typed with a dash in it would be cut in two. A header that
 * already carries `employer` (or `physician`) is in the split shape: its pair is taken as posted.
 * Everything else is `normalizeMetlife` unchanged, which is idempotent on its own output.
 */
export function normalizeConfirmed(raw: unknown): MetlifeExtraction {
  const x = normalizeMetlife(raw);
  const h = isRecord(raw) && isRecord(raw.header) ? raw.header : {};
  const header: MetlifeHeader = { ...x.header };
  if (typeof h.employer === "string") {
    header.policyNumber = plain(h.policyNumber);
    header.employer = plain(h.employer);
  }
  if (typeof h.physician === "string") {
    header.providerCode = plain(h.providerCode).toUpperCase();
    header.physician = plain(h.physician);
  }
  return { header, lines: x.lines };
}

/** The header fields kept under `metlife`, in a fixed order. */
export function claimMetlifeFrom(h: MetlifeHeader): ClaimMetlife {
  return {
    policyNumber: h.policyNumber,
    employer: h.employer,
    certificateNumber: h.certificateNumber,
    dependentCode: h.dependentCode,
    paperPatientNameAr: h.paperPatientNameAr,
    providerCode: h.providerCode,
    physician: h.physician,
    statusText: h.statusText,
    diagnosisCode: h.diagnosisCode,
    estimatedCost: h.estimatedCost,
    requestedTotal: h.requestedTotal,
    approvedTotal: h.approvedTotal,
    patientShareTotal: h.patientShareTotal,
    collectNote: h.collectNote,
    terminationDate: h.terminationDate,
    comment: h.comment,
  };
}

/**
 * The claim to store, from a confirmed extraction. The caller has already run the hard checks, so the
 * approval number and date are real; a missing date is stored as "" rather than invented.
 */
export function claimFromExtraction(args: {
  payerId: string;
  extraction: MetlifeExtraction;
  patientId: string;
  patientName: string;
  status: ClaimStatus;
  treatedDate: string | null;
  doc: InsuranceClaim["doc"];
}): Omit<InsuranceClaim, "id"> {
  const h = args.extraction.header;
  const lines = args.extraction.lines.map((l) => ({ ...l }));
  return {
    payerId: args.payerId,
    insurer: "metlife",
    approvalNumber: h.approvalNumber,
    approvalDate: h.approvalDate ?? "",
    status: args.status,
    treatedDate: args.treatedDate,
    patientId: args.patientId,
    patientName: args.patientName,
    paperPatientName: h.paperPatientName,
    metlife: claimMetlifeFrom(h),
    lines,
    totals: claimTotals(lines),
    doc: {
      path: args.doc.path,
      contentType: args.doc.contentType,
      bytes: args.doc.bytes,
      pages: args.doc.pages,
    },
    dentists: {},
    lineStatus: {},
    shareCollected: null,
    ledgerIds: {},
    insurerPaid: null,
  };
}

function parseDoc(raw: unknown): InsuranceClaim["doc"] {
  const d = isRecord(raw) ? raw : {};
  const bytes = typeof d.bytes === "number" && Number.isFinite(d.bytes) && d.bytes >= 0 ? d.bytes : 0;
  const pages = typeof d.pages === "number" && Number.isFinite(d.pages) && d.pages > 0 ? d.pages : null;
  return { path: typeof d.path === "string" ? d.path : "", contentType: typeof d.contentType === "string" ? d.contentType : "", bytes, pages };
}

/**
 * A stored claim, or null when it is not one: an unknown status, no patient, no approval number, a
 * malformed date. Lines and the `metlife` header are read through the reader's own normaliser, so a
 * hand-edited document cannot smuggle in a string where a number belongs; totals are recomputed from
 * the lines.
 */
export function parseClaim(id: string, raw: unknown): InsuranceClaim | null {
  if (!id || !isRecord(raw)) return null;
  const r = raw;
  if (r.insurer !== "metlife") return null;
  if (!isClaimStatus(r.status)) return null;
  const payerId = trimmed(r.payerId);
  const patientId = trimmed(r.patientId);
  const approvalNumber = trimmed(r.approvalNumber);
  if (!payerId || !patientId || !approvalNumber) return null;
  const approvalDate = typeof r.approvalDate === "string" ? r.approvalDate : "";
  if (approvalDate !== "" && !isIsoDate(approvalDate)) return null;
  const treatedDate = r.treatedDate === null || r.treatedDate === undefined ? null : r.treatedDate;
  if (treatedDate !== null && !isIsoDate(treatedDate)) return null;
  if (!Array.isArray(r.lines) || !isRecord(r.metlife)) return null;

  const x = normalizeConfirmed({ header: r.metlife, lines: r.lines });
  return {
    id,
    payerId,
    insurer: "metlife",
    approvalNumber,
    approvalDate,
    status: r.status,
    treatedDate,
    patientId,
    patientName: typeof r.patientName === "string" ? r.patientName : "",
    paperPatientName: typeof r.paperPatientName === "string" ? r.paperPatientName : "",
    metlife: claimMetlifeFrom(x.header),
    lines: x.lines,
    totals: claimTotals(x.lines),
    doc: parseDoc(r.doc),
    dentists: parseLineDentists(r.dentists, x.lines.length),
    lineStatus: parseLineStatus(r.lineStatus, x.lines.length),
    shareCollected: parseShareCollected(r.shareCollected),
    ledgerIds: parseLineLedger(r.ledgerIds, x.lines.length),
    insurerPaid: parseInsurerPaid(r.insurerPaid),
  };
}

// --- Edits and the patient's membership ------------------------------------------------------------

/**
 * The treated date a status change implies. `undefined` means "leave the stored one".
 *
 * - `approved` (not treated yet): always null, whatever date came with it.
 * - `treated`: the date sent, else the one already stored, else the approval date (the card's default).
 * - `sent`: sent work was done, so a claim with no treated date yet gets one exactly as `treated` does
 *   (the date sent, else the approval date); one that has a date keeps it unless a new one is sent.
 * - anything else, or no status change: the date sent when one was sent, else unchanged.
 */
export function treatedDateAfter(args: {
  status?: ClaimStatus;
  treatedDate?: string | null;
  current: string | null;
  approvalDate: string;
}): string | null | undefined {
  if (args.status === "approved") return null;
  if (args.status === "treated") {
    if (args.treatedDate) return args.treatedDate;
    return args.current ?? (args.approvalDate || null);
  }
  if (args.status === "sent" && args.current === null) {
    return args.treatedDate || args.approvalDate || null;
  }
  return args.treatedDate === undefined ? undefined : args.treatedDate;
}

/**
 * The claim as an extraction again, with an edit's `lines` and/or `metlife` laid over it, so the
 * reader's hard checks can be run on what the claim would become. The claim's own approval number,
 * date and paper name always win over anything in the patched `metlife`; no header confidence is
 * carried (a saved claim was already looked at by a person).
 */
export function claimExtraction(claim: InsuranceClaim, patch: { lines?: unknown[]; metlife?: Record<string, unknown> } = {}): MetlifeExtraction {
  const header = normalizeConfirmed({
    header: {
      // claim.metlife carries employer and physician, so this is the split shape normalizeConfirmed keeps.
      ...claim.metlife,
      ...(patch.metlife ?? {}),
      approvalNumber: claim.approvalNumber,
      approvalDate: claim.approvalDate,
      paperPatientName: claim.paperPatientName,
      confidence: {},
    },
    lines: [],
  }).header;
  const lines = patch.lines ? normalizeMetlife({ lines: patch.lines }).lines : claim.lines.map((l) => ({ ...l }));
  return { header, lines };
}

/**
 * What to write to `patients/{id}.insurance.{payerId}` for this paper, or null when the stored entry
 * already says the same (or the payer id is not storable). The paper's certificate, dependent code and
 * policy number win; a policy number the paper leaves blank keeps the one the clinic typed.
 */
export function insuranceEntryToWrite(
  payerId: string,
  paper: { certificateNumber: string; dependentCode: string; policyNumber: string },
  patient: Record<string, unknown>,
): PatientInsuranceEntry | null {
  const stored = readInsurance(patient)[payerId];
  const entry = writeInsurance({
    [payerId]: {
      memberNumber: "",
      certificateNumber: paper.certificateNumber,
      dependentCode: paper.dependentCode,
      policyNumber: paper.policyNumber || stored?.policyNumber || "",
    },
  })[payerId];
  if (!entry) return null;
  const same = stored && (["memberNumber", "certificateNumber", "dependentCode", "policyNumber"] as const).every((k) => (stored[k] ?? "") === (entry[k] ?? ""));
  return same ? null : entry;
}

// --- The dentist on each line, and the patient's share ---------------------------------------------

/** `dentists` as stored: a map of line index -> entry; junk and out-of-range indices are dropped. */
export function parseLineDentists(raw: unknown, lineCount: number): Record<number, LineDentist> {
  const out: Record<number, LineDentist> = {};
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= lineCount || !isRecord(v)) continue;
    const staffId = trimmed(v.staffId);
    if (!staffId) continue;
    const rate = Number(v.rate);
    const share = Number(v.share);
    out[i] = {
      staffId,
      name: typeof v.name === "string" ? v.name : "",
      rate: Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 100) : 0,
      share: Number.isFinite(share) ? round2(share) : 0,
    };
  }
  return out;
}

export function isLineStatus(v: unknown): v is LineStatus {
  return typeof v === "string" && (LINE_STATUSES as readonly string[]).includes(v);
}

/** `lineStatus` as stored: a map of line index -> state; junk and out-of-range indices are dropped. */
export function parseLineStatus(raw: unknown, lineCount: number): Record<number, LineStatus> {
  const out: Record<number, LineStatus> = {};
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= lineCount || !isLineStatus(v)) continue;
    out[i] = v;
  }
  return out;
}

/** A line's state: what was stored for it, else `Completed` (every claim saved before states existed). */
export function lineStatusOf(claim: Pick<InsuranceClaim, "lineStatus">, lineIndex: number): LineStatus {
  return claim.lineStatus?.[lineIndex] ?? "Completed";
}

export function parseShareCollected(raw: unknown): ShareCollected | null {
  if (!isRecord(raw)) return null;
  const ledgerId = trimmed(raw.ledgerId);
  const amount = Number(raw.amount);
  if (!ledgerId || !Number.isFinite(amount) || amount <= 0) return null;
  return { ledgerId, amount: round2(amount), date: isIsoDate(raw.date) ? raw.date : "" };
}

/**
 * The entry to stamp when a dentist is picked for a line: their rate on this payer, and the share
 * that rate earns on the line's APPROVED amount (the owner's rule: approved, not requested, and not
 * what the insurer eventually pays).
 */
export function lineDentistFor(
  line: { approvedAmount: number },
  staff: { id: string; name: string } & CommissionRates,
  payerId: string,
): LineDentist {
  const rate = commissionRateFor(staff, payerId);
  return { staffId: staff.id, name: staff.name, rate, share: round2((line.approvedAmount * rate) / 100) };
}

/**
 * Apply a set of picks to the stored map: a staff id assigns the line, null clears it, lines not
 * named keep what they had. Returns the new map, never mutating the old one.
 */
export function applyDentistPicks(
  claim: Pick<InsuranceClaim, "lines" | "dentists" | "payerId">,
  picks: Record<string, string | null>,
  staffById: ReadonlyMap<string, { id: string; name: string } & CommissionRates>,
): { dentists: Record<number, LineDentist>; unknownStaff: string[] } {
  const dentists: Record<number, LineDentist> = { ...claim.dentists };
  const unknownStaff: string[] = [];
  for (const [k, staffId] of Object.entries(picks)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= claim.lines.length) continue;
    if (staffId === null) {
      delete dentists[i];
      continue;
    }
    const staff = staffById.get(staffId);
    if (!staff) {
      unknownStaff.push(staffId);
      continue;
    }
    dentists[i] = lineDentistFor(claim.lines[i], staff, claim.payerId);
  }
  return { dentists, unknownStaff };
}

export function parseLineLedger(raw: unknown, lineCount: number): Record<number, LineLedger> {
  const out: Record<number, LineLedger> = {};
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= lineCount || !isRecord(v)) continue;
    const ledgerId = trimmed(v.ledgerId);
    const noteId = trimmed(v.noteId);
    if (!ledgerId || !noteId) continue;
    out[i] = { ledgerId, noteId };
  }
  return out;
}

export function parseInsurerPaid(raw: unknown): InsurerPaid | null {
  if (!isRecord(raw)) return null;
  const amount = Number(raw.amount);
  if (!isIsoDate(raw.date) || !Number.isFinite(amount) || amount < 0) return null;
  return { date: raw.date, amount: round2(amount) };
}

// --- The treatment rows an approval writes into the patient's file --------------------------------

/** What a line is worth to the clinic: the insurer's approved part plus what the patient pays. */
export function lineCharge(line: Pick<MetlifeLine, "approvedAmount" | "patientShare">): number {
  return round2(line.approvedAmount + line.patientShare);
}

export type TreatmentRowArgs = {
  claimId: string;
  claim: Pick<InsuranceClaim, "payerId" | "approvalNumber" | "approvalDate" | "treatedDate" | "patientId" | "patientName" | "lines" | "dentists" | "lineStatus">;
  payerName: string;
  /** The clinic's own name per code, else the paper's description prints. */
  wording: Record<string, string>;
  actor: { uid: string; name: string; role: string };
};

export type TreatmentRow = {
  lineIndex: number;
  note: Record<string, unknown>;
  charge: Record<string, unknown>;
};

/**
 * One clinical note and one ledger charge per line the insurer approved (or the patient pays for),
 * in the shape `/api/clinical/procedures` writes, so every report, the patient's finance tab and
 * the payer report read them as ordinary treatments under this insurer.
 *
 * The charge is what the clinic will actually receive — the approved amount plus the patient's
 * share. The paper's requested figure is kept as the list price, and the gap as a discount with
 * its reason, so a crown asked at 2,700 and approved at 500 is not silently a 500 crown.
 *
 * The dentist's share is NOT the ordinary commission-on-payment: by the owner's rule it is the
 * stamped rate on the approved amount, earned when the line is assigned. It is written onto the
 * charge so the row reads correctly, and the payments made later carry no commission of their own.
 */
export function insuranceTreatmentRows(args: TreatmentRowArgs): TreatmentRow[] {
  const { claim, claimId, payerName, wording, actor } = args;
  const out: TreatmentRow[] = [];
  claim.lines.forEach((line, i) => {
    const charge = lineCharge(line);
    if (charge <= 0) return;
    const name = wording[line.code]?.trim() || line.description.trim() || line.code;
    const dentist = claim.dentists[i] ?? null;
    const units = Math.max(1, line.unitsApproved || line.unitsRequested || 1);
    const unitCost = round2(charge / units);
    const listPrice = round2(line.grossTotal);
    const discountAmount = Math.max(0, round2(listPrice - charge));
    const commissionAmount = dentist ? dentist.share : 0;
    const base = {
      cost: charge,
      unitCost,
      unitsCount: units,
      pricingFormula: `${units} x ${unitCost}`,
      pricingMode: "flat",
      listPrice,
      priceListId: null,
      priceListName: null,
      // The app's own discount vocabulary ("percent" | "fixed" | "none"): an unknown mode reads
      // as no discount, and any editor that re-saved the row would then charge the full list price.
      discountMode: discountAmount > 0 ? "fixed" : "none",
      discountFixed: discountAmount > 0 ? discountAmount : null,
      discountPercent: null,
      discountValue: discountAmount > 0 ? discountAmount : null,
      discountAmount,
      discountReason: discountAmount > 0 ? `${payerName} approved ${round2(line.approvedAmount)} of ${listPrice}` : null,
      payerId: claim.payerId,
      payerName,
      doctorId: dentist?.staffId ?? null,
      serviceId: null,
      serviceIds: [] as string[],
      serviceName: name,
      // The day the work was done: the treated date, else the approval's own date.
      date: claim.treatedDate ?? claim.approvalDate,
      claimId,
      approvalNumber: claim.approvalNumber,
      serviceCode: line.code,
      insurerCovered: round2(line.approvedAmount),
      patientShare: round2(line.patientShare),
    };
    out.push({
      lineIndex: i,
      note: {
        patientId: claim.patientId,
        appointmentId: null,
        tooth: "Gen",
        procedure: name,
        procedures: [name],
        ...base,
        note: `${payerName} approval ${claim.approvalNumber}`,
        doctor: dentist?.name ?? "",
        unmatchedProcedures: [] as string[],
        // The line's own state. Every line gets its row whatever the state (the charge exists
        // either way, as the clinical editor does); the ledger row carries no status of its own.
        status: lineStatusOf(claim, i),
        createdByUid: actor.uid,
        createdByName: actor.name,
        createdByRole: actor.role,
      },
      charge: {
        patientId: claim.patientId,
        patientName: claim.patientName,
        type: "procedure",
        category: "Treatment",
        amount: charge,
        ...base,
        description: `${name} (T: Gen) | ${payerName} ${claim.approvalNumber}`,
        doctorName: dentist?.name ?? "",
        doctorCommissionPercentage: dentist?.rate ?? 0,
        doctorCommissionAmount: commissionAmount,
        clinicProfit: round2(charge - commissionAmount),
        labFee: 0,
        labFeePerUnit: 0,
        labOrderService: "",
        appointmentId: null,
        paid: 0,
        createdBy: actor.uid,
      },
    });
  });
  return out;
}

/**
 * What a payment against a treatment row may actually be: what was asked, capped at what is still
 * open on the row (its cost less the payments already against it), never below zero. A row the
 * patient already paid in full at the counter takes nothing more from the insurer's settlement.
 */
export function cappedPayment(wanted: number, cost: number, alreadyPaid: number): number {
  const open = round2(Number(cost) - Number(alreadyPaid));
  return Math.max(0, round2(Math.min(Number(wanted) || 0, Number.isFinite(open) ? open : 0)));
}

/**
 * What a status change does to the treatment rows an approval writes.
 *
 * - `write`: the claim becomes `treated` or `sent` and has no rows yet — the work is done (a claim
 *   sent to the insurer was treated, even if nobody marked it so first), record it.
 * - `remove`: the claim goes back to `approved` or is `cancelled` while rows exist — the work did
 *   not happen (the caller refuses when any row already has money against it).
 * - `none`: anything else, including `treated` ↔ `sent` and a claim that already has its rows.
 */
export function rowsActionForStatus(args: { from: ClaimStatus; to: ClaimStatus | undefined; hasRows: boolean }): "write" | "remove" | "none" {
  const { from, to, hasRows } = args;
  if (to === undefined || to === from) return "none";
  if ((to === "treated" || to === "sent") && !hasRows) return "write";
  if ((to === "approved" || to === "cancelled") && hasRows) return "remove";
  return "none";
}

/** The doctor fields to write on an existing row when a line's dentist changes. */
export function dentistRowPatch(line: Pick<MetlifeLine, "approvedAmount" | "patientShare">, dentist: LineDentist | null): Record<string, unknown> {
  const charge = lineCharge(line);
  const commissionAmount = dentist ? dentist.share : 0;
  return {
    doctorId: dentist?.staffId ?? null,
    doctorName: dentist?.name ?? "",
    doctor: dentist?.name ?? "",
    doctorCommissionPercentage: dentist?.rate ?? 0,
    doctorCommissionAmount: commissionAmount,
    clinicProfit: round2(charge - commissionAmount),
  };
}
