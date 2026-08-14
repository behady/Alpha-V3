// Per-patient channel preferences. Run with tsx.
//
// The case that matters is the third one: SMS sending arrived long after patients had already been
// marked as opted out of WhatsApp. Those marks mean "stop messaging me", not "stop messaging me on
// that particular app". If an unset SMS preference counted as consent, switching SMS on would text
// every one of those patients on day one — the exact opposite of what they asked for.
import assert from "node:assert/strict";
import {
  isSmsBlocked,
  isWhatsAppBlocked,
  smsPreferenceState,
} from "../src/lib/patientMessaging.ts";

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

console.log("✓ patientMessaging: WhatsApp opt-outs cover SMS until a patient is explicitly allowed");
