/**
 * The translation layer between WhatsApp's own ids and shapes and the ones the web app speaks.
 *
 * Pure functions, no Baileys import: everything here is unit-tested without a socket, and the
 * shapes it produces are the contract the web app's inbound route already parses
 * (src/app/api/webhooks/whatsapp-inbound/route.ts reads the WAHA/Wapilot layout — `event` at
 * the root, the message under `payload`). Keeping that layout means the web app does not learn
 * a new gateway; it just points at a different host.
 */

const WA_USER_SUFFIX = "@s.whatsapp.net";

/**
 * What the web app sends as `chat_id` → the jid WhatsApp wants.
 *
 *   201012345678        → 201012345678@s.whatsapp.net
 *   201012345678@c.us   → 201012345678@s.whatsapp.net
 *   1234567@lid         → unchanged (an anonymised sender is a valid destination as-is)
 *   1234-5678@g.us      → unchanged (a group)
 */
export function toWaJid(chatId) {
  const s = String(chatId || "").trim();
  if (!s) return "";
  if (/@(lid|g\.us|s\.whatsapp\.net|broadcast)$/i.test(s)) return s;
  const digits = s.replace(/@c\.us$/i, "").replace(/\D/g, "");
  return digits ? `${digits}${WA_USER_SUFFIX}` : "";
}

/** WhatsApp's jid → the `@c.us` form the web app stores and matches on. */
export function toChatId(jid) {
  const s = String(jid || "").trim();
  if (!s) return "";
  // A device-qualified id (`2010…:12@s.whatsapp.net`) names one phone; the chat is the person.
  return s.replace(/:\d+@/, "@").replace(/@s\.whatsapp\.net$/i, "@c.us");
}

export function digitsOf(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

/**
 * Unwrap the envelopes WhatsApp puts around a message's actual content.
 *
 * Disappearing messages, view-once, edits and documents-with-caption each nest the real message
 * one level down. Baileys has `normalizeMessageContent` for this; it is re-implemented here so
 * the shaping stays testable without the library.
 */
export function unwrapContent(message) {
  let m = message || null;
  for (let i = 0; i < 5 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message ||
      m.documentWithCaptionMessage?.message ||
      m.editedMessage?.message ||
      null;
    if (!inner) break;
    m = inner;
  }
  return m;
}

/** The words in a message, from whichever field WhatsApp put them in. Empty for a bare voice note. */
export function messageText(message) {
  const m = unwrapContent(message);
  if (!m) return "";
  return String(
    m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.documentMessage?.caption ||
      m.buttonsResponseMessage?.selectedDisplayText ||
      m.listResponseMessage?.title ||
      m.templateButtonReplyMessage?.selectedDisplayText ||
      m.interactiveResponseMessage?.body?.text ||
      ""
  ).trim();
}

/**
 * The attachment, if any, in the vocabulary the web app's media reader classifies on:
 * `ptt` is a push-to-talk voice note (what patients actually send), `audio` a forwarded file.
 */
export function messageMedia(message) {
  const m = unwrapContent(message);
  if (!m) return null;
  if (m.audioMessage) return { type: m.audioMessage.ptt ? "ptt" : "audio", mimetype: m.audioMessage.mimetype || "audio/ogg", field: "audioMessage" };
  if (m.imageMessage) return { type: "image", mimetype: m.imageMessage.mimetype || "image/jpeg", field: "imageMessage" };
  if (m.stickerMessage) return { type: "sticker", mimetype: m.stickerMessage.mimetype || "image/webp", field: "stickerMessage" };
  if (m.videoMessage) return { type: "video", mimetype: m.videoMessage.mimetype || "video/mp4", field: "videoMessage" };
  if (m.documentMessage) return { type: "document", mimetype: m.documentMessage.mimetype || "application/octet-stream", field: "documentMessage" };
  return null;
}

/** Messages that are not a person saying something: reactions, deletions, key exchanges. */
export function isSilentMessage(message) {
  const m = unwrapContent(message);
  if (!m) return true;
  const keys = Object.keys(m).filter((k) => k !== "messageContextInfo" && k !== "senderKeyDistributionMessage");
  if (keys.length === 0) return true;
  return keys.every((k) => /^(protocolMessage|reactionMessage|pollUpdateMessage|keepInChatMessage|encReactionMessage)$/.test(k));
}

/**
 * WhatsApp's own status ladder → the ack numbers the web app's parser reads
 * (lib/bot/wapilotAck.ts): -1 ERROR · 1 SERVER · 2 DEVICE · 3 READ · 4 PLAYED.
 *
 * Baileys' `WAMessageStatus`: 0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED.
 * PENDING is returned as null: it means "not yet sent", which is not a report.
 */
export function ackFromStatus(status) {
  const n = Number(status);
  if (!Number.isFinite(n)) return null;
  switch (n) {
    case 0:
      return { ack: -1, ackName: "ERROR" };
    case 2:
      return { ack: 1, ackName: "SERVER" };
    case 3:
      return { ack: 2, ackName: "DEVICE" };
    case 4:
      return { ack: 3, ackName: "READ" };
    case 5:
      return { ack: 4, ackName: "PLAYED" };
    default:
      return null;
  }
}

/**
 * The webhook body for a message, in the layout the web app already reads.
 *
 * `from` is the PHONE whenever WhatsApp let us know it. Since the lid privacy rollout a sender
 * can arrive as `1234@lid` with no phone in the message itself — but WhatsApp also hands the
 * paired phone number alongside (`remoteJidAlt`), which a third-party gateway never surfaced.
 * Passing it as `from` means the web app sees a patient it can look up instead of a stranger
 * behind a lid, and its whole lid-learning path becomes a fallback rather than the norm.
 */
export function buildMessageEvent({ instanceId, key, timestamp, text, media, mediaUrl, pushName, phoneJid }) {
  const chat = toChatId(key.remoteJid);
  const from = phoneJid ? toChatId(phoneJid) : chat;
  const payload = {
    id: key.id,
    from,
    to: key.fromMe ? chat : undefined,
    fromMe: Boolean(key.fromMe),
    body: text || "",
    type: media ? media.type : "chat",
    timestamp: Number(timestamp) || Math.floor(Date.now() / 1000),
    _data: {
      notifyName: pushName || undefined,
      // Kept alongside the phone, so the web app can learn the pairing without an echo.
      lid: /@lid$/i.test(chat) ? chat : undefined,
      chatId: chat,
    },
  };
  if (media) {
    payload.mimetype = media.mimetype;
    payload.hasMedia = true;
    if (mediaUrl) payload.media = { url: mediaUrl, mimetype: media.mimetype };
  }
  return { event: "message", session: instanceId, instanceId, payload };
}

export function buildAckEvent({ instanceId, key, status }) {
  const mapped = ackFromStatus(status);
  if (!mapped) return null;
  return {
    event: "message.ack",
    session: instanceId,
    instanceId,
    payload: {
      id: key.id,
      from: toChatId(key.remoteJid),
      fromMe: true,
      ack: mapped.ack,
      ackName: mapped.ackName,
    },
  };
}

/** A random pause between two sends, in milliseconds. */
export function randomGap(minMs, maxMs) {
  const lo = Math.max(0, Number(minMs) || 0);
  const hi = Math.max(lo, Number(maxMs) || lo);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
