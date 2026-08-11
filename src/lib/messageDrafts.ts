import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { normalizeToE164, sendWhatsApp } from "@/lib/whatsapp";
import { resolveWhatsappDeliveryMode } from "@/lib/whatsappDelivery";

/**
 * Outbound messages drafted automatically, held for a human to approve before they send.
 *
 * Every existing WhatsApp path in this app merges a template and sends immediately. That is fine
 * for a booking confirmation the patient is expecting, but a win-back message to someone who has
 * not been seen in months is a judgement call about tone and timing, and it goes to a real person
 * who did not ask for it. So generation and sending are separated: a scan proposes, a person
 * decides.
 *
 * Sending happens here rather than in the route so the status transition and the send cannot drift
 * apart — a draft is only marked sent after the send actually returns.
 */

export type DraftStatus = "pending_review" | "approved" | "sent" | "rejected" | "failed";
export type DraftReason = "dormant_reactivation";

export interface MessageDraft {
  id: string;
  patientId: string;
  patientName: string;
  phone: string;
  body: string;
  reason: DraftReason;
  status: DraftStatus;
  createdAt?: unknown;
  context?: Record<string, unknown>;
}

export interface DraftInput {
  patientId: string;
  patientName: string;
  phone: string;
  body: string;
  reason: DraftReason;
  context?: Record<string, unknown>;
}

/**
 * Create drafts, skipping patients who already have one awaiting review for the same reason.
 *
 * Re-running a scan is expected — it is the only way to pick up newly-dormant patients — so
 * without this a weekly scan would stack four identical drafts against the same person and
 * whoever reviews the queue would message them repeatedly.
 */
export async function createMessageDrafts(
  clinicId: string,
  inputs: DraftInput[]
): Promise<{ created: number; skipped: number }> {
  if (inputs.length === 0) return { created: 0, skipped: 0 };

  const reasons = Array.from(new Set(inputs.map((i) => i.reason)));
  const existing = new Set<string>();

  for (const reason of reasons) {
    const snap = await adminClinicCollection(clinicId, "message_drafts")
      .where("reason", "==", reason)
      .where("status", "in", ["pending_review", "approved", "sent"])
      .get();
    snap.forEach((doc) => {
      const d = doc.data() || {};
      if (typeof d.patientId === "string") existing.add(`${reason}:${d.patientId}`);
    });
  }

  let created = 0;
  let skipped = 0;

  for (const input of inputs) {
    if (existing.has(`${input.reason}:${input.patientId}`)) {
      skipped++;
      continue;
    }
    await adminClinicCollection(clinicId, "message_drafts").add({
      patientId: input.patientId,
      patientName: input.patientName,
      phone: input.phone,
      body: input.body,
      reason: input.reason,
      context: input.context || null,
      channel: "whatsapp",
      status: "pending_review" as DraftStatus,
      createdBy: "system",
      createdAt: FieldValue.serverTimestamp(),
    });
    existing.add(`${input.reason}:${input.patientId}`);
    created++;
  }

  return { created, skipped };
}

export async function listMessageDrafts(clinicId: string, status?: DraftStatus): Promise<MessageDraft[]> {
  let ref = adminClinicCollection(clinicId, "message_drafts").limit(500) as FirebaseFirestore.Query;
  if (status) ref = ref.where("status", "==", status);

  const snap = await ref.get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as unknown as MessageDraft[];
  // Sorted in memory so this needs no composite index for the status filter above.
  return rows.sort((a, b) => String(b.patientName || "").localeCompare(String(a.patientName || "")));
}

export type ResolveDraftResult =
  | { ok: true; status: "sent" }
  | { ok: true; status: "rejected" }
  /**
   * Approved, but there is no gateway to send through. The finished message is returned so the
   * reviewer can open WhatsApp and send it themselves. The draft deliberately stays in the
   * pending queue until something actually goes out.
   */
  | { ok: true; status: "manual"; phone: string; body: string }
  | { ok: false; error: string };

/**
 * Approve and send, or reject.
 *
 * `editedBody` lets the reviewer fix the wording before it goes out — the draft is a starting
 * point, not something to rubber-stamp. The pending-status guard makes a double submit a no-op
 * rather than a second message to the same patient.
 */
export async function resolveMessageDraft(args: {
  clinicId: string;
  draftId: string;
  decision: "approve" | "reject";
  userId: string;
  userName?: string | null;
  editedBody?: string;
}): Promise<ResolveDraftResult> {
  const { clinicId, draftId, decision, userId, userName, editedBody } = args;

  const ref = adminClinicDoc(clinicId, "message_drafts", draftId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "That draft no longer exists." };

  const draft = snap.data() || {};
  if (draft.status !== "pending_review") {
    return { ok: false, error: "That draft has already been handled." };
  }

  if (decision === "reject") {
    await ref.update({
      status: "rejected" as DraftStatus,
      reviewedByUserId: userId,
      reviewedByName: userName || null,
      reviewedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, status: "rejected" };
  }

  const body = (editedBody ?? String(draft.body || "")).trim();
  if (!body) return { ok: false, error: "The message is empty." };

  const phone = normalizeToE164(String(draft.phone || ""));
  if (!phone) return { ok: false, error: "This patient has no usable phone number." };

  // No gateway connected: hand the finished message back so a person can send it, and leave the
  // draft in the queue. Marking it "sent" here would be the worst outcome — the patient never
  // hears from the clinic, and the queue says they did, so nobody ever chases it.
  const mode = await resolveWhatsappDeliveryMode(clinicId);
  if (mode === "manual") {
    await ref.update({
      body,
      reviewedByUserId: userId,
      reviewedByName: userName || null,
      reviewedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, status: "manual", phone, body };
  }

  try {
    await sendWhatsApp({ clinicId, to: phone, text: body });
  } catch (error: unknown) {
    // Left as failed rather than sent, so the queue reflects what actually went out.
    await ref.update({
      status: "failed" as DraftStatus,
      error: error instanceof Error ? error.message : "Send failed",
      reviewedByUserId: userId,
      reviewedAt: FieldValue.serverTimestamp(),
    });
    return { ok: false, error: error instanceof Error ? error.message : "Send failed" };
  }

  await ref.update({
    status: "sent" as DraftStatus,
    body,
    reviewedByUserId: userId,
    reviewedByName: userName || null,
    reviewedAt: FieldValue.serverTimestamp(),
    sentAt: FieldValue.serverTimestamp(),
  });

  // Mirrors what every other send path records, so this shows up in the patient's message history.
  await adminClinicCollection(clinicId, "whatsapp_logs").add({
    patientId: draft.patientId,
    type: draft.reason,
    message: body,
    status: "success",
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, status: "sent" };
}
