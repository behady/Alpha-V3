/** First non-empty phone-like field on a patient document (matches Cloud Functions logic). */
export function pickPatientPhone(patient: Record<string, unknown> | null | undefined): string {
  if (!patient || typeof patient !== "object") return "";
  const keys = [
    "phone",
    "phoneNumber",
    "phoneE164",
    "patientPhone",
    "mobile",
    "whatsapp",
    "whatsApp",
    "contactNumber",
    "telephone",
    "primaryPhone",
  ];
  for (const k of keys) {
    const v = patient[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * A comparable form of a phone number, for deciding whether two records mean the same person.
 *
 * Deliberately separate from `normalizeToE164`, which refuses a number carrying no explicit
 * international prefix. That refusal is right when *sending* — guessing a country and messaging a
 * stranger in it is worse than refusing — but it is wrong when *matching*, and that mismatch is
 * why an inbound stop request found nobody: WhatsApp identifies a sender as `201551552440` with
 * no plus, which the sending normalizer correctly reports as unusable, and the lookup then
 * compared an empty string against every patient.
 *
 * The rules, in order:
 *   - Arabic-Indic digits fold to ASCII. Real records in this database carry `٠١٢٢٢٦٨١٥٧٨`,
 *     which a plain \D strip erases entirely, leaving nothing to compare.
 *   - International and trunk prefixes are removed, so `+201551552440`, `00201551552440`,
 *     `201551552440` and `01551552440` all reduce to the same subscriber digits.
 *   - The last 9 digits are compared. Two Egyptian mobiles sharing their final 9 digits would
 *     have to differ only in the operator prefix, which does not happen; anything shorter than 9
 *     is returned whole rather than padded, so a fragment cannot match a real number by accident.
 */
export function phoneMatchKey(raw: string | null | undefined): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";

  // ٠١٢٣٤٥٦٧٨٩ and ۰۱۲۳۴۵۶۷۸۹ → 0123456789
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

  let digits = s.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("00")) digits = digits.slice(2);
  // A single leading zero is the national trunk prefix, never part of the subscriber number.
  while (digits.startsWith("0")) digits = digits.slice(1);

  return digits.length > 9 ? digits.slice(-9) : digits;
}

/** Do these two numbers identify the same person, whatever shape each was written in? */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = phoneMatchKey(a);
  const kb = phoneMatchKey(b);
  return ka.length >= 7 && ka === kb;
}
