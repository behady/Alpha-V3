// src/lib/grandTour.ts
/**
 * The grand tour: every screen, every setting, every switch — narrated by Sara.
 *
 * This is pure data so the API route can read it too: the server builds the `open_tour_stop`
 * tool's id list from this file and hands the model the current stop's notes, which is what keeps
 * Sara's spoken tour and Sara's answers from describing two different products.
 *
 * Two kinds of text live on every stop, and they are written for two different readers:
 *
 *  - `say` is what Sara says out loud when the stop opens. Written for a person who has never seen
 *    the screen, in both languages, two to four sentences, warm and concrete. It is shown as a
 *    typed-out line and optionally read aloud, so it is never a list.
 *  - `knowledge` is what the model is given when the user asks a question at that stop. Written
 *    for a model, in English only, dense: what is on the screen, what each option does, the
 *    gotchas. The model answers FROM this, so anything not written here it must not claim.
 *
 * The tour is not a lesson. Lessons (tutorials.ts) make the user click the real controls; the
 * tour locks the page under a spotlight and talks. Sara offers a lesson whenever one matches, and
 * the tour pauses while it runs and resumes where it left off.
 *
 * Gating is the same three doors the navigation itself uses: a nav item hidden from this person
 * (`navKey`), a settings section they cannot open (`settingsId`), and the plain admin gate. A stop
 * nobody in this role can see is never offered — a tour of a door you cannot open is a taunt.
 */

import { SETTINGS_SECTIONS, type SettingsSection } from "@/config/settingsRegistry";
import type { DemoAction } from "@/lib/tourDemo";

export interface Localized {
  en: string;
  ar: string;
}

/** The guide. One place, so renaming her is one edit. */
export const TOUR_GUIDE: Localized = { en: "Sara", ar: "سارة" };

export type TourChapterId =
  | "welcome"
  | "dashboard"
  | "frontdesk"
  | "operations"
  | "insights"
  | "settings"
  | "wrapup";

export interface TourChapter {
  id: TourChapterId;
  title: Localized;
  blurb: Localized;
}

export interface TourStop {
  id: string;
  chapter: TourChapterId;
  /** The screen this stop lives on. The overlay navigates there when the stop opens. */
  route: string;
  /**
   * `[data-tour="…"]` anchors to spotlight, first visible wins. Absent: the whole page area
   * (`page-main`) is lit, which is right for "this is the Finance page" and wrong for "this
   * button".
   */
  spot?: string[];
  title: Localized;
  /** Sara's line. Two to four sentences, spoken. */
  say: Localized;
  /** Questions worth asking here — shown as chips, sent as typed. */
  ask: Localized[];
  /** What the model knows about this stop. English, dense, factual. */
  knowledge: string;
  /** Help Center articles whose full text is handed to the model at this stop. */
  helpSlugs?: string[];
  /** Only for people who can see this navigation item. */
  navKey?: string;
  /** Only for people who can open this settings section. */
  settingsId?: string;
  /** Only for people who see the Settings gear at all. */
  requiresSettingsLink?: boolean;
  adminOnly?: boolean;
  /**
   * The route is resolved at runtime. "firstPatient" opens the first patient on file and skips the
   * stop when there is none — a fresh clinic has no file to show yet. "demoPatient" opens the test
   * patient Sara created (skipped when she did not).
   */
  dynamic?: "firstPatient" | "demoPatient";
  /** Which tab of the demo patient's file to land on. */
  demoPatientTab?: string;
  /**
   * What Sara does on this stop once the person has said yes to demos: real clicks and real
   * typing on the real screen, narrated step by step. See tourDemo.ts.
   */
  demo?: DemoAction[];
  /** Only shown while demos are on — the payment on the test patient, the cleanup at the end. */
  demoOnly?: boolean;
  /**
   * Skip the demo (with a word) when its result already exists — a tour taken twice must not
   * make two test patients or two test treatments.
   */
  demoSkipIf?: "demoPatientExists" | "serviceRowExists";
}

export const TOUR_CHAPTERS: TourChapter[] = [
  {
    id: "welcome",
    title: { en: "Finding your way", ar: "الطريق جوّه النظام" },
    blurb: { en: "The black bar at the top, and what lives in it.", ar: "الشريط الأسود اللي فوق، وفيه إيه." },
  },
  {
    id: "dashboard",
    title: { en: "The dashboard", ar: "لوحة التحكم" },
    blurb: { en: "The screen you land on, and its three faces.", ar: "الشاشة اللي بتبدأ منها، وأشكالها التلاتة." },
  },
  {
    id: "frontdesk",
    title: { en: "Front desk", ar: "الاستقبال" },
    blurb: { en: "WhatsApp, patients, the calendar and leads.", ar: "واتساب والمرضى والمواعيد والعملاء المحتملين." },
  },
  {
    id: "operations",
    title: { en: "Running the clinic", ar: "تشغيل العيادة" },
    blurb: { en: "Money, stock, the lab and the time clock.", ar: "الفلوس والمخزون والمعمل والحضور." },
  },
  {
    id: "insights",
    title: { en: "Insights and growth", ar: "الرؤى والنمو" },
    blurb: { en: "Intelligence, marketing and reports.", ar: "الذكاء والتسويق والتقارير." },
  },
  {
    id: "settings",
    title: { en: "Every setting", ar: "كل الإعدادات" },
    blurb: { en: "Each section of Settings, one by one.", ar: "كل قسم في الإعدادات، واحد واحد." },
  },
  {
    id: "wrapup",
    title: { en: "Help, and me", ar: "المساعدة، وأنا" },
    blurb: { en: "Where to get help, and how to keep asking.", ar: "تلاقي المساعدة فين، وتسألني إزاي." },
  },
];

/* ------------------------------------------------------------------------------------------ */
/* The stops                                                                                    */
/* ------------------------------------------------------------------------------------------ */

const WELCOME_STOPS: TourStop[] = [
  {
    id: "topbar",
    chapter: "welcome",
    route: "/",
    spot: ["topnav", "nav-menu"],
    title: { en: "The black bar", ar: "الشريط الأسود" },
    say: {
      en: "Everything in the system is reached from this black bar. Dashboard is a direct link, and the three menus next to it — Front Desk, Operations, Insights & Growth — hold every page. On a phone the same pages sit behind the menu button at the bottom.",
      ar: "كل حاجة في النظام بتوصلها من الشريط الأسود ده. لوحة التحكم لينك مباشر، والتلات قوايم اللي جنبها — الاستقبال، العمليات، الرؤى والنمو — فيهم كل الصفحات. على الموبايل نفس الصفحات ورا زرار القايمة اللي تحت.",
    },
    ask: [
      { en: "Why are some pages missing from my menus?", ar: "ليه فيه صفحات مش ظاهرة في القوايم؟" },
      { en: "Can I use this on my phone?", ar: "أقدر أستخدمه من الموبايل؟" },
    ],
    knowledge:
      "The app's navigation is one black bar at the top (desktop) with: the clinic logo/name, a clinic switcher (only when the person belongs to more than one clinic), a direct Dashboard link, and three dropdown menus — Front Desk (WhatsApp, Patients, Appointments, Leads), Operations (Finance, Inventory, Supply Store, Lab Tracking, Time Clock), Insights & Growth (Intelligence, Marketing, Reports). On the right: the Settings gear (admins and people with the settings permission), the notification bell, and the account menu. On phones (below the lg breakpoint) there is a bottom bar with Dashboard, WhatsApp, Intelligence, Appointments, Finance, Patients and a Menu button that opens a full sheet with every page plus language, Settings, Getting started, Help and Logout. A page missing from someone's menus means their role/permissions do not include it (Settings → Users → Manage access), or the clinic's plan does not include the feature (Inventory, Time Clock, Marketing, WhatsApp are plan-gated), or — for the Supply Store — no supplier shop is connected. The web app works in any modern browser on phone, tablet and desktop; there is also a native Android app that talks to the same clinic data.",
  },
  {
    id: "account-menu",
    chapter: "welcome",
    route: "/",
    spot: ["account-menu", "nav-menu"],
    title: { en: "Your account menu", ar: "قايمة حسابك" },
    say: {
      en: "Your name up here opens your account menu. That's where you switch the language between English and Arabic, open Getting started and the Help Center, restart this tour, and log out.",
      ar: "اسمك اللي فوق ده بيفتح قايمة حسابك. من هنا بتغيّر اللغة بين العربي والإنجليزي، وتفتح صفحة البداية ومركز المساعدة، وتعيد الجولة دي، وتسجّل خروج.",
    },
    ask: [
      { en: "How do I switch to Arabic?", ar: "أغيّر اللغة للإنجليزي إزاي؟" },
      { en: "Can I take this tour again later?", ar: "أقدر أعيد الجولة دي بعدين؟" },
    ],
    knowledge:
      "The account menu (the initials/name at the top right) contains: Getting started (/welcome — the setup checklist and this tour), Help Center (/help), the language toggle (English ⇄ العربية; the whole interface flips, including right-to-left layout, and the choice is remembered on this device), 'Tour with Sara' (restarts or resumes this tour), 'Return to Hub' for platform super-admins only, and Logout. The person's role at this clinic is printed under their name. On phones the same items are in the bottom Menu sheet.",
  },
  {
    id: "notifications",
    chapter: "welcome",
    route: "/",
    spot: ["notification-bell"],
    title: { en: "Notifications", ar: "التنبيهات" },
    say: {
      en: "The bell collects what needs a human: a patient checked in, a lab case back, stock running low, a WhatsApp message the bot couldn't answer. An admin decides which alerts are on under Settings → Alerts.",
      ar: "الجرس بيجمع اللي محتاج بني آدم: مريض وصل، حالة رجعت من المعمل، صنف قرّب يخلص، رسالة واتساب البوت معرفش يرد عليها. المدير بيحدد التنبيهات اللي شغالة من الإعدادات ← التنبيهات.",
    },
    ask: [
      { en: "Which alerts can the system send?", ar: "النظام بيبعت أنهي تنبيهات؟" },
      { en: "Do alerts reach my phone?", ar: "التنبيهات بتوصل على الموبايل؟" },
    ],
    knowledge:
      "The notification bell lists in-app notifications for this person. Sources include: patient check-ins and late patients (front desk), lab cases due or returned, low stock in Inventory, new leads, new WhatsApp conversations and bot handoffs (messages the WhatsApp assistant could not answer), join requests to the clinic. Which clinical/front-desk alerts are enabled is set by an admin under Settings → Alerts (/settings/alerts): in-app alerts for doctors and front desk, plus the patient-facing automated messages. Push notifications to phones exist for the Android app (e.g. patient checked in, slot freed, low stock). A new WhatsApp message also plays a chime and shows a desktop notification while the web app is open.",
  },
  {
    id: "settings-gear",
    chapter: "welcome",
    route: "/",
    spot: ["nav-settings", "nav-menu"],
    requiresSettingsLink: true,
    title: { en: "The Settings gear", ar: "ترس الإعدادات" },
    say: {
      en: "This gear is Settings — twenty-odd sections in four groups: Personal, Clinic, People, and System & Automation. We'll walk through every one of them near the end of the tour.",
      ar: "الترس ده هو الإعدادات — حوالي عشرين قسم في أربع مجموعات: شخصي، العيادة، الفريق، والنظام والأتمتة. هنمشي عليهم كلهم قرب آخر الجولة.",
    },
    ask: [
      { en: "Who can change settings?", ar: "مين يقدر يغيّر الإعدادات؟" },
      { en: "Is there a search inside Settings?", ar: "فيه بحث جوّه الإعدادات؟" },
    ],
    knowledge:
      "Settings (/settings) has four groups: Personal (Profile, Theme, Interface), Clinic (Clinic profile, Schedule, Branches & Rooms, Dental Labs, Prices, Prescriptions, Visit Reasons, Patient Sources, Attendance, Online Booking, Recall), People (Users, Join Requests, Dentists), System & Automation (Alerts, WhatsApp, SMS, Activity Logs, AI Credits, Recently Deleted). Most Clinic/People/System sections are admin-only (Owner or Clinic Admin). Prescriptions can be granted to staff with the access.settings permission. Everyone can open Profile, Theme (read; admins save), Interface and Recently Deleted. There is a search box at the top of Settings that searches every section by name. When the clinic's subscription is expired or suspended, settings are readable but nothing can be saved.",
  },
];

const DASHBOARD_STOPS: TourStop[] = [
  {
    id: "dashboard",
    chapter: "dashboard",
    route: "/",
    title: { en: "The dashboard", ar: "لوحة التحكم" },
    say: {
      en: "This is home. It answers one question in three seconds: what is happening in the clinic right now — who's booked today, who's arrived, who's in the chair, and what came in at the desk.",
      ar: "دي الشاشة الرئيسية. بتجاوب على سؤال واحد في تلات ثواني: إيه اللي حاصل في العيادة دلوقتي — مين محجوز النهارده، مين وصل، مين على الكرسي، والاستقبال قبض كام.",
    },
    ask: [
      { en: "What do the numbers on the dashboard count?", ar: "الأرقام اللي على الشاشة بتعدّ إيه؟" },
      { en: "Why is my dashboard empty?", ar: "ليه لوحة التحكم فاضية؟" },
    ],
    knowledge:
      "The dashboard (/) is the desk view for reception and admins: today's appointments in order with their status, patients waiting, who is in the chair, today's cash taken at the desk, quick actions (new patient, new appointment), and the day's alerts. A brand-new clinic sees empty states until the first patient and appointment exist. Numbers are for today unless a card says otherwise; money here is cash actually recorded as payments today, not charges. The reception assistant (voice-capable) can be summoned from the appointment views. A user whose role is Dentist sees a different home — see the next stop.",
    helpSlugs: ["the-dashboard", "running-the-day"],
  },
  {
    id: "dashboard-faces",
    chapter: "dashboard",
    route: "/",
    title: { en: "Three home screens", ar: "تلات شاشات رئيسية" },
    say: {
      en: "Home has three faces. Reception sees the desk. A dentist sees their own chair: the next patient, their day, lab cases back for them, and their own money. An owner can switch to the owner's view — cash today, who's on the floor, and the growth tabs. You choose yours under Settings → Interface.",
      ar: "الشاشة الرئيسية ليها تلات أشكال. الاستقبال بيشوف المكتب. الدكتور بيشوف كرسيه: المريض الجاي، يومه، الحالات اللي رجعت من المعمل، وفلوسه. صاحب العيادة يقدر يحوّل لشاشة المالك — الكاش النهارده، مين موجود، وتابات النمو. بتختار بتاعتك من الإعدادات ← واجهة الاستخدام.",
    },
    ask: [
      { en: "What does a dentist see on their home screen?", ar: "الدكتور بيشوف إيه في شاشته؟" },
      { en: "How do I switch to the owner's view?", ar: "أحوّل لشاشة المالك إزاي؟" },
    ],
    knowledge:
      "Three home screens at the same URL (/): (1) the desk view — reception's board of today's appointments and check-ins; (2) the dentist's home, shown automatically to anyone whose role is Dentist — the next patient in their chair, their day's list, lab cases that came back for them, patients they left mid-treatment with no next visit booked, and their own money (what their patients paid today, their share if the clinic allows it under Settings → Dentists, and what their patients still owe); (3) the owner's view for admins — cash today, who is on the floor, the waiting room, then Money / Team / The floor / Growth tabs with every dentist by name, over Today / This week / This month. An admin picks between desk, owner's view and (if also a dentist) the chair under Settings → Interface → 'Your home screen'. The setting is stored on the person's own record, so it follows them to every device.",
  },
];

const FRONTDESK_STOPS: TourStop[] = [
  {
    id: "chats",
    chapter: "frontdesk",
    route: "/chats",
    navKey: "chats",
    title: { en: "WhatsApp", ar: "واتساب" },
    say: {
      en: "This is the clinic's WhatsApp inbox, inside the system. Every patient conversation is a thread on the left; open one and reply from here. When the WhatsApp assistant is on, it answers patients itself, books them, and hands the ones it can't handle to you with a note.",
      ar: "ده صندوق واتساب العيادة، جوّه النظام. كل محادثة مريض خيط على الجنب؛ افتحه ورد من هنا. لما مساعد الواتساب يكون شغال، بيرد على المرضى بنفسه، وبيحجزلهم، واللي ميعرفش يتعامل معاه بيسلّمهولك مع ملاحظة.",
    },
    ask: [
      { en: "How do I connect my clinic's WhatsApp number?", ar: "أربط رقم واتساب العيادة إزاي؟" },
      { en: "What can the WhatsApp assistant do on its own?", ar: "مساعد الواتساب بيقدر يعمل إيه لوحده؟" },
      { en: "Can patients stop the messages?", ar: "المريض يقدر يوقف الرسايل؟" },
    ],
    knowledge:
      "The WhatsApp page (/chats) is the clinic's WhatsApp inbox: a list of conversations (unread count on the nav icon and a chime on new messages), the open thread, a composer to reply, and the patient's file linked from the thread. It requires a WhatsApp Business number connected under Settings → WhatsApp (an official Meta WhatsApp Business connection; the clinic owns its own Meta business portfolio and Alpha is a partner on the number). The WhatsApp assistant (a bot; the clinic names it under Settings → WhatsApp, e.g. 'Sara') answers patients in Egyptian Arabic or English: prices from the clinic's price list, working hours, location, ready answers the clinic writes, offering real free appointment slots and booking them, rescheduling, sending the clinic's media (photos/videos), medicine questions with strict safety rules, and it hands off to a human when it cannot answer — those handoffs appear on the Intelligence page's 'The Bot' tab. Patients can opt out with words like 'stop'; a footer line is added so opt-out is always possible, and SMS is off by default. Automated messages (confirmations, reminders, recalls, review requests) go out over the same number, using approved templates; the message queue on the Intelligence page holds messages waiting for a human to press send. Bot replies are part of the clinic's AI credits.",
    helpSlugs: ["messages"],
  },
  {
    id: "patients",
    chapter: "frontdesk",
    route: "/patients",
    navKey: "patients",
    title: { en: "Patients", ar: "المرضى" },
    say: {
      en: "The patient directory. Every person who has ever sat in your chair is a row here, with their phone, their balance, and their last visit. Click a row and their whole file opens.",
      ar: "دليل المرضى. أي حد قعد على كرسيك في حياته هو صف هنا، برقمه ورصيده وآخر زيارة. اضغط على الصف وملفه كله يفتح.",
    },
    ask: [
      { en: "What if two patients share one phone number?", ar: "لو مريضين بنفس رقم الموبايل؟" },
      { en: "Can I import my old patient list?", ar: "أقدر أستورد قايمة المرضى القديمة؟" },
    ],
    knowledge:
      "The Patients page (/patients) lists every patient: name, phone, balance (what they owe), last visit, source. Rows open the patient's file. A patient record holds name, phone(s), date of birth, gender, address, source (how they heard of the clinic — the list is set under Settings → Patient Sources), notes, allergies/medical alerts. Two patients may share one phone (a parent and child): the system allows it and warns you, and WhatsApp messages go to the number on the record. Deleting a patient moves them to Recently Deleted (Settings → Recently Deleted) from where they can be restored. Bulk import from an old system: there is an import tool at /migrate (admin) that accepts spreadsheets; ask support for help mapping columns.",
    helpSlugs: ["add-a-patient"],
  },
  {
    id: "patients-search",
    chapter: "frontdesk",
    route: "/patients",
    navKey: "patients",
    spot: ["patients-search"],
    title: { en: "Finding someone fast", ar: "تلاقي حد بسرعة" },
    say: {
      en: "Type here to find anyone — part of a name, or a few digits of their phone. The list narrows as you type. At the desk with a patient on the line, this is the fastest way in.",
      ar: "اكتب هنا وتلاقي أي حد — جزء من الاسم، أو كام رقم من التليفون. القايمة بتضيق وانت بتكتب. وانت على المكتب ومريض على التليفون، دي أسرع طريقة.",
    },
    ask: [
      { en: "Can I search by phone number?", ar: "أقدر أدوّر برقم التليفون؟" },
      { en: "Can the assistant open a patient for me?", ar: "المساعد يقدر يفتحلي ملف مريض؟" },
    ],
    knowledge:
      "The search box on the Patients page matches any part of the name and any run of digits in the phone number, live as you type. The AI assistant (the orb in the corner, after the tour) can also open a patient's file by name: 'open Ahmed's file'. There is a two-step lesson 'find-patient' that rings the search box on the real screen.",
  },
  {
    id: "patients-add",
    chapter: "frontdesk",
    route: "/patients",
    navKey: "patients",
    spot: ["patients-add"],
    title: { en: "Adding a patient", ar: "إضافة مريض" },
    say: {
      en: "New patients start with this button. Name and phone are enough to book them; everything else can be filled in later, even from the chair. If you'd like, after the tour I can walk you through it on the real screen.",
      ar: "المريض الجديد بيبدأ من الزرار ده. الاسم والتليفون كفاية عشان تحجزله؛ الباقي ممكن يتملى بعدين، حتى من على الكرسي. لو تحب، بعد الجولة أمشي معاك عليها على الشاشة الحقيقية.",
    },
    ask: [
      { en: "What fields are required for a new patient?", ar: "إيه الحقول المطلوبة للمريض الجديد؟" },
      { en: "Teach me to add a patient", ar: "علّمني أضيف مريض" },
    ],
    knowledge:
      "The 'Add patient' button (permission patients.add) opens the new-patient form: name (required), phone (required for WhatsApp/SMS), date of birth, gender, source, address, notes. Patients can also be created in the booking form while making an appointment, from a lead (convert a lead to a patient), and by the WhatsApp assistant when it books a new caller. There is a guided lesson 'add-patient' — offer it with start_tutorial when the user asks how. During the tour Sara may add a test patient named 'Test patient (Sara)' to demonstrate, and deletes it at the end (it then sits in Settings → Recently Deleted).",
    helpSlugs: ["add-a-patient"],
    demoSkipIf: "demoPatientExists",
    demo: [
      {
        kind: "click",
        anchor: "patients-add",
        say: { en: "Watch. Add patient opens the form.", ar: "بصّ. زرار إضافة مريض بيفتح الفورم." },
      },
      {
        kind: "type",
        anchor: "new-patient-name",
        text: "{{patientName}}",
        say: { en: "The name first — that is the only thing you truly need.", ar: "الاسم الأول — ده الوحيد اللي لازم يتكتب." },
      },
      {
        kind: "type",
        anchor: "new-patient-phone",
        text: "{{phone}}",
        say: { en: "Then the phone. For a real patient, WhatsApp confirmations and reminders go here — this one is a made-up number that reaches nobody.", ar: "وبعدين التليفون. للمريض الحقيقي، تأكيدات الواتساب والتذكيرات بتروح هنا — ده رقم وهمي مش بيوصل لحد." },
      },
      {
        kind: "click",
        anchor: "new-patient-save",
        say: { en: "Save. The file is created and appears in the list.", ar: "حفظ. الملف اتعمل وظهر في القايمة." },
      },
      { kind: "wait", anchor: "patient-row", optional: true, timeoutMs: 4000 },
      {
        kind: "markDemoPatient",
        say: { en: "And I've marked my test patient as never-to-be-messaged, so nothing we do next sends anything anywhere.", ar: "وعلّمت على المريض التجريبي إنه ميتبعتلوش رسايل، فمفيش حاجة هنعملها بعد كده هتبعت أي حاجة لحد." },
      },
      {
        kind: "say",
        text: {
          en: "That's a patient. Birthday, address and medical history can all be filled in from the file later — even from the chair.",
          ar: "كده بقى عندنا مريض. تاريخ الميلاد والعنوان والتاريخ المرضي كلهم ممكن يتملوا من الملف بعدين — حتى من على الكرسي.",
        },
      },
    ],
  },
  {
    id: "patient-file",
    chapter: "frontdesk",
    route: "/patients",
    dynamic: "firstPatient",
    navKey: "patients",
    spot: ["patient-tab-clinical", "patient-tab-overview"],
    title: { en: "A patient's file", ar: "ملف المريض" },
    say: {
      en: "This is one patient's whole story on one screen. The tabs are the chapters: Clinical is every procedure in order, Treatment Plan is what's proposed, Finance is charges, payments and balance, then Timeline, X-rays, Prescriptions and Notes.",
      ar: "ده قصة مريض واحد كاملة على شاشة واحدة. التابات هي الفصول: السجل السريري هو كل إجراء بالترتيب، خطة العلاج هي المقترح، الحسابات هي الرسوم والمدفوعات والرصيد، وبعدين الخط الزمني والأشعة والروشتات والملاحظات.",
    },
    ask: [
      { en: "How is the patient's balance calculated?", ar: "رصيد المريض بيتحسب إزاي؟" },
      { en: "Where do I write a prescription?", ar: "أكتب الروشتة منين؟" },
      { en: "What is the teeth chart?", ar: "إيه هو رسم الأسنان؟" },
    ],
    knowledge:
      "A patient's file (/patients/{id}) has tabs: Overview (details, alerts, next appointment), Clinical (every procedure recorded, in order, with tooth numbers, dentist, price and notes; add a procedure from here; the teeth chart / odontogram lives with the clinical record and prints a diagnosis report from /patients/{id}/diagnosis), Treatment Plan (proposed work with prices, can be drafted by the AI and printed/sent), Finance (charges, payments, balance; Quick Pay to take a payment; receipts; balance = total cost of procedure rows minus total paid on payment rows — exactly the patient Finance tab's formula), Timeline (appointments and events), X-rays (uploaded images), Prescriptions (written at /patients/{id}/rx from the clinic's drug list; print or send on WhatsApp), Notes. A payment can be linked to a specific procedure or put on account. Dentist commission and lab fees are split at payment time per the clinic's rules. Deep links: /patients/{id}?tab=finance etc.",
    helpSlugs: ["patient-account", "clinical-record", "prescriptions", "teeth-chart"],
  },
  {
    id: "patient-payment",
    chapter: "frontdesk",
    route: "/patients",
    dynamic: "demoPatient",
    demoPatientTab: "finance",
    demoOnly: true,
    navKey: "patients",
    spot: ["patient-tab-finance", "page-main"],
    title: { en: "Taking a payment", ar: "استلام دفعة" },
    say: {
      en: "Now money. This is our test patient's Finance tab. I'll take a payment the way the desk does it every day — then, at the end of the tour, I'll delete it again.",
      ar: "دلوقتي الفلوس. دي تاب الحسابات بتاعة المريض التجريبي. هستلم دفعة زي ما الاستقبال بيعمل كل يوم — وفي آخر الجولة هحذفها تاني.",
    },
    ask: [
      { en: "What's the difference between paying for a treatment and paying on account?", ar: "إيه الفرق بين الدفع لعلاج معين والدفع على الحساب؟" },
      { en: "How do I print a receipt?", ar: "أطبع إيصال إزاي؟" },
    ],
    knowledge:
      "On a patient's Finance tab, 'Add payment' (Quick Pay) opens a small form: optionally pick a specific procedure to settle, a note, the amount, and Confirm. A payment can be tied to a procedure (its 'remaining' drops) or put on account (lowers the overall balance only). Payments appear as rows with a receipt/print button, edit and delete (permission-gated). After a payment the system sends the patient a WhatsApp receipt automatically when patient automation is on (Settings → WhatsApp) — Sara's test patient is marked opted-out so no receipt is sent for the demo. Deleting a payment moves it to Recently Deleted and rebalances the account server-side. Sara's demo payment is 50 with the note 'Sara's test payment'.",
    helpSlugs: ["take-a-payment", "patient-account"],
    demo: [
      {
        kind: "click",
        anchor: "patient-tab-finance",
        optional: true,
        say: { en: "The Finance tab: charges, payments and the balance.", ar: "تاب الحسابات: الرسوم والمدفوعات والرصيد." },
      },
      {
        kind: "click",
        anchor: "finance-add-payment",
        say: { en: "Add payment.", ar: "إضافة دفعة." },
      },
      {
        kind: "type",
        anchor: "finance-pay-note",
        text: "{{paymentNote}}",
        say: { en: "A note, so month-end knows what this was.", ar: "ملاحظة، عشان آخر الشهر نعرف دي كانت إيه." },
      },
      {
        kind: "type",
        anchor: "finance-pay-amount",
        text: "{{paymentAmount}}",
        say: { en: "Fifty pounds on account — not tied to a treatment.", ar: "خمسين جنيه على الحساب — مش مربوطة بعلاج." },
      },
      {
        kind: "click",
        anchor: "finance-pay-confirm",
        say: { en: "Confirm. The balance updates, and a receipt can be printed from the row. A real patient would get the receipt on WhatsApp too; my test patient is marked not to be messaged.", ar: "تأكيد. الرصيد اتحدّث، والإيصال بيتطبع من الصف. المريض الحقيقي كان هيوصله الإيصال على واتساب كمان؛ المريض التجريبي معلّم عليه إنه ميتبعتلوش." },
      },
      {
        kind: "say",
        text: {
          en: "The same money now shows in Finance for the whole clinic, as cash in for today.",
          ar: "نفس الفلوس دلوقتي ظاهرة في حسابات العيادة كلها، كاش داخل النهارده.",
        },
      },
    ],
  },
  {
    id: "appointments",
    chapter: "frontdesk",
    route: "/appointments",
    navKey: "appointments",
    title: { en: "The calendar", ar: "المواعيد" },
    say: {
      en: "The calendar only offers the hours you're open, so set your schedule once and it stops showing times you're closed. Switch between week, day, a column per doctor, or a plain list up top. Every appointment carries a colour — that colour is its status.",
      ar: "التقويم بيعرض بس الساعات اللي انت فاتح فيها، فظبط جدولك مرة واحدة وهيبطل يوريك مواعيد وانت قافل. غيّر بين الأسبوع، واليوم، وعمود لكل دكتور، أو قايمة عادية من فوق. كل موعد ليه لون — اللون ده هو حالته.",
    },
    ask: [
      { en: "What do the appointment colours mean?", ar: "ألوان المواعيد معناها إيه؟" },
      { en: "What's the difference between cancelling and deleting?", ar: "إيه الفرق بين الإلغاء والحذف؟" },
      { en: "How does check-in work?", ar: "تسجيل الوصول بيشتغل إزاي؟" },
    ],
    knowledge:
      "The Appointments page (/appointments) shows the calendar in four views: week, day, doctor (one day, one column per dentist) and list (grouped). Working hours, slot length and days off come from Settings → Schedule. Statuses, each with its own colour: Unconfirmed (just booked), Confirmed, Delayed, Check in (patient arrived), In chair, Check out, Completed, Late, No show, Canceled, Rescheduled, Emergency, Unavailable (a blocked slot). The day flows booked → confirmed → checked in → in chair → completed; the dashboard reads these statuses. Cancelling keeps the record (and the reason) for reports; deleting sends it to Recently Deleted. Reminders and confirmations go out automatically on WhatsApp/SMS when configured. Clicking an appointment opens a side panel — the edit form or the AI reception assistant, chosen under Settings → Interface. A flashing card appears when a patient is fifteen minutes late (Settings → Interface). Online booking (Settings → Online Booking) lets patients book into free slots from a public link.",
    helpSlugs: ["book-an-appointment", "reschedule-or-cancel", "running-the-day"],
  },
  {
    id: "appointments-add",
    chapter: "frontdesk",
    route: "/appointments",
    navKey: "appointments",
    spot: ["appointment-add"],
    title: { en: "Booking", ar: "الحجز" },
    say: {
      en: "Booking is three choices: who, what, and when. Pick the patient — or create one on the spot — add the treatment from your price list, and pick a free slot. The confirmation goes to the patient's WhatsApp by itself.",
      ar: "الحجز تلات اختيارات: مين، وإيه، وإمتى. اختار المريض — أو اعمله على طول — ضيف العلاج من قايمة أسعارك، واختار وقت فاضي. التأكيد بيروح لواتساب المريض لوحده.",
    },
    ask: [
      { en: "Does booking charge the patient?", ar: "الحجز بيحاسب المريض؟" },
      { en: "Teach me to book an appointment", ar: "علّمني أحجز موعد" },
    ],
    knowledge:
      "The booking form: patient picker (search or create new), treatment(s) from the services price list with a duration, dentist, date and time chosen from free slots that respect working hours, a note, and whether to charge now (a booking can add the procedure to the patient's account immediately or leave charging until the visit). On save a WhatsApp confirmation is queued/sent if messaging is set up. Guided lesson: 'book-appointment'. The AI assistant can also book by chat ('book Ahmed tomorrow at 5 with Dr. Mona') and asks for the doctor and duration if not given; it never invents a patient.",
    helpSlugs: ["book-an-appointment"],
  },
  {
    id: "leads",
    chapter: "frontdesk",
    route: "/leads",
    navKey: "leads",
    title: { en: "Leads", ar: "العملاء المحتملين" },
    say: {
      en: "Leads are everyone who asked but hasn't booked yet — a call, a Facebook message, a walk-in who said 'I'll think about it'. Write them down here, move them through the stages, and you'll see which channel actually fills the chair.",
      ar: "العملاء المحتملين هم كل حد سأل ولسه محجزش — مكالمة، رسالة فيسبوك، حد دخل وقال «هفكر». سجّلهم هنا، ونقّلهم بين المراحل، وهتعرف أنهي قناة فعلاً بتملى الكرسي.",
    },
    ask: [
      { en: "How do I turn a lead into a patient?", ar: "أحوّل العميل المحتمل لمريض إزاي؟" },
      { en: "Can Facebook ads send leads here automatically?", ar: "إعلانات فيسبوك تبعت العملاء هنا لوحدها؟" },
    ],
    knowledge:
      "The Leads page (/leads): a board/list of prospects with name, phone, source, interest, stage (new → contacted → booked / lost with a reason), follow-up date and notes. 'Convert to patient' creates the patient record and can go straight to booking. Losing a lead asks for a reason so the Marketing Funnel report can show why. Meta (Facebook/Instagram) lead ads can be connected so form leads land here automatically, and a welcome WhatsApp can be sent to new leads. The AI assistant can log a lead from chat. Lesson: 'handle-lead'.",
    helpSlugs: ["leads"],
  },
];

const OPERATIONS_STOPS: TourStop[] = [
  {
    id: "finance",
    chapter: "operations",
    route: "/finance",
    navKey: "finance",
    title: { en: "Finance", ar: "الحسابات" },
    say: {
      en: "This is the clinic's ledger — every pound in and out. Cash in from patients, expenses you record, lab fees and dentist shares as deductions, and at the top the number that matters: true net for the period you pick.",
      ar: "ده دفتر العيادة — كل جنيه داخل وخارج. الكاش من المرضى، المصاريف اللي بتسجلها، مصاريف المعمل ونصيب الدكاترة كخصومات، وفوق الرقم اللي يهمك: صافي الربح الحقيقي للفترة اللي تختارها.",
    },
    ask: [
      { en: "What is True Net?", ar: "يعني إيه صافي الربح الحقيقي؟" },
      { en: "Why doesn't Finance match a patient's file?", ar: "ليه الحسابات مش مطابقة لملف المريض؟" },
      { en: "How are dentist commissions calculated?", ar: "عمولة الدكتور بتتحسب إزاي؟" },
    ],
    knowledge:
      "The Finance page (/finance) is the clinic-wide ledger for a chosen period: Cash In (payments actually received), Expenses (manual entries: rent, salaries, supplies, bills, with categories and optional recurring), Deductions (lab fees and dentist commission shares taken out of payments), and True Net = cash in − expenses − deductions. Rows can be exported. Per row, cash counts the first non-zero money field ('paid' for payments/income, 'cost' for expenses), so a paid amount sitting on a procedure row counts as cash here while the patient screen ignores it — the usual reason the two screens seem to disagree. When a number is questioned, the assistant must call audit_patient_records (one patient) or run_clinic_report (clinic-wide), never sum by hand. Dentist commission: a percentage per dentist (set on their user record) applied to the dentist's share of a payment after lab fees, per the clinic's rules; lab fees come from lab cases. Unpaid balances are chased from /finance/recovery. Lesson: 'add-expense', 'record-payment'.",
    helpSlugs: ["the-ledger", "take-a-payment", "commissions-and-lab-fees"],
  },
  {
    id: "finance-expense",
    chapter: "operations",
    route: "/finance",
    navKey: "finance",
    spot: ["finance-expense-btn"],
    title: { en: "Recording an expense", ar: "تسجيل مصروف" },
    say: {
      en: "Expenses go in with this button: a description, an amount, a category, and whether it repeats every month. Record rent and salaries once as recurring and the net figure stays honest all year.",
      ar: "المصاريف بتتسجل من الزرار ده: وصف، ومبلغ، وفئة، وهل بيتكرر كل شهر. سجّل الإيجار والمرتبات مرة واحدة كمتكررة وصافي الربح يفضل صادق طول السنة.",
    },
    ask: [
      { en: "Can I add my own expense categories?", ar: "أقدر أضيف فئات مصاريف بتاعتي؟" },
      { en: "Teach me to record an expense", ar: "علّمني أسجل مصروف" },
    ],
    knowledge:
      "The 'Add entry' button on Finance opens a form with a type switch (income / expense), date, description, amount, category and a recurring toggle. Manual income is for money that is not a patient payment (e.g. selling a product). Categories are a fixed list with 'General' as default. Lesson: 'add-expense'.",
  },
  {
    id: "inventory",
    chapter: "operations",
    route: "/inventory",
    navKey: "inventory",
    title: { en: "Inventory", ar: "المخزون" },
    say: {
      en: "What's in the cupboard, what it's worth, and what's about to run out. Give each item a minimum, and the system flags it — and can alert you — before you discover it empty mid-procedure.",
      ar: "اللي في الدولاب، وقيمته، واللي قرّب يخلص. حط لكل صنف حد أدنى، والنظام يعلّم عليه — ويقدر ينبهك — قبل ما تكتشف إنه فاضي وانت في نص الإجراء.",
    },
    ask: [
      { en: "How do low-stock alerts work?", ar: "تنبيه نقص المخزون بيشتغل إزاي؟" },
      { en: "Can I order supplies from here?", ar: "أقدر أطلب مستلزمات من هنا؟" },
    ],
    knowledge:
      "Inventory (/inventory, plan feature) tracks materials: name, category, unit, quantity on hand, unit cost (so stock value is shown), supplier, minimum level and expiry. Items at or below their minimum are flagged and trigger a low-stock alert (in-app; push on Android). Stock is adjusted manually (received / used). The Supply Store page (next stop, when a supplier shop is connected) sits next to Inventory for reordering. Lesson: 'add-inventory-item'.",
    helpSlugs: ["inventory"],
  },
  {
    id: "store",
    chapter: "operations",
    route: "/store",
    navKey: "store",
    title: { en: "Supply Store", ar: "متجر المستلزمات" },
    say: {
      en: "A partner supplier's shop, inside the system. Browse, fill the basket, and place the order; you pay the driver in cash when it's delivered. Nothing to sign up for.",
      ar: "متجر مورّد شريك، جوّه النظام. اتفرج، املا السلة، واطلب؛ بتدفع للمندوب كاش لما يوصّل. مفيش تسجيل ولا حاجة.",
    },
    ask: [
      { en: "How do I pay for an order?", ar: "بدفع ثمن الطلب إزاي؟" },
      { en: "Can I track my order?", ar: "أقدر أتابع طلبي؟" },
    ],
    knowledge:
      "The Supply Store (/store) shows a connected partner supplier's catalogue with prices; a basket button in the header; orders are cash on delivery — no online payment. Order history and status live on the page. It appears only when a supplier shop is connected for the platform and the person holds access.store; it is not a paid-plan feature.",
    helpSlugs: ["supply-store"],
  },
  {
    id: "lab",
    chapter: "operations",
    route: "/lab",
    navKey: "lab",
    title: { en: "Lab Tracking", ar: "متابعة المعمل" },
    say: {
      en: "Every crown, denture and aligner you send out is a case here: which lab, which patient, when it's due, and whether it's back. Overdue cases rise to the top, and a remake is one click.",
      ar: "كل طربوش وطقم وتقويم شفاف بتبعته برّه هو حالة هنا: أنهي معمل، أنهي مريض، مستحق إمتى، ورجع ولا لسه. المتأخر بيطلع فوق، وإعادة الحالة ضغطة واحدة.",
    },
    ask: [
      { en: "How do I add my dental labs?", ar: "أضيف معاملي إزاي؟" },
      { en: "Where do lab fees show up?", ar: "مصاريف المعمل بتظهر فين؟" },
    ],
    knowledge:
      "Lab Tracking (/lab, permission access.lab): a board of lab cases — patient, dentist, lab (from Settings → Dental Labs), work type, shade/notes, sent date, due date, status (sent → in progress → received → fitted), fee. Header counts: out at labs, overdue, due this week, total. Print a lab order slip; raise a remake linked to the original. The Money tab summarises what is owed to each lab. Lab fees become deductions in Finance and are subtracted before dentist commission. Lesson: 'lab-order'.",
    helpSlugs: ["commissions-and-lab-fees"],
  },
  {
    id: "attendance",
    chapter: "operations",
    route: "/attendance",
    navKey: "attendance",
    title: { en: "Time Clock", ar: "الحضور والانصراف" },
    say: {
      en: "Staff clock in and out here — on the desk computer or their phone. An admin sets a geofence around the clinic so a phone clock-in only counts from inside, and the team view turns hours into a payroll sheet.",
      ar: "الموظفين بيسجلوا حضور وانصراف من هنا — من جهاز المكتب أو موبايلهم. المدير بيحدد نطاق جغرافي حوالين العيادة عشان تسجيل الحضور من الموبايل يتحسب بس من جوّه، وشاشة الفريق بتحوّل الساعات لكشف مرتبات.",
    },
    ask: [
      { en: "Can staff clock in from home?", ar: "الموظف يقدر يسجل حضور من البيت؟" },
      { en: "How is payroll calculated?", ar: "المرتبات بتتحسب إزاي؟" },
    ],
    knowledge:
      "Time Clock (/attendance, plan feature): 'My Worksheet' for each person (clock in/out, their shifts and hours for a date range) and 'Team Control Center' for admins (everyone's attendance, edits, and payroll invoices from hours × rate). Mobile clock-ins can be restricted to the clinic's location by the geofence set under Settings → Attendance (a radius around the clinic's pinned location). The Android app has a read-only roster and period hours.",
    helpSlugs: ["staff-attendance", "working-hours"],
  },
];

const INSIGHTS_STOPS: TourStop[] = [
  {
    id: "intelligence",
    chapter: "insights",
    route: "/ai",
    navKey: "intelligence",
    spot: ["ai-tabs"],
    title: { en: "Intelligence", ar: "ذكاء ألفا" },
    say: {
      en: "One page, a few tabs. The Brief is today's and this week's numbers written as sentences. Messages is the WhatsApp queue — texts the system wrote, waiting for a person to press send. No-Shows closes out yesterday's unanswered appointments. And The Bot shows the questions the WhatsApp assistant couldn't answer, so you can teach it.",
      ar: "صفحة واحدة، كام تاب. الملخص هو أرقام النهارده والأسبوع مكتوبة كجمل. الرسايل هي طابور الواتساب — رسايل النظام كتبها ومستنية حد يضغط إرسال. الغياب بيقفل مواعيد امبارح اللي محدش جاوب عليها. والبوت بيوريك الأسئلة اللي مساعد الواتساب معرفش يرد عليها، عشان تعلّمه.",
    },
    ask: [
      { en: "Why do messages wait for me instead of sending?", ar: "ليه الرسايل بتستنى مني بدل ما تتبعت؟" },
      { en: "How do I teach the bot a new answer?", ar: "أعلّم البوت إجابة جديدة إزاي؟" },
    ],
    knowledge:
      "Intelligence (/ai) has tabs filtered by permission: The Brief (?tab=brief — today's/this week's numbers as a written briefing: bookings, arrivals, cash, no-shows), Messages (?tab=messages — the WhatsApp send queue: messages the system composed (reminders, recalls, follow-ups) that wait for a human to review and press send; ones with an approved template can go automatically), No-Shows (?tab=noshows — past appointments still in a booked status: mark them no-show, completed or reschedule, which is what makes attendance figures true), The Bot (?tab=bot — real patient questions the WhatsApp assistant handed to a person; repeats are worth a ready answer in Settings → WhatsApp). Older AI pages: /ai/revenue (revenue recovery — unpaid balances to chase), /ai/reactivation (patients who have not been back), /ai/operations (recalls) — reachable by URL.",
    helpSlugs: ["messages"],
  },
  {
    id: "marketing",
    chapter: "insights",
    route: "/marketing",
    navKey: "marketing",
    title: { en: "Marketing", ar: "التسويق" },
    say: {
      en: "The marketing studio. Create writes posts and campaign copy in your clinic's voice, Campaigns sends them, Cases turns before-and-afters into content, Reviews asks happy patients for a Google review and catches the unhappy ones first, and Results shows what worked.",
      ar: "استوديو التسويق. «إنشاء» بيكتب بوستات ونصوص حملات بصوت عيادتك، «الحملات» بتبعتها، «الحالات» بتحوّل صور قبل وبعد لمحتوى، «التقييمات» بتطلب من المريض المبسوط تقييم على جوجل وبتلقط الزعلان الأول، و«النتائج» بتوريك إيه اللي نفع.",
    },
    ask: [
      { en: "How does the review request work?", ar: "طلب التقييم بيشتغل إزاي؟" },
      { en: "Does marketing use my AI credits?", ar: "التسويق بيستهلك رصيد الذكاء الاصطناعي؟" },
    ],
    knowledge:
      "Marketing (/marketing, paid add-on feature 'marketingText'; staff need access.marketing) has tabs: Create (AI-written posts, captions and messages in EN/AR in the clinic's tone), Campaigns (WhatsApp broadcasts to patient segments with templates), Cases (before/after photos into posts, with consent), Reviews (a review request after a visit: happy patients are sent to the clinic's Google review link, unhappy ones are flagged for a call — stats: requests, answered, average stars, happy → Google, unhappy), Results (what each campaign produced), Calendar (planned posts), Library (saved content), Playbooks (ready plans). Marketing generation draws from a separate monthly marketing credit allowance shown under Settings → AI Credits.",
  },
  {
    id: "reports",
    chapter: "insights",
    route: "/reports",
    navKey: "reports",
    spot: ["reports-tabs"],
    title: { en: "Reports", ar: "التقارير" },
    say: {
      en: "Five reports over any date range: Service Analysis — what you actually sell; Dentist Performance; Patient Sources — where patients come from; the Marketing Funnel from lead to chair; and a Clinic Overview. Every one exports to PDF or Excel.",
      ar: "خمس تقارير على أي فترة: تحليل الخدمات — انت بتبيع إيه فعلاً؛ أداء الأطباء؛ مصادر المرضى — المرضى جايين منين؛ قمع التسويق من العميل المحتمل للكرسي؛ ونظرة عامة على العيادة. كل واحد بيتصدّر PDF أو إكسل.",
    },
    ask: [
      { en: "Which report shows my best-selling services?", ar: "أنهي تقرير بيوريني أكتر خدمات بتتباع؟" },
      { en: "Can the assistant read a report for me?", ar: "المساعد يقدر يقرالي تقرير؟" },
    ],
    knowledge:
      "Reports (/reports): pick a start and end date, then a tab — Service Analysis (count and revenue per service), Dentist Performance (per dentist: patients, procedures, revenue, commission), Patient Sources (new patients per source), Marketing Funnel (leads by stage and source, conversion), Clinic Overview (totals). Export buttons produce PDF and Excel. The AI assistant can run clinic reports in chat via run_clinic_report and explain the figures. Lesson: 'explore-reports'.",
  },
];

/* ------------------------------------------------------------------------------------------ */
/* Settings — one stop per section, generated from the registry so a new section cannot be    */
/* silently left off the tour.                                                                 */
/* ------------------------------------------------------------------------------------------ */

interface SettingsNarration {
  say: Localized;
  ask: Localized[];
  knowledge: string;
  helpSlugs?: string[];
  demo?: DemoAction[];
  demoSkipIf?: TourStop["demoSkipIf"];
}

const SETTINGS_NARRATION: Record<string, SettingsNarration> = {
  general: {
    say: {
      en: "Your own profile: your name as it prints on documents, your photo, your phone and your password. Only you can change it.",
      ar: "ملفك الشخصي: اسمك زي ما بيتطبع على المستندات، وصورتك، ورقمك، وكلمة السر. انت بس اللي تقدر تغيّره.",
    },
    ask: [{ en: "How do I change my password?", ar: "أغيّر كلمة السر إزاي؟" }],
    knowledge:
      "Profile (/settings/profile): the signed-in person's own record — display name, profile photo, phone, email (read-only, it is the login), password change, and their signature/title for prescriptions if they are a dentist. Only the six self-editable fields; role and permissions are changed by an admin under Users.",
  },
  appearance: {
    say: {
      en: "The clinic's look — the accent colour and theme everybody sees. Anyone can look; an admin saves.",
      ar: "شكل العيادة — لون التمييز والثيم اللي الكل بيشوفه. أي حد يشوف؛ المدير هو اللي يحفظ.",
    },
    ask: [{ en: "Can each user pick their own theme?", ar: "كل مستخدم يقدر يختار ثيم بتاعه؟" }],
    knowledge:
      "Theme (/settings/theme): clinic-wide appearance — accent colour presets and light/dark preference. Visible to every member; saveable by admins only, because it is the clinic's look, not a personal one. Per-person layout choices are under Interface instead.",
  },
  interface: {
    say: {
      en: "How the app behaves for you: which home screen you land on, how the booking form opens, what appears beside the schedule when you click an appointment, and how a patient's clinical history is sorted and grouped. These follow you to every device.",
      ar: "التطبيق بيتصرف إزاي معاك: بتبدأ من أنهي شاشة، فورم الحجز بيفتح إزاي، إيه اللي بيظهر جنب الجدول لما تضغط على موعد، وتاريخ المريض السريري بيترتب ويتجمع إزاي. الاختيارات دي بتمشي معاك على كل جهاز.",
    },
    ask: [
      { en: "What is the reception assistant panel?", ar: "إيه هي لوحة مساعد الاستقبال؟" },
      { en: "Can I hide the calendar on phones?", ar: "أقدر أخفي التقويم من الموبايل؟" },
    ],
    knowledge:
      "Interface (/settings/interface), stored on the person's own record: 'Your home screen' (desk / owner's view / the chair — for admins); appointment editor style (modal or panel); the side panel when clicking an appointment (the edit form or the AI reception assistant, switchable from the panel); how the procedure editor opens (on the page or pop-up); clinical note sort (newest/oldest first), grouping by visit, density; appointments visibility (show everywhere / desktop only / hidden — for clinics that run the schedule only from the desk); late-patient alert (a flashing card when a patient is fifteen minutes late).",
  },
  clinic_profile: {
    say: {
      en: "The clinic itself: name, logo, phone, address, and your Google links. All of it prints on every prescription, invoice and report — the black card at the top is your letterhead, drawn exactly as it will print.",
      ar: "العيادة نفسها: الاسم، الشعار، التليفون، العنوان، ولينكات جوجل. كل ده بيتطبع على كل روشتة وفاتورة وتقرير — الكارت الأسود اللي فوق هو ورق العيادة زي ما هيتطبع بالظبط.",
    },
    ask: [
      { en: "Where does the logo appear?", ar: "الشعار بيظهر فين؟" },
      { en: "What are the Google links for?", ar: "لينكات جوجل دي بتاعة إيه؟" },
    ],
    knowledge:
      "Clinic profile (/settings/clinic, admin): clinic name, logo (shown in the top bar and on every printed document), phone, address, currency, Google Maps link and Google review link (used by the WhatsApp assistant for directions and by Marketing → Reviews). A live preview at the top shows the letterhead. Lesson: 'clinic-profile'.",
    helpSlugs: ["clinic-profile-and-logo"],
  },
  clinical: {
    say: {
      en: "Opening hours, appointment length, and days off. The calendar and the WhatsApp assistant both obey this, so a wrong closing time here means the bot offers patients slots you're not there for.",
      ar: "ساعات العمل، ومدة الموعد، وأيام الإجازة. التقويم ومساعد الواتساب الاتنين بيمشوا على ده، فلو ساعة القفل غلط هنا البوت هيعرض للمرضى مواعيد انت مش موجود فيها.",
    },
    ask: [
      { en: "Can different days have different hours?", ar: "الأيام تقدر يكون ليها ساعات مختلفة؟" },
      { en: "Teach me to set working hours", ar: "علّمني أظبط ساعات العمل" },
    ],
    knowledge:
      "Schedule (/settings/schedule, admin): open-from and close-at times, slot duration in minutes, and which weekdays the clinic is closed. Read by the calendar (which hours it draws and offers), the booking form, online booking, and the WhatsApp assistant's slot offers. Lesson: 'set-working-hours'.",
    helpSlugs: ["working-hours"],
  },
  locations: {
    say: {
      en: "Branches and rooms. If you work from more than one place, name each branch and its chairs here; staff pick a working branch, and a price list can belong to a branch.",
      ar: "الفروع والغرف. لو بتشتغل من أكتر من مكان، سمّي كل فرع وكراسيه هنا؛ الموظف بيختار فرعه، وقايمة الأسعار ممكن تبقى لفرع معين.",
    },
    ask: [{ en: "Do I need branches if I have one clinic?", ar: "محتاج فروع لو عندي عيادة واحدة؟" }],
    knowledge:
      "Branches & Rooms (/settings/branches, admin): define branches (locations) and the rooms/chairs in each. Each staff member picks one working branch; appointments and price lists can be scoped to a branch. A single-location clinic can ignore this section.",
  },
  labs: {
    say: {
      en: "The dental labs you send work to — name, phone, and what they charge. Lab Tracking picks from this list, and their fees flow into the ledger as deductions.",
      ar: "المعامل اللي بتبعتلها شغل — الاسم، والتليفون، وبياخدوا كام. متابعة المعمل بتختار من القايمة دي، ومصاريفهم بتنزل في الدفتر كخصومات.",
    },
    ask: [{ en: "Where do lab fees get deducted?", ar: "مصاريف المعمل بتتخصم فين؟" }],
    knowledge:
      "Dental Labs (/settings/labs, admin): the list of external labs with contact details and default fees per work type. Used by the Lab Tracking page; a case's fee becomes a deduction in Finance and is taken before dentist commission.",
    helpSlugs: ["commissions-and-lab-fees"],
  },
  services: {
    say: {
      en: "The price list everything is built on. Every treatment with its price, category and icon; price lists per branch with a blanket discount; the discount reasons you require; and a ceiling on how much a non-admin can discount.",
      ar: "قايمة الأسعار اللي كل حاجة مبنية عليها. كل علاج بسعره وفئته وأيقونته؛ قوايم أسعار لكل فرع بخصم عام؛ أسباب الخصم اللي بتطلبها؛ وحد أقصى للخصم لغير المدير.",
    },
    ask: [
      { en: "What is a price list versus a service?", ar: "إيه الفرق بين قايمة الأسعار والخدمة؟" },
      { en: "Teach me to update prices", ar: "علّمني أعدّل الأسعار" },
    ],
    knowledge:
      "Prices (/settings/prices, admin): (1) the service catalogue — every treatment with price, category, icon, default duration, and whether it is a lab job; (2) Price lists — alternative pricing for the same services (insurance, an offer, a family rate), each with a blanket discount prefilled on every line, and optionally tied to a branch; (3) Discount reasons — a reason is required with every discount; (4) Discount ceiling for non-admins. Bookings, charges, the WhatsApp assistant's price answers and commissions all read from here. Lesson: 'update-prices'. During the tour Sara may add 'Test treatment (Sara)' at 100 to demonstrate, and deletes it at the end.",
    helpSlugs: ["services-and-prices"],
    demoSkipIf: "serviceRowExists",
    demo: [
      {
        kind: "click",
        anchor: "price-add-service",
        say: { en: "Let me add a treatment. Add treatment opens the form.", ar: "خليني أضيف علاج. زرار إضافة علاج بيفتح الفورم." },
      },
      {
        kind: "type",
        anchor: "price-service-name",
        text: "{{serviceName}}",
        say: { en: "A name. The category and icon are suggested from it.", ar: "الاسم. الفئة والأيقونة بيتقترحوا منه." },
      },
      {
        kind: "type",
        anchor: "price-service-price",
        text: "{{servicePrice}}",
        say: { en: "And the price.", ar: "والسعر." },
      },
      {
        kind: "click",
        anchor: "price-service-save",
        say: { en: "Save. It's now in every booking form, every charge, and the WhatsApp assistant's price answers.", ar: "حفظ. دلوقتي هو في كل فورم حجز، وكل رسم، وفي ردود أسعار مساعد الواتساب." },
      },
      { kind: "wait", anchor: "price-row-delete", optional: true, timeoutMs: 4000 },
    ],
  },
  prescriptions: {
    say: {
      en: "The drug database behind prescriptions — dozens of common Egyptian medicines are already here, each with its usual dose. Add your own favourites so writing a prescription is a few clicks.",
      ar: "قاعدة الأدوية اللي ورا الروشتات — فيها عشرات الأدوية المصرية الشايعة بجرعتها المعتادة. ضيف اللي بتكتبه كتير عشان الروشتة تبقى كام ضغطة.",
    },
    ask: [{ en: "Can I add a medicine that isn't listed?", ar: "أقدر أضيف دوا مش موجود؟" }],
    knowledge:
      "Prescriptions (/settings/prescriptions; admins and staff with access.settings): the clinic's drug list — name, form, strength, default dose/frequency/duration and notes. A catalogue of common Egyptian drugs ships built in; the clinic adds its own. Also the prescription header/footer text. Prescriptions are written from a patient's file (/patients/{id}/rx), printed or sent on WhatsApp. Lesson: 'write-prescription'.",
    helpSlugs: ["prescriptions"],
  },
  visit_reasons: {
    say: {
      en: "The reasons reception picks from when booking — check-up, pain, follow-up, and whatever else your clinic uses. Keep it short and the bookings stay tidy.",
      ar: "الأسباب اللي الاستقبال بيختار منها وهو بيحجز — كشف، ألم، متابعة، وأي حاجة تانية عيادتك بتستخدمها. خليها قصيرة والحجوزات تفضل مرتبة.",
    },
    ask: [{ en: "Where is the visit reason used?", ar: "سبب الزيارة بيتستخدم فين؟" }],
    knowledge:
      "Visit Reasons (/settings/visit-reasons, admin): the editable list of reasons shown in the booking form and online booking; also what the WhatsApp assistant records as the reason when it books.",
  },
  sources: {
    say: {
      en: "How patients heard about you — Facebook, Google, a friend, walk-in. Every new patient gets one, and the Patient Sources report tells you which channel is worth the money.",
      ar: "المرضى عرفوك منين — فيسبوك، جوجل، صاحب، مرّ من الشارع. كل مريض جديد بياخد واحد، وتقرير مصادر المرضى بيقولك أنهي قناة تستاهل الفلوس.",
    },
    ask: [{ en: "Can I see which source brings the most patients?", ar: "أقدر أشوف أنهي مصدر بيجيب أكتر مرضى؟" }],
    knowledge:
      "Patient Sources (/settings/patient-sources, admin): the list of acquisition channels offered on the new-patient and lead forms. Reports → Patient Sources and Marketing Funnel break results down by these.",
  },
  attendance: {
    say: {
      en: "Attendance rules: pin the clinic's location and the radius around it — a phone clock-in only counts from inside that circle.",
      ar: "قواعد الحضور: ثبّت مكان العيادة والنطاق حواليه — تسجيل الحضور من الموبايل بيتحسب بس من جوّه الدايرة دي.",
    },
    ask: [{ en: "What happens if someone clocks in outside the radius?", ar: "لو حد سجّل حضور برّه النطاق؟" }],
    knowledge:
      "Attendance settings (/settings/attendance, admin): attendance geofencing — the clinic's coordinates and an allowed radius in metres. Clock-ins from a phone outside the radius are refused; desk clock-ins are not location-checked. The Time Clock page uses this.",
    helpSlugs: ["staff-attendance"],
  },
  online_booking: {
    say: {
      en: "A public booking page for your clinic. Switch it on, choose what the patient can pick, add a cover image, and share the link — one link per channel, so you can see where bookings come from.",
      ar: "صفحة حجز عامة لعيادتك. شغّلها، اختار المريض يقدر يختار إيه، حط صورة غلاف، وشارك اللينك — لينك لكل قناة، عشان تعرف الحجوزات جاية منين.",
    },
    ask: [{ en: "Do online bookings need confirmation?", ar: "الحجز الإلكتروني محتاج تأكيد؟" }],
    knowledge:
      "Online Booking (/settings/online-booking, admin): enable a public page where patients book into real free slots; choose which services/reasons and dentists are offered, a cover image, and generate tagged links per channel (Facebook, Instagram, Google) so the source is recorded. Bookings arrive as Unconfirmed appointments and can be auto-confirmed by WhatsApp.",
  },
  recall: {
    say: {
      en: "Recall and reactivation: how many months after a visit a patient is reminded to come back, and how the system reaches patients who drifted away. This is the quiet engine that refills the chair.",
      ar: "المتابعة وإعادة التفعيل: بعد كام شهر من الزيارة المريض يتفكّر يرجع، والنظام بيوصل إزاي للمرضى اللي بعدوا. ده الموتور الهادي اللي بيملى الكرسي تاني.",
    },
    ask: [{ en: "When does a recall message go out?", ar: "رسالة المتابعة بتتبعت إمتى؟" }],
    knowledge:
      "Recall (/settings/recall, admin): recall interval (months after the last visit), the message wording, and reactivation rules for patients with no visit for a long period. Messages are composed into the Intelligence → Messages queue (or sent automatically with an approved WhatsApp template), and the WhatsApp assistant can book the returning patient directly.",
  },
  users: {
    say: {
      en: "Your team. Create a login for each person, give them a role — Owner, Admin, Dentist, Receptionist, Assistant — then fine-tune with the individual switches: who sees money, who can delete, who can discount. Or share an invite link and let them ask to join.",
      ar: "فريقك. اعمل حساب لكل حد، وادّيله دور — مالك، مدير، دكتور، استقبال، مساعد — وبعدين ظبط بالمفاتيح الفردية: مين يشوف الفلوس، مين يحذف، مين يخصم. أو شارك لينك دعوة وخليهم يطلبوا الانضمام.",
    },
    ask: [
      { en: "What's the difference between roles and permissions?", ar: "إيه الفرق بين الدور والصلاحيات؟" },
      { en: "Teach me to add a team member", ar: "علّمني أضيف عضو للفريق" },
    ],
    knowledge:
      "Users (/settings/users, admin): the staff list with role (Owner, Clinic Admin, Dentist, Receptionist, Assistant), status, and 'Manage access' — granular permissions per person (access to each page: patients, appointments, finance, inventory, lab, marketing, settings…, plus actions such as delete, discount, view money). Add a user (name, email, first password), reset a password, transfer ownership, deactivate. Invite links let people request to join; requests appear under Join Requests. A dentist's commission percentage is set on their user record. Lesson: 'invite-team'.",
    helpSlugs: ["add-your-team", "roles-and-permissions"],
  },
  join_requests: {
    say: {
      en: "People who used your invite link and are waiting to be let in. Approve them with a role, or decline.",
      ar: "الناس اللي استخدموا لينك الدعوة ومستنيين تدخّلهم. وافق عليهم بدور، أو ارفض.",
    },
    ask: [{ en: "Where do I get the invite link?", ar: "أجيب لينك الدعوة منين؟" }],
    knowledge:
      "Join Requests (/settings/join-requests, admin): pending requests from people who signed up through the clinic's invite link (Settings → Users → Invite). Approve with a role or decline; approved people get a login at this clinic.",
    helpSlugs: ["add-your-team"],
  },
  dentists: {
    say: {
      en: "What a dentist's own home screen may show — today, whether they see their share of what their patients paid. A pay-visibility decision, so it's clinic-wide and yours to make.",
      ar: "شاشة الدكتور الرئيسية تقدر تعرض إيه — حالياً، هل يشوف نصيبه من اللي مرضاه دفعوه ولا لأ. ده قرار عن ظهور الأجر، فهو على مستوى العيادة وبإيدك.",
    },
    ask: [{ en: "Can dentists see each other's money?", ar: "الدكاترة بيشوفوا فلوس بعض؟" }],
    knowledge:
      "Dentists (/settings/dentists, admin): clinic-wide switches for the dentist home screen — whether each dentist sees their own share (commission) of their patients' payments. Dentists never see other dentists' figures; admins see everyone under the owner's view and Reports → Dentist Performance.",
  },
  notifications: {
    say: {
      en: "Alerts: which in-app notifications doctors and the front desk get, and which automated messages patients receive — confirmations, reminders, follow-ups — and when.",
      ar: "التنبيهات: الدكاترة والاستقبال بياخدوا أنهي إشعارات جوّه النظام، والمرضى بيوصلهم أنهي رسايل تلقائية — تأكيدات، تذكيرات، متابعات — وإمتى.",
    },
    ask: [{ en: "When is the appointment reminder sent?", ar: "تذكير الموعد بيتبعت إمتى؟" }],
    knowledge:
      "Alerts (/settings/alerts, admin): in-app clinical alerts (patient checked in, late, lab back, low stock) for doctors and front desk; patient-facing automation switches — booking confirmation, reminder before the appointment and at what hour, post-visit follow-up, review request — and their wording per language.",
  },
  whatsapp: {
    say: {
      en: "The WhatsApp assistant's brain. Connect the number, name the assistant, write your ready answers and coaching notes, upload the photos and videos it may send, keep a medicine list it may talk about, and try it in the playground before a real patient does.",
      ar: "مخ مساعد الواتساب. اربط الرقم، سمّي المساعد، اكتب إجاباتك الجاهزة وملاحظات التدريب، ارفع الصور والفيديوهات اللي مسموحله يبعتها، وحط قايمة الأدوية اللي يتكلم عنها، وجرّبه في الملعب قبل ما مريض حقيقي يجرّبه.",
    },
    ask: [
      { en: "What are ready answers?", ar: "يعني إيه الإجابات الجاهزة؟" },
      { en: "How do I test the bot safely?", ar: "أجرّب البوت بأمان إزاي؟" },
    ],
    knowledge:
      "WhatsApp (/settings/whatsapp, admin, plan feature whatsappIntegration): connect the clinic's WhatsApp Business number (Meta), the assistant's name and persona notes, ready answers (question → answer pairs the bot uses first), coaching notes (house rules), the media library (photos/videos it may send on request), the medicine list it may discuss, message templates, working of handoff to humans, and the Playground — a sandbox chat to test the bot without a real patient or real bookings. Bot replies spend AI credits; testing in the playground also spends them.",
  },
  sms: {
    say: {
      en: "SMS from the clinic's own phone — the fallback when a patient isn't on WhatsApp. It costs per message, so read the warning, set the opt-out line, and choose which messages may go by SMS.",
      ar: "رسايل SMS من تليفون العيادة نفسه — البديل لما المريض ميكونش على واتساب. بتتكلف على كل رسالة، فاقرا التحذير، وحط سطر إيقاف الرسايل، واختار أنهي رسايل تمشي SMS.",
    },
    ask: [{ en: "Why is SMS off by default?", ar: "ليه SMS مقفول افتراضياً؟" }],
    knowledge:
      "SMS (/settings/sms, admin): sending from the clinic's own phone(s) via the Android app as the sending device; per-message cost warning; the opt-out line appended to every SMS; which message types may fall back to SMS and at what hour; recent messages log. Off by default because it costs money per message and cannot be as easily opted out of as WhatsApp.",
  },
  logs: {
    say: {
      en: "Activity logs — what happened, in order, and who did it. Every save, delete and AI action is a line here. When something looks wrong, this is where the answer is.",
      ar: "سجل النشاط — إيه اللي حصل، بالترتيب، ومين عمله. كل حفظ وحذف وإجراء ذكاء اصطناعي سطر هنا. لما حاجة تبان غلط، الإجابة هنا.",
    },
    ask: [{ en: "Can I see who deleted a record?", ar: "أقدر أعرف مين حذف السجل؟" }],
    knowledge:
      "Activity Logs (/settings/activity, admin, read-only): a chronological log of actions by user — creates, edits, deletes, payments, AI assistant actions — with timestamps. Deleted records themselves are in Recently Deleted.",
  },
  ai_credits: {
    say: {
      en: "Your AI credits: how many the plan gives each month, how many are used, and by what — chat, WhatsApp replies, treatment plans, marketing. Every action is logged here with who used it and for which patient.",
      ar: "رصيد الذكاء الاصطناعي: الباقة بتدّي كام كل شهر، اتستخدم كام، وفي إيه — الشات، ردود الواتساب، خطط العلاج، التسويق. كل إجراء متسجّل هنا بمين استخدمه ولأنهي مريض.",
    },
    ask: [
      { en: "What costs a credit?", ar: "إيه اللي بيكلّف رصيد؟" },
      { en: "What happens when credits run out?", ar: "لو الرصيد خلص بيحصل إيه؟" },
    ],
    knowledge:
      "AI Credits (/settings/ai-credits, admin, read-only): monthly allowance by plan, used vs remaining, extra credits, a log of every AI action (feature, user, patient, credits). Costs: a chat or reception message 1 credit (3 with an image), a WhatsApp bot reply 1, a treatment-plan draft 2, super mode more; marketing has its own allowance; spoken replies have a separate monthly character cap. When credits run out the assistant and the WhatsApp bot stop answering until the 1st of next month or a top-up; the bot then tells patients reception will contact them. Asking Sara a question during this tour costs one credit; the narration itself is free.",
  },
  recently_deleted: {
    say: {
      en: "The bin. Anything deleted — a patient, an appointment, a payment — waits here until you restore it or remove it for good. Nothing in this system disappears on one click.",
      ar: "السلة. أي حاجة اتحذفت — مريض، موعد، دفعة — بتستنى هنا لحد ما ترجّعها أو تشيلها خالص. مفيش حاجة في النظام ده بتختفي بضغطة واحدة.",
    },
    ask: [{ en: "How long do deleted records stay?", ar: "المحذوفات بتفضل قد إيه؟" }],
    knowledge:
      "Recently Deleted (/settings/recently-deleted, every member): deleted records by type with who deleted them and when; Restore puts a record back exactly as it was; 'Delete forever' removes it. Records stay until removed for good.",
  },
};

function settingsStops(): TourStop[] {
  const intro: TourStop = {
    id: "settings",
    chapter: "settings",
    route: "/settings",
    requiresSettingsLink: true,
    title: { en: "Settings, all of it", ar: "الإعدادات، كلها" },
    say: {
      en: "Now the part most tours skip: every setting. Four groups — Personal, Clinic, People, System & Automation — and a search box that finds any section by name. I'll open each one and tell you what it decides.",
      ar: "دلوقتي الجزء اللي أغلب الجولات بتعدّيه: كل الإعدادات. أربع مجموعات — شخصي، العيادة، الفريق، النظام والأتمتة — وخانة بحث بتلاقي أي قسم باسمه. هفتح كل واحد وأقولك بيحدد إيه.",
    },
    ask: [{ en: "Which settings should I do first?", ar: "أبدأ بأنهي إعدادات الأول؟" }],
    knowledge:
      "The Settings index (/settings) lists every section this person may open, grouped. Recommended first-day order for an admin: Clinic profile → Schedule → Prices → Users → Alerts → WhatsApp. The Getting started page (/welcome) tracks these as a checklist that ticks itself when the clinic actually has the thing.",
  };

  const perSection = SETTINGS_SECTIONS.flatMap((section: SettingsSection): TourStop[] => {
    const text = SETTINGS_NARRATION[section.id];
    if (!text) return [];
    return [
      {
        id: `settings-${section.id}`,
        chapter: "settings",
        route: section.route,
        settingsId: section.id,
        spot: ["settings-panel", "page-main"],
        title: { en: section.labelEn, ar: section.labelAr },
        say: text.say,
        ask: text.ask,
        knowledge: text.knowledge,
        helpSlugs: text.helpSlugs,
        demo: text.demo,
        demoSkipIf: text.demoSkipIf,
      },
    ];
  });

  return [intro, ...perSection];
}

const WRAPUP_STOPS: TourStop[] = [
  {
    id: "help",
    chapter: "wrapup",
    route: "/help",
    title: { en: "The Help Center", ar: "مركز المساعدة" },
    say: {
      en: "When you want the long version, it's here: written guides with screenshots, in Arabic and English, in the order you'll need them — from setting up the clinic to what to do when a number looks wrong.",
      ar: "لما تحب النسخة الطويلة، هي هنا: أدلة مكتوبة بالصور، بالعربي والإنجليزي، بالترتيب اللي هتحتاجه — من تجهيز العيادة لحد لما رقم يبان غلط.",
    },
    ask: [{ en: "Is there a guide for taking payments?", ar: "فيه دليل لاستلام المدفوعات؟" }],
    knowledge:
      "The Help Center (/help) has articles in sections: Setting up your clinic, Front desk, Money, Clinical, Running the clinic, AI features, Settings, When something looks wrong. Each article is bilingual with screenshots. The AI assistant can open one: /help/{slug}.",
  },
  {
    id: "getting-started",
    chapter: "wrapup",
    route: "/welcome",
    title: { en: "Getting started", ar: "البداية" },
    say: {
      en: "This is your checklist. Every step ticks itself when the clinic actually has the thing — a patient, a saved schedule, a payment — not when you watched a lesson about it. Press 'Show me how' on any step and a ring points at the exact spot on the real screen.",
      ar: "دي قايمة خطواتك. كل خطوة بتتشطب لوحدها لما العيادة يبقى عندها الحاجة فعلاً — مريض، جدول متحفوظ، دفعة — مش لما تتفرج على درس عنها. اضغط «وريني إزاي» على أي خطوة ودايرة هتشاور على المكان بالظبط على الشاشة الحقيقية.",
    },
    ask: [{ en: "What's the difference between this tour and a lesson?", ar: "إيه الفرق بين الجولة دي والدرس؟" }],
    knowledge:
      "Getting started (/welcome): the setup route in four stages (Open for business, Run a real day, Get the money right, Get more out of it), each mission proved by the clinic's own data or by finishing its lesson; time-left estimate; the trial countdown; a sample clinic with a week of fake data to look around; and this tour, which can be resumed from where it stopped. The tour describes; a lesson makes you click the real buttons with a pulsing ring.",
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
    title: { en: "Deleting, the right way", ar: "الحذف بالطريقة الصح" },
    say: {
      en: "Before we finish, I'll tidy up after myself — and deleting is something you should see too. Nothing in this system disappears on one click: it moves to Recently Deleted, where it can be restored.",
      ar: "قبل ما نخلّص، هنضّف ورايا — والحذف حاجة لازم تشوفها برضه. مفيش حاجة في النظام ده بتختفي بضغطة واحدة: بتروح للمحذوفات، وتقدر ترجّعها.",
    },
    ask: [
      { en: "Can I get a deleted patient back?", ar: "أقدر أرجّع مريض اتحذف؟" },
      { en: "Who is allowed to delete?", ar: "مين مسموحله يحذف؟" },
    ],
    knowledge:
      "Deleting: a payment is deleted from the bin icon on its row (permission finance.delete or similar); a patient from the pencil (edit profile) then the red bin button (permission patients.delete); a treatment from its row in Settings → Prices (admin). Every delete asks for confirmation; deleting a patient with records still attached asks a second time and lists what stays behind. All of it lands in Settings → Recently Deleted, where Restore puts it back exactly as it was and 'Delete forever' removes it.",
    demo: [
      {
        kind: "click",
        anchor: "patient-tab-finance",
        optional: true,
        timeoutMs: 4000,
        say: { en: "First the test payment, from the Finance tab.", ar: "الأول الدفعة التجريبية، من تاب الحسابات." },
      },
      // Each of these is optional: a payment deleted on an earlier run of the tour is simply not
      // there to delete, and the cleanup must still go on to the patient.
      {
        kind: "click",
        anchor: "finance-row-delete",
        inRowContaining: "{{paymentNote}}",
        optional: true,
        timeoutMs: 4000,
        say: { en: "The bin icon on its row.", ar: "أيقونة السلة على صفها." },
      },
      {
        kind: "click",
        anchor: "confirm-yes",
        optional: true,
        timeoutMs: 2500,
        say: { en: "Every delete asks first. Confirm.", ar: "كل حذف بيسأل الأول. تأكيد." },
      },
      { kind: "waitGone", anchor: "finance-row-delete", inRowContaining: "{{paymentNote}}", timeoutMs: 8000, optional: true },
      { kind: "pause", ms: 600 },
      {
        kind: "click",
        anchor: "patient-edit",
        say: { en: "Now the patient. The pencil opens the profile editor.", ar: "دلوقتي المريض. القلم بيفتح تعديل الملف." },
      },
      {
        kind: "click",
        anchor: "patient-delete",
        say: { en: "Delete is the red button at the bottom — deliberately out of the way.", ar: "الحذف هو الزرار الأحمر اللي تحت — بعيد عن الإيد عن قصد." },
      },
      {
        kind: "click",
        anchor: "confirm-yes",
        say: { en: "Confirm. If anything is still attached to the file, it asks once more and says what stays behind.", ar: "تأكيد. لو فيه حاجة لسه متعلقة بالملف، بيسأل مرة كمان وبيقولك إيه اللي هيفضل." },
      },
      { kind: "click", anchor: "confirm-yes", optional: true, timeoutMs: 2500 },
      // The file closes and the list returns only when the delete went through.
      { kind: "waitGone", anchor: "patient-delete", timeoutMs: 8000 },
      { kind: "pause", ms: 1200 },
      {
        kind: "say",
        text: {
          en: "Gone from the list — not from the system. Settings → Recently Deleted has it, with the payment.",
          ar: "اتشال من القايمة — مش من النظام. الإعدادات ← المحذوفات فيها هو والدفعة.",
        },
      },
    ],
  },
  {
    id: "demo-cleanup-service",
    chapter: "wrapup",
    route: "/settings/prices",
    settingsId: "services",
    demoOnly: true,
    spot: ["settings-panel", "page-main"],
    title: { en: "And the test treatment", ar: "والعلاج التجريبي" },
    say: {
      en: "One more: the test treatment I added to your price list. Same idea — the bin on its row, then confirm.",
      ar: "واحدة كمان: العلاج التجريبي اللي ضفته في قايمة أسعارك. نفس الفكرة — السلة على صفه، وبعدين تأكيد.",
    },
    ask: [{ en: "Where do deleted treatments go?", ar: "العلاجات المحذوفة بتروح فين؟" }],
    knowledge:
      "A treatment is removed from Settings → Prices with the bin icon on its row (hover the row on desktop); it asks to confirm, then moves to Recently Deleted. Past charges that used it keep their price and name.",
    demo: [
      {
        kind: "click",
        anchor: "price-row-delete",
        inRowContaining: "{{serviceName}}",
        optional: true,
        timeoutMs: 5000,
        say: { en: "The bin on the test treatment's row.", ar: "السلة على صف العلاج التجريبي." },
      },
      {
        kind: "click",
        anchor: "confirm-yes",
        optional: true,
        timeoutMs: 2500,
        say: { en: "Confirm.", ar: "تأكيد." },
      },
      { kind: "waitGone", anchor: "price-row-delete", inRowContaining: "{{serviceName}}", timeoutMs: 8000 },
      {
        kind: "say",
        text: {
          en: "Everything I added is now in Recently Deleted. Your data is exactly as I found it.",
          ar: "كل اللي ضفته دلوقتي في المحذوفات. بياناتك زي ما لقيتها بالظبط.",
        },
      },
    ],
  },
  {
    id: "finale",
    chapter: "wrapup",
    route: "/",
    title: { en: "That's the whole system", ar: "ده النظام كله" },
    say: {
      en: "That's every screen and every switch. From now on I'm the orb in the corner: ask me anything, in Arabic or English — 'how many patients do I have', 'open Ahmed's file', 'teach me to take a payment' — and I'll answer, open it, or walk you through it on the real screen. Welcome aboard.",
      ar: "دي كل شاشة وكل مفتاح. من دلوقتي أنا الدايرة اللي في الركن: اسألني أي حاجة، بالعربي أو الإنجليزي — «عندي كام مريض»، «افتح ملف أحمد»، «علّمني أستلم دفعة» — وهجاوبك، أو أفتحهالك، أو أمشي معاك عليها على الشاشة الحقيقية. نوّرت.",
    },
    ask: [
      { en: "What can you do for me every day?", ar: "بتقدري تعمليلي إيه كل يوم؟" },
      { en: "How do I start a lesson later?", ar: "أبدأ درس بعدين إزاي؟" },
    ],
    knowledge:
      "After the tour, the assistant lives in the floating orb at the bottom corner of every page. It has three hats: Assist (answers from the clinic's data, opens screens, books, records payments with confirmation, drafts treatment plans, reads reports, remembers rules you teach it), Trainer (starts guided lessons on the real screen — 14 lessons: add-patient, book-appointment, record-payment, add-inventory-item, find-patient, record-treatment, write-prescription, add-expense, handle-lead, set-working-hours, update-prices, clinic-profile, invite-team, lab-order; picking a lesson from the 'Teach me' menu is free, asking in words costs a credit), Support (triage a problem and file a bug or feature ticket with a screenshot). The tour can be restarted from the account menu → Tour with Sara, or from Getting started.",
  },
];

export const TOUR_STOPS: TourStop[] = [
  ...WELCOME_STOPS,
  ...DASHBOARD_STOPS,
  ...FRONTDESK_STOPS,
  ...OPERATIONS_STOPS,
  ...INSIGHTS_STOPS,
  ...settingsStops(),
  ...WRAPUP_STOPS,
];

export const TOUR_STOP_IDS = TOUR_STOPS.map((s) => s.id);

export function tourStopById(id: string): TourStop | undefined {
  return TOUR_STOPS.find((s) => s.id === id);
}

/** Who is being shown around, and what they are allowed to see. */
export interface TourViewer {
  isAdmin: boolean;
  /** Nav keys actually rendered for this person (permissions, plan and connected features applied). */
  visibleNavKeys: readonly string[];
  /** Whether the Settings gear is shown to them at all. */
  showSettings: boolean;
  /** Settings section ids they may open. */
  visibleSettingsIds: readonly string[];
}

/**
 * The stops this person can be shown, in tour order.
 *
 * Same three doors the navigation uses. A stop on a page that is not in their menus is skipped
 * rather than shown-and-blocked: the tour would navigate to an access-denied screen and narrate
 * a page that is not there.
 */
export function tourStopsFor(viewer: TourViewer): TourStop[] {
  return TOUR_STOPS.filter((stop) => {
    if (stop.adminOnly && !viewer.isAdmin) return false;
    if (stop.navKey && !viewer.visibleNavKeys.includes(stop.navKey)) return false;
    if (stop.requiresSettingsLink && !viewer.showSettings) return false;
    if (stop.settingsId && !viewer.visibleSettingsIds.includes(stop.settingsId)) return false;
    return true;
  });
}

/** Roughly how long the tour takes at a reading pace: about twenty seconds a stop. */
export function tourMinutes(stopCount: number): number {
  return Math.max(3, Math.round((stopCount * 20) / 60));
}

/** Ordered chapters that still have at least one stop for this person. */
export function tourChaptersFor(stops: readonly TourStop[]): TourChapter[] {
  const present = new Set(stops.map((s) => s.chapter));
  return TOUR_CHAPTERS.filter((c) => present.has(c.id));
}
