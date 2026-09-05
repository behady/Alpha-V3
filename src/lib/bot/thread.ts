import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { conversationKey } from "./conversation";

/**
 * The full WhatsApp thread with one number, both directions, every voice.
 *
 * The conversation document remembers what the bot needs — state, budgets, pending options — and
 * the handoff inbox showed a person the one sentence that triggered a flag. Neither is a chat.
 * On the official channel the clinic's number lives on Meta's servers, not in anyone's phone, so
 * there is no WhatsApp app to open and scroll back through: if the system does not keep the
 * thread, nobody has it. This is that thread.
 *
 * One subcollection under the conversation, `messages`, one document per message, and a handful
 * of summary fields on the parent so a list of chats can render without opening every thread:
 * who wrote last, what they said, when, and how many patient messages nobody has read yet.
 *
 * Written only from the server. Every send already passes through one of three places (the bot's
 * reply, a staff reply, the notification pipeline) and every receive through one of two webhooks;
 * recording at those five points is what keeps the thread complete rather than "mostly complete".
 */

export type ThreadAuthor = "patient" | "bot" | "staff" | "system";

export interface ThreadMessageInput {
  direction: "in" | "out";
  author: ThreadAuthor;
  text: string;
  /** The message carried media instead of (or as well as) words. */
  media?: string;
  /** WhatsApp's own id for an inbound message, kept for later media download. */
  messageId?: string;
  /** For staff messages: who typed it. */
  uid?: string;
  name?: string;
  /**
   * What kind of system or bot message this was — a booking confirmation, a reminder, the bot's
   * `hours` answer — so the thread can label it. Free-form slug; the UI maps what it knows.
   */
  kind?: string;
  /** Which gateway carried it: "meta" for the official channel, "wapilot" for the unofficial one. */
  channel?: "meta" | "wapilot";
}

/** Keep the list preview short; the thread has the rest. */
const PREVIEW_CHARS = 160;

/** A media message with no caption still needs words in the list. */
export function mediaPlaceholder(media: string | undefined, text: string): string {
  if (text.trim()) return text.trim();
  return media ? `[${media}]` : "";
}

/**
 * Append one message to the thread and refresh the parent's summary in the same breath.
 *
 * Failures are swallowed by the caller's choice, not here: recording the thread must never be
 * what stops a reply from going out, so callers wrap this in a catch and move on. The cost of a
 * missing thread line is a gap in history; the cost of a missing reply is a patient left hanging.
 */
export async function recordThreadMessage(
  clinicId: string,
  address: string,
  m: ThreadMessageInput,
  now: number = Date.now()
): Promise<void> {
  const key = conversationKey(address);
  const text = mediaPlaceholder(m.media, m.text).slice(0, 4000);
  if (!text) return;

  const parent = adminClinicDoc(clinicId, "whatsapp_conversations", key);

  const line: Record<string, unknown> = {
    direction: m.direction,
    author: m.author,
    text,
    at: now,
    createdAt: FieldValue.serverTimestamp(),
  };
  // Firestore rejects an explicit undefined; these are optional by nature.
  if (m.media) line.media = m.media;
  if (m.messageId) line.messageId = m.messageId;
  if (m.uid) line.uid = m.uid;
  if (m.name) line.name = m.name;
  if (m.kind) line.kind = m.kind;
  if (m.channel) line.channel = m.channel;

  const summary: Record<string, unknown> = {
    phone: address,
    lastText: text.replace(/\s+/g, " ").slice(0, PREVIEW_CHARS),
    lastAt: now,
    lastDirection: m.direction,
    lastAuthor: m.author,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (m.channel) summary.channel = m.channel;
  if (m.direction === "in") {
    // What the 24-hour rule is measured from: only a patient's own message opens the window.
    summary.lastInboundAt = now;
    summary.unreadCount = FieldValue.increment(1);
  }

  await Promise.all([parent.collection("messages").add(line), parent.set(summary, { merge: true })]);

  // A number the bot never identified (bot off, stranger, opt-out) still deserves a name in the
  // list. One exact-match query, the shape the app stores E.164 phones in — never the 3000-row
  // scan the bot uses, which is too heavy to pay on every message.
  if (m.direction === "in" && !key.startsWith("lid_")) {
    await attachPatientIfMissing(clinicId, key, address).catch(() => {});
  }
}

async function attachPatientIfMissing(clinicId: string, key: string, address: string): Promise<void> {
  const parent = adminClinicDoc(clinicId, "whatsapp_conversations", key);
  const snap = await parent.get();
  if (snap.exists && typeof snap.data()?.patientId === "string" && snap.data()?.patientId) return;
  const digits = address.replace(/\D/g, "");
  if (digits.length < 7) return;
  const hit = await adminClinicCollection(clinicId, "patients").where("phone", "==", `+${digits}`).limit(1).get();
  if (hit.empty) return;
  const p = hit.docs[0];
  const name = String(p.data()?.name || "").trim();
  await parent.set({ patientId: p.id, ...(name ? { patientName: name } : {}) }, { merge: true });
}
