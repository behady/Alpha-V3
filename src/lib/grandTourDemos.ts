// src/lib/grandTourDemos.ts
/**
 * The hands-on half of the tour: what Sara does for real, and the stops that only exist when
 * she is allowed to.
 *
 * The setup chapter helps a new clinic for real — default hours, a starter price list, a test
 * dentist when there is none — each after a yes. The front-desk chapter then runs a normal day
 * on her own test patient: book, arrive, seat, done, a procedure, a prescription, a payment. The
 * cleanup at the end deletes every one of those through the real delete buttons, then restores
 * one from Recently Deleted so that is taught too, and removes it for good.
 *
 * Nothing here touches a real patient. Every demo that opens a file first checks the name on
 * the page is the test patient's (GrandTourOverlay), and the test patient is flagged
 * never-to-be-messaged the moment it is saved.
 */

import type { Localized, TourStop } from "@/lib/grandTour";
import type { DemoAction } from "@/lib/tourDemo";

type L = Localized;
const l = (en: string, ar: string): L => ({ en, ar });
const say = (en: string, ar: string): DemoAction => ({ kind: "say", text: l(en, ar) });
const click = (anchor: string, en?: string, ar?: string, extra: Partial<Extract<DemoAction, { kind: "click" }>> = {}): DemoAction => ({
  kind: "click",
  anchor,
  ...(en && ar ? { say: l(en, ar) } : {}),
  ...extra,
});
const type = (anchor: string, text: string, en?: string, ar?: string): DemoAction => ({
  kind: "type",
  anchor,
  text,
  ...(en && ar ? { say: l(en, ar) } : {}),
});
const point = (text: L, en: string, ar: string, container: "self" | "card" | "row" = "card"): DemoAction => ({
  kind: "point",
  text,
  container,
  say: l(en, ar),
});
const yes = (anchor = "confirm-yes", en?: string, ar?: string): DemoAction =>
  click(anchor, en, ar, { optional: true, timeoutMs: 3000 });

/** The four settings sections that ARE the setup of a new clinic, toured first. */
export const SETUP_SECTION_IDS = ["clinic_profile", "clinical", "services", "users"] as const;

/** Real help on the setup stops, each after a yes; and the test dentist when there is none. */
export const SETTINGS_DEMOS: Record<string, { demo: DemoAction[]; demoSkipIf?: TourStop["demoSkipIf"] }> = {
  clinical: {
    demo: [
      {
        kind: "if",
        check: "scheduleSet",
        is: false,
        then: [
          {
            kind: "offer",
            offer: "defaultHours",
            say: l(
              "Your hours aren't set yet, so the calendar can't offer any times. Shall I set 10 in the morning to 10 at night, Friday off, 30-minute slots? Change any of it right here afterwards.",
              "مواعيدك لسه متظبطتش، فالتقويم مش هيقدر يعرض أي وقت. أظبطها من 10 الصبح لـ10 بالليل، الجمعة إجازة، والموعد نص ساعة؟ غيّر أي حاجة فيها من هنا بعدين.",
            ),
            then: [say("Done — the calendar and the WhatsApp assistant follow these hours from now on.", "تم — التقويم ومساعد الواتساب بيمشوا على المواعيد دي من دلوقتي.")],
          },
        ],
      },
    ],
  },
  services: {
    demoSkipIf: "serviceRowExists",
    demo: [
      {
        kind: "if",
        check: "anyService",
        is: false,
        then: [
          {
            kind: "offer",
            offer: "starterServices",
            say: l(
              "Your price list is empty. Shall I load a starter list of the treatments a general practice actually books — consultation, scaling, fillings, root canals, crowns and so on — with starting prices you edit? In the language we're speaking now.",
              "قايمة أسعارك فاضية. أحمّل قايمة مبدئية بالعلاجات اللي العيادة العامة بتحجزها فعلاً — كشف، تنظيف، حشو، عصب، طرابيش وغيرهم — بأسعار مبدئية تعدّلها؟ باللغة اللي بنتكلم بيها دلوقتي.",
            ),
            then: [say("Loaded. Every treatment can be edited or deleted from its row, and the price is only a starting point.", "اتحمّلت. كل علاج بيتعدّل أو يتحذف من صفه، والسعر مجرد بداية.")],
          },
        ],
      },
      click("price-add-service", "Now let me add one myself, so you see the form. Add treatment.", "دلوقتي خليني أضيف واحد بنفسي، عشان تشوف الفورم. إضافة علاج."),
      type("price-service-name", "{{serviceName}}", "A name. The category and icon are suggested from it.", "الاسم. الفئة والأيقونة بيتقترحوا منه."),
      type("price-service-price", "{{servicePrice}}", "And the price.", "والسعر."),
      click("price-service-save", "Save. It's now in every booking form, every charge, and the WhatsApp assistant's price answers.", "حفظ. دلوقتي هو في كل فورم حجز، وكل رسم، وفي ردود أسعار مساعد الواتساب."),
      { kind: "wait", anchor: "price-row-delete", optional: true, timeoutMs: 4000 },
    ],
  },
  users: {
    demo: [
      {
        kind: "if",
        check: "anyDentist",
        is: false,
        then: [
          {
            kind: "if",
            check: "demoDentistExists",
            is: false,
            then: [
              say("There's no dentist on the team yet, and an appointment needs one. I'll add a test dentist now, and delete it at the end.", "مفيش دكتور في الفريق لسه، والموعد لازمله دكتور. هضيف دكتور تجريبي دلوقتي، وأحذفه في الآخر."),
              click("users-add", "Add team member.", "إضافة عضو للفريق."),
              type("user-name", "{{dentistName}}", "A name…", "الاسم…"),
              type("user-email", "{{dentistEmail}}", "…the email they'll sign in with — this one is a placeholder that reaches nobody…", "…الإيميل اللي هيدخل بيه — ده رقم وهمي مبيوصلش لحد…"),
              type("user-password", "{{dentistPassword}}", "…a first password, which they change later…", "…باسورد أولي، بيغيّره بعدين…"),
              type("user-role", "Dentist", "…and the role: Dentist. That's what puts them on the booking form.", "…والدور: دكتور. ده اللي بيحطه في فورم الحجز."),
              click("user-save", "Create the login.", "إنشاء الحساب."),
              { kind: "wait", anchor: "user-delete", optional: true, timeoutMs: 6000 },
              say("Your real dentists go in the same way. Each then gets Manage access for the fine switches.", "دكاترتك الحقيقيين بيتضافوا بنفس الطريقة. وكل واحد بعدها بياخد إدارة الصلاحيات للمفاتيح الدقيقة."),
            ],
          },
        ],
      },
    ],
  },
};

/* ------------------------------------------------------------------------------------------ */
/* The normal day, on the test patient                                                         */
/* ------------------------------------------------------------------------------------------ */

/** Replaces the old "Booking" stop: a real booking on the test patient. */
export const APPOINTMENT_DEMO_STOP: TourStop = {
  id: "appointment-demo",
  chapter: "frontdesk",
  // One booking per test patient: a second run of the tour must not stack appointments.
  demoSkipIf: "demoAppointmentExists",
  route: "/appointments",
  navKey: "appointments",
  spot: ["appointment-add"],
  title: { en: "Booking", ar: "الحجز" },
  say: {
    en: "Booking is three choices: who, what, and when. Pick the patient — or create one on the spot — a dentist, and a free slot. I'll book my test patient now.",
    ar: "الحجز تلات اختيارات: مين، وإيه، وإمتى. اختار المريض — أو اعمله على طول — والدكتور، ووقت فاضي. هحجز للمريض التجريبي دلوقتي.",
  },
  ask: [
    { en: "Does booking charge the patient?", ar: "الحجز بيحاسب المريض؟" },
    { en: "What if two dentists share a chair?", ar: "لو دكتورين على كرسي واحد؟" },
  ],
  knowledge:
    "The booking form: patient picker (search or create new), dentist, date and time chosen from free slots that respect working hours, duration, optional treatment(s) from the price list (a booking can add a paid procedure now or stay a follow-up with nothing posted), a note. On save a WhatsApp confirmation is queued/sent if messaging is set up — Sara's test patient is opted out so nothing is sent. Guided lesson: 'book-appointment'. The AI assistant can also book by chat and asks for the doctor and duration if not given.",
  helpSlugs: ["book-an-appointment"],
  demo: [
    click("appointment-add", "Add appointment opens the form.", "إضافة موعد بتفتح الفورم."),
    { kind: "wait", anchor: "booking-patient", timeoutMs: 6000 },
    type("booking-patient", "{{patientName}}", "The patient: type a name and pick from the list.", "المريض: اكتب الاسم واختار من القايمة."),
    click("booking-patient-option", "There's my test patient.", "أهو المريض التجريبي.", { timeoutMs: 5000 }),
    { kind: "selectFirst", anchor: "booking-doctor", say: l("The dentist — anyone on the team with the Dentist role.", "الدكتور — أي حد في الفريق بدور دكتور.") },
    { kind: "selectFirst", anchor: "booking-time", say: l("And a free time. Only the hours you're open are offered.", "ووقت فاضي. مش بيعرض غير ساعات الشغل."), optional: true },
    { kind: "selectFirst", anchor: "booking-duration", optional: true },
    click("booking-confirm", "Book. For a real patient the WhatsApp confirmation goes out by itself; mine is marked not to be messaged.", "احجز. للمريض الحقيقي تأكيد الواتساب بيطلع لوحده؛ التجريبي معلّم عليه إنه ميتبعتلوش."),
    // The first offered slot can already hold someone: the system warns before a double booking.
    // Sara goes ahead (the booking is hers and is deleted at the end) and says why.
    click("confirm-yes", "It warns when the slot already has someone — a double booking is a choice, never an accident. Mine is a test, so I'll go ahead.", "بيحذّر لو الميعاد فيه حد — الحجز المزدوج قرار، مش غلطة. بتاعي تجريبي، فهكمّل.", { optional: true, timeoutMs: 2500 }),
    { kind: "pause", ms: 1200 },
    say("It's on the calendar in yellow — unconfirmed — until the patient confirms or arrives.", "بقى على التقويم بالأصفر — غير مؤكد — لحد ما المريض يأكد أو يوصل."),
  ],
};

/** The day, from the receptionist's desk: arrive, seat, check out — and the side editor. */
export const DAY_FLOW_STOP: TourStop = {
  id: "day-flow",
  chapter: "frontdesk",
  route: "/",
  demoOnly: true,
  spot: ["dashboard-appointment", "page-main"],
  title: { en: "Running the day", ar: "تشغيل اليوم" },
  say: {
    en: "Back on the desk. This is where a receptionist lives: each card is a patient, and one button moves them through the day — arrived, in the chair, done. Let me run my test patient through it.",
    ar: "رجعنا للمكتب. هنا الاستقبال بيعيش: كل كارت مريض، وزرار واحد بينقّله في اليوم — وصل، على الكرسي، خلص. خليني أمشّي المريض التجريبي.",
  },
  ask: [
    { en: "What happens when I press Arrive?", ar: "لما أضغط وصول بيحصل إيه؟" },
    { en: "Can I open the AI receptionist beside an appointment?", ar: "أقدر أفتح مساعد الاستقبال جنب الموعد؟" },
  ],
  knowledge:
    "On the desk view each appointment card carries one stage button: Arrive (→ Checked In, stamps the check-in time and starts the waiting clock), Seat (→ In Chair), Check Out (→ Checking Out, then Completed at the desk after payment). Clicking a card opens the side panel: either the editor (doctor, status, date, time, duration, reason for visit, notes, Quick Pay, Delete) or the AI reception assistant that can act on the open appointment — chosen under Settings → Interface. Dentists see the same statuses on their chair screen. A card also has icons for visit history, the file, pay, edit and delete.",
  helpSlugs: ["running-the-day"],
  demo: [
    { kind: "homeView", view: "desk" },
    { kind: "wait", anchor: "dashboard-appointment", timeoutMs: 8000 },
    click("dashboard-appointment", "Click the card and the side panel opens.", "اضغط على الكارت واللوحة الجانبية تفتح.", { inRowContaining: "{{patientName}}" }),
    point(l("Doctor", "الطبيب"), "The editor: doctor…", "المحرر: الدكتور…", "self"),
    point(l("Status", "الحالة"), "…status…", "…الحالة…", "self"),
    point(l("Time", "الوقت"), "…date, time and duration…", "…التاريخ والوقت والمدة…", "self"),
    point(l("Reason for Visit", "سبب الزيارة"), "…and the reason for the visit. Everything saves as you change it.", "…وسبب الزيارة. كل حاجة بتتحفظ وانت بتغيّرها.", "self"),
    // Optional: on a second run the test appointment may already be past these stages.
    click("appointment-stage", "Now the day. Arrive — the patient is in the waiting room and the clock starts.", "دلوقتي اليوم. وصول — المريض في صالة الانتظار والساعة بدأت.", { inRowContaining: "{{patientName}}", timeoutMs: 5000, optional: true }),
    { kind: "pause", ms: 900 },
    click("appointment-stage", "Seat — they're in the chair. The dentist's screen shows them now.", "دخول — بقى على الكرسي. شاشة الدكتور بتوريه دلوقتي.", { inRowContaining: "{{patientName}}", timeoutMs: 5000, optional: true }),
    { kind: "pause", ms: 900 },
    click("appointment-stage", "Check out — back to the desk to pay and book the next visit.", "خروج — رجع للمكتب يدفع ويحجز الزيارة الجاية.", { inRowContaining: "{{patientName}}", timeoutMs: 5000, optional: true }),
    say("That's the whole day, three presses. The dashboard's counters and the brief all read these statuses.", "ده اليوم كله، تلات ضغطات. عدادات لوحة التحكم والملخص كلهم بيقروا الحالات دي."),
  ],
};

/** The clinical note: a procedure from the price list, on the test patient. */
export const PATIENT_CLINICAL_STOP: TourStop = {
  id: "patient-clinical",
  chapter: "frontdesk",
  route: "/patients",
  dynamic: "demoPatient",
  demoPatientTab: "clinical",
  demoOnly: true,
  navKey: "patients",
  spot: ["patient-tab-clinical", "page-main"],
  title: { en: "Recording a treatment", ar: "تسجيل علاج" },
  say: {
    en: "The Clinical tab is the patient's history: every procedure in order. Let me record one on my test patient — the price comes from your price list, and it can go straight onto the account.",
    ar: "تاب السجل السريري هو تاريخ المريض: كل إجراء بالترتيب. خليني أسجّل واحد على المريض التجريبي — السعر بييجي من قايمة أسعارك، ويقدر ينزل على الحساب على طول.",
  },
  ask: [
    { en: "What is the teeth chart for?", ar: "رسم الأسنان بتاع إيه؟" },
    { en: "Does recording a procedure charge the patient?", ar: "تسجيل الإجراء بيحاسب المريض؟" },
  ],
  knowledge:
    "Clinical tab: 'Add New Procedure' opens the editor — search the price list (or type a free name), the cost fills from the list, tooth numbers, a clinical note, an optional discount, and 'Add to Ledger' which posts the charge to the patient's account (untick for a note-only entry). Procedures list newest-first by default (Settings → Interface changes it). The teeth chart (Diagnosis) charts findings per tooth and prints a diagnosis report. Lesson: 'record-treatment'.",
  helpSlugs: ["clinical-record", "teeth-chart"],
  demo: [
    click("patient-tab-clinical", "The Clinical tab.", "تاب السجل السريري.", { optional: true }),
    click("clinical-add-procedure", "Add new procedure.", "إضافة إجراء جديد."),
    type("clinical-procedure-name", "{{procedureName}}", "Search the price list…", "دوّر في قايمة الأسعار…"),
    // Optional: on a clinic whose price list does not hold the test treatment (the setup stop was
    // skipped), the typed name stays as free text and the editor still saves it.
    click("service-option", "…and pick the treatment. The cost fills in from the list.", "…واختار العلاج. التكلفة بتتملى من القايمة.", { timeoutMs: 4000, optional: true }),
    point(l("Add to Ledger", "إضافة للسجل المالي"), "Add to ledger puts the charge on the patient's account. Untick it for a note only.", "الإضافة للسجل المالي بتحط الرسم على حساب المريض. شيل العلامة لو ملاحظة بس.", "self"),
    click("clinical-save", "Save. It's in the history, and on the account.", "حفظ. بقى في التاريخ، وعلى الحساب."),
    { kind: "pause", ms: 900 },
  ],
};

/** A prescription from the drug list, on the test patient. */
export const PATIENT_RX_STOP: TourStop = {
  id: "patient-rx",
  chapter: "frontdesk",
  route: "/patients",
  dynamic: "demoPatient",
  demoOnly: true,
  navKey: "patients",
  spot: ["rx-open", "page-main"],
  title: { en: "Writing a prescription", ar: "كتابة روشتة" },
  say: {
    en: "Write Rx opens the prescription pad: search the drug list, add, and it's printable on your letterhead or sent on WhatsApp. Watch.",
    ar: "وصفة طبية بتفتح الروشتة: دوّر في قايمة الأدوية، ضيف، وتتطبع على ورق العيادة أو تتبعت على واتساب. بصّ.",
  },
  ask: [
    { en: "Can I add my own drugs to the list?", ar: "أقدر أضيف أدويتي للقايمة؟" },
    { en: "Does it send the prescription on WhatsApp?", ar: "بيبعت الروشتة على واتساب؟" },
  ],
  knowledge:
    "Write Rx (permission clinical.edit) opens /patients/{id}/rx: a search over the clinic's drug list (dozens of common Egyptian medicines ship built in; more under Settings → Prescriptions), each pick fills name, dose, frequency and duration which you can edit, then Save. The saved prescription prints on the clinic letterhead or is sent to the patient on WhatsApp as a document (not for Sara's opted-out patient). Past prescriptions are on the Prescriptions tab. Lesson: 'write-prescription'.",
  helpSlugs: ["prescriptions"],
  demo: [
    click("rx-open", "Write Rx.", "وصفة طبية."),
    { kind: "wait", anchor: "rx-drug-search", timeoutMs: 8000 },
    type("rx-drug-search", "{{drugQuery}}", "Search the drug list.", "دوّر في قايمة الأدوية."),
    click("rx-drug-option", "Pick one. Dose, frequency and duration fill in — editable.", "اختار واحد. الجرعة والتكرار والمدة بيتملوا — وبيتعدّلوا.", { timeoutMs: 5000 }),
    click("rx-add-drug", "Add it to the prescription.", "ضيفه للروشتة.", { optional: true, timeoutMs: 3000 }),
    click("rx-save", "Save. Print it, or send it on WhatsApp.", "حفظ. اطبعها، أو ابعتها على واتساب."),
    { kind: "pause", ms: 1000 },
  ],
};

/** Every other tab on the file, opened and explained. */
export const PATIENT_TABS_STOP: TourStop = {
  id: "patient-tabs",
  chapter: "frontdesk",
  route: "/patients",
  dynamic: "firstPatient",
  navKey: "patients",
  spot: ["patient-tab-plan", "page-main"],
  title: { en: "The rest of the file", ar: "باقي الملف" },
  say: {
    en: "The other tabs, one by one.",
    ar: "باقي التابات، واحد واحد.",
  },
  ask: [{ en: "Where do X-rays go?", ar: "الأشعة بتتحط فين؟" }],
  knowledge:
    "Treatment Plan: proposed work with prices, can be drafted by the AI from the chart, printed or sent. Timeline: every appointment and event in order. Overview: details plus the per-patient 'WhatsApp automation' switch and the message log. X-Rays & Photos: uploads, viewable full screen. Prescriptions: every prescription written, reprintable. Notes: free notes for the team.",
  walk: [
    click("patient-tab-plan", "Treatment Plan: what's proposed and priced, before it's done. The assistant can draft one from the chart.", "خطة العلاج: المقترح وسعره، قبل ما يتعمل. المساعد يقدر يكتب واحدة من الرسم.", { optional: true }),
    click("patient-tab-timeline", "Timeline: every visit and event, in order.", "الخط الزمني: كل زيارة وحدث، بالترتيب.", { optional: true }),
    click("patient-tab-overview", "Overview: the details — and this patient's WhatsApp automation switch, with the log of what was sent.", "نظرة عامة: البيانات — ومفتاح رسايل الواتساب التلقائية للمريض ده، وسجل اللي اتبعت.", { optional: true }),
    click("patient-tab-xrays", "X-rays and photos: upload, and view full screen.", "الأشعة والصور: ارفع، واتفرج بالشاشة الكاملة.", { optional: true }),
    click("patient-tab-prescriptions", "Prescriptions: everything written, reprintable.", "الروشتات: كل اللي اتكتب، بيتطبع تاني.", { optional: true }),
    click("patient-tab-notes", "Notes: free notes for the team.", "الملاحظات: ملاحظات حرة للفريق.", { optional: true }),
    click("patient-tab-clinical", "And back to Clinical.", "ونرجع للسجل السريري.", { optional: true }),
  ],
};

/** A lead, for real. */
export const LEAD_DEMO_STOP: TourStop = {
  id: "lead-demo",
  chapter: "frontdesk",
  route: "/leads",
  navKey: "leads",
  demoOnly: true,
  spot: ["leads-add"],
  title: { en: "Catching an inquiry", ar: "تسجيل استفسار" },
  say: {
    en: "The phone rings, someone asks about a price and says they'll think about it. That's a lead. Let me write one down.",
    ar: "التليفون بيرن، حد بيسأل عن سعر وبيقول هفكر. ده عميل محتمل. خليني أسجّل واحد.",
  },
  ask: [{ en: "How do I turn a lead into a patient?", ar: "أحوّل العميل لمريض إزاي؟" }],
  knowledge:
    "Add lead: name, phone, source, what they asked about, a follow-up date. The card shows how long they've waited for a reply; the stage dropdown moves them new → contacted → booked → in the chair, or lost with a reason. Convert to patient creates the file and can go to booking. Facebook/Instagram lead ads can feed this list automatically.",
  helpSlugs: ["leads"],
  demo: [
    click("leads-add", "Add lead.", "إضافة عميل."),
    type("leads-name", "{{leadName}}", "Their name…", "اسمه…"),
    type("leads-phone", "{{leadPhone}}", "…and phone. Source and follow-up date are optional but worth it.", "…وتليفونه. المصدر وميعاد المتابعة اختياريين بس يستاهلوا."),
    click("leads-save", "Save. The card counts how long they've been waiting for a reply.", "حفظ. الكارت بيعدّ استنى قد إيه للرد."),
    { kind: "pause", ms: 900 },
  ],
};

/* ------------------------------------------------------------------------------------------ */
/* Money & operations demos on existing stops                                                  */
/* ------------------------------------------------------------------------------------------ */

export const STOP_DEMOS: Record<string, DemoAction[]> = {
  "finance-expense": [
    click("finance-expense-btn", "Manual entry.", "إدخال يدوي."),
    click("finance-type-expense", "Expense, not income.", "مصروف، مش دخل.", { optional: true }),
    type("finance-expense-desc", "{{expenseNote}}", "What it was…", "كان إيه…"),
    type("finance-expense-amount", "{{expenseAmount}}", "…and how much.", "…وكام."),
    click("finance-expense-save", "Save. True net drops by exactly this.", "حفظ. صافي العيادة بينقص بالمبلغ ده بالظبط."),
    { kind: "pause", ms: 900 },
  ],
  inventory: [
    click("inventory-add", "Add item.", "إضافة صنف."),
    type("inventory-item-name", "{{itemName}}", "A name…", "اسم…"),
    type("inventory-item-stock", "{{itemStock}}", "…how many you have…", "…عندك كام…"),
    // The reorder threshold is required: without it the low-stock alert could never fire.
    type("inventory-item-min", "{{itemMin}}", "…and the minimum. Below this it turns Low and can alert you — the save insists on it.", "…والحد الأدنى. تحته بيبقى ناقص وممكن ينبّهك — والحفظ مش بيقبل من غيره."),
    click("inventory-save", "Save.", "حفظ."),
    { kind: "pause", ms: 900 },
  ],
};

/* ------------------------------------------------------------------------------------------ */
/* Cleanup and restore                                                                         */
/* ------------------------------------------------------------------------------------------ */

export const CLEANUP_STOPS: TourStop[] = [
  {
    id: "demo-cleanup-day",
    chapter: "wrapup",
    route: "/",
    demoOnly: true,
    spot: ["dashboard-appointment", "page-main"],
    title: { en: "Deleting, the right way", ar: "الحذف بالطريقة الصح" },
    say: {
      en: "Before we finish I'll tidy up after myself, and deleting is something you should see too. Nothing in this system disappears on one click: it moves to Recently Deleted, where it can be restored. First the test appointment.",
      ar: "قبل ما نخلّص هنضّف ورايا، والحذف حاجة لازم تشوفها برضه. مفيش حاجة في النظام ده بتختفي بضغطة واحدة: بتروح للمحذوفات، وتقدر ترجّعها. الأول الموعد التجريبي.",
    },
    ask: [{ en: "Who is allowed to delete?", ar: "مين مسموحله يحذف؟" }],
    knowledge:
      "An appointment is deleted from its side panel (Delete, red, at the bottom) after a confirmation; cancelling instead keeps it on the record with a reason. Deleting is permission-gated (appointments.delete) and everything lands in Recently Deleted.",
    demo: [
      { kind: "homeView", view: "desk" },
      click("dashboard-appointment", "Open the card…", "افتح الكارت…", { inRowContaining: "{{patientName}}", optional: true, timeoutMs: 6000 }),
      click("appointment-delete", "…Delete, at the bottom of the panel…", "…حذف، تحت في اللوحة…", { optional: true, timeoutMs: 4000 }),
      yes("confirm-yes", "…and confirm.", "…وتأكيد."),
      { kind: "pause", ms: 900 },
    ],
  },
  {
    id: "demo-cleanup-patient",
    chapter: "wrapup",
    route: "/patients",
    dynamic: "demoPatient",
    demoPatientTab: "finance",
    demoOnly: true,
    navKey: "patients",
    spot: ["page-main"],
    title: { en: "The test patient", ar: "المريض التجريبي" },
    say: {
      en: "Now the payment, then the patient. If anything is still attached to the file — the procedure, the prescription — it asks a second time and says what stays behind.",
      ar: "دلوقتي الدفعة، وبعدين المريض. لو فيه حاجة لسه متعلقة بالملف — الإجراء، الروشتة — بيسأل مرة كمان وبيقولك إيه اللي هيفضل.",
    },
    ask: [{ en: "Can I get a deleted patient back?", ar: "أقدر أرجّع مريض اتحذف؟" }],
    knowledge:
      "A payment is deleted from the bin icon on its row (rebalances the account server-side); a patient from the pencil then the red bin button (patients.delete); a patient with records attached asks a second time and lists them. All of it lands in Recently Deleted.",
    demo: [
      click("patient-tab-finance", "The Finance tab.", "تاب الحسابات.", { optional: true, timeoutMs: 4000 }),
      click("finance-row-delete", "The bin on the payment row…", "السلة على صف الدفعة…", { inRowContaining: "{{paymentNote}}", optional: true, timeoutMs: 4000 }),
      yes("confirm-yes", "…confirm.", "…تأكيد."),
      { kind: "waitGone", anchor: "finance-row-delete", inRowContaining: "{{paymentNote}}", timeoutMs: 8000, optional: true },
      { kind: "pause", ms: 600 },
      click("patient-edit", "The patient: the pencil opens the profile editor.", "المريض: القلم بيفتح تعديل الملف."),
      click("patient-delete", "Delete is the red button at the bottom — deliberately out of the way.", "الحذف هو الزرار الأحمر اللي تحت — بعيد عن الإيد عن قصد."),
      click("confirm-yes", "Confirm.", "تأكيد."),
      yes("confirm-yes", "It asks once more because the procedure and prescription stay behind. Confirm again.", "بيسأل مرة كمان عشان الإجراء والروشتة هيفضلوا. تأكيد تاني."),
      { kind: "waitGone", anchor: "patient-delete", timeoutMs: 8000 },
      { kind: "pause", ms: 1200 },
      say("Gone from the list — not from the system.", "اتشال من القايمة — مش من النظام."),
    ],
  },
  {
    id: "demo-cleanup-rest",
    chapter: "wrapup",
    route: "/finance",
    navKey: "finance",
    demoOnly: true,
    spot: ["page-main"],
    title: { en: "The expense, the lead, the item, the dentist", ar: "المصروف والعميل والصنف والدكتور" },
    say: {
      en: "The rest is the same idea, screen by screen: the bin on the row, then confirm.",
      ar: "الباقي نفس الفكرة، شاشة شاشة: السلة على الصف، وبعدين تأكيد.",
    },
    ask: [{ en: "Where do deleted things go?", ar: "المحذوفات بتروح فين؟" }],
    knowledge: "Expenses are deleted from their ledger row on Finance; leads from the bin on the lead card; stock items from their row in Inventory; a user from Settings → Users (Remove user). Each asks first and lands in Recently Deleted.",
    demo: [
      click("finance-ledger-delete", "The test expense.", "المصروف التجريبي.", { inRowContaining: "{{expenseNote}}", optional: true, timeoutMs: 5000 }),
      yes(),
      { kind: "route", path: "/leads", say: l("The test lead.", "العميل التجريبي.") },
      click("leads-delete", undefined, undefined, { inRowContaining: "{{leadName}}", optional: true, timeoutMs: 6000 }),
      yes(),
      { kind: "route", path: "/inventory", say: l("The test item.", "الصنف التجريبي.") },
      click("inventory-row-delete", undefined, undefined, { inRowContaining: "{{itemName}}", optional: true, timeoutMs: 6000 }),
      yes(),
      { kind: "route", path: "/settings/prices", say: l("The test treatment.", "العلاج التجريبي.") },
      click("price-row-delete", undefined, undefined, { inRowContaining: "{{serviceName}}", optional: true, timeoutMs: 6000 }),
      yes(),
      {
        kind: "if",
        check: "demoDentistExists",
        then: [
          { kind: "route", path: "/settings/users", say: l("And the test dentist.", "والدكتور التجريبي.") },
          click("user-delete", undefined, undefined, { inRowContaining: "{{dentistName}}", optional: true, timeoutMs: 6000 }),
          yes(),
        ],
      },
      say("Everything I added is in Recently Deleted now.", "كل اللي ضفته بقى في المحذوفات دلوقتي."),
    ],
  },
  {
    id: "demo-restore",
    chapter: "wrapup",
    route: "/settings/recently-deleted",
    settingsId: "recently_deleted",
    demoOnly: true,
    spot: ["settings-panel", "page-main"],
    title: { en: "Getting something back", ar: "ترجيع حاجة" },
    say: {
      en: "Recently Deleted: everything anyone deleted, with who and when. Restore puts a record back exactly as it was. Let me restore the test treatment — and then remove it for good, which only an admin can do.",
      ar: "المحذوفات: كل اللي أي حد حذفه، بمين وإمتى. الاستعادة بترجّع السجل زي ما كان بالظبط. خليني أرجّع العلاج التجريبي — وبعدين أشيله خالص، وده المدير بس اللي يقدر يعمله.",
    },
    ask: [{ en: "How long do deleted records stay?", ar: "المحذوفات بتفضل قد إيه؟" }],
    knowledge:
      "Recently Deleted (Settings → Recently Deleted, every member): deleted records by type with who deleted them and when; Restore (any member who may create that record) puts it back exactly as it was; the red 'Delete permanently' (admins only) removes it for good. Records stay until removed for good.",
    demo: [
      click("bin-restore", "Restore the test treatment.", "رجّع العلاج التجريبي.", { inRowContaining: "{{serviceName}}", optional: true, timeoutMs: 6000 }),
      { kind: "pause", ms: 1200 },
      { kind: "route", path: "/settings/prices", say: l("It's back on the price list, exactly as it was.", "رجع لقايمة الأسعار، زي ما كان بالظبط.") },
      { kind: "wait", anchor: "price-row-delete", timeoutMs: 8000, optional: true },
      click("price-row-delete", "Delete it again…", "احذفه تاني…", { inRowContaining: "{{serviceName}}", optional: true, timeoutMs: 6000 }),
      yes(),
      { kind: "route", path: "/settings/recently-deleted", say: l("…and this time, remove it for good.", "…والمرة دي، شيله خالص.") },
      click("bin-purge", "The red button. Admins only, and it asks.", "الزرار الأحمر. للمدير بس، وبيسأل.", { inRowContaining: "{{serviceName}}", optional: true, timeoutMs: 6000 }),
      yes(),
      say("The rest of my test records stay here for you to restore or remove whenever you like.", "باقي سجلاتي التجريبية هتفضل هنا ترجّعها أو تشيلها وقت ما تحب."),
    ],
  },
];
