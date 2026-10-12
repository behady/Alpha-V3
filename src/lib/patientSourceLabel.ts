/**
 * Arabic for the "how did you hear about us" sources the app seeds a new clinic with.
 *
 * The seeded values are stored in English (Settings → How patients find you, and every patient's
 * `referral`), and the marketing reports group by the stored text, so they are never
 * rewritten. This only changes what an Arabic screen shows for exactly those starter values; a
 * source the clinic typed itself is shown as typed.
 */
const SOURCE_AR: Record<string, string> = {
  "Walk-in": "مرور عابر",
  "Social Media": "وسائل التواصل",
  "Friend / Family": "صديق / عائلة",
  "Other Doctor": "طبيب آخر",
  Google: "جوجل",
  Instagram: "إنستجرام",
  "Online Booking": "الحجز أونلاين",
};

export function patientSourceLabel(source: string, isAr: boolean): string {
  if (!isAr) return source;
  return SOURCE_AR[source] ?? source;
}
