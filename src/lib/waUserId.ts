/**
 * A WhatsApp sender with no phone number.
 *
 * Two shapes exist, one per channel:
 *
 *   `172357054414966@lid`      — the QR-linked gateway (see lib/whatsappLid).
 *   `EG.13491208655302741918`  — the official Cloud API: Meta's "business-scoped user id". Since
 *                                WhatsApp usernames, a person can write to a business without
 *                                their number ever being shared. Meta then OMITS `from` and
 *                                `wa_id` from the webhook and names the sender only by this id
 *                                (`from_user_id`, `contacts[].user_id`).
 *
 * Both are an address — a reply to them delivers — and neither is an identity: no patient can be
 * looked up from one, so booking still needs the person to type their number.
 *
 * Pure, no imports: the webhook, the senders, the chat key and the tests all read from here.
 */

/** Two-letter country code, a period, then up to 128 letters and digits (`ENT.` marks a parent id). */
const WA_USER_ID = /^[A-Za-z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/;

export function isWaUserId(value: unknown): boolean {
  return typeof value === "string" && WA_USER_ID.test(value.trim());
}

/** An address that reaches a person but hides their phone: a gateway lid or a Meta user id. */
export function isHiddenSender(address: unknown): boolean {
  if (typeof address !== "string") return false;
  const s = address.trim();
  return /@lid$/i.test(s) || WA_USER_ID.test(s);
}

/**
 * The conversation key for a user id, or "" when the value is not one.
 *
 * Every character is kept and the key is prefixed: the digits inside a user id are not a phone
 * number, and reducing them the way a phone is reduced could land on a real patient's thread.
 */
export function waUserIdKey(address: string): string {
  const s = String(address || "").trim();
  return WA_USER_ID.test(s) ? `uid_${s.replace(/[^A-Za-z0-9]/g, "_")}` : "";
}

/**
 * How one outgoing Cloud API message is addressed.
 *
 * A phone goes in `to`, as bare digits. A user id goes in `recipient`, verbatim — Meta refuses it
 * with any part changed, and stripping it to digits (what every send used to do) would address
 * the message to a number that is not this person.
 */
export function metaRecipient(to: string): { to: string } | { recipient: string } | null {
  const s = String(to || "").trim();
  if (WA_USER_ID.test(s)) return { recipient: s };
  const digits = s.replace(/\D/g, "");
  return digits ? { to: digits } : null;
}

export interface MetaInboundSender {
  /** Where the thread lives and where a reply goes: the phone when Meta shared it, else the user id. */
  address: string;
  /** International digits, or "" when the number is hidden. */
  phone: string;
  /** Meta's id for this person, present on every webhook since April 2026. */
  userId: string;
  username: string;
  /** Their WhatsApp profile name. */
  name: string;
}

/** Who sent one message of a Cloud API webhook, from the message and its sibling `contacts`. */
export function metaInboundSender(message: unknown, contacts: unknown): MetaInboundSender {
  const m = (message && typeof message === "object" ? message : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const phone = str(m.from).replace(/\D/g, "");
  const rawUserId = str(m.from_user_id);
  const userId = WA_USER_ID.test(rawUserId) ? rawUserId : "";

  const list = (Array.isArray(contacts) ? contacts : []).filter((c) => c && typeof c === "object") as Array<Record<string, unknown>>;
  const contact =
    list.find((c) => (userId && str(c.user_id) === userId) || (phone && str(c.wa_id).replace(/\D/g, "") === phone)) ||
    (list.length === 1 ? list[0] : undefined);
  const profile = (contact?.profile && typeof contact.profile === "object" ? contact.profile : {}) as Record<string, unknown>;

  return {
    address: phone || userId,
    phone,
    userId,
    username: str(profile.username).slice(0, 80),
    name: str(profile.name).slice(0, 80),
  };
}
