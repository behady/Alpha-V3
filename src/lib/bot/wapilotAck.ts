import type { ThreadDeliveryStatus } from "@/lib/bot/thread";

/**
 * The gateway saying what happened to a message after it accepted it.
 *
 * "The API said ok" and "it is on the patient's phone" are different facts, and the chat screen
 * draws its ticks from the second one. On the official channel Meta posts that as a `statuses`
 * webhook; the gateway posts it as an ack event — and until this read them, every message sent
 * through the gateway stayed on one tick forever, so a receptionist could not tell a message the
 * patient had read from one that never arrived.
 *
 * WhatsApp's own ack ladder, which the gateway passes straight through:
 *   -1 ERROR · 0 PENDING · 1 SERVER (left us) · 2 DEVICE (on their phone) · 3 READ · 4 PLAYED
 *
 * PLAYED is READ for a voice note. PENDING is deliberately dropped: it means "not yet sent", and
 * `updateThreadStatus` never moves a status backwards anyway, so reporting it could only ever be
 * noise.
 */

export type DeliveryAck = {
  /** The chat the message was sent into — the address the thread is keyed on. */
  chatId: string;
  /** The gateway's id for the message, matched against what the send recorded. */
  messageId: string;
  status: ThreadDeliveryStatus;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function obj(v: unknown): Record<string, any> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : null;
}

/** The id as a string, whether it arrived flat or as whatsapp-web.js's serialised object. */
function idOf(m: Record<string, any>): string {
  return (
    str(m.id) ||
    str(obj(m.id)?._serialized) ||
    str(m.messageId) ||
    str(m.message_id) ||
    str(obj(m.key)?.id) ||
    str(m.msgId) ||
    str(obj(m._data)?.id?._serialized)
  );
}

/**
 * A number on WhatsApp's ladder, or a word, into the four states the thread stores.
 *
 * Both are read because the two field names do not always travel together: some builds send
 * `ack: 3` with no `ackName`, and some send `status: "read"` with no number at all.
 */
export function ackToStatus(ack: unknown, name: unknown): ThreadDeliveryStatus | null {
  const word = str(name).toLowerCase();
  if (word) {
    if (word === "error" || word === "failed") return "failed";
    if (word === "server" || word === "sent") return "sent";
    if (word === "device" || word === "delivered") return "delivered";
    if (word === "read" || word === "played") return "read";
    if (word === "pending") return null;
  }

  // `Number("")` is 0 — which would read an absent ack as PENDING rather than as "no ack here".
  if (ack === null || ack === undefined || ack === "") return null;
  const n = Number(ack);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return "failed";
  if (n === 1) return "sent";
  if (n === 2) return "delivered";
  if (n >= 3) return "read";
  return null; // 0 = PENDING
}

/**
 * Find a delivery report in whatever the gateway posted.
 *
 * Takes the candidate wrappers the inbound route has already unpacked, so a wrapper added there
 * is understood here too. Returns null for ordinary messages — the common case by far — and the
 * route then carries on treating the payload as a patient writing in.
 */
export function extractDeliveryAck(body: Record<string, any>, candidates: Record<string, any>[]): DeliveryAck | null {
  const event = str(body.event) || str(body.type) || str(body.eventType);
  // An event named "message" is an ordinary message, not a report; only ack/status events count.
  const named = /ack|status|receipt|delivery/i.test(event);

  for (const m of candidates) {
    const status = ackToStatus(m.ack ?? m.ackCode ?? m.acknowledgement, m.ackName ?? m.status ?? m.state);
    if (!status) continue;

    /*
     * A report is about OUR message. An inbound message from a patient can carry an ack of its
     * own (their phone telling us it was delivered to them), and reading that as a report would
     * look up an id we never sent and quietly do nothing — but it would also mean the patient's
     * actual message was consumed as a receipt and never answered. So unless the event names
     * itself a report, `fromMe` has to say so.
     */
    const fromMe = m.fromMe === true || m.fromMe === "true" || m.from_me === true || (typeof m.id === "string" && m.id.startsWith("true_"));
    if (!named && !fromMe) continue;

    const messageId = idOf(m);
    // `from` on a report is the chat it belongs to; `to`/`chatId` are what flatter gateways call
    // the same thing.
    const chatId = str(m.from) || str(m.chatId) || str(m.chat_id) || str(m.to) || str(m.recipient);
    if (!messageId || !chatId) continue;

    return { chatId, messageId, status };
  }

  return null;
}
