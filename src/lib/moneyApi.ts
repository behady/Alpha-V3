/**
 * Client-side calls to the routes that own money.
 *
 * Every screen used to write to Firestore directly. They now post here, and firestore.rules denies
 * them the collections, so the permission checks and the transaction boundaries in those routes
 * are the only path — not merely the intended one.
 *
 * Reads are untouched: `onSnapshot` on `ledger` and `clinical_notes` still works exactly as
 * before, so the live screens stay live. Only writes moved.
 *
 * Errors come back as thrown `MoneyApiError` with the server's own message, so a caller can show
 * the user what actually happened ("2 payments have been recorded against this") instead of a
 * generic failure. `reason` carries the machine-readable code where there is one, which is what
 * lets a caller offer the right next step rather than just reporting a refusal.
 */

import { auth } from "@/lib/firebase";
import { CLINIC_INACTIVE_CODE } from "@/lib/clinicStatus";
import { OVER_ALLOCATION_CODE } from "@/lib/paymentAllocation";
import { currentClinicId } from "@/lib/db-utils";

export class MoneyApiError extends Error {
  status: number;
  reason?: string;
  blockingPaymentIds?: string[];
  /** How much was still owed on the treatment, when the refusal was an over-allocation. */
  remaining?: number;
  /** How far past the charge the attempted payment would have gone. */
  excess?: number;

  constructor(message: string, status: number, reason?: string, blockingPaymentIds?: string[]) {
    super(message);
    this.name = "MoneyApiError";
    this.status = status;
    this.reason = reason;
    this.blockingPaymentIds = blockingPaymentIds;
  }
}

/**
 * True when the server refused because the payment would settle more than the treatment is worth.
 *
 * The error carries `remaining`, so a screen can offer the right next step — record what is
 * actually owed and take the rest on account — instead of just repeating the refusal.
 */
export function isOverAllocationError(error: unknown): error is MoneyApiError {
  return error instanceof MoneyApiError && error.reason === OVER_ALLOCATION_CODE;
}

/** True when the server refused because money has already been collected. */
export function isHasPaymentsError(error: unknown): error is MoneyApiError {
  return error instanceof MoneyApiError && error.reason === "HAS_PAYMENTS";
}

/**
 * True when the server refused because the clinic's subscription has lapsed, rather than because
 * this person lacks a permission. Both are 403s and, until this existed, both reached the user as
 * the same shrug. They need different words: one is "ask your admin", the other is "we need to
 * renew", and a receptionist who is told the wrong one will go and bother the wrong person.
 */
export function isClinicInactiveError(error: unknown): error is MoneyApiError {
  return error instanceof MoneyApiError && error.reason === CLINIC_INACTIVE_CODE;
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new MoneyApiError("You are signed out. Sign in and try again.", 401);
  const token = await user.getIdToken();
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function post<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
  /**
   * Which clinic this write belongs to, attached here rather than at each call site.
   *
   * The routes fall back to `resolveUserClinicId(uid, null)` when the body names no clinic — which
   * is the caller's `defaultClinicId`, or whichever key `Object.keys(clinicRoles)[0]` happens to
   * return. Six of the seven write paths never sent one. So somebody working at a second clinic
   * logged a procedure and it was priced against the FIRST clinic's price list, attributed to the
   * first clinic's staff, and written into the first clinic's records — with the only visible
   * symptom being "Choose the dentist who performed this treatment", because the dentist on screen
   * belonged to the clinic they were actually looking at.
   *
   * Attached once, here, for the same reason the auth token is: a value every request needs and
   * no request should have to remember. An explicit `clinicId` in the body still wins, so the
   * superadmin panel and anything else acting on another clinic is unaffected.
   */
  const clinicId = body.clinicId ?? currentClinicId();

  const response = await fetch(path, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(clinicId ? { ...body, clinicId } : body),
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    // A route that died before writing JSON — the status is all we have to go on.
  }

  if (!response.ok || payload.ok === false) {
    const error = new MoneyApiError(
      typeof payload.error === "string" ? payload.error : "Something went wrong. Nothing was changed.",
      response.status,
      typeof payload.reason === "string" ? payload.reason : undefined,
      Array.isArray(payload.blockingPaymentIds) ? (payload.blockingPaymentIds as string[]) : undefined
    );
    if (typeof payload.remaining === "number") error.remaining = payload.remaining;
    if (typeof payload.excess === "number") error.excess = payload.excess;
    throw error;
  }

  return payload as T;
}

async function get<T = Record<string, unknown>>(path: string): Promise<T> {
  const response = await fetch(path, { headers: await authHeaders() });
  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    /* see above */
  }
  if (!response.ok || payload.ok === false) {
    throw new MoneyApiError(
      typeof payload.error === "string" ? payload.error : "Could not load that.",
      response.status,
      typeof payload.reason === "string" ? payload.reason : undefined
    );
  }
  return payload as T;
}

// --- ledger -------------------------------------------------------------------------------------

export type CreatePaymentArgs = {
  patientId: string;
  patientName?: string | null;
  amount: number;
  method?: string;
  description?: string;
  /** The charge being settled. Omit for a payment on account. */
  procedureId?: string | null;
  date?: string;
  category?: string;
  clinicId?: string | null;
};

/**
 * Record a payment. The dentist, the lab fee and the commission are all resolved server-side from
 * the procedure being settled — the caller does not (and must not) work them out.
 */
export function createPayment(args: CreatePaymentArgs): Promise<{ id: string }> {
  return post("/api/finance/ledger", { action: "create-payment", ...args });
}

export type CreateEntryArgs = {
  type: "income" | "expense";
  amount: number;
  description: string;
  category?: string;
  date?: string;
  method?: string;
  isRecurring?: boolean;
  clinicId?: string | null;
};

/** Clinic income or overhead — money that belongs to no patient. */
export function createLedgerEntry(args: CreateEntryArgs): Promise<{ id: string }> {
  return post("/api/finance/ledger", { action: "create-entry", ...args });
}

/**
 * Edit a payment, or a clinic income/expense line. Treatment charges go through updateProcedure.
 *
 * `patch.procedureId` moves a payment to a different treatment of the same patient, or to no
 * treatment at all (`null`) — the repair for money recorded against the wrong charge. The server
 * re-derives the dentist, the lab fee and the commission on both the old charge and the new one,
 * so this is not the same as deleting the row and re-entering it: the payment keeps its date, its
 * method, who collected it, and its place in the audit trail.
 */
export function updateLedgerRow(id: string, patch: Record<string, unknown>, clinicId?: string | null) {
  return post("/api/finance/ledger", { action: "update", id, patch, clinicId });
}

/** Throws MoneyApiError with reason "HAS_PAYMENTS" when money has been collected against it. */
export function deleteLedgerRow(id: string, clinicId?: string | null) {
  return post<{ deleted: Array<{ collection: string; id: string }> }>("/api/finance/ledger", {
    action: "delete",
    id,
    clinicId,
  });
}

/**
 * Override a payment's commission split by hand.
 *
 * The server stamps the row as manually set, which is what stops a later repair pass from
 * "correcting" a deliberate decision back to the dentist's standing rate.
 */
export function setPaymentCommission(id: string, commissionPercentage: number, clinicId?: string | null) {
  return post("/api/finance/ledger", { action: "set-commission", id, commissionPercentage, clinicId });
}

// --- clinical procedures -------------------------------------------------------------------------

export type ProcedureWriteArgs = {
  patientId: string;
  appointmentId?: string | null;
  /** Procedure names. The first governs the billing rule when they differ. */
  procedures: string[];
  selectedTeeth: string[];
  /** Free-text tooth label, used only when no teeth are selected on the chart. */
  tooth?: string;
  /** A hand-typed unit cost. Leave null to price from the catalogue. */
  unitCost?: number | null;
  /** Manual override of the per_tooth / flat / per_arch rule. */
  pricingMode?: string | null;
  doctorId: string;
  status?: "Planned" | "Ongoing" | "Completed";
  note?: string;
  date?: string;
  addToLedger?: boolean;
  clinicId?: string | null;
};

export type ProcedureWriteResult = { noteId: string; ledgerId: string | null; cost: number };

export function createProcedure(args: ProcedureWriteArgs): Promise<ProcedureWriteResult> {
  return post("/api/clinical/procedures", { action: "create", ...args });
}

export function updateProcedure(noteId: string, args: ProcedureWriteArgs): Promise<ProcedureWriteResult> {
  return post("/api/clinical/procedures", { action: "update", noteId, ...args });
}

export function deleteProcedure(noteId: string, clinicId?: string | null) {
  return post<{ deleted: Array<{ collection: string; id: string }> }>("/api/clinical/procedures", {
    action: "delete",
    noteId,
    clinicId,
  });
}

/** Re-file a treatment under another visit; its charge follows, keeping the dates in step. */
export function moveProcedure(noteId: string, targetAppointmentId: string, clinicId?: string | null) {
  return post("/api/clinical/procedures", { action: "move", noteId, targetAppointmentId, clinicId });
}

/** Carry a treatment into a later visit at no extra charge. */
export function continueProcedure(noteId: string, targetAppointmentId: string, clinicId?: string | null) {
  return post<{ noteId: string }>("/api/clinical/procedures", {
    action: "continue",
    noteId,
    targetAppointmentId,
    clinicId,
  });
}

// --- appointment deletion --------------------------------------------------------------------------

export type VisitService = {
  noteId: string;
  name: string;
  tooth: string;
  cost: number;
  paid: number;
  status: string;
};

export type DeletePreview = {
  services: VisitService[];
  hasPayments: boolean;
  paymentCount: number;
};

/** What deleting this appointment would affect, so the screen can ask before doing it. */
export function previewAppointmentDelete(appointmentId: string, clinicId?: string | null): Promise<DeletePreview> {
  const params = new URLSearchParams({ appointmentId });
  // Same rule as the writes: default to the clinic on screen. A preview naming the wrong tenant
  // would describe an appointment that is not the one about to be deleted.
  const resolved = clinicId ?? currentClinicId();
  if (resolved) params.set("clinicId", resolved);
  return get(`/api/appointments/delete?${params.toString()}`);
}

export type DeleteAppointmentResult = {
  servicesAction: "keep" | "delete";
  deletedNotes: number;
  detachedNotes: number;
  deletedLedgerRows: number;
};

/**
 * Delete an appointment.
 *
 * `servicesAction` is required rather than defaulted, so no caller can delete a visit's treatments
 * without having decided to. "keep" detaches them into the patient's general history.
 */
export function deleteAppointment(
  appointmentId: string,
  servicesAction: "keep" | "delete",
  clinicId?: string | null
): Promise<DeleteAppointmentResult> {
  return post("/api/appointments/delete", { appointmentId, servicesAction, clinicId });
}
