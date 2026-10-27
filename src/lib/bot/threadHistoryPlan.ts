import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";

/**
 * Old WhatsApp messages, and messages typed on the clinic's own phone, onto the chat threads.
 *
 * On the QR-linked gateway the clinic's number still lives in a real phone, and the system is one
 * more linked device. Two things never reached the chat screen: the chats that already existed
 * when the phone was linked (WhatsApp copies them to a new device, the gateway threw the copy
 * away), and anything a receptionist typed on the phone itself (the gateway passed it on, the web
 * app only used it to learn lids). Both arrive here as plain items and are filed — never answered.
 *
 * This file is the pure half: reading the items, deciding the thread, and spotting a line the
 * thread already has. No database, so it is tested directly (tests/threadHistory.test.mts).
 */

export type HistoryItem = {
  /** WhatsApp's id for the message — the same one a send through the gateway was recorded under. */
  id: string;
  /** The other person: `201012345678@c.us`, or `123…@lid` when WhatsApp hid the number. */
  from: string;
  fromMe: boolean;
  body: string;
  /** "chat" for words, else the media kind: image, video, audio, document, sticker. */
  type: string;
  /** Seconds. */
  timestamp: number;
};

export type ExistingLine = {
  messageId?: string;
  waMessageId?: string;
  direction?: string;
  text?: string;
  at?: number;
};

const MEDIA_KINDS = new Set(["image", "video", "audio", "document", "sticker"]);

/** What the gateway posted, kept only where it is a usable message. */
export function readHistoryItems(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryItem[] = [];
  for (const r of raw.slice(0, 500)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    const from = typeof o.from === "string" ? o.from.trim() : "";
    const timestamp = Number(o.timestamp);
    if (!id || !from || !Number.isFinite(timestamp) || timestamp <= 0) continue;
    const type = typeof o.type === "string" && MEDIA_KINDS.has(o.type) ? o.type : "chat";
    const body = typeof o.body === "string" ? o.body.trim().slice(0, 4000) : "";
    if (!body && type === "chat") continue;
    out.push({ id, from, fromMe: o.fromMe === true, body, type, timestamp });
  }
  return out;
}

/** The address a thread is keyed on — the same one the live inbound path computes. */
export function historyAddress(from: string): string {
  const s = String(from || "").trim();
  if (/@lid$/i.test(s)) return s;
  return normalizeToE164AssumingCountry(s.split("@")[0]);
}

/** A stable document id, so the same message filed twice is one line, not two. */
export function historyLineId(id: string): string {
  return `wa_${String(id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120)}`;
}

function squash(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/** How far apart a recorded line and WhatsApp's own timestamp can be and still be one message. */
const SAME_MESSAGE_MS = 3 * 60 * 1000;

/**
 * Whether the thread already holds this message.
 *
 * By id first: a send through the gateway is recorded under the id the gateway returned, which
 * is the id WhatsApp later reports. Then by words and time, for the lines that were recorded
 * without one — patient messages received live, and a few of the bot's extra bubbles. Messages
 * the system sent may have been recorded slightly differently from what went out (a footer, a
 * trimmed space), so the words only need to share their opening.
 */
export function isAlreadyInThread(item: HistoryItem, existing: ExistingLine[]): boolean {
  const at = item.timestamp * 1000;
  const direction = item.fromMe ? "out" : "in";
  const words = squash(item.body);
  const head = words.slice(0, 40);
  for (const line of existing) {
    if (line.messageId === item.id || line.waMessageId === item.id) return true;
    if (line.direction !== direction) continue;
    if (typeof line.at !== "number" || Math.abs(line.at - at) > SAME_MESSAGE_MS) continue;
    const theirs = squash(line.text || "");
    if (!words) {
      // A bare photo or voice note: its line says "[image]" / "[audio]".
      if (theirs === `[${item.type}]`) return true;
      continue;
    }
    if (theirs === words) return true;
    if (head.length >= 12 && (theirs.startsWith(head) || words.startsWith(theirs.slice(0, 40)))) return true;
  }
  return false;
}

/** The thread line for one item. */
export function historyLine(item: HistoryItem) {
  const media = item.type === "chat" ? undefined : item.type;
  const text = item.body || (media ? `[${media}]` : "");
  return {
    direction: item.fromMe ? ("out" as const) : ("in" as const),
    // Typed on the clinic's phone: a person, though not one the system can name.
    author: item.fromMe ? ("staff" as const) : ("patient" as const),
    text,
    at: item.timestamp * 1000,
    messageId: item.id,
    kind: item.fromMe ? "from_phone" : "history",
    channel: "wapilot" as const,
    ...(media ? { media } : {}),
  };
}
