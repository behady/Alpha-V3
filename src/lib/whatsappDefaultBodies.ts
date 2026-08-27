import type { WhatsAppTemplateType } from "@/types/whatsapp";

/**
 * Which set of default bodies a clinic starts from.
 *
 * `bilingual` — English heading with an Arabic line under it. The original, and right for a clinic
 *               in New Cairo or the North Coast whose patients switch between the two.
 * `arabic`    — Arabic only. Most Egyptian clinics message Egyptian patients, and half a message
 *               in a language the reader skips is not neutral: it makes the clinic look like it is
 *               using foreign software, and it doubles the length of every reminder.
 *
 * A pack only ever seeds the editable templates. Once a clinic saves a body it owns it, and
 * switching packs later has to say plainly that it overwrites those edits.
 */
export type WhatsAppTemplatePack = "bilingual" | "arabic";

export const WHATSAPP_TEMPLATE_PACKS: readonly WhatsAppTemplatePack[] = ["bilingual", "arabic"];

export function isTemplatePack(v: unknown): v is WhatsAppTemplatePack {
  return v === "bilingual" || v === "arabic";
}

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

  reactivation: `🦷 *We miss you | نفتقدك*

Hi {{patient_name}},

It has been a while since your last visit to *{{clinic_name}}*.
Regular check-ups keep small problems small — we would be glad to see you again.

Reply to this message to book a time that suits you.
يسعدنا حجز موعد في الوقت المناسب لك.`,

  // The reply a lead gets seconds after asking. Deliberately short, personal and question-first:
  // it should read like a receptionist who saw the enquiry, not like an advertisement — both
  // because that is what converts, and because bulk-looking messages are what get numbers banned.
  lead_welcome: `مرحباً {{patient_name}} 👋

شكراً لتواصلك مع *{{clinic_name}}*. وصلنا استفسارك وحابين نساعدك.
امتى يكون وقت مناسب نتصل بيك؟

---

Hi {{patient_name}} 👋

Thanks for contacting *{{clinic_name}}*. We received your enquiry and we would be glad to help.
When is a good time to call you?`,
};

/**
 * The same nine messages, written only in Arabic.
 *
 * Not a translation of the bilingual set line by line — a message that reads as translated reads
 * as automated, which is exactly the impression that gets a number reported. The labels are the
 * words an Egyptian receptionist would use ("الدكتور", "المتبقي"), the closings are the ones she
 * would type, and the English field names are gone rather than transliterated.
 *
 * The placeholders are identical to the bilingual pack, so a clinic can switch between them
 * without any of the merge values changing.
 */
export const WHATSAPP_ARABIC_BODIES: Record<WhatsAppTemplateType, string> = {
  new: `🔔 *تم تأكيد حجزك* 📅

👤 *الاسم:* {{patient_name}}
🏥 *العيادة:* {{clinic_name}}
👨‍⚕️ *الدكتور:* {{doctor}}
📅 *التاريخ:* {{date}}
⏰ *الساعة:* {{time}}

في انتظارك — ولو احتجت أي تعديل كلمنا.`,

  edit: `🔄 *تم تغيير موعدك* ⚠️

👤 *الاسم:* {{patient_name}}
🏥 *العيادة:* {{clinic_name}}
👨‍⚕️ *الدكتور:* {{doctor}}
📅 *التاريخ الجديد:* {{date}}
⏰ *الساعة الجديدة:* {{time}}

لو الميعاد ده مش مناسب، رد علينا ونظبطه.`,

  cancel: `🗑️ *تم إلغاء موعدك* ❌

👤 *الاسم:* {{patient_name}}
🏥 *العيادة:* {{clinic_name}}
👨‍⚕️ *الدكتور:* {{doctor}}
📅 *التاريخ:* {{date}}
⏰ *الساعة:* {{time}}

لو حابب تحجز ميعاد تاني، رد على الرسالة دي.`,

  invoice: `💵 *استلمنا دفعتك* ✅

👤 *الاسم:* {{patient_name}}
💰 *المبلغ:* {{amount}} ج.م
💳 *طريقة الدفع:* {{method}}
🧾 *البيان:* {{description}}
⚖️ *المتبقي:* {{balance}} ج.م
🏥 *العيادة:* {{clinic_name}}

شكراً لثقتك.`,

  treatment: `🦷 *تحديث حالتك العلاجية* 📝

👤 *الاسم:* {{patient_name}}
👨‍⚕️ *الدكتور:* {{doctor}}
⚙️ *الإجراء:* {{procedure}}
🦷 *السن:* {{tooth}}
📝 *ملاحظات:* {{notes}}
🏥 *العيادة:* {{clinic_name}}

تمنياتنا لك بالشفاء العاجل.`,

  reminder24h: `⏰ *تذكير بموعدك بكرة*

👤 *{{patient_name}}*
📅 *{{date}}* · ⏰ *{{time}}*
👨‍⚕️ *{{doctor}}*
🏥 *{{clinic_name}}*

في انتظارك.`,

  google_review: `⭐ *رأيك يهمنا*

أهلاً {{patient_name}}،

شكراً لزيارتك *{{clinic_name}}*.
لو الخدمة عجبتك، تقييمك بيفرق معانا كتير:
{{google_link}}

شكراً لوقتك.`,

  reactivation: `🦷 *وحشتنا*

أهلاً {{patient_name}}،

بقى لك فترة من آخر زيارة لـ *{{clinic_name}}*.
الكشف الدوري بيخلي المشكلة الصغيرة تفضل صغيرة — ويسعدنا نشوفك تاني.

رد على الرسالة دي ونحجز لك ميعاد مناسب.`,

  // Same reasoning as the bilingual version: short, personal, question-first. A lead who just
  // asked about a price should feel a receptionist answered, not a broadcast list.
  lead_welcome: `مرحباً {{patient_name}} 👋

شكراً لتواصلك مع *{{clinic_name}}*. وصلنا استفسارك وحابين نساعدك.
امتى يكون وقت مناسب نتصل بيك؟`,
};

/** The starting bodies for one pack. */
export function templatePackBodies(pack: WhatsAppTemplatePack): Record<WhatsAppTemplateType, string> {
  return pack === "arabic" ? WHATSAPP_ARABIC_BODIES : WHATSAPP_DEFAULT_BODIES;
}

/**
 * @returns null = template type explicitly disabled; otherwise custom or default body.
 *
 * `pack` only decides which built-in body answers when the clinic has not written its own — a
 * saved template always wins, because it is the clinic's own words.
 */
export function resolveWhatsappTemplateForPatient(
  settingsTemplates: unknown,
  type: WhatsAppTemplateType,
  pack: WhatsAppTemplatePack = "bilingual"
): string | null {
  const templates = Array.isArray(settingsTemplates) ? settingsTemplates : [];
  const row = templates.find(
    (t): t is { type: string; isActive?: boolean; message?: string } =>
      Boolean(t) && typeof t === "object" && (t as { type?: string }).type === type
  );
  if (row && row.isActive === false) return null;
  if (row && typeof row.message === "string" && row.message.trim()) return row.message.trim();
  return templatePackBodies(pack)[type] || null;
}
