export const WAITING_MOODS = [
  { key: "happy", emoji: "😊", labelEn: "Happy", labelAr: "مرتاح" },
  { key: "neutral", emoji: "😐", labelEn: "Neutral", labelAr: "عادي" },
  { key: "annoyed", emoji: "😤", labelEn: "Annoyed", labelAr: "متضايق" },
  { key: "angry", emoji: "😠", labelEn: "Angry", labelAr: "زعلان" },
  { key: "furious", emoji: "🤬", labelEn: "Very upset", labelAr: "متعصب جداً" },
] as const;

export type WaitingMoodKey = (typeof WAITING_MOODS)[number]["key"];

export function getWaitingMoodEmoji(mood?: string | null): string {
  if (!mood) return "";
  return WAITING_MOODS.find((m) => m.key === mood)?.emoji ?? "";
}

export function getWaitingMoodLabel(mood: string, language: "en" | "ar"): string {
  const row = WAITING_MOODS.find((m) => m.key === mood);
  if (!row) return mood;
  return language === "ar" ? row.labelAr : row.labelEn;
}
