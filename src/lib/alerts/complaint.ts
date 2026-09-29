import { deliverClinicNotification } from "@/lib/notificationDelivery";

/**
 * A patient message that reads as a complaint.
 *
 * Not sentiment analysis — a word list, in the Egyptian Arabic patients actually write and the
 * English a few use. A false positive costs the owner one glance; a missed complaint costs a
 * review. The list is deliberately short and concrete: words that almost never appear in a
 * booking or a thank-you.
 */
export const COMPLAINT_WORDS: readonly string[] = [
  // Arabic
  "شكوى", "شكوي", "اشتكي", "هشتكي", "زعلان", "زعلانه", "زعلانة", "مش راضي", "مش راضية", "مش راضيه",
  "سيء", "سيئ", "سيئة", "وحش", "وحشة", "وحشه", "استهتار", "إهمال", "اهمال", "فلوسي", "استرجاع", "استرداد",
  "هبلغ", "هرفع", "محامي", "غلط في", "غلطتوا", "خربتوا", "مش هرجع", "مش هجيلكم", "احترام", "قليل الأدب", "قليلين الأدب",
  // English
  "complaint", "complain", "terrible", "awful", "worst", "refund", "unacceptable", "disrespect", "rude", "lawyer", "never coming back",
];

/** Words that look like a complaint but are how people ask for a booking or say thanks. */
const NOT_COMPLAINT = ["مش راضي اخد", "مش راضي احجز"];

export function matchesComplaint(text: string): boolean {
  const t = String(text || "").toLowerCase().replace(/[ً-ْـ]/g, "");
  if (!t.trim()) return false;
  if (NOT_COMPLAINT.some((w) => t.includes(w))) return false;
  return COMPLAINT_WORDS.some((w) => t.includes(w.toLowerCase()));
}

/** Raise the alert for one inbound patient message, if it reads as a complaint. Never throws. */
export async function raiseComplaintIfAny(args: { clinicId: string; phone: string; text: string; chatId?: string }): Promise<boolean> {
  if (!matchesComplaint(args.text)) return false;
  try {
    await deliverClinicNotification(
      args.clinicId,
      { title: "⚠️ رسالة تبدو شكوى", body: `${args.phone}: ${args.text.slice(0, 160)}` },
      {
        event: "complaintKeyword",
        channel: "alpha_bookings",
        data: { screen: "chats", ...(args.chatId ? { chatId: args.chatId } : {}) },
        whatsappText: `⚠️ *رسالة تبدو شكوى*\n${args.phone}\n\n"${args.text.slice(0, 400)}"`,
      },
    );
  } catch (error) {
    console.warn("complaint alert failed:", error);
  }
  return true;
}
