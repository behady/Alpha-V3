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
