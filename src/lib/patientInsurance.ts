/**
 * A patient's membership with each insurer.
 *
 * Stored on the patient record as `insurance: { [payerId]: { memberNumber } }`. The member number
 * is what the insurer's claim statement prints in front of the patient's name — `(A1B2) …` — and
 * what the insurer's clerk matches the claim against. One per insurer, because a patient can be
 * covered by two.
 *
 * Pure. Blanks are dropped rather than written: Firestore refuses `undefined`, and an empty-string
 * entry would print `()` on the statement.
 */

export type PatientInsurance = Record<string, { memberNumber: string }>;

const PAYER_ID = /^[a-z0-9_-]+$/;

/** payerId → member number, for the patient document as read from Firestore. */
export function readMemberNumbers(patient: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = patient.insurance;
  if (!raw || typeof raw !== "object") return out;
  for (const [payerId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const member = String((entry as { memberNumber?: unknown }).memberNumber ?? "").trim();
    if (member) out[payerId] = member;
  }
  return out;
}

/** The map to store, from what was typed. Trimmed; blank entries and malformed ids are left out. */
export function writeInsurance(edits: Record<string, string>): PatientInsurance {
  const out: PatientInsurance = {};
  for (const [payerId, typed] of Object.entries(edits)) {
    if (!PAYER_ID.test(payerId)) continue;
    const member = String(typed ?? "").trim();
    if (member) out[payerId] = { memberNumber: member };
  }
  return out;
}
