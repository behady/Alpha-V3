/**
 * The long walkthrough — twelve parts, ten to fifteen minutes, from a clinic that does not exist
 * yet to the screens that only make sense once it has run for a while.
 *
 * Parts w0–w5 run on a clinic CREATED ON CAMERA (`--no-pin` for the creation itself, then
 * `--clinic <id>` once it exists and seed-walkthrough-clinic.mjs has filled it). Parts w6–w12
 * run on the established demo clinic: WhatsApp threads, reports and lab boards need history a
 * fifteen-minute-old clinic cannot have, and the narration says so.
 *
 * Every selector below was read off the live app with promo-probe-ui.mjs — the placeholders,
 * the button labels, the select options — not guessed. When the UI changes, re-probe.
 *
 * Two things that are deliberately NOT done on camera:
 *   - no login account is created (the team part fills the create-account form and stops; the
 *     invite link is the route it actually demonstrates);
 *   - no x-ray is analysed (the upload dialog is shown, the AI reading is narrated).
 */

import { BOOKING_SLOT, SEARCH_PANEL, STAR_PATIENT } from "./promo-chapters.mjs";

/** The clinic created in part 0. Not "Sham Dent" — the user asked for a demo name. */
export const NEW_CLINIC_NAME = "عيادة الأمل للأسنان";

/** The patient added on camera in part 3, then paid, treated and charted in part 4. */
export const NEW_PATIENT = { name: "Mostafa Kamel", phone: "1012345678", search: "Mostafa" };

/** The person who books through the public page in part 5. */
export const WEB_BOOKER = { name: "Sara Adel", phone: "01098765432" };

/** Tomorrow, skipping Friday, as the Arabic-Indic day number the booking calendar shows. */
function nextOpenDayArabic() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 5) d.setDate(d.getDate() + 1);
  return String(d.getDate()).replace(/\d/g, (x) => "٠١٢٣٤٥٦٧٨٩"[Number(x)]);
}
export const BOOK_DAY_AR = nextOpenDayArabic();

/** A modal's root, for scoping clicks to what is in front rather than what is behind it. */
const MODAL = ".fixed";
/** Any visible time slot: "٠٥:٠٠ م", "05:00 PM", "17:00" — the page decides, the regex accepts. */
const SLOT_RE = "[٠-٩0-9]{1,2}:[٠-٩0-9]{2}";

export const WALKTHROUGH = {
  // ---------------------------------------------------------------------------------------------
  // Part 0a — the login page, recorded SIGNED OUT (an empty profile). The Google button is on
  // screen; nobody clicks it.
  w0a: {
    title: "Sign in",
    slug: "w0a-login",
    beats: [
      { n: 0, label: "login-page", url: "/login", settle: 7000, actions: [{ do: "wait", ms: 9000 }] },
    ],
  },
  // Part 0b — creating the clinic, SIGNED IN, recorded with --pin-once: the first load is pinned
  // to the demo clinic (never the account's real one), after which the app's own switch to the
  // new clinic is left alone.
  w0b: {
    title: "Create the clinic",
    slug: "w0b-create",
    beats: [
      {
        n: 0, label: "switcher", url: "/", settle: 9000,
        actions: [
          { do: "click", text: "Demo Clinic — Alpha Dental" },
          { do: "wait", ms: 2500 },
          { do: "click", text: "إضافة عيادة جديدة" },
          { do: "wait", ms: 6000 },
        ],
      },
      {
        n: 1, label: "name-it", settle: 500,
        actions: [
          { do: "fill", placeholder: "عيادة النور", text: NEW_CLINIC_NAME, perChar: 110 },
          { do: "wait", ms: 2000 },
        ],
      },
      {
        n: 2, label: "create", settle: 300,
        actions: [
          { do: "click", text: "إنشاء العيادة" },
          { do: "wait", ms: 12000 },
        ],
      },
      {
        // The setup wizard: hours, slot length, off days. Walked, not skipped — a dentist will do
        // this exact screen on their first day.
        n: 3, label: "setup-hours", settle: 1000,
        actions: [
          { do: "wheel", ms: 3000, dy: 60 },
          { do: "click", role: "button", text: "الجمعة", exact: true, optional: true },
          { do: "wait", ms: 1500 },
          { do: "click", role: "button", text: "التالي", exact: true, optional: true },
          { do: "wait", ms: 4000 },
        ],
      },
      {
        // Step 2 (prices) is passed, step 3 (clinic details) is saved: "حفظ وابدأ" is the wizard's
        // last button and the one that lands on the new clinic's dashboard.
        n: 4, label: "setup-rest", settle: 500,
        actions: [
          { do: "wheel", ms: 2500, dy: 60 },
          { do: "click", role: "button", text: "التالي", exact: true, optional: true },
          { do: "wait", ms: 3500 },
          { do: "click", text: "حفظ وابدأ", optional: true, timeout: 6000 },
          { do: "wait", ms: 9000 },
        ],
      },
      {
        // The coach card is Sara. Named, thanked, and closed — the narrator is doing her job today.
        n: 5, label: "meet-sara", settle: 500,
        actions: [{ do: "wait", ms: 7000 }],
      },
      {
        n: 6, label: "close-sara", settle: 300,
        actions: [
          { do: "click", text: "بطّل الشرح خالص", optional: true, timeout: 5000 },
          { do: "wait", ms: 2500 },
          { do: "click", text: "بطل الشرح خالص", optional: true, timeout: 3000 },
          { do: "wait", ms: 4000 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w1: {
    title: "The team",
    slug: "w1-team",
    beats: [
      { n: 0, label: "users-page", url: "/settings/users", settle: 11000, actions: [{ do: "wait", ms: 4000 }] },
      {
        // The create-account form: filled so every field is seen, never submitted.
        n: 1, label: "create-form", settle: 300,
        actions: [
          { do: "click", text: "إضافة عضو للفريق" },
          { do: "wait", ms: 2500 },
          { do: "fill", sel: `${MODAL} input[type="text"]`, text: "Dr. Youssef Kamal", perChar: 90 },
          { do: "fill", sel: `${MODAL} input[type="email"]`, text: "youssef@alamal-dental.com", perChar: 60 },
          { do: "fill", sel: `${MODAL} input[type="password"]`, text: "Youssef2026", perChar: 90 },
          { do: "selectWhere", has: "مساعد", pick: "طبيب" },
          { do: "wait", ms: 5000 },
        ],
      },
      {
        n: 2, label: "invite-link", settle: 300,
        actions: [
          { do: "press", key: "Escape" },
          { do: "wait", ms: 1500 },
          { do: "selectWhere", has: "استقبال", pick: "طبيب" },
          { do: "wait", ms: 1000 },
          { do: "click", text: "إنشاء رابط" },
          { do: "wait", ms: 5000 },
        ],
      },
      {
        n: 3, label: "permissions", settle: 300,
        actions: [
          { do: "clickFirst", text: "الصلاحيات" },
          { do: "wait", ms: 3000 },
          { do: "wheel", ms: 5000, dy: 70 },
          { do: "wait", ms: 2000 },
          { do: "press", key: "Escape" },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w2: {
    title: "The desk",
    slug: "w2-desk",
    beats: [
      { n: 0, label: "day", url: "/", settle: 10000, actions: [{ do: "wait", ms: 4500 }] },
      {
        n: 1, label: "week", settle: 300,
        actions: [
          { do: "click", role: "button", text: "أسبوعي", exact: true },
          { do: "wait", ms: 3000 },
          { do: "wheel", ms: 5000, dy: 70 },
        ],
      },
      {
        n: 2, label: "back-to-day", settle: 300,
        actions: [
          { do: "click", role: "button", text: "يومي", exact: true },
          { do: "wait", ms: 4500 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w3: {
    title: "A new patient, and an appointment",
    slug: "w3-patient",
    beats: [
      {
        n: 0, label: "new-patient-form", url: "/", settle: 10000,
        actions: [
          { do: "click", text: "مريض جديد" },
          { do: "wait", ms: 2500 },
          { do: "fill", placeholder: "اسم المريض", text: NEW_PATIENT.name, perChar: 100 },
          { do: "fill", placeholder: "1001234567", text: NEW_PATIENT.phone, perChar: 80 },
          { do: "fill", placeholder: "المدينة، المنطقة", text: "مدينة نصر، القاهرة", perChar: 80 },
          { do: "selectWhere", has: "Walk-in", pick: "Google" },
          { do: "wait", ms: 1500 },
        ],
      },
      {
        n: 1, label: "save-patient", settle: 300,
        actions: [
          { do: "click", text: "إنشاء ملف المريض" },
          { do: "wait", ms: 6000 },
        ],
      },
      {
        n: 2, label: "click-the-gap", settle: 300,
        actions: [
          { do: "clickSlot", time: BOOKING_SLOT },
          { do: "wait", ms: 3000 },
          { do: "fill", placeholder: "دور بالاسم أو رقم الموبايل", text: NEW_PATIENT.search, perChar: 110 },
          { do: "wait", ms: 2500 },
          { do: "clickFirst", text: NEW_PATIENT.name, within: SEARCH_PANEL },
          { do: "wait", ms: 2000 },
        ],
      },
      {
        n: 3, label: "setter", settle: 300,
        actions: [
          { do: "selectWhere", has: "Dr. Omar", pick: "Dr. Hana" },
          { do: "wait", ms: 1200 },
          { do: "selectWhere", has: "15 دقيقة", pick: "30 دقيقة" },
          { do: "wait", ms: 2500 },
          { do: "click", text: "أكّد الحجز" },
          { do: "wait", ms: 2000 },
          { do: "click", text: "أيوه", optional: true, timeout: 3000 },
          { do: "wait", ms: 4000 },
        ],
      },
      {
        // Clicking the card that just landed opens the inline editor: status, time, notes.
        n: 4, label: "editor", settle: 500,
        actions: [
          { do: "scrollTo", text: NEW_PATIENT.name, which: "last", ms: 2500 },
          { do: "clickFirst", text: NEW_PATIENT.name },
          { do: "wait", ms: 4000 },
          { do: "wheel", ms: 4000, dy: 60, x: 300, y: 500 },
          { do: "wait", ms: 2000 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w4: {
    title: "Money and the file",
    slug: "w4-file",
    beats: [
      {
        n: 0, label: "quick-pay", url: "/", settle: 10000,
        actions: [
          { do: "click", text: "دفع سريع" },
          { do: "wait", ms: 2500 },
          { do: "fill", placeholder: "البحث باسم المريض", text: NEW_PATIENT.search, perChar: 110 },
          { do: "wait", ms: 3000 },
          { do: "clickFirst", text: NEW_PATIENT.name, within: MODAL },
          { do: "wait", ms: 2500 },
          { do: "fill", sel: `${MODAL} input[type="number"]`, text: "500", perChar: 150 },
          { do: "wait", ms: 1500 },
          { do: "click", text: "تأكيد الدفع" },
          { do: "wait", ms: 5000 },
        ],
      },
      {
        n: 1, label: "open-file", url: "/patients", settle: 9000,
        actions: [
          { do: "fill", placeholder: "بحث بالاسم أو الهاتف", text: NEW_PATIENT.search, perChar: 120 },
          { do: "wait", ms: 2500 },
          { do: "clickFirst", text: NEW_PATIENT.name },
          { do: "wait", ms: 6000 },
          { do: "wheel", ms: 3000, dy: 60 },
        ],
      },
      {
        // Composite filling on three teeth, picked off the chart inside the drawer.
        n: 2, label: "add-procedure", settle: 300,
        actions: [
          { do: "clickFirst", text: "السجل السريري" },
          { do: "wait", ms: 2500 },
          { do: "clickFirst", text: "إضافة إجراء جديد" },
          { do: "wait", ms: 3000 },
          { do: "selectWhere", has: "Select doctor", pick: "Dr. Omar" },
          { do: "fill", placeholder: "Search procedures", text: "Composite", perChar: 110 },
          { do: "wait", ms: 2000 },
          { do: "clickMatch", pattern: "Composite Filling", within: MODAL },
          { do: "wait", ms: 1500 },
        ],
      },
      {
        n: 3, label: "pick-teeth", settle: 300,
        actions: [
          { do: "click", sel: '[data-tooth="14"]' },
          { do: "wait", ms: 900 },
          { do: "click", sel: '[data-tooth="15"]' },
          { do: "wait", ms: 900 },
          { do: "click", sel: '[data-tooth="16"]' },
          { do: "wait", ms: 2500 },
          { do: "click", text: "حفظ الإجراء" },
          { do: "wait", ms: 6000 },
        ],
      },
      {
        n: 4, label: "ai-plan", settle: 300,
        actions: [
          { do: "clickFirst", text: "خطة العلاج" },
          { do: "wait", ms: 3000 },
          { do: "clickFirst", text: "اقتراح بالذكاء الاصطناعي" },
          { do: "wait", ms: 22000 },
        ],
      },
      {
        n: 5, label: "xray", settle: 300,
        actions: [
          { do: "press", key: "Escape" },
          { do: "clickFirst", text: "الأشعة والصور" },
          { do: "wait", ms: 3000 },
          { do: "clickFirst", text: "إضافة أشعة أسنان" },
          { do: "wait", ms: 5000 },
          { do: "press", key: "Escape" },
          { do: "wait", ms: 1000 },
        ],
      },
      {
        n: 6, label: "ledger", settle: 300,
        actions: [
          { do: "clickFirst", text: "المالية" },
          { do: "wait", ms: 4000 },
          { do: "wheel", ms: 5000, dy: 60 },
          { do: "wait", ms: 2000 },
        ],
      },
      {
        n: 7, label: "finance-page", url: "/finance", settle: 10000,
        actions: [{ do: "wheel", ms: 5000, dy: 70 }],
      },
      {
        n: 8, label: "expense", settle: 300,
        actions: [
          { do: "click", text: "إدخال يدوي" },
          { do: "wait", ms: 2500 },
          { do: "clickMatch", pattern: "^Expense$", within: MODAL },
          { do: "wait", ms: 1000 },
          { do: "fill", placeholder: "Electricity Bill", text: "فاتورة كهرباء — سبتمبر", perChar: 80 },
          { do: "fill", placeholder: "0.00", text: "1200", perChar: 150 },
          { do: "wait", ms: 1500 },
          { do: "clickMatch", pattern: "حفظ|إضافة|Save|Add", within: MODAL },
          { do: "wait", ms: 5000 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w5: {
    title: "Online booking",
    slug: "w5-booking",
    beats: [
      {
        n: 0, label: "public-page", url: "/book/__CLINIC__", settle: 9000,
        actions: [
          { do: "wait", ms: 2500 },
          { do: "clickFirst", text: "Main Branch" },
          { do: "wait", ms: 2500 },
        ],
      },
      {
        n: 1, label: "pick-day-and-time", settle: 300,
        actions: [
          { do: "click", role: "button", text: BOOK_DAY_AR, exact: true },
          { do: "wait", ms: 3000 },
          { do: "clickMatch", pattern: SLOT_RE },
          { do: "wait", ms: 2500 },
          { do: "wheel", ms: 2500, dy: 70 },
        ],
      },
      {
        n: 2, label: "details", settle: 300,
        actions: [
          { do: "selectWhere", has: "اختر", pickIndex: 1, optional: true },
          { do: "fill", placeholder: "الاسم هنا", text: WEB_BOOKER.name, perChar: 110 },
          { do: "fill", placeholder: "010XXXXXXXX", text: WEB_BOOKER.phone, perChar: 80 },
          { do: "wait", ms: 1500 },
          { do: "click", text: "تأكيد الحجز" },
          { do: "wait", ms: 7000 },
        ],
      },
      {
        n: 3, label: "lands-on-the-desk", url: "/", settle: 10000,
        actions: [
          { do: "click", role: "button", text: "اليوم التالي" },
          { do: "wait", ms: 3500 },
          { do: "scrollTo", text: WEB_BOOKER.name, ms: 3000, optional: true },
          { do: "wait", ms: 4000 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  // From here on: the demo clinic.
  w6: {
    title: "WhatsApp",
    slug: "w6-whatsapp",
    beats: [
      { n: 0, label: "the-queue", url: "/chats", settle: 11000, actions: [{ do: "wait", ms: 4000 }] },
      { n: 1, label: "handoff", settle: 300, actions: [{ do: "clickFirst", text: "Heba Gamal" }, { do: "wait", ms: 6500 }] },
      { n: 2, label: "bot-booked", settle: 300, actions: [{ do: "clickFirst", text: "Mohamed Abdelrahman" }, { do: "wait", ms: 7000 }] },
      { n: 3, label: "reminder", settle: 300, actions: [{ do: "clickFirst", text: "Sherif Adly" }, { do: "wait", ms: 6000 }] },
      {
        n: 4, label: "triggers", url: "/settings/whatsapp", settle: 11000,
        actions: [
          { do: "click", text: "الرسائل التلقائية" },
          { do: "wait", ms: 3000 },
          { do: "wheel", ms: 7000, dy: 65 },
          { do: "wait", ms: 2000 },
        ],
      },
      { n: 5, label: "owner-alerts", settle: 300, actions: [{ do: "click", text: "تنبيهات المالك" }, { do: "wait", ms: 3000 }, { do: "wheel", ms: 4000, dy: 60 }] },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w7: {
    title: "The bot and the AI",
    slug: "w7-bot-ai",
    beats: [
      { n: 0, label: "who-answers", url: "/settings/whatsapp-bot", settle: 12000, actions: [{ do: "wait", ms: 3000 }, { do: "wheel", ms: 5000, dy: 55 }] },
      { n: 1, label: "ready-answers", settle: 300, actions: [{ do: "click", role: "button", text: "الردود الجاهزة" }, { do: "wait", ms: 3000 }, { do: "wheel", ms: 5000, dy: 75 }] },
      { n: 2, label: "coaching", url: "/settings/whatsapp-ai", settle: 11000, actions: [{ do: "wheel", ms: 7000, dy: 65 }] },
      { n: 3, label: "clinical-switch", url: "/settings/whatsapp-bot", settle: 11000, actions: [{ do: "wheel", ms: 6000, dy: 70 }] },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w8: {
    title: "Stock",
    slug: "w8-stock",
    beats: [
      { n: 0, label: "inventory", url: "/inventory", settle: 10000, actions: [{ do: "wait", ms: 3000 }, { do: "wheel", ms: 4000, dy: 60 }] },
      { n: 1, label: "low", settle: 300, actions: [{ do: "click", role: "button", text: "منخفض", exact: true }, { do: "wait", ms: 4500 }] },
      { n: 2, label: "add-item", settle: 300, actions: [{ do: "click", text: "إضافة صنف" }, { do: "wait", ms: 5000 }, { do: "press", key: "Escape" }, { do: "click", role: "button", text: "الكل", exact: true, optional: true, timeout: 2500 }, { do: "wait", ms: 2000 }] },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w9: {
    title: "The lab",
    slug: "w9-lab",
    beats: [
      { n: 0, label: "board", url: "/lab", settle: 10000, actions: [{ do: "wait", ms: 3500 }, { do: "wheel", ms: 4500, dy: 60 }] },
      { n: 1, label: "late", settle: 300, actions: [{ do: "clickFirst", text: "متأخرة" }, { do: "wait", ms: 4500 }] },
      // The order dialog ignores Escape; its own cancel button is what closes it.
      { n: 2, label: "new-order", settle: 300, actions: [{ do: "click", text: "أمر معمل جديد" }, { do: "wait", ms: 5500 }, { do: "clickMatch", pattern: "^إلغاء$", within: ".fixed" }, { do: "wait", ms: 1500 }] },
      { n: 3, label: "accounts", settle: 300, actions: [{ do: "click", role: "button", text: "الحسابات", exact: true }, { do: "wait", ms: 5000 }] },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w10: {
    title: "Reports",
    slug: "w10-reports",
    beats: [
      { n: 0, label: "overview", url: "/reports", settle: 11000, actions: [{ do: "wait", ms: 3500 }, { do: "wheel", ms: 4500, dy: 60 }] },
      { n: 1, label: "dentists", settle: 300, actions: [{ do: "clickFirst", text: "أداء الأطباء" }, { do: "wait", ms: 5500 }] },
      { n: 2, label: "sources", settle: 300, actions: [{ do: "clickFirst", text: "مصادر المرضى" }, { do: "wait", ms: 5000 }] },
      { n: 3, label: "funnel", settle: 300, actions: [{ do: "clickFirst", text: "قمع التسويق" }, { do: "wait", ms: 5000 }] },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w11: {
    title: "The AI assistant",
    slug: "w11-assistant",
    beats: [
      { n: 0, label: "brief", url: "/ai", settle: 11000, actions: [{ do: "wait", ms: 3000 }, { do: "wheel", ms: 5000, dy: 60 }] },
      { n: 1, label: "no-shows", settle: 300, actions: [{ do: "click", role: "button", text: "غياب المرضى", exact: true }, { do: "wait", ms: 5000 }] },
      { n: 2, label: "bot-misses", settle: 300, actions: [{ do: "click", role: "button", text: "البوت", exact: true }, { do: "wait", ms: 5000 }] },
      {
        // The orb: the assistant you can just ask. Bottom-left at this size.
        n: 3, label: "ask-it", settle: 300,
        actions: [
          { do: "click", sel: 'button[title="سارة"]' },
          { do: "wait", ms: 3000 },
          { do: "fill", sel: 'input[placeholder^="اسأل"]', text: "مين عليه فلوس لسه؟", perChar: 90 },
          { do: "press", key: "Enter" },
          { do: "wait", ms: 18000 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------------------------
  w12: {
    title: "And the rest",
    slug: "w12-more",
    beats: [
      { n: 0, label: "attendance", url: "/attendance", settle: 10000, actions: [{ do: "wait", ms: 2000 }, { do: "wheel", ms: 3500, dy: 60 }] },
      { n: 1, label: "leads", url: "/leads", settle: 10000, actions: [{ do: "wait", ms: 2000 }, { do: "wheel", ms: 3500, dy: 60 }] },
      { n: 2, label: "marketing", url: "/marketing", settle: 10000, actions: [{ do: "wait", ms: 2000 }, { do: "wheel", ms: 3500, dy: 60 }] },
      { n: 3, label: "ortho", url: "/ortho", settle: 10000, actions: [{ do: "wait", ms: 4000 }] },
      { n: 4, label: "closing", url: "/", settle: 10000, actions: [{ do: "wait", ms: 6000 }] },
    ],
  },
};
