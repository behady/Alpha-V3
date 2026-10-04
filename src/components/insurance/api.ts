/**
 * The Insurance page's calls to its routes, and the shapes they pass around.
 *
 * Nothing on this page writes to Firestore: reads are live listeners, every write is one of these
 * calls with the signed-in user's ID token (the same `Authorization: Bearer` header every other
 * client call in the app sends). Deletes go through `deleteRecord` in `recycleBinApi`, which does
 * the same.
 *
 * Calls resolve to `{ status, data }` rather than throwing on a refusal, because the claims route
 * answers 409 in two different shapes and 400 with the checks: the caller needs the body either way.
 */

import { auth } from "@/lib/firebase";
import type { Check, MetlifeExtraction, MetlifeHeader, MetlifeLine } from "@/lib/insurance/metlife";
import type { PatientMatch } from "@/lib/insurance/matchPatient";
import type { ClaimStatus, LineStatus } from "@/lib/insurance/claims";
import type { BinNotice } from "@/lib/recycleBin";

export type ApiAnswer = { status: number; data: Record<string, unknown> };

/** Thrown only when the call could not be made: signed out, or no network. */
export class InsuranceCallError extends Error {
  kind: "signed_out" | "network";
  constructor(kind: "signed_out" | "network") {
    super(kind);
    this.name = "InsuranceCallError";
    this.kind = kind;
  }
}

async function call(method: "POST" | "PATCH", path: string, body: unknown): Promise<ApiAnswer> {
  const user = auth.currentUser;
  if (!user) throw new InsuranceCallError("signed_out");
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new InsuranceCallError("network");
  }
  let data: Record<string, unknown> = {};
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // A route that died before writing JSON: the status is all there is.
  }
  return { status: response.status, data };
}

/** What `/api/insurance/read` answers on success. */
export type ReadResult = {
  docId: string;
  extraction: MetlifeExtraction;
  checks: Check[];
  match: PatientMatch;
  duplicate: { claimId: string; savedAt: string | null } | null;
  /** This approval was deleted and is still in Recently Deleted: restore it, do not save it again. */
  inBin: BinNotice | null;
  /** The clinic's own sheet wording per code on the paper; null = none stored yet. */
  wording: Record<string, string | null>;
};

/** One document on screen waiting to be confirmed. */
export type OpenDoc = {
  /** The insurer it was read for: the card saves under this one even if the page's select moves. */
  payerId: string;
  docId: string;
  docPath: string;
  /** Storage download URL for the viewer; "" when it could not be had. */
  docUrl: string;
  contentType: string;
  result: ReadResult;
  /** True when the desk is typing the paper in by hand (the read failed). */
  typed: boolean;
};

export type ReadOutcome = { ok: true; result: ReadResult } | { ok: false; error: string; retryable: boolean };

export async function readDocument(args: { clinicId: string; payerId: string; docId: string; docPath: string }): Promise<ReadOutcome> {
  const { status, data } = await call("POST", "/api/insurance/read", args);
  if (status === 200 && data.ok === true && data.extraction && typeof data.extraction === "object") {
    return {
      ok: true,
      result: {
        docId: String(data.docId || args.docId),
        extraction: data.extraction as MetlifeExtraction,
        checks: Array.isArray(data.checks) ? (data.checks as Check[]) : [],
        match: (data.match as PatientMatch) || { kind: "none" },
        duplicate: (data.duplicate as ReadResult["duplicate"]) ?? null,
        inBin: (data.inBin as ReadResult["inBin"]) ?? null,
        wording: data.wording && typeof data.wording === "object" ? (data.wording as Record<string, string | null>) : {},
      },
    };
  }
  return {
    ok: false,
    error: typeof data.error === "string" ? data.error : "",
    // 502 says so itself; any 5xx is worth another go, a 4xx is not.
    retryable: data.retryable === true || status >= 500,
  };
}

export type SaveBody = {
  clinicId: string;
  docId: string;
  payerId: string;
  extraction: MetlifeExtraction;
  patient: { id: string } | { create: { name: string; phone?: string } };
  /** The dentist for every line that has no entry in `lines` (the older one-dentist shape). */
  dentistId?: string;
  /** Per service line: who did it (null = nobody yet) and where it stands (absent = Completed). */
  lines?: Record<number, { dentistId?: string | null; status?: LineStatus }>;
  /** Omitted by the confirm card: the server saves the paper as treated. */
  status?: "approved" | "treated";
  wording?: Record<string, string>;
  docPath?: string;
};

export type SaveOutcome =
  | { kind: "saved"; claimId: string; patientId: string }
  | { kind: "duplicate"; claimId: string; savedAt: string | null }
  | { kind: "in_bin"; notice: BinNotice; error: string }
  | { kind: "doc_taken"; claimId: string; error: string }
  | { kind: "checks"; checks: Check[]; error: string }
  | { kind: "error"; error: string };

/**
 * POST /api/insurance/claims. `treatedDate` is never sent: with status "treated" (the default) the
 * server takes the approval date, with "approved" it stores null.
 */
export async function saveClaim(body: SaveBody): Promise<SaveOutcome> {
  const { status, data } = await call("POST", "/api/insurance/claims", body);
  if (status === 201 && data.ok === true) {
    return { kind: "saved", claimId: String(data.claimId || ""), patientId: String(data.patientId || "") };
  }
  const error = typeof data.error === "string" ? data.error : "";
  if (status === 409 && data.duplicate && typeof data.duplicate === "object") {
    const d = data.duplicate as { claimId?: unknown; savedAt?: unknown };
    return { kind: "duplicate", claimId: String(d.claimId || ""), savedAt: typeof d.savedAt === "string" ? d.savedAt : null };
  }
  if (status === 409 && data.inBin && typeof data.inBin === "object") return { kind: "in_bin", notice: data.inBin as BinNotice, error };
  if (status === 409 && typeof data.claimId === "string") return { kind: "doc_taken", claimId: data.claimId, error };
  if (status === 400 && Array.isArray(data.checks)) return { kind: "checks", checks: data.checks as Check[], error };
  return { kind: "error", error };
}

export type ClaimPatch = {
  status?: ClaimStatus;
  treatedDate?: string | null;
  patientId?: string;
  /** An edit of the paper: every service line, and the header fields (approval number and date stay). */
  lines?: MetlifeLine[];
  metlife?: Partial<MetlifeHeader>;
  /** Line index -> staff id to assign, or null to clear. The server stamps the rate and share. */
  dentists?: Record<number, string | null>;
  /** Line index -> where that service stands; follows into the treatment row's note. */
  lineStatus?: Record<number, LineStatus>;
  /** Take the patient's share as cash: the server posts the ledger row and stamps the claim in one transaction. */
  collectShare?: true;
  /** Record the insurer's payment against the treatment rows, and mark them settled. */
  insurerPaid?: true;
};

/** PATCH /api/insurance/claims. Resolves to the server's message on a refusal, null on success. */
export async function patchClaim(clinicId: string, claimId: string, patch: ClaimPatch): Promise<string | null> {
  const { status, data } = await call("PATCH", "/api/insurance/claims", { clinicId, claimId, patch });
  if (status === 200 && data.ok === true) return null;
  return typeof data.error === "string" && data.error ? data.error : `HTTP ${status}`;
}

/** A blank header, for "type it myself": every field empty, in the split shape the claims route keeps. */
export function blankHeader(): MetlifeHeader {
  return {
    approvalNumber: "",
    approvalDate: null,
    policyNumber: "",
    employer: "",
    certificateNumber: "",
    dependentCode: "",
    paperPatientName: "",
    paperPatientNameAr: "",
    providerCode: "",
    physician: "",
    statusText: "",
    diagnosisCode: "",
    estimatedCost: null,
    requestedTotal: null,
    approvedTotal: null,
    patientShareTotal: null,
    collectNote: null,
    terminationDate: null,
    comment: "",
    confidence: {},
  };
}

/** What the confirm card opens with when the desk types the paper in. */
export function blankResult(docId: string): ReadResult {
  return { docId, extraction: { header: blankHeader(), lines: [] }, checks: [], match: { kind: "none" }, duplicate: null, inBin: null, wording: {} };
}

/** The file's type for Storage; the read route refuses `application/octet-stream`. */
export function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() || "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "";
}

/** Today on the clinic's clock (Cairo), as yyyy-mm-dd. */
export function cairoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
}

/** First and last day of the month holding `ymd`. */
export function monthRange(ymd: string): { from: string; to: string } {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: `${ymd.slice(0, 7)}-01`, to: last };
}

/**
 * Take the patient's share as cash. One call: the server writes the income row and the claim's
 * stamp together, so a failure can never leave a cash row with nothing pointing at it. Resolves to
 * the server's message on a refusal (409 when it was already collected), null on success.
 */
export async function collectPatientShare(clinicId: string, claimId: string): Promise<string | null> {
  return patchClaim(clinicId, claimId, { collectShare: true });
}

/** Record the insurer's payment for an approval. Resolves to the server's message on a refusal, null on success. */
export async function recordInsurerPayment(clinicId: string, claimId: string): Promise<string | null> {
  return patchClaim(clinicId, claimId, { insurerPaid: true });
}
