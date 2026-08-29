// Per-patient channel preferences. Run with tsx.
//
// The case that matters is the third one: SMS sending arrived long after patients had already been
// marked as opted out of WhatsApp. Those marks mean "stop messaging me", not "stop messaging me on
// that particular app". If an unset SMS preference counted as consent, switching SMS on would text
// every one of those patients on day one — the exact opposite of what they asked for.
import assert from "node:assert/strict";
import {
  SMS_OPT_OUT_FOOTER,
  WHATSAPP_OPT_OUT_FOOTER_AR,
  WHATSAPP_OPT_OUT_FOOTER_BILINGUAL,
  appendOptOutFooter,
  isOptOutReply,
  isSmsBlocked,
  isWhatsAppBlocked,
  normalizeReplyText,
  smsPreferenceState,
  withSmsOptOutFooter,
} from "../src/lib/patientMessaging.ts";
import { DEFAULT_SMS_TEMPLATES, measureSms } from "../src/lib/sms/config.ts";

// --- a patient with no preferences set at all ---
assert.equal(isWhatsAppBlocked({}), false, "a patient with nothing set is contactable");
assert.equal(isSmsBlocked({}), false);
assert.equal(smsPreferenceState({}), "allowed");

// --- explicit SMS opt-out ---
assert.equal(isSmsBlocked({ smsOptOut: true }), true);
assert.equal(smsPreferenceState({ smsOptOut: true }), "blocked_explicitly");
assert.equal(
  isWhatsAppBlocked({ smsOptOut: true }),
  false,
  "turning texts off must not also turn WhatsApp off"
);

// --- THE ONE THAT MATTERS: an existing WhatsApp opt-out covers SMS until told otherwise ---
assert.equal(
  isSmsBlocked({ whatsappOptOut: true }),
  true,
  "a patient who opted out of WhatsApp must not start receiving texts the day SMS is switched on"
);
assert.equal(smsPreferenceState({ whatsappOptOut: true }), "blocked_by_whatsapp");

// --- but staff can explicitly override it ---
// The common real case: a patient who does not use WhatsApp at all, so texts are the only way to
// reach them.
assert.equal(
  isSmsBlocked({ whatsappOptOut: true, smsOptOut: false }),
  false,
  "explicitly allowing SMS must win over the inherited WhatsApp opt-out"
);
assert.equal(smsPreferenceState({ whatsappOptOut: true, smsOptOut: false }), "allowed");
assert.equal(
  isWhatsAppBlocked({ whatsappOptOut: true, smsOptOut: false }),
  true,
  "allowing texts must not quietly re-enable WhatsApp"
);

// --- both off is still both off ---
assert.equal(isWhatsAppBlocked({ whatsappOptOut: true, smsOptOut: true }), true);
assert.equal(isSmsBlocked({ whatsappOptOut: true, smsOptOut: true }), true);

// --- missing / null records are treated as "do not assume consent is recorded" ---
assert.equal(isSmsBlocked(null), false, "an absent record is not an opt-out, but is contactable");
assert.equal(isSmsBlocked(undefined), false);

// --- a stray non-boolean must not be read as an opt-out ---
// Firestore is schemaless and older rows carry odd shapes; only a real boolean should count.
assert.equal(isSmsBlocked({ smsOptOut: undefined, whatsappOptOut: false }), false);

// ================================================================================================
// Reading a patient's reply.
//
// The stakes are asymmetric and it is worth being explicit about which way. A missed opt-out means
// a patient who asked to be left alone is messaged again, and the next thing they press is "Report
// spam" — the signal that gets the clinic's number restricted. A false positive means a patient is
// silently cut off from their own appointment reminders and nobody finds out until they miss one.
// So: match generously on spelling, never on ambiguous words.
// ================================================================================================

// --- the plain cases ---
assert.equal(isOptOutReply("STOP"), true);
assert.equal(isOptOutReply("stop"), true);
assert.equal(isOptOutReply("  Stop  "), true, "phones add whitespace");
assert.equal(isOptOutReply("stop."), true, "and punctuation");
assert.equal(isOptOutReply("إيقاف"), true);
assert.equal(isOptOutReply("ايقاف"), true, "written without the hamza, which is how most people type it");
assert.equal(isOptOutReply("توقف"), true);
assert.equal(isOptOutReply("إلغاء الاشتراك"), true);
assert.equal(isOptOutReply("unsubscribe"), true);

// --- Arabic spelling variation must not decide whether a patient is heard ---
assert.equal(normalizeReplyText("إِيقَاف"), normalizeReplyText("ايقاف"), "tashkeel is folded away");
assert.equal(normalizeReplyText("أيقاف"), "ايقاف", "every hamza form folds to bare alef");
assert.equal(isOptOutReply("«إيقاف»"), true, "quoted by a keyboard that likes brackets");

// --- THE ONE THAT MATTERS: words that mean something else in a dental clinic ---
assert.equal(
  isOptOutReply("إلغاء"),
  false,
  "bare 'cancel' means cancel my appointment — reading it as an opt-out silently ends the patient's reminders"
);
assert.equal(isOptOutReply("cancel"), false, "same trap in English");
assert.equal(
  isOptOutReply("عايز الغي الميعاد"),
  false,
  "a sentence about cancelling an appointment is a request for the receptionist, not an opt-out"
);

// --- and substrings must never trigger ---
assert.equal(
  isOptOutReply("please don't stop my treatment"),
  false,
  "'stop' inside a sentence can mean the opposite of stop messaging me"
);
assert.equal(isOptOutReply("non-stop pain since yesterday"), false);
assert.equal(isOptOutReply(""), false);
assert.equal(isOptOutReply("   "), false);

// ================================================================================================
// The footer.
// ================================================================================================

const body = "🔔 تم تأكيد حجزك\n📅 غداً 10:00";

assert.ok(
  appendOptOutFooter(body, WHATSAPP_OPT_OUT_FOOTER_AR).endsWith(WHATSAPP_OPT_OUT_FOOTER_AR),
  "the footer lands at the end"
);
assert.ok(
  appendOptOutFooter(body, WHATSAPP_OPT_OUT_FOOTER_AR).startsWith(body),
  "and the message itself is untouched"
);

// --- idempotent: a body passes through more than one hand ---
// The assistant stamps the footer on at staging time so the confirmation card shows what the
// patient will read; delivery then applies it again to every outgoing message. Without this, an
// approved message would carry the line twice.
const once = appendOptOutFooter(body, WHATSAPP_OPT_OUT_FOOTER_AR);
assert.equal(
  appendOptOutFooter(once, WHATSAPP_OPT_OUT_FOOTER_AR),
  once,
  "appending twice must change nothing"
);
assert.equal(
  appendOptOutFooter(once, WHATSAPP_OPT_OUT_FOOTER_BILINGUAL),
  once,
  "and switching template language must not stack a second footer on a message that has one"
);

// --- a clinic that wrote its own wording is left alone ---
const selfWritten = "موعدك غداً.\nلو مش عايز رسائل تاني أرسل إيقاف وهنوقفها.";
assert.equal(
  appendOptOutFooter(selfWritten, WHATSAPP_OPT_OUT_FOOTER_AR),
  selfWritten,
  "the clinic already told the patient how to stop; saying it twice reads as a machine"
);
const selfWrittenEn = "See you tomorrow. Reply STOP if you would rather not get these.";
assert.equal(appendOptOutFooter(selfWrittenEn, WHATSAPP_OPT_OUT_FOOTER_BILINGUAL), selfWrittenEn);

// --- the SMS footer costs a second segment, and the screen must say so ---
// This is the assertion behind the warning printed next to the SMS toggle. If it ever stops being
// true the warning is wrong, and a clinic is being told its bill will double when it will not —
// or, far worse, the reverse.
{
  const reminder = DEFAULT_SMS_TEMPLATES.reminder24h;
  assert.equal(measureSms(withSmsOptOutFooter(reminder, false)).segments, 1, "the bare body fits one message");
  assert.equal(
    measureSms(withSmsOptOutFooter(reminder, true)).segments,
    2,
    "with the footer it does not — this is the doubled phone bill the settings screen warns about"
  );
  assert.equal(withSmsOptOutFooter(reminder, false), reminder, "off means untouched");
  assert.ok(
    !withSmsOptOutFooter(reminder, true).includes("\n\n"),
    "SMS joins with a single newline; a blank line is two billed characters"
  );
  assert.equal(withSmsOptOutFooter("", true), "", "an empty body stays empty rather than becoming a bare footer");
}

// --- the word the footer asks for is a word the matcher accepts ---
// These two drifting apart is the quiet failure: the message would tell every patient to send a
// word that does nothing, which is worse than printing no footer at all.
for (const footer of [WHATSAPP_OPT_OUT_FOOTER_AR, WHATSAPP_OPT_OUT_FOOTER_BILINGUAL, SMS_OPT_OUT_FOOTER]) {
  const quoted = footer.match(/إيقاف|STOP/g) || [];
  assert.ok(quoted.length > 0, `footer must name a stop word: ${footer}`);
  for (const word of quoted) {
    assert.equal(isOptOutReply(word), true, `the footer asks for "${word}" but replying it does nothing`);
  }
}

console.log("✓ patientMessaging: WhatsApp opt-outs cover SMS until a patient is explicitly allowed");
console.log("✓ patientMessaging: STOP is honoured across Arabic spellings, and 'cancel' is not an opt-out");
console.log("✓ patientMessaging: the footer is idempotent and asks for a word the matcher accepts");
