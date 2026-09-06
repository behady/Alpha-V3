import type { MetaInteractive } from "@/lib/metaWhatsapp";

/**
 * The assistant's own fixed sentences, in the patient's script.
 *
 * The model writes in whatever language the patient wrote. Everything the CODE composes — the
 * menus, the day and time lists, the booking confirmation, the handoff promises, the emergency
 * line — was Arabic and stayed Arabic, so an English conversation kept sprouting Arabic walls,
 * and the buttons never changed at all because only the message text was ever rewritten.
 *
 * Two rules make this safe. It runs ONLY when we are confident the patient is writing in Latin
 * script (see `isLatinMessage`, which ignores button ids and bare digits), and it only ever
 * replaces sentences this codebase wrote itself — a model-authored reply is already in the right
 * language and is left alone because none of these needles will match it.
 */

const SENTENCES: Array<[string, string]> = [
  // --- handoffs and the emergency path -------------------------------------------------------
  ["تمام، حد من الاستقبال هيتواصل مع حضرتك في أقرب وقت 🙏", "Sure — someone from reception will get back to you shortly 🙏"],
  ["تمام 👍 الاستقبال هيتواصل معاك في أقرب وقت.", "Got it 👍 reception will get back to you shortly."],
  ["وصلتنا رسالتك 🙏 حد من إدارة العيادة هيتواصل معاك في أقرب وقت.", "We've received your message 🙏 someone from the clinic's management will contact you shortly."],
  ["الاستقبال هيتواصل معاك حالاً يأكدلك.", "Reception will contact you shortly to confirm."],
  ["وصلتنا رسالتك 🙏 عشان دي حاجة طبية، حد من العيادة هيرد على حضرتك بنفسه في أقرب وقت.", "We've received your message 🙏 because this is a medical question, someone from the clinic will answer you personally, as soon as possible."],
  ["لو الموضوع مستعجل، كلمنا على طول على", "If it's urgent, please call us straight away on"],
  ["لو الموضوع مستعجل، كلمنا على تليفون العيادة على طول.", "If it's urgent, please call the clinic straight away."],
  // --- appointment changes -------------------------------------------------------------------
  ["وصلتنا رسالتك بخصوص إلغاء الميعاد 👍", "We've received your cancellation request 👍"],
  ["وصلتنا رسالتك بخصوص تعديل الميعاد 👍", "We've received your request to move the appointment 👍"],
  ["وصلتنا رسالتك بخصوص تأخير الميعاد 👍", "Noted that you're running late 👍"],
  ["مالقيتش ليك ميعاد محجوز حالياً 🙏 تحب نحجزلك؟", "I couldn't find an upcoming appointment for you 🙏 would you like to book one?"],
  ["تمام، هنعدّل ميعادك ده 🔁", "Sure, let's move this appointment 🔁"],
  ["ميعادك الجاي 👇", "Your next appointment 👇"],
  ["لو حابب تعدله أو تلغيه ابعتلنا وهنظبطهولك.", "If you'd like to change or cancel it, just tell me and I'll sort it out."],
  // --- booking --------------------------------------------------------------------------------
  ["✅ تم تأكيد حجزك:", "✅ Your appointment is confirmed:"],
  ["✅ تم تسجيل طلب حجزك:", "✅ Your booking request is registered:"],
  ["✅ تم تعديل ميعادك:", "✅ Your appointment has been moved:"],
  ["✅ (تجربة) الحجز كان هيتسجل كده:", "✅ (test) the booking would have been saved as:"],
  ["مستنينك 🦷 لو حبيت تعدّل الميعاد، ابعت *3*.", "See you then 🦷 If you need to change it, just tell me."],
  ["مستنينكي 🦷 لو حبيت تعدّل الميعاد، ابعتي *3*.", "See you then 🦷 If you need to change it, just tell me."],
  ["العيادة هتراجع الطلب وهتتواصل مع حضرتك للتأكيد. لو حبيت تعدّل، ابعت *3*.", "The clinic will review the request and contact you to confirm. If you need to change it, just tell me."],
  ["العيادة هتراجع الطلب وهتتواصل مع حضرتك للتأكيد. لو حبيت تعدّل، ابعتي *3*.", "The clinic will review the request and contact you to confirm. If you need to change it, just tell me."],
  ["أهلاً بيك 🙏 عشان أسجل الحجز باسمك، ابعتلي اسمك الكامل.", "Great 🙏 to put the booking under your name, please send me your full name."],
  ["أهلاً بيكي 🙏 عشان أسجل الحجز باسمك، ابعتيلي اسمك الكامل.", "Great 🙏 to put the booking under your name, please send me your full name."],
  ["أهلاً بيك 🙏 عشان نسجل الحجز، ياريت حضرتك تبعتلنا الاسم الكامل.", "Great 🙏 to register the booking, please send us your full name."],
  ["أهلاً بيكي 🙏 عشان نسجل الحجز، ياريت حضرتك تبعتيلنا الاسم الكامل.", "Great 🙏 to register the booking, please send us your full name."],
  ["أهلاً بيك 🌟 عشان نسجل حجزك، ابعتلنا اسمك الكامل من فضلك.", "Welcome 🌟 to register your booking, please send us your full name."],
  ["معلش، ياريت الاسم بالحروف (مش أرقام) عشان نكمل الحجز 🙏", "Sorry — please send your name in letters (not numbers) so we can complete the booking 🙏"],
  ["تمام، الحجز لمين؟ ياريت تبعتلنا الاسم الكامل بتاعه 🙏", "Sure — who is the booking for? Please send me their full name 🙏"],
  ["عندك أكتر من حجز مفتوح بالفعل — ابعت *3* والاستقبال هيظبطهالك.", "You already have several open bookings — reception will sort this out for you."],
  ["الميعاد ده اتحجز في نفس اللحظة 🙏", "That slot was taken at the same moment 🙏"],
  ["اليوم ده كل مواعيده اتحجزت 🙏", "That day is fully booked 🙏"],
  ["اليوم ده كل مواعيده اتحجزت 🙏 اختار يوم تاني:", "That day is fully booked 🙏 pick another day:"],
  ["الميعاد القديم مش موجود، نحجزلك ميعاد جديد 👇", "The old appointment is gone — let's book you a new one 👇"],
  ["تمام 👍 الاستقبال هيتواصل معاك في أقرب وقت لتحديد الميعاد.", "Got it 👍 reception will contact you shortly to arrange the appointment."],
  // --- menus, lists and prompts ---------------------------------------------------------------
  ["📅 اختار اليوم اللي يناسبك:", "📅 Pick the day that suits you:"],
  ["📅 اختار اليوم اللي يناسبك مع", "📅 Pick the day that suits you with"],
  ["👨‍⚕️ تحب تحجز مع مين؟", "👨‍⚕️ Who would you like to see?"],
  ["⏰ المواعيد المتاحة يوم", "⏰ Available times on"],
  ["*0* — رجوع للقائمة", "*0* — back to the menu"],
  ["*0* — رجوع لاختيار اليوم", "*0* — back to the day list"],
  ["معلش مفهمتش 🙏 ابعت رقم من الاختيارات دي:", "Sorry, I didn't catch that 🙏 send one of these numbers:"],
  ["اختار من الأزرار 👇", "Choose from the buttons 👇"],
  ["الأسعار دي بداية السعر، والاستقبال بيأكد السعر النهائي بعد الكشف.", "These are starting prices; reception confirms the final price after the examination."],
  ["💰 *أسعارنا تبدأ من:*", "💰 *Our prices start from:*"],
  ["الاستقبال هيبعتلك قائمة الأسعار حالاً 🙏", "Reception will send you the price list shortly 🙏"],
  // --- media ----------------------------------------------------------------------------------
  ["وصلتنا الرسالة الصوتية 🎙️ حد من العيادة هيسمعها ويرد عليك حالاً.", "Got your voice note 🎙️ someone from the clinic will listen and reply to you shortly."],
  ["وصلتنا الصورة 📷 حد من العيادة هيشوفها ويرد عليك حالاً.", "Got your photo 📷 someone from the clinic will look at it and reply to you shortly."],
  ["لو الموضوع طارئ كلمنا على طول.", "If it's an emergency, please call us straight away."],
  // --- courtesies -----------------------------------------------------------------------------
  ["مالقيتش ليك ميعاد محجوز حالياً 🙏", "I couldn't find an upcoming appointment for you 🙏"],
  ["أيوه احنا فاتحين دلوقتي ✅", "Yes, we're open right now ✅"],
  ["احنا مقفولين دلوقتي 🙏", "We're closed right now 🙏"],
  ["🕐 مواعيدنا:", "🕐 Our hours:"],
  ["📍 *العنوان:*", "📍 *Address:*"],
];

const DAYS: Array<[string, string]> = [
  ["الأحد", "Sunday"],
  ["الإثنين", "Monday"],
  ["الاثنين", "Monday"],
  ["الثلاثاء", "Tuesday"],
  ["الأربعاء", "Wednesday"],
  ["الخميس", "Thursday"],
  ["الجمعة", "Friday"],
  ["السبت", "Saturday"],
];

/** The list titles and button captions, which live outside the message text. */
const LABELS: Array<[string, string]> = [
  ["حجز موعد 🦷", "Book an appointment 🦷"],
  ["الحجز مع الاستقبال", "Book via reception"],
  ["مواعيد العمل 🕐", "Opening hours 🕐"],
  ["الاستقبال 💬", "Reception 💬"],
  ["اختيار الدكتور", "Choose a dentist"],
  ["اختيار اليوم", "Choose a day"],
  ["اختيار الميعاد", "Choose a time"],
  ["رجوع للقائمة", "Back to the menu"],
  ["رجوع لاختيار اليوم", "Back to the day list"],
  ["أي دكتور 👌", "Any dentist 👌"],
];

/**
 * Is this message evidence that the patient writes in Latin script?
 *
 * A button id ("m1", "dr|Mohamed Ehab", "t2026-09-08|03:30 PM|") and a bare digit are Latin
 * characters that say nothing about the person: reading them as English is how an Arabic patient
 * who tapped a button got the rest of their booking in English.
 */
export function isLatinMessage(raw: string): boolean {
  const t = String(raw || "").trim();
  if (!t) return false;
  if (/^(m[123]|back_menu|back_days)$/i.test(t)) return false;
  if (/^(dr\||d\d{4}-\d{2}-\d{2}|t\d{4}-\d{2}-\d{2})/i.test(t)) return false;
  if (/^[\d\s٠-٩۰-۹.,]+$/.test(t)) return false;
  if (/[؀-ۿ]/.test(t)) return false;
  // At least two Latin letters, so an emoji or a stray "ok." is not taken as a language choice.
  return (t.match(/[A-Za-z]/g) || []).length >= 2;
}

function swap(text: string): string {
  let out = text;
  for (const [ar, en] of SENTENCES) out = out.split(ar).join(en);
  for (const [ar, en] of DAYS) out = out.split(ar).join(en);
  for (const [ar, en] of LABELS) out = out.split(ar).join(en);
  return out
    .replace(/(\d{1,2}:\d{2})\s*م(?![؀-ۿ])/g, "$1 PM")
    .replace(/(\d{1,2}:\d{2})\s*ص(?![؀-ۿ])/g, "$1 AM");
}

/** Rewrite one composed reply — text AND the interactive parts — for a Latin-script patient. */
export function localizeOutbound(text: string, structure?: MetaInteractive): { text: string; structure?: MetaInteractive } {
  const out = swap(text);
  if (!structure) return { text: out };
  return {
    text: out,
    structure: {
      ...structure,
      body: swap(structure.body),
      ...(structure.buttons ? { buttons: structure.buttons.map((b) => ({ ...b, title: swap(b.title) })) } : {}),
      ...(structure.list
        ? {
            list: {
              // WhatsApp caps the list button at 20 characters, so a translated caption that grew
              // is trimmed here rather than being rejected by the API with an opaque 400.
              buttonLabel: swap(structure.list.buttonLabel).slice(0, 20),
              rows: structure.list.rows.map((r) => ({
                ...r,
                title: swap(r.title).slice(0, 24),
                ...(r.description ? { description: swap(r.description) } : {}),
              })),
            },
          }
        : {}),
    },
  };
}
