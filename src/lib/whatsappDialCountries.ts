/** Dial codes only (no +) for building E.164 with national number. */
export type WhatsAppDialCountry = {
  iso: string;
  dial: string;
  nameEn: string;
  nameAr: string;
};

export const WHATSAPP_DIAL_COUNTRIES: WhatsAppDialCountry[] = [
  { iso: "EG", dial: "20", nameEn: "Egypt", nameAr: "مصر" },
  { iso: "SA", dial: "966", nameEn: "Saudi Arabia", nameAr: "السعودية" },
  { iso: "AE", dial: "971", nameEn: "United Arab Emirates", nameAr: "الإمارات" },
  { iso: "KW", dial: "965", nameEn: "Kuwait", nameAr: "الكويت" },
  { iso: "QA", dial: "974", nameEn: "Qatar", nameAr: "قطر" },
  { iso: "BH", dial: "973", nameEn: "Bahrain", nameAr: "البحرين" },
  { iso: "OM", dial: "968", nameEn: "Oman", nameAr: "عُمان" },
  { iso: "JO", dial: "962", nameEn: "Jordan", nameAr: "الأردن" },
  { iso: "LB", dial: "961", nameEn: "Lebanon", nameAr: "لبنان" },
  { iso: "IQ", dial: "964", nameEn: "Iraq", nameAr: "العراق" },
  { iso: "SY", dial: "963", nameEn: "Syria", nameAr: "سوريا" },
  { iso: "PS", dial: "970", nameEn: "Palestine", nameAr: "فلسطين" },
  { iso: "YE", dial: "967", nameEn: "Yemen", nameAr: "اليمن" },
  { iso: "SD", dial: "249", nameEn: "Sudan", nameAr: "السودان" },
  { iso: "LY", dial: "218", nameEn: "Libya", nameAr: "ليبيا" },
  { iso: "TN", dial: "216", nameEn: "Tunisia", nameAr: "تونس" },
  { iso: "DZ", dial: "213", nameEn: "Algeria", nameAr: "الجزائر" },
  { iso: "MA", dial: "212", nameEn: "Morocco", nameAr: "المغرب" },
  { iso: "US", dial: "1", nameEn: "United States", nameAr: "الولايات المتحدة" },
  { iso: "CA", dial: "1", nameEn: "Canada", nameAr: "كندا" },
  { iso: "GB", dial: "44", nameEn: "United Kingdom", nameAr: "المملكة المتحدة" },
  { iso: "FR", dial: "33", nameEn: "France", nameAr: "فرنسا" },
  { iso: "DE", dial: "49", nameEn: "Germany", nameAr: "ألمانيا" },
  { iso: "IT", dial: "39", nameEn: "Italy", nameAr: "إيطاليا" },
  { iso: "ES", dial: "34", nameEn: "Spain", nameAr: "إسبانيا" },
  { iso: "TR", dial: "90", nameEn: "Turkey", nameAr: "تركيا" },
  { iso: "IN", dial: "91", nameEn: "India", nameAr: "الهند" },
  { iso: "PK", dial: "92", nameEn: "Pakistan", nameAr: "باكستان" },
  { iso: "NG", dial: "234", nameEn: "Nigeria", nameAr: "نيجيريا" },
  { iso: "ZA", dial: "27", nameEn: "South Africa", nameAr: "جنوب أفريقيا" },
  { iso: "AU", dial: "61", nameEn: "Australia", nameAr: "أستراليا" },
];

/**
 * Combine country calling code (digits only, e.g. "20") with local WhatsApp number.
 * Strips non-digits and removes a leading national trunk "0" when present.
 */
export function buildE164FromDialAndNational(dialDigits: string, nationalRaw: string): string {
  const cc = String(dialDigits || "").replace(/\D/g, "");
  let n = String(nationalRaw || "").replace(/\D/g, "");
  while (n.startsWith("0") && n.length > 1) n = n.slice(1);
  if (!cc || !n) return "";
  return `+${cc}${n}`;
}
