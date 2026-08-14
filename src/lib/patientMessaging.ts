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
