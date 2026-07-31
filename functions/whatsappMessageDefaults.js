/**
 * Canonical patient WhatsApp bodies (WhatsApp *bold*). Used when Firestore has no custom text.
 * Keep in sync with `defaultBodyForType` in `src/components/settings/WhatsAppSettings.tsx`.
 */
const WHATSAPP_DEFAULT_TEMPLATES = {
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
 * @param {string} template
 * @param {Record<string, string | number | undefined | null>} vars
 */
function mergeWhatsappTemplate(template, vars) {
  let out = String(template || "");
  for (const [key, val] of Object.entries(vars)) {
    const safe = val === undefined || val === null ? "" : String(val);
    out = out.split(`{{${key}}}`).join(safe);
  }
  return out;
}

/**
 * @param {Record<string, unknown>|undefined} settings  settings/whatsapp .data()
 * @param {"new"|"edit"|"cancel"|"invoice"|"treatment"|"reminder24h"|"google_review"} type
 * @returns {string|null} null = skip (template disabled)
 */
function resolveWhatsappTemplate(settings, type) {
  const defaults = WHATSAPP_DEFAULT_TEMPLATES;
  const templates = settings && Array.isArray(settings.templates) ? settings.templates : [];
  const row = templates.find((t) => t && t.type === type);
  if (row && row.isActive === false) return null;
  if (row && typeof row.message === "string" && row.message.trim()) return row.message.trim();
  return defaults[type] || null;
}

module.exports = {
  WHATSAPP_DEFAULT_TEMPLATES,
  mergeWhatsappTemplate,
  resolveWhatsappTemplate,
};
