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

export type PatientInsurance = Record<string, PatientInsuranceEntry>;

const PAYER_ID = /^[a-z0-9_-]+$/;

/** What the insurer's own paper identifies the patient by; only the member number is always known. */
export type PatientInsuranceEntry = { memberNumber: string; certificateNumber?: string; dependentCode?: string; policyNumber?: string };

/** MetLife prints the member as certificate and dependent code: `987/1`. */
export function metlifeMemberNumber(certificate: string, dependent: string): string {
  return `${certificate.trim()}/${dependent.trim()}`;
}

/** payerId → full entry. Kept when any of its four fields is filled; the optional ones only when present. */
export function readInsurance(patient: Record<string, unknown>): Record<string, PatientInsuranceEntry> {
  const out: Record<string, PatientInsuranceEntry> = {};
  const raw = patient.insurance;
  if (!raw || typeof raw !== "object") return out;
  for (const [payerId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const memberNumber = String(e.memberNumber ?? "").trim();
    const read: PatientInsuranceEntry = { memberNumber };
    let any = memberNumber !== "";
    for (const key of ["certificateNumber", "dependentCode", "policyNumber"] as const) {
      const value = String(e[key] ?? "").trim();
      if (value) { read[key] = value; any = true; }
    }
    // A half-filled or policy-only entry is still the clinic's data: the editor must show it again.
    if (any) out[payerId] = read;
  }
  return out;
}

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

/**
 * The map to store, from what was typed. Trimmed; blank entries and malformed ids are left out.
 * A string is a plain member number. An entry is MetLife's three boxes: certificate and dependent
 * together make the member number (`987/1`); without both it is the typed member number, possibly
 * "". An entry is stored when any of its four fields is filled. Blank optional fields are left out,
 * never written as `undefined`.
 */
export function writeInsurance(edits: Record<string, PatientInsuranceEntry | string>): PatientInsurance {
  const out: PatientInsurance = {};
  for (const [payerId, typed] of Object.entries(edits)) {
    if (!PAYER_ID.test(payerId)) continue;
    if (typeof typed !== "object" || typed === null) {
      const member = String(typed ?? "").trim();
      if (member) out[payerId] = { memberNumber: member };
      continue;
    }
    const certificate = String(typed.certificateNumber ?? "").trim();
    const dependent = String(typed.dependentCode ?? "").trim();
    const policy = String(typed.policyNumber ?? "").trim();
    const both = certificate !== "" && dependent !== "";
    const memberNumber = both ? metlifeMemberNumber(certificate, dependent) : String(typed.memberNumber ?? "").trim();
    if (!memberNumber && !certificate && !dependent && !policy) continue;
    const entry: PatientInsuranceEntry = { memberNumber };
    if (certificate) entry.certificateNumber = certificate;
    if (dependent) entry.dependentCode = dependent;
    if (policy) entry.policyNumber = policy;
    out[payerId] = entry;
  }
  return out;
}
