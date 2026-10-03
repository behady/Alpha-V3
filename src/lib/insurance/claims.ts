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
};

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
  };
}
