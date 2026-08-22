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

export class MoneyApiError extends Error {
  status: number;
  reason?: string;
  blockingPaymentIds?: string[];

  constructor(message: string, status: number, reason?: string, blockingPaymentIds?: string[]) {
    super(message);
    this.name = "MoneyApiError";
    this.status = status;
    this.reason = reason;
    this.blockingPaymentIds = blockingPaymentIds;
  }
}

/** True when the server refused because money has already been collected. */
export function isHasPaymentsError(error: unknown): error is MoneyApiError {
  return error instanceof MoneyApiError && error.reason === "HAS_PAYMENTS";
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new MoneyApiError("You are signed out. Sign in and try again.", 401);
  const token = await user.getIdToken();
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function post<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    // A route that died before writing JSON — the status is all we have to go on.
  }

  if (!response.ok || payload.ok === false) {
    throw new MoneyApiError(
      typeof payload.error === "string" ? payload.error : "Something went wrong. Nothing was changed.",
      response.status,
      typeof payload.reason === "string" ? payload.reason : undefined,
      Array.isArray(payload.blockingPaymentIds) ? (payload.blockingPaymentIds as string[]) : undefined
    );
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

/** Edit a payment, or a clinic income/expense line. Treatment charges go through updateProcedure. */
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
  if (clinicId) params.set("clinicId", clinicId);
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
