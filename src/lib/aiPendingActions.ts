import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { logAiAction } from "@/lib/serverLogger";

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

export type PendingActionPreview = {
  id: string;
  kind: "delete";
  collection: string;
  documentId: string;
  /** A few identifying fields from the real document, for the confirmation prompt. */
  summary: Record<string, unknown>;
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

export type ResolveResult =
  | { ok: true; status: "approved"; collection: string; documentId: string }
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

  const collection = String(pending.collection || "");
  const documentId = String(pending.documentId || "");
  const targetRef = adminClinicDoc(clinicId, collection, documentId);
  const before = await targetRef.get();

  if (!before.exists) {
    await pendingRef.update({ status: "stale", resolvedAt: FieldValue.serverTimestamp() });
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

  await pendingRef.update({ status: "approved", resolvedAt: FieldValue.serverTimestamp(), resolvedByUserId: userId });

  return { ok: true, status: "approved", collection, documentId };
}
