/**
 * Which automated channels a single patient may be contacted on.
 *
 * Two fields on the patient record, and they are deliberately not symmetrical:
 *
 *   `whatsappOptOut`  true  → no automated WhatsApp. Has existed for a long time.
 *   `smsOptOut`       true  → no automated SMS.
 *                     false → SMS allowed, even if WhatsApp is opted out.
 *                     unset → follow whatsappOptOut.
 *
 * That third state is the point. SMS sending was added long after patients had already been marked
 * as opted out of WhatsApp, and those marks mean "stop messaging me" — not "stop messaging me on
 * this particular app". If an unset smsOptOut simply meant "allowed", switching SMS on would start
 * texting every one of those patients on day one, which is the opposite of what they asked for.
 *
 * So an unset value inherits, and setting it explicitly to false is how staff say "this patient is
 * fine with texts even though WhatsApp is off" — which is exactly the case where a patient has no
 * WhatsApp at all.
 */

export interface PatientContactPreferences {
  whatsappOptOut?: boolean;
  /** Tri-state on purpose: true, false, or absent. See the note above. */
  smsOptOut?: boolean;
}

/** True when automated WhatsApp must not be sent to this patient. */
export function isWhatsAppBlocked(patient: PatientContactPreferences | null | undefined): boolean {
  return patient?.whatsappOptOut === true;
}

/** True when automated SMS must not be sent to this patient. */
export function isSmsBlocked(patient: PatientContactPreferences | null | undefined): boolean {
  if (patient?.smsOptOut === true) return true;
  if (patient?.smsOptOut === false) return false;
  // Unset: inherit the older, broader preference rather than assuming consent.
  return patient?.whatsappOptOut === true;
}

/** How the patient profile should describe the current SMS state, including why. */
export type SmsPreferenceState = "allowed" | "blocked_explicitly" | "blocked_by_whatsapp";

export function smsPreferenceState(patient: PatientContactPreferences | null | undefined): SmsPreferenceState {
  if (patient?.smsOptOut === true) return "blocked_explicitly";
  if (patient?.smsOptOut === false) return "allowed";
  return patient?.whatsappOptOut === true ? "blocked_by_whatsapp" : "allowed";
}

/* ------------------------------------------------------------------------------------------------
 * Opt-out: the line at the bottom of the message, and the reply that acts on it.
 *
 * This is account protection, not politeness. What gets a clinic's WhatsApp number restricted is
 * recipients pressing "Block" and "Report spam" — Meta reads those as the signal, and an
 * unofficial gateway number has no appeals process worth the name. A visible way to stop the
 * messages is what a annoyed patient uses *instead* of the report button, so the footer is
 * cheaper than the ban it prevents.
 *
 * The words below are therefore a promise. Anything that prints this footer must also honour the
 * reply — see lib/optOutInbound. A footer saying "reply STOP" over a number where STOP does
 * nothing is worse than no footer at all: it converts a patient who would have muted the chat
 * into one who reports it.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Arabic written by hand varies more than the keyword list can: hamza forms (إيقاف/ايقاف),
 * ya/alef-maqsura, and tashkeel a phone keyboard adds by accident. Fold all of it before matching,
 * so a patient who types the word correctly is not ignored on a technicality.
 */
export function normalizeReplyText(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    // Tashkeel and the tatweel stretch character.
    .replace(/[ؐ-ًؚ-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    // Punctuation people add around a single word: "stop.", "«إيقاف»".
    .replace(/[.!؟?,،"'«»()\[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Replies that mean "stop messaging me", already normalized.
 *
 * Deliberately narrow. "إلغاء" and "cancel" are absent although both are plainly opt-out words in
 * other products: in a dental clinic they overwhelmingly mean *cancel my appointment*, and reading
 * that as consent withdrawal would silently cut a patient off from their own reminders while the
 * receptionist believes the appointment was cancelled. A word that is ambiguous here is left for a
 * human to read.
 */
const OPT_OUT_REPLIES = new Set([
  // English
  "stop",
  "unsubscribe",
  "opt out",
  "optout",
  "remove me",
  "no messages",
  // Arabic
  "ايقاف",
  "توقف",
  "توقفوا",
  "اوقف",
  "اوقفوا",
  "ايقاف الرسايل",
  "ايقاف الرسائل",
  "الغاء الاشتراك",
  "لا رسائل",
  "لا رسايل",
  "لا تراسلني",
  "لا تراسلوني",
  "مش عايز رسائل",
  "مش عايز رسايل",
  // The ways people actually say it. None of these were recognised, so a patient who wrote
  // "بلاش رسايل" kept receiving reminders while formally still consenting — which on WhatsApp is
  // the exact behaviour that gets a business number restricted.
  "بلاش رسايل",
  "بلاش رسائل",
  "بلاش رسايل تاني",
  "مش عايزه رسايل",
  "مش عايزة رسائل",
  "مش عاوز رسايل",
  "مش عاوز رسائل",
  "امسحوا رقمي",
  "امسح رقمي",
  "شيلوا رقمي",
  "شيلوني",
  "شيلوني من القايمه",
  "شيلوني من القائمة",
  "سيبوني في حالي",
  "سيبوني",
  "متبعتوش تاني",
  "متبعتش تاني",
  "كفايه رسايل",
  "كفاية رسائل",
  "الغاء الاشتراك",
  "stop messaging me",
  "stop messages",
  "unsubscribe me",
  "remove my number",
  "dont message me",
  "don't message me",
]);

/**
 * Is this inbound message a request to stop?
 *
 * Whole-message match only. "Please don't stop my treatment" contains the word and means the
 * opposite, and a substring match would opt that patient out of every future reminder.
 */
export function isOptOutReply(raw: string): boolean {
  return OPT_OUT_REPLIES.has(normalizeReplyText(raw));
}

/** The word the footer asks for, in each language. Keep these in the keyword set above. */
export const OPT_OUT_KEYWORD_AR = "إيقاف";
export const OPT_OUT_KEYWORD_EN = "STOP";

/**
 * The footer for a WhatsApp message, matching the language of the templates around it.
 *
 * WhatsApp bills nothing per message, so this costs only screen space — which is why it is on by
 * default there and off by default for SMS, where the same two lines can double a clinic's bill.
 */
export const WHATSAPP_OPT_OUT_FOOTER_AR = `— لإيقاف الرسائل أرسل: ${OPT_OUT_KEYWORD_AR}`;
export const WHATSAPP_OPT_OUT_FOOTER_BILINGUAL = `— لإيقاف الرسائل أرسل: ${OPT_OUT_KEYWORD_AR} · To stop, reply: ${OPT_OUT_KEYWORD_EN}`;

/**
 * The SMS footer.
 *
 * Arabic only and as short as it can be said. An SMS carrying one Arabic character is billed in
 * 70-character segments, and the default bodies already sit at 63–69 of those 70 — so this footer
 * always costs a second segment. That is the whole reason it defaults to off for SMS: the clinic
 * should double its own phone bill on purpose, not by inheriting a default.
 *
 * Joined with a single newline rather than the blank line WhatsApp gets. A blank line is two
 * characters, and at this size two characters are worth having.
 */
export const SMS_OPT_OUT_FOOTER = `للإيقاف أرسل ${OPT_OUT_KEYWORD_AR}`;

/**
 * Add the footer unless it is already there.
 *
 * Idempotent because bodies pass through more than one hand: a clinic that pasted the line into
 * its own custom template must not receive it twice, and re-queueing a message must not grow it.
 */
export function appendOptOutFooter(text: string, footer: string, separator = "\n\n"): string {
  const body = String(text || "");
  if (!footer.trim()) return body;

  // Compare on the keyword rather than the whole footer: a clinic that wrote its own wording
  // around the same word has already told the patient how to stop.
  const normalizedBody = normalizeReplyText(body);
  if (normalizedBody.includes(normalizeReplyText(OPT_OUT_KEYWORD_AR)) && normalizedBody.includes("ارسل")) {
    return body;
  }
  if (/\bstop\b/i.test(body) && /repl(y|ies)|send/i.test(body)) return body;

  return `${body.replace(/\s+$/, "")}${separator}${footer}`;
}

/**
 * The SMS body exactly as it will be sent, footer and all.
 *
 * One function so that the settings screen's segment counter and the queue writer cannot disagree.
 * They are the same arithmetic on the same string, and the counter is the only warning a clinic
 * gets before it doubles its own phone bill — a counter measuring a slightly different string than
 * the one that goes out is a counter that lies in the direction nobody checks.
 */
export function withSmsOptOutFooter(text: string, enabled: boolean): string {
  if (!enabled || !text.trim()) return text;
  return appendOptOutFooter(text, SMS_OPT_OUT_FOOTER, "\n");
}
