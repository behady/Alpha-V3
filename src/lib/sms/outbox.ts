import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * The queue of text messages waiting for the clinic's phone to send them.
 *
 * A queue rather than a direct send, because the sender is a phone in someone's pocket. The server
 * decides *what* to send at 07:00; the phone sends it whenever it next has signal and battery.
 * Everything about this file exists to keep that gap honest — a message is only ever reported as
 * sent when the handset says the network accepted it.
 */

export type SmsStatus = "queued" | "sending" | "sent" | "failed";

export interface SmsMessage {
  id: string;
  to: string;
  text: string;
  status: SmsStatus;
  type: string;
  patientId?: string;
  patientName?: string;
  appointmentId?: string;
  createdAt: string;
  claimedAt?: string;
  claimedByDeviceId?: string;
  sentAt?: string;
  error?: string;
  attempts: number;
}

const COLLECTION = "sms_outbox";

/**
 * How long a claimed message may sit before another attempt is allowed.
 *
 * The phone marks a message as its own the moment it picks it up, then sends it. If the app is
 * killed in between — battery saver, a reboot, the user swiping it away — nothing would ever come
 * back to unstick it, and the patient would simply never be reminded. After this long, the message
 * returns to the queue. Long enough that a phone briefly out of signal is not treated as dead.
 */
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

/** Stop retrying a number the network keeps refusing, instead of texting it forever. */
const MAX_ATTEMPTS = 3;

/** One phone, one round: enough for a normal clinic day, small enough to ack quickly. */
const CLAIM_BATCH = 25;

/**
 * Queue one reminder.
 *
 * The document id is derived from what the message is *for*, not generated — so a cron run that
 * fires twice, or a manual send racing the nightly sweep, cannot queue the same reminder twice.
 * Returns false when it was already there.
 */
export async function enqueueSms(
  clinicId: string,
  key: string,
  message: Omit<SmsMessage, "id" | "status" | "createdAt" | "attempts">
): Promise<boolean> {
  const ref = adminClinicDoc(clinicId, COLLECTION, key);
  const existing = await ref.get();
  if (existing.exists) return false;

  await ref.set({
    ...message,
    status: "queued" satisfies SmsStatus,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  return true;
}

function toMessage(id: string, data: Record<string, unknown>): SmsMessage {
  return {
    id,
    to: String(data.to || ""),
    text: String(data.text || ""),
    status: (data.status as SmsStatus) || "queued",
    type: String(data.type || ""),
    patientId: data.patientId ? String(data.patientId) : undefined,
    patientName: data.patientName ? String(data.patientName) : undefined,
    appointmentId: data.appointmentId ? String(data.appointmentId) : undefined,
    createdAt: String(data.createdAt || ""),
    claimedAt: data.claimedAt ? String(data.claimedAt) : undefined,
    claimedByDeviceId: data.claimedByDeviceId ? String(data.claimedByDeviceId) : undefined,
    sentAt: data.sentAt ? String(data.sentAt) : undefined,
    error: data.error ? String(data.error) : undefined,
    attempts: Number(data.attempts || 0),
  };
}

/**
 * Hand a batch of messages to one phone.
 *
 * Claiming happens in a transaction so that two paired phones polling at the same moment cannot
 * both walk away with the same reminder — the patient would get the same text twice, from two
 * numbers, which is worse than not being reminded at all.
 */
export async function claimSms(clinicId: string, deviceId: string): Promise<SmsMessage[]> {
  const db = adminDb();
  const collection = adminClinicCollection(clinicId, COLLECTION);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    // Pending work, whether never picked up or picked up by a phone that then went silent. Both
    // states are read here so the abandoned ones can be recovered in the same pass.
    const snap = await tx.get(collection.where("status", "in", ["queued", "sending"]).limit(CLAIM_BATCH * 2));

    const claimed: SmsMessage[] = [];
    for (const doc of snap.docs) {
      if (claimed.length >= CLAIM_BATCH) break;

      const message = toMessage(doc.id, doc.data() || {});
      if (message.attempts >= MAX_ATTEMPTS) continue;

      if (message.status === "sending") {
        const claimedAt = message.claimedAt ? Date.parse(message.claimedAt) : 0;
        // Still with another phone, and not yet overdue — leave it alone.
        if (Number.isFinite(claimedAt) && now - claimedAt < CLAIM_TIMEOUT_MS) continue;
      }

      tx.update(doc.ref, {
        status: "sending" satisfies SmsStatus,
        claimedAt: new Date(now).toISOString(),
        claimedByDeviceId: deviceId,
        attempts: message.attempts + 1,
      });

      claimed.push({ ...message, status: "sending", attempts: message.attempts + 1 });
    }

    return claimed;
  });
}

export interface SmsAck {
  id: string;
  sent: boolean;
  /** The handset's own reason for a failure — "no service", "generic failure", and so on. */
  error?: string;
  /** When the handset says the network took it. Falls back to server time if absent. */
  sentAt?: string;
}

/**
 * Record what the phone actually managed to send.
 *
 * A failure is written back as `queued`, not `failed`, while attempts remain — a text that failed
 * because the phone was underground at 07:00 should go out at 07:15, not be abandoned. Only once
 * the attempts are used up does it become a visible failure, because at that point a human needs
 * to know the patient was never told.
 */
export async function ackSms(clinicId: string, deviceId: string, acks: SmsAck[]): Promise<{ sent: number; failed: number; requeued: number }> {
  const db = adminDb();
  const batch = db.batch();
  let sent = 0;
  let failed = 0;
  let requeued = 0;

  for (const ack of acks) {
    if (!ack.id) continue;
    const ref = adminClinicDoc(clinicId, COLLECTION, ack.id);
    const snap = await ref.get();
    if (!snap.exists) continue;

    const message = toMessage(snap.id, snap.data() || {});
    // A phone acking a message it never claimed is either a stale retry after the claim timed out
    // or a confused client; either way the phone that owns it now is the authority.
    if (message.claimedByDeviceId && message.claimedByDeviceId !== deviceId) continue;

    if (ack.sent) {
      batch.update(ref, {
        status: "sent" satisfies SmsStatus,
        sentAt: ack.sentAt || new Date().toISOString(),
        error: null,
      });
      sent += 1;
      continue;
    }

    const exhausted = message.attempts >= MAX_ATTEMPTS;
    batch.update(ref, {
      status: (exhausted ? "failed" : "queued") satisfies SmsStatus,
      error: ack.error || "The phone could not send this message.",
      claimedAt: null,
      claimedByDeviceId: null,
    });
    if (exhausted) failed += 1;
    else requeued += 1;
  }

  await batch.commit();
  return { sent, failed, requeued };
}

/** Recent queue activity for the settings screen, newest first. */
export async function recentSms(clinicId: string, limit = 30): Promise<SmsMessage[]> {
  const snap = await adminClinicCollection(clinicId, COLLECTION).get();
  return snap.docs
    .map((d) => toMessage(d.id, d.data() || {}))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
