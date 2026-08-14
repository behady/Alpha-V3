import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";

/**
 * WhatsApp messages waiting for someone at the clinic to press send.
 *
 * The free tier of WhatsApp delivery. Meta gives no way for a third-party app to send a message on
 * a clinic's behalf — the only thing any app can do is open WhatsApp with the chat and the text
 * ready, and a person taps send. Automating that tap is possible with an accessibility service and
 * is how clinics get their number permanently banned, so it is not done here.
 *
 * What this collection buys is the part that *can* be automated: deciding who to message, writing
 * the right body from the right template, honouring opt-outs, and remembering what has already
 * gone. Sending becomes a minute of tapping through a list instead of looking up twelve patients
 * by hand.
 *
 * It also fixes something that was simply broken. The nightly reminder sweep runs at 03:00 with
 * nobody at a browser, so its WhatsApp leg gave up immediately with `no_whatsapp_connection` and
 * the reminders were never sent at all. Now they wait in here until morning.
 *
 * Separate from `sms_outbox` on purpose. That queue is drained by a background worker that sends
 * without a human; this one is a to-do list for a person. They share the policy that decides
 * whether to message someone (see lib/sms/events) but nothing about how a message leaves.
 */

export type WhatsappOutboxStatus = "queued" | "sent" | "skipped";

export interface WhatsappOutboxMessage {
  id: string;
  to: string;
  text: string;
  status: WhatsappOutboxStatus;
  /** Template name — `reminder24h`, `new`, `cancel`, and so on. */
  type: string;
  patientId?: string;
  patientName?: string;
  appointmentId?: string;
  createdAt: string;
  sentAt?: string;
  /** Which handset the person was holding. Only for working out who did what. */
  sentByDeviceId?: string;
}

const COLLECTION = "whatsapp_outbox";

/** Beyond this, a queued message is stale enough that sending it would confuse the patient. */
const EXPIRY_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Queue one message for a human to send.
 *
 * The document id is derived from what the message is *for*, so the nightly sweep running twice,
 * or a manual send racing it, cannot put the same reminder in the list twice. Returns false when
 * it was already there.
 */
export async function enqueueWhatsapp(
  clinicId: string,
  key: string,
  message: Omit<WhatsappOutboxMessage, "id" | "status" | "createdAt">
): Promise<boolean> {
  const ref = adminClinicDoc(clinicId, COLLECTION, key);
  const existing = await ref.get();
  if (existing.exists) return false;

  // Undefined is not a Firestore value and this object is assembled from optional fields.
  const payload: Record<string, unknown> = {
    status: "queued" satisfies WhatsappOutboxStatus,
    createdAt: new Date().toISOString(),
  };
  for (const [field, value] of Object.entries(message)) {
    if (value !== undefined) payload[field] = value;
  }

  await ref.set(payload);
  return true;
}

function toMessage(id: string, data: Record<string, unknown>): WhatsappOutboxMessage {
  return {
    id,
    to: String(data.to || ""),
    text: String(data.text || ""),
    status: (data.status as WhatsappOutboxStatus) || "queued",
    type: String(data.type || ""),
    patientId: data.patientId ? String(data.patientId) : undefined,
    patientName: data.patientName ? String(data.patientName) : undefined,
    appointmentId: data.appointmentId ? String(data.appointmentId) : undefined,
    createdAt: String(data.createdAt || ""),
    sentAt: data.sentAt ? String(data.sentAt) : undefined,
    sentByDeviceId: data.sentByDeviceId ? String(data.sentByDeviceId) : undefined,
  };
}

/**
 * Whether a queued message is still worth sending.
 *
 * A reminder for a visit that has already happened is worse than no reminder — the patient reads
 * "your appointment is tomorrow" about a day they have been and gone. Phones go flat and people
 * take holidays, so the list has to be able to give up on its own.
 */
export function isStale(message: Pick<WhatsappOutboxMessage, "createdAt">, now = Date.now()): boolean {
  const created = Date.parse(message.createdAt);
  if (!Number.isFinite(created)) return false;
  return now - created > EXPIRY_MS;
}

/** Everything still waiting, oldest first — the order a person should work through them. */
export async function pendingWhatsapp(clinicId: string, now = Date.now()): Promise<WhatsappOutboxMessage[]> {
  const snap = await adminClinicCollection(clinicId, COLLECTION).where("status", "==", "queued").get();
  return snap.docs
    .map((d) => toMessage(d.id, d.data() || {}))
    .filter((m) => !isStale(m, now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Recent activity for the settings screen, newest first. */
export async function recentWhatsapp(clinicId: string, limit = 30): Promise<WhatsappOutboxMessage[]> {
  const snap = await adminClinicCollection(clinicId, COLLECTION).get();
  return snap.docs
    .map((d) => toMessage(d.id, d.data() || {}))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
