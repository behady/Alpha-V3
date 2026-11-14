import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { conversationKey } from "./conversation";
import { normaliseForClaim } from "./replyClaims";
import { knownPatientPatch } from "./threadPatientLink";

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
  /** Meta's id for an OUTBOUND message — the key its sent/delivered/read/failed statuses carry. */
  waMessageId?: string;
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
  /** For a file the clinic sent: where the bubble renders it from, and what it is. */
  mediaUrl?: string;
  mime?: string;
  /** For a message the clinic sent: the patient it was addressed to, so the chat is named from line one. */
  patientId?: string;
  patientName?: string;
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
): Promise<string> {
  const key = conversationKey(address);
  const text = mediaPlaceholder(m.media, m.text).slice(0, 4000);
  if (!text) return "";

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
  if (m.waMessageId) {
    line.waMessageId = m.waMessageId;
    // The API accepted it; Meta's status webhook moves it on from here (see updateThreadStatus).
    line.status = "sent";
  }
  if (m.uid) line.uid = m.uid;
  if (m.name) line.name = m.name;
  if (m.kind) line.kind = m.kind;
  if (m.channel) line.channel = m.channel;
  if (m.mediaUrl) line.mediaUrl = m.mediaUrl;
  if (m.mime) line.mime = m.mime;

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
    // A patient writing to an archived chat brings it back to the list — archived means "done
    // for now", and a new message is exactly what ends that.
    summary.archived = false;
    summary.unreadCount = FieldValue.increment(1);
  }

  const [lineRef] = await Promise.all([parent.collection("messages").add(line), parent.set(summary, { merge: true })]);

  // A number the bot never identified (bot off, stranger, opt-out) still deserves a name in the
  // list. One exact-match query, the shape the app stores E.164 phones in — never the 3000-row
  // scan the bot uses, which is too heavy to pay on every message.
  if (m.direction === "in" && !key.startsWith("lid_")) {
    await attachPatientIfMissing(clinicId, key, address).catch(() => {});
  }
  // A confirmation or reminder opens the chat before the patient ever writes, and its sender
  // already knows who it is for — without this the chat showed a bare number until they replied.
  const known = m.direction === "out" ? knownPatientPatch(m.patientId, m.patientName) : null;
  if (known) {
    await attachKnownPatientIfMissing(clinicId, key, known).catch(() => {});
  }

  // The line's id, so a background step (media download) can find it again.
  return lineRef.id;
}

/**
 * The words in a voice note, attached to the voice note.
 *
 * Written onto the audio's own line rather than as a second message, so one recording is one
 * bubble with its text underneath — and one unread, not two.
 */
export async function attachTranscript(
  clinicId: string,
  address: string,
  lineId: string,
  transcript: string
): Promise<void> {
  const text = transcript.trim().slice(0, 4000);
  if (!lineId || !text) return;
  const parent = adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(address));
  await Promise.all([
    parent.collection("messages").doc(lineId).set({ transcript: text }, { merge: true }),
    // The list preview reads better as the words than as "[audio]".
    parent.set({ lastText: `🎤 ${text.replace(/\s+/g, " ").slice(0, PREVIEW_CHARS - 3)}` }, { merge: true }),
  ]);
}

export type ThreadDeliveryStatus = "sent" | "delivered" | "read" | "failed";

/** WhatsApp's own ordering: a status never moves backwards, whatever order webhooks arrive in. */
const STATUS_RANK: Record<ThreadDeliveryStatus, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/**
 * What Meta did with a message after accepting it.
 *
 * "Accepted by the API" and "on the patient's phone" are not the same thing — a free-form reply
 * outside the 24-hour window returns 200 and then fails in a status webhook a second later. The
 * ticks in the chat are drawn from this, so a receptionist sees the difference instead of being
 * told "sent" about a message nobody received.
 */
export async function updateThreadStatus(
  clinicId: string,
  recipient: string,
  waMessageId: string,
  status: ThreadDeliveryStatus,
  error?: { code?: number | string; message?: string }
): Promise<void> {
  if (!waMessageId) return;
  const key = conversationKey(recipient);
  const hit = await adminClinicDoc(clinicId, "whatsapp_conversations", key)
    .collection("messages")
    .where("waMessageId", "==", waMessageId)
    .limit(1)
    .get();
  if (hit.empty) return;
  const doc = hit.docs[0];
  const current = (doc.data().status as ThreadDeliveryStatus | undefined) || "sent";
  if (STATUS_RANK[status] <= STATUS_RANK[current] && status !== "failed") return;

  const patch: Record<string, unknown> = { status, statusAt: Date.now() };
  if (status === "failed" && error) {
    patch.errorCode = error.code ?? null;
    patch.errorMessage = String(error.message || "").slice(0, 300);
  }
  await doc.ref.set(patch, { merge: true });
}

/** Names a chat after the patient with this number, unless it already has one. */
export async function attachPatientIfMissing(clinicId: string, key: string, address: string): Promise<void> {
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

/** Never re-points a chat someone already linked: a shared family number keeps the patient it has. */
async function attachKnownPatientIfMissing(
  clinicId: string,
  key: string,
  known: { patientId: string; patientName?: string }
): Promise<void> {
  const parent = adminClinicDoc(clinicId, "whatsapp_conversations", key);
  const snap = await parent.get();
  if (typeof snap.data()?.patientId === "string" && snap.data()?.patientId) return;
  await parent.set(known, { merge: true });
}

/** What the bot knows about the message it is answering, to tell a NEW message from a copy of this one. */
export type CurrentInbound = { text: string; messageId?: string };

/**
 * The inbound same-words claim's window (respond.ts): the same words again inside it are refused
 * by their own turn, so such a line will never get an answer of its own.
 */
const REPEAT_MS = 20_000;

/** What a patient line said, as the inbound claim compares it: a voice note by its transcript. */
const said = (line: Record<string, unknown>): string => normaliseForClaim(String(line.transcript || line.text || ""));

/** "[image]", "[audio]": a media line with no words (yet). */
const MEDIA_PLACEHOLDER = /^\[[a-z_]+\]$/i;

/**
 * Is this thread line a patient message newer than the one being answered?
 *
 * `sinceMs` is the `at` of the answered message's OWN line. It used to be the moment its turn
 * started, which is later than the line: two messages landing 8 ms apart (14/11/2026, "عياده
 * اسنان" then "السلام عليكم") were each older than the other turn's start, neither turn saw the
 * other, and the patient got two greetings and two different offers. Two lines in the same
 * millisecond are ordered by id, so the two turns always agree which one is newer.
 *
 * A copy of the answered message (same id, or the same words) is not newer. Neither is a line filed
 * from the phone's own history on the QR line: nobody answers those. Pure, so the rule is
 * unit-tested; newerPatientLines does the read.
 */
export function isNewerPatientLine(line: Record<string, unknown>, current: CurrentInbound, sinceMs: number): boolean {
  if (line.direction !== "in" || line.author !== "patient") return false;
  if (line.kind === "history") return false;
  const at = Number(line.at);
  if (!(at >= sinceMs)) return false;
  if (current.messageId && line.messageId === current.messageId) return false;
  // Same millisecond: the larger id is the newer one, so exactly one of the two turns gives way.
  if (at === sinceMs && !(current.messageId && typeof line.messageId === "string" && line.messageId > current.messageId)) return false;
  return said(line) !== normaliseForClaim(current.text);
}

/**
 * The patient lines in `lines` (oldest first) that are newer than the answered message and will be
 * answered by a turn of their own.
 *
 * A line repeating an earlier line's words inside the inbound claim's window is left out: its turn
 * is refused as a duplicate, so it answers nothing, and it must not silence an answer that is
 * still owed. A media line with no words yet (a voice note being transcribed) is never a repeat.
 */
export function newerLinesOf(lines: Array<Record<string, unknown>>, current: CurrentInbound, sinceMs: number): Array<Record<string, unknown>> {
  const patient = lines.filter((l) => l.direction === "in" && l.author === "patient" && l.kind !== "history");
  const repeats = (l: Record<string, unknown>): boolean => {
    const words = said(l);
    if (!words || MEDIA_PLACEHOLDER.test(words)) return false;
    const at = Number(l.at);
    return patient.some((p) => p !== l && Number(p.at) < at && at - Number(p.at) <= REPEAT_MS && said(p) === words);
  };
  return patient.filter((l) => isNewerPatientLine(l, current, sinceMs) && !repeats(l));
}

/**
 * Did the patient write again after the message being answered? The lines that say so.
 *
 * Several messages in quick succession each start their own turn, and with a slow model the turns
 * overlap. The newest turn's model reads the whole thread and answers all of it, so an answer
 * composed for an older message may be dropped unsent (respond.ts asks lib/bot/supersede which
 * newer lines will really reach the model). Read from 20 seconds before the message, so a repeat
 * can be recognised. Never throws: a read failure means "nothing newer", and the answer goes out.
 */
export async function newerPatientLines(clinicId: string, address: string, sinceMs: number, current: CurrentInbound): Promise<Array<Record<string, unknown>>> {
  const lines = await recentThreadLines(clinicId, address, sinceMs - REPEAT_MS - 1, 30);
  return newerLinesOf(lines.reverse(), current, sinceMs);
}

/**
 * The newest thread lines since `sinceMs`, newest first, at most `max`.
 *
 * For rules that need the clinic's last word to the patient (lib/bot/staffHold). Never throws: a
 * read failure is an empty list, and the caller then behaves as it did before the rule existed.
 */
export async function recentThreadLines(clinicId: string, address: string, sinceMs: number, max = 30): Promise<Record<string, unknown>[]> {
  try {
    const snap = await adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(address))
      .collection("messages")
      .where("at", ">", sinceMs)
      .orderBy("at", "desc")
      .limit(max)
      .get();
    return snap.docs.map((d) => d.data() || {});
  } catch {
    return [];
  }
}
