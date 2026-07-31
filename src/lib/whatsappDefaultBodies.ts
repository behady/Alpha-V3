import type { WhatsAppTemplateType } from "@/types/whatsapp";

/** Canonical copy for Settings UI + API fallbacks. Keep in sync with `functions/whatsappMessageDefaults.js`. */
export const WHATSAPP_DEFAULT_BODIES: Record<WhatsAppTemplateType, string> = {
  new: `🔔 *New Booking | حجز جديد* 📅

👤 *Patient:* {{patient_name}}
🏥 *Clinic:* {{clinic_name}}
👨‍⚕️ *Doctor:* {{doctor}}
📅 *Date:* {{date}}
⏰ *Time:* {{time}}

We look forward to seeing you!
نتطلع لرؤيتك!`,

  edit: `🔄 *Rescheduled | إعادة جدولة* ⚠️

👤 *Patient:* {{patient_name}}
🏥 *Clinic:* {{clinic_name}}
👨‍⚕️ *Doctor:* {{doctor}}
📅 *New Date:* {{date}}
⏰ *New Time:* {{time}}

Please let us know if you need further changes.
يرجى إعلامنا إذا كنت بحاجة لأي تعديل آخر.`,

  cancel: `🗑️ *Cancelled | إلغاء موعد* ❌

👤 *Patient:* {{patient_name}}
🏥 *Clinic:* {{clinic_name}}
👨‍⚕️ *Doctor:* {{doctor}}
📅 *Date:* {{date}}
⏰ *Time:* {{time}}

If you would like to rebook, please contact us.
لإعادة الحجز، يرجى التواصل معنا.`,

  invoice: `💵 *Payment Received | تم الدفع* ✅

👤 *Patient:* {{patient_name}}
💰 *Amount:* {{amount}} EGP
💳 *Method:* {{method}}
🧾 *Details:* {{description}}
⚖️ *Remaining Balance:* {{balance}} EGP
🏥 *Clinic:* {{clinic_name}}

Thank you!
شكراً لك!`,

  treatment: `🦷 *Treatment Update | تحديث العلاج* 📝

👤 *Patient:* {{patient_name}}
👨‍⚕️ *Doctor:* {{doctor}}
⚙️ *Procedure:* {{procedure}}
🦷 *Tooth:* {{tooth}}
📝 *Notes:* {{notes}}
🏥 *Clinic:* {{clinic_name}}

We wish you a speedy recovery!
نتمنى لك الشفاء العاجل!`,

  reminder24h: `⏰ *Appointment reminder | تذكير موعد*

👤 *{{patient_name}}*
📅 *{{date}}* · ⏰ *{{time}}*
👨‍⚕️ *{{doctor}}*
🏥 *{{clinic_name}}*

See you soon!
نتطلع لرؤيتك غداً.`,

  google_review: `⭐ *We value your feedback*

Hi {{patient_name}},

Thank you for visiting *{{clinic_name}}*.
If you have a moment, we would appreciate your review:
{{google_link}}

Thank you!
شكراً لثقتكم.`,
};

/**
 * @returns null = template type explicitly disabled; otherwise custom or default body.
 */
export function resolveWhatsappTemplateForPatient(
  settingsTemplates: unknown,
  type: WhatsAppTemplateType
): string | null {
  const templates = Array.isArray(settingsTemplates) ? settingsTemplates : [];
  const row = templates.find(
    (t): t is { type: string; isActive?: boolean; message?: string } =>
      Boolean(t) && typeof t === "object" && (t as { type?: string }).type === type
  );
  if (row && row.isActive === false) return null;
  if (row && typeof row.message === "string" && row.message.trim()) return row.message.trim();
  return WHATSAPP_DEFAULT_BODIES[type] || null;
}
