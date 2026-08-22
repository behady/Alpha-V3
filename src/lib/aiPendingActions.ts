import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { buildPaymentRow } from "@/lib/ledgerWrite";
import { logAiAction } from "@/lib/serverLogger";
import { sendWhatsApp } from "@/lib/whatsapp";
import { resolveWhatsappDeliveryMode } from "@/lib/whatsappDelivery";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

/**
 * Two-step confirmation for destructive assistant actions.
 *
 * The chat route used to delete inline, inside the tool-call loop, and only afterwards tell the
 * user what it had done — so any confirmation built on top of the reply would be confirming an
 * action that had already happened. Deleting is instead recorded here as a *pending* action and
 * executed only when the user approves it in a second request.
 *
 * The stored preview is read from Firestore at request time, not taken from what the model said.
 * If the model picks the wrong document id, the user sees the real record that id points at
 * rather than a confident description of the one the model believed it chose.
 */

/** A stale prompt should not stay actionable — the record may have changed since. */
const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * What a staged action will do once approved.
 *
 * `delete` predates the others and keeps its exact shape, because the chat widget renders it.
 * The three reception kinds were added when the appointment assistant gained the ability to act:
 * each one touches money, a patient's phone, or the calendar, so none of them execute inline.
 */
export type PendingActionKind = "delete" | "appointment_update" | "payment" | "whatsapp";

/** One field the user is being asked to approve a change to. */
export type PendingChange = { label: string; from: string; to: string };

export type PendingActionPreview = {
  id: string;
  kind: PendingActionKind;
  collection: string;
  documentId: string;
  /** A few identifying fields from the real document, for the confirmation prompt. */
  summary: Record<string, unknown>;
  /** Short heading for the card, e.g. "Move appointment". */
  title?: string;
  /** Field-by-field diff, for `appointment_update`. */
  changes?: PendingChange[];
  /** For `whatsapp`: the exact text that will be sent, merged at staging time. */
  messageBody?: string;
  /** For `whatsapp`: the number it goes to. */
  recipient?: string;
  /** For `payment`: how much. */
  amount?: number;
  /** Plain-language explainer shown under the summary, for actions with a non-obvious mechanic. */
  note?: string;
};

/** Fields worth showing so a person can tell whether this is the record they meant. */
const PREVIEW_FIELDS = [
  "name", "patientName", "date", "time", "doctor", "treatment", "procedure",
  "type", "amount", "cost", "paid", "description", "status", "reason",
];

function buildSummary(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PREVIEW_FIELDS) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== "") out[key] = data[key];
  }
  return out;
}

/**
 * Stage a delete for confirmation. Returns null when the document does not exist, so the caller
 * can tell the model the truth instead of prompting the user about a phantom record.
 */
export async function createPendingAiDelete(args: {
  clinicId: string;
  collection: string;
  documentId: string;
  userId: string;
  userName?: string | null;
  userRole?: string | null;
}): Promise<PendingActionPreview | null> {
  const { clinicId, collection, documentId, userId, userName, userRole } = args;

  const snap = await adminClinicDoc(clinicId, collection, documentId).get();
  if (!snap.exists) return null;

  const data = (snap.data() || {}) as Record<string, unknown>;

  const ref = await adminClinicCollection(clinicId, "ai_pending_actions").add({
    kind: "delete",
    collection,
    documentId,
    status: "pending",
    // Kept so approval can verify the record has not changed since it was described.
    snapshot: data,
    requestedByUserId: userId,
    requestedByName: userName || null,
    requestedByRole: userRole || null,
    requestedAt: FieldValue.serverTimestamp(),
    expiresAt: Date.now() + PENDING_TTL_MS,
  });

  return { id: ref.id, kind: "delete", collection, documentId, summary: buildSummary(data) };
}

/** Outcome of staging. An error here is something the assistant must tell the user, not retry. */
export type StageResult =
  | { ok: true; preview: PendingActionPreview }
  | { ok: false; error: string };

/** Shared writer: every staged action records who asked, when it lapses, and the record as read. */
async function stagePendingAction(args: {
  clinicId: string;
  kind: PendingActionKind;
  collection: string;
  documentId: string;
  payload: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
  userId: string;
  userName?: string | null;
  userRole?: string | null;
}): Promise<string> {
  const ref = await adminClinicCollection(args.clinicId, "ai_pending_actions").add({
    kind: args.kind,
    collection: args.collection,
    documentId: args.documentId,
    payload: args.payload,
    status: "pending",
    snapshot: args.snapshot,
    requestedByUserId: args.userId,
    requestedByName: args.userName || null,
    requestedByRole: args.userRole || null,
    requestedAt: FieldValue.serverTimestamp(),
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
  return ref.id;
}

const APPOINTMENT_FIELD_LABELS: Record<string, string> = {
  status: "Status",
  date: "Date",
  time: "Time",
  duration: "Duration",
  doctor: "Dentist",
};

function displayValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (field === "duration") return `${value} min`;
  return String(value);
}

/**
 * Stage a change to an appointment — a status move, a reschedule, or both.
 *
 * The diff is computed against the stored record, so the card shows what will really change rather
 * than what the model believed the appointment said. A request that changes nothing is refused
 * outright: a confirmation prompt that does nothing teaches people to approve without reading.
 */
export async function createPendingAppointmentUpdate(args: {
  clinicId: string;
  appointmentId: string;
  updates: Record<string, string | number>;
  title: string;
  userId: string;
  userName?: string | null;
  userRole?: string | null;
}): Promise<StageResult> {
  const { clinicId, appointmentId, updates, title, userId, userName, userRole } = args;

  const snap = await adminClinicDoc(clinicId, "appointments", appointmentId).get();
  if (!snap.exists) return { ok: false, error: "That appointment no longer exists." };
  const data = (snap.data() || {}) as Record<string, unknown>;

  const changes: PendingChange[] = [];
  const effective: Record<string, string | number> = {};
  for (const [field, value] of Object.entries(updates)) {
    if (value === undefined || value === null || value === "") continue;
    if (String(data[field] ?? "") === String(value)) continue;
    changes.push({
      label: APPOINTMENT_FIELD_LABELS[field] || field,
      from: displayValue(field, data[field]),
      to: displayValue(field, value),
    });
    effective[field] = value;
  }

  if (changes.length === 0) {
    return { ok: false, error: "Nothing would change — the appointment already has those values." };
  }

  const id = await stagePendingAction({
    clinicId, kind: "appointment_update", collection: "appointments", documentId: appointmentId,
    payload: { updates: effective }, snapshot: data, userId, userName, userRole,
  });

  // A date/time move keeps the original document on its day (marked Rescheduled) and books a
  // second, new document for the new time — see resolvePendingAiAction. That is a bigger
  // consequence than "this field changes", so the card says so before anyone taps Confirm.
  const isReschedule = effective.date !== undefined || effective.time !== undefined;

  return {
    ok: true,
    preview: {
      id, kind: "appointment_update", collection: "appointments", documentId: appointmentId,
      title, summary: buildSummary(data), changes,
      note: isReschedule
        ? "The original booking stays on its day, marked Rescheduled. A new appointment is created for the new time."
        : undefined,
    },
  };
}

/** Stage a payment against a patient's ledger. Nothing is written until it is approved. */
export async function createPendingPayment(args: {
  clinicId: string;
  patientId: string;
  amount: number;
  description: string;
  date: string;
  userId: string;
  userName?: string | null;
  userRole?: string | null;
}): Promise<StageResult> {
  const { clinicId, patientId, amount, description, date, userId, userName, userRole } = args;

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "A payment needs an amount greater than zero." };
  }

  const patientSnap = await adminClinicDoc(clinicId, "patients", patientId).get();
  if (!patientSnap.exists) return { ok: false, error: "That patient no longer exists." };
  const patientName = String((patientSnap.data() || {}).name || "Unknown");

  const payload = { patientId, patientName, amount, description, date };
  const id = await stagePendingAction({
    clinicId, kind: "payment", collection: "ledger", documentId: "",
    payload, snapshot: null, userId, userName, userRole,
  });

  return {
    ok: true,
    preview: {
      id, kind: "payment", collection: "ledger", documentId: "",
      title: "Record payment", amount,
      summary: { patientName, description, date },
    },
  };
}

/**
 * Stage a WhatsApp message.
 *
 * The merged body is stored now and sent verbatim on approval, so the text a person reads on the
 * card is byte-for-byte the text the patient receives. Re-merging at send time would leave room
 * for the two to differ.
 */
export async function createPendingWhatsApp(args: {
  clinicId: string;
  patientId: string;
  patientName: string;
  phone: string;
  body: string;
  messageType: string;
  userId: string;
  userName?: string | null;
  userRole?: string | null;
}): Promise<StageResult> {
  const { clinicId, patientId, patientName, phone, body, messageType, userId, userName, userRole } = args;

  if (!phone) return { ok: false, error: "That patient has no phone number on file." };
  if (!body.trim()) return { ok: false, error: "That message template is empty or switched off." };

  const payload = { patientId, patientName, phone, body, messageType };
  const id = await stagePendingAction({
    clinicId, kind: "whatsapp", collection: "whatsapp_logs", documentId: "",
    payload, snapshot: null, userId, userName, userRole,
  });

  return {
    ok: true,
    preview: {
      id, kind: "whatsapp", collection: "whatsapp_logs", documentId: "",
      title: "Send WhatsApp message", recipient: phone, messageBody: body,
      summary: { patientName, type: messageType },
    },
  };
}

export type ResolveResult =
  | {
      ok: true; status: "approved"; kind: PendingActionKind; collection: string; documentId: string; message: string;
      /** Set only when a reschedule created a second document — the id the client should switch to. */
      newAppointmentId?: string;
      /** The composed message, when there is no gateway and a person has to send it themselves. */
      manual?: { phone: string; text: string };
    }
  | { ok: true; status: "rejected" }
  | { ok: false; error: string };

/**
 * Approve or reject a staged action.
 *
 * The approving user must be the one who asked — otherwise a prompt raised in one person's chat
 * could be actioned from another's session — and the action must still be pending, so a
 * double-submit cannot delete twice.
 */
export async function resolvePendingAiAction(args: {
  clinicId: string;
  actionId: string;
  decision: "approve" | "reject";
  userId: string;
  userName?: string | null;
  userRole?: string | null;
}): Promise<ResolveResult> {
  const { clinicId, actionId, decision, userId, userName, userRole } = args;

  const pendingRef = adminClinicDoc(clinicId, "ai_pending_actions", actionId);
  const pendingSnap = await pendingRef.get();
  if (!pendingSnap.exists) return { ok: false, error: "That confirmation has expired or was already handled." };

  const pending = pendingSnap.data() || {};
  if (pending.status !== "pending") return { ok: false, error: "That action was already handled." };
  if (pending.requestedByUserId !== userId) return { ok: false, error: "Only the person who requested this can confirm it." };

  if (decision === "reject") {
    await pendingRef.update({ status: "rejected", resolvedAt: FieldValue.serverTimestamp(), resolvedByUserId: userId });
    return { ok: true, status: "rejected" };
  }

  if (typeof pending.expiresAt === "number" && Date.now() > pending.expiresAt) {
    await pendingRef.update({ status: "expired", resolvedAt: FieldValue.serverTimestamp() });
    return { ok: false, error: "That confirmation expired. Please ask again." };
  }

  const kind = (pending.kind || "delete") as PendingActionKind;
  const collection = String(pending.collection || "");
  const documentId = String(pending.documentId || "");
  const payload = (pending.payload || {}) as Record<string, any>;

  // Deleting clinical or financial history stays an Admin decision. The check lives here as well
  // as in the route, because a stored action must not become a way around the gate if the user's
  // role changed between staging and approval.
  if (kind === "delete" && userRole !== "Admin") {
    return { ok: false, error: "Only a Clinic Admin can confirm a deletion." };
  }

  const markApproved = () =>
    pendingRef.update({ status: "approved", resolvedAt: FieldValue.serverTimestamp(), resolvedByUserId: userId });
  const markStale = () =>
    pendingRef.update({ status: "stale", resolvedAt: FieldValue.serverTimestamp() });

  // --- Appointment change ---------------------------------------------------------------------
  if (kind === "appointment_update") {
    const ref = adminClinicDoc(clinicId, "appointments", documentId);
    const snap = await ref.get();
    if (!snap.exists) {
      await markStale();
      return { ok: false, error: "That appointment no longer exists." };
    }

    const current = (snap.data() || {}) as Record<string, unknown>;
    const staged = (pending.snapshot || {}) as Record<string, unknown>;
    const updates = (payload.updates || {}) as Record<string, string | number>;

    // The user approved a specific "from → to". If someone edited the appointment in between, the
    // card they read no longer describes reality, so this must not silently apply anyway.
    for (const field of Object.keys(updates)) {
      if (String(current[field] ?? "") !== String(staged[field] ?? "")) {
        await markStale();
        return { ok: false, error: "This appointment changed after the preview was shown. Please ask again." };
      }
    }

    const dateChanging = updates.date !== undefined && String(current.date ?? "") !== String(updates.date);
    const timeChanging = updates.time !== undefined && String(current.time ?? "") !== String(updates.time);

    /*
     * A date/time move keeps the OLD document exactly where it is — still on its original day,
     * still findable — and creates a SECOND, new document for the new slot. The user asked for
     * this specifically: an earlier version moved the single document in place (matching how the
     * manual editor already worked), which meant a moved appointment left nothing behind and its
     * original day could look like nobody had ever booked it. "Cancelled" already stays visible on
     * its day in this app; "Rescheduled" gets the same treatment rather than inventing a new
     * pattern. A pure status change (check-in, confirm, etc.) has no date/time in `updates` and
     * falls through to the plain single-document path below, unchanged.
     */
    if (dateChanging || timeChanging) {
      const fromDate = String(current.date ?? "?");
      const fromTime = String(current.time ?? "?");
      const toDate = String(updates.date ?? current.date ?? "?");
      const toTime = String(updates.time ?? current.time ?? "?");
      const actor = `${userName || "Alpha AI"} (via assistant)`;
      const now = new Date();

      const newRef = adminClinicCollection(clinicId, "appointments").doc();

      // Only the fields describing the visit itself carry forward — not checkInTime/checkOutTime/
      // waitingMood/statusHistory/clinicalNoteId, which belong to the old slot's own outcome, and
      // not doctorId when the dentist's display name changed, since the tool that stages a
      // reschedule only ever supplies a new `doctor` string, never a resolved staff id.
      const carryFromOldNotes = String(current.notes || "").trim();
      const forwardTraceLine = `Rescheduled from ${fromDate} ${fromTime} (via assistant).`;

      const newAppointment: Record<string, unknown> = {
        patientId: current.patientId ?? null,
        patientName: current.patientName ?? null,
        treatment: current.treatment ?? "",
        doctor: updates.doctor ?? current.doctor ?? "",
        doctorId: current.doctorId ?? null,
        date: toDate,
        time: toTime,
        duration: updates.duration ?? current.duration ?? 30,
        type: current.type ?? "consult",
        notes: carryFromOldNotes ? `${carryFromOldNotes}\n${forwardTraceLine}` : forwardTraceLine,
        cost: current.cost ?? 0,
        serviceId: current.serviceId ?? null,
        serviceName: current.serviceName ?? null,
        listPrice: current.listPrice ?? 0,
        discountMode: current.discountMode ?? "none",
        discountPercent: current.discountPercent ?? null,
        discountFixed: current.discountFixed ?? null,
        discountAmount: current.discountAmount ?? 0,
        clinicalNoteId: null,
        status: "Scheduled",
        statusHistory: [{ status: "Scheduled", timestamp: now, modifiedBy: actor }],
        rescheduledFromId: documentId,
        rescheduledFromDate: fromDate,
        rescheduledFromTime: fromTime,
        addedBy: actor,
        id: newRef.id,
        createdAt: FieldValue.serverTimestamp(),
      };
      await newRef.set(newAppointment);

      const backTraceLine = `Rescheduled to ${toDate} ${toTime} (via assistant).`;
      const oldNotes = carryFromOldNotes ? `${carryFromOldNotes}\n${backTraceLine}` : backTraceLine;
      await ref.update({
        status: "Rescheduled",
        notes: oldNotes,
        statusHistory: FieldValue.arrayUnion({ status: "Rescheduled", timestamp: now, modifiedBy: actor }),
        rescheduledToId: newRef.id,
        rescheduledToDate: toDate,
        rescheduledToTime: toTime,
        modifiedBy: actor,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await logAiAction({
        clinicId, kind: "update", collection: "appointments", documentId,
        userId, userName, userRole, before: current,
        after: { status: "Rescheduled", rescheduledToId: newRef.id, toDate, toTime },
      });
      await logAiAction({
        clinicId, kind: "create", collection: "appointments", documentId: newRef.id,
        userId, userName, userRole, after: newAppointment,
      });
      await markApproved();

      return {
        ok: true, status: "approved", kind, collection, documentId,
        newAppointmentId: newRef.id,
        message: `Moved from ${fromDate} ${fromTime} to ${toDate} ${toTime}. The original stays on its day, marked Rescheduled.`,
      };
    }

    const prevStatus = normalizeAppointmentStatus(String(current.status || ""));
    const nextStatusRaw = updates.status ? String(updates.status) : "";
    const nextStatus = nextStatusRaw ? normalizeAppointmentStatus(nextStatusRaw) : "";

    const updatePayload: Record<string, unknown> = {
      ...updates,
      modifiedBy: `${userName || "Alpha AI"} (via assistant)`,
      updatedAt: FieldValue.serverTimestamp(),
    };

    /*
     * A status move is not just a field write.
     *
     * The dashboard's own stage buttons stamp checkInTime/checkOutTime, seed waitingMood and append
     * to statusHistory, and a check-in additionally opens an attendance row. Writing only `status`
     * here would produce a patient who is "Checked In" with no arrival time and no attendance
     * record — invisible to the waiting-time widget and to attendance reporting. Whatever the
     * dashboard does, this has to do too.
     */
    if (nextStatusRaw) {
      updatePayload.statusHistory = FieldValue.arrayUnion({
        status: nextStatusRaw,
        timestamp: new Date(),
        modifiedBy: `${userName || "Alpha AI"} (via assistant)`,
      });
      if (nextStatus === "Checked In" && prevStatus !== "Checked In") {
        if (!current.waitingMood) updatePayload.waitingMood = "neutral";
        if (!current.checkInTime) updatePayload.checkInTime = FieldValue.serverTimestamp();
      }
      if ((nextStatus === "Checking Out" || nextStatus === "Completed") && prevStatus !== nextStatus && !current.checkOutTime) {
        updatePayload.checkOutTime = FieldValue.serverTimestamp();
      }
    }

    await ref.update(updatePayload);

    if (nextStatus === "Checked In" && prevStatus !== "Checked In") {
      await adminClinicCollection(clinicId, "attendance").add({
        patientId: current.patientId || null,
        patientName: current.patientName || null,
        appointmentId: documentId,
        checkInTime: FieldValue.serverTimestamp(),
        doctor: current.doctor || null,
        status: "waiting",
      });
    }

    await logAiAction({
      clinicId, kind: "update", collection: "appointments", documentId,
      userId, userName, userRole, before: current, after: updates,
    });
    await markApproved();

    return { ok: true, status: "approved", kind, collection, documentId, message: "Appointment updated." };
  }

  // --- Payment --------------------------------------------------------------------------------
  if (kind === "payment") {
    const ref = adminClinicCollection(clinicId, "ledger").doc();
    // Built through the shared builder so an assistant-recorded payment is the same shape as one
    // taken at the desk. This used to be assembled by hand with `amount: 0` and no commission
    // fields at all — a legacy shape that reads as zero to anything summing `amount`, and that the
    // payout report skips entirely for having no commission on it.
    //
    // The assistant only ever records payments on account (procedureId stays null), so there is no
    // procedure to attribute to and the commission fields are explicit zeroes. Allocating one to a
    // treatment is a decision for a person looking at the patient's ledger.
    const record = {
      ...buildPaymentRow({
        patientId: String(payload.patientId || ""),
        patientName: typeof payload.patientName === "string" ? payload.patientName : null,
        amount: Number(payload.amount) || 0,
        date: String(payload.date || new Date().toISOString().split("T")[0]),
        description: String(payload.description || "Payment"),
        procedure: null,
        actor: { uid: userId, name: `${userName || "Alpha AI"} (via assistant)` },
      }),
      id: ref.id,
      receivedBy: userName || "Alpha AI",
      createdAt: FieldValue.serverTimestamp(),
    };
    await ref.set(record);

    await logAiAction({
      clinicId, kind: "create", collection: "ledger", documentId: ref.id,
      userId, userName, userRole, after: record,
    });
    await markApproved();

    return { ok: true, status: "approved", kind, collection: "ledger", documentId: ref.id, message: "Payment recorded." };
  }

  // --- WhatsApp -------------------------------------------------------------------------------
  if (kind === "whatsapp") {
    // The person approving this is sitting in front of the screen, so when there is no gateway
    // the honest outcome is to hand them the finished message rather than fail. The log records
    // "manual", not "success", because nothing has reached the patient yet.
    const mode = await resolveWhatsappDeliveryMode(clinicId);
    if (mode === "manual") {
      const logRef = await adminClinicCollection(clinicId, "whatsapp_logs").add({
        patientId: payload.patientId,
        type: `assistant_${payload.messageType}`,
        message: payload.body,
        status: "manual",
        sentBy: userName || userId,
        createdAt: FieldValue.serverTimestamp(),
      });
      await markApproved();
      return {
        ok: true,
        status: "approved",
        kind,
        collection: "whatsapp_logs",
        documentId: logRef.id,
        message: "Message ready — open WhatsApp to send it.",
        manual: { phone: String(payload.phone), text: String(payload.body) },
      };
    }

    // Marked approved only after the send returns, so a failed send can never be logged as sent.
    try {
      await sendWhatsApp({ clinicId, to: String(payload.phone), text: String(payload.body) });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "The message could not be sent.";
      await pendingRef.update({ status: "failed", resolvedAt: FieldValue.serverTimestamp(), failureReason: message });
      return { ok: false, error: `The message was not sent: ${message}` };
    }

    const logRef = await adminClinicCollection(clinicId, "whatsapp_logs").add({
      patientId: payload.patientId,
      type: `assistant_${payload.messageType}`,
      message: payload.body,
      status: "success",
      sentBy: userName || userId,
      createdAt: FieldValue.serverTimestamp(),
    });
    await markApproved();

    return { ok: true, status: "approved", kind, collection: "whatsapp_logs", documentId: logRef.id, message: "Message sent." };
  }

  // --- Delete (unchanged) ---------------------------------------------------------------------
  const targetRef = adminClinicDoc(clinicId, collection, documentId);
  const before = await targetRef.get();

  if (!before.exists) {
    await markStale();
    return { ok: false, error: "That record no longer exists." };
  }

  // Same snapshot-then-delete the inline path used, so a deletion stays recoverable.
  await adminClinicCollection(clinicId, "ai_deletion_log").add({
    collection,
    documentId,
    deletedBy: userName || userId,
    snapshot: before.data(),
    confirmedFromPendingAction: actionId,
    deletedAt: FieldValue.serverTimestamp(),
  });
  await targetRef.delete();

  await logAiAction({
    clinicId, kind: "delete", collection, documentId,
    userId, userName, userRole, before: before.data(),
  });

  await markApproved();

  return { ok: true, status: "approved", kind: "delete", collection, documentId, message: "Record deleted." };
}
