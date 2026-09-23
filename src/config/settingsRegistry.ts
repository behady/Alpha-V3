/**
 * Every section of the Settings screen, described once.
 *
 * Phase 0 of the settings rebuild. This file is pure data — no React, no Firestore, no imports
 * that pull either in — so it can land before any UI changes and be asserted against
 * firestore.rules by tests/settingsRegistry.test.mts on its own.
 *
 * It exists because the settings screen kept four separate lists of the same facts: a `tabs`
 * array, three hand-written group filters in the sidebar, and the permission checks scattered
 * through the render. Nothing kept them in step, and three things went wrong that no reviewer
 * could see:
 *
 *   1. `recall`, `recently_deleted` and `ai_credits` were in the tabs array and in none of the
 *      three group filters, so on a desktop they were unreachable. Recall survived only because
 *      two AI pages deep-link to `?tab=recall`.
 *
 *   2. The whole Clinic Management group was wrapped in an admin check, so the sections meant to
 *      open for a non-admin holding `access.settings` never appeared for one — while the mobile
 *      dropdown and a typed `?tab=` still let them in. The grant half-worked, in the least
 *      discoverable way available.
 *
 *   3. The Prices section was gated on `access.settings`, which firestore.rules does not accept
 *      for anything that section writes. `services` is held out of the blanket member-write grant
 *      and its own block is Admin-only; `settings/price_lists` and `settings/discounts` are
 *      settings documents, also Admin-only. A non-admin who was granted `access.settings`
 *      therefore reached a screen on which nothing could be saved. The `'services':
 *      'access.settings'` entry in the permission maps looks like the grant that makes it work
 *      and can never fire — `memberMayWrite()` excludes `services` from the only path that reads
 *      those maps.
 *
 * So: `edit` below is not a preference. It is a claim about what firestore.rules will actually
 * accept, and the test fails if the two disagree. Read it as documentation of the database, not
 * of the menu.
 */

/**
 * Where a section appears in the side list. A section belongs to exactly one group.
 *
 * Grouped by the job you came to do, not by who owns the data. The first version had four
 * groups — Personal, Clinic, People, System & Automation — and Clinic alone held thirteen
 * sections, so "where do I change the opening hours" meant scanning a wall of buttons.
 */
export type SettingsGroup =
  | "personal"
  | "clinic"
  | "booking"
  | "money"
  | "team"
  | "messages"
  | "system";

/**
 * Who may do a thing.
 *
 * `member` is any signed-in member of the clinic; `admin` is Clinic Admin or Owner (both, per
 * isClinicAdmin() in firestore.rules); `self` is the signed-in person acting on their own row.
 */
export type SettingsAccess =
  | { kind: "member" }
  | { kind: "admin" }
  | { kind: "self" }
  | { kind: "permission"; id: string };

/**
 * What a section writes.
 *
 * `settingsDoc` and `collection` are checked against firestore.rules directly. `server` is a
 * write that goes through an API route on the Admin SDK, which bypasses rules entirely — so it
 * must name the test that stands in for them, or the carve-out is just an omission with a label.
 * `device` is browser-local and reaches no database at all.
 */
export type SettingsTarget =
  | { kind: "settingsDoc"; docId: string }
  | { kind: "collection"; name: string }
  /**
   * A collection that lives at the root, not under `clinics/{id}`. Three of them are global —
   * see the list in src/lib/db-utils.ts — and `getClinicCollection()` quietly returns the root
   * reference for those names. Which match block in firestore.rules governs a write therefore
   * depends on this distinction, and getting it wrong reads the wrong rule entirely.
   */
  | { kind: "rootCollection"; name: string }
  | { kind: "selfStaffRow" }
  /**
   * One field on the signed-in person's own `users/{uid}` document. firestore.rules lets someone
   * write their own record apart from `isSuperAdmin`, `clinicRoles` and `clinicPermissions`, so
   * this needs no rules change — unlike the staff row, whose self-edit carve-out names six fields
   * and would have to be widened.
   */
  | { kind: "userRecord"; field: string }
  | { kind: "server"; route: string; guardedBy: string }
  | { kind: "device"; note: string }
  | { kind: "readOnly"; reads: string };

export interface SettingsSection {
  /** Frozen: the value `?tab=` used to carry. Other screens and the tutorials still use these. */
  id: string;
  /** Where this section lives after Phase 1. `?tab=<id>` must redirect here. */
  route: string;
  group: SettingsGroup;
  labelEn: string;
  labelAr: string;
  /**
   * One plain sentence on what the section decides. Shown under the title and searched, so
   * typing "password" finds Your profile and "hours" finds Working hours — words that are in no
   * section's name.
   */
  hintEn: string;
  hintAr: string;
  /**
   * Extra words the search should answer to, in either language: the name the section had
   * before (people who learned "Recall" still type it) and the words people actually use.
   */
  keywords: string[];
  /** Everything this section can write. Empty means it is a viewer. */
  writes: SettingsTarget[];
  /** Who may open it. Never stricter than `edit` — a section you may change but not see is a bug. */
  view: SettingsAccess;
  /** Who may save. Must match what firestore.rules enforces for every target above. */
  edit: SettingsAccess;
  /** Frozen tutorial anchor. The walkthrough's pulsing ring attaches to this exact string. */
  tourAnchor?: string;
  /** Subscription feature this section is gated behind, if any. */
  feature?: string | string[];
}

const ADMIN: SettingsAccess = { kind: "admin" };
const MEMBER: SettingsAccess = { kind: "member" };

export const SETTINGS_SECTIONS: SettingsSection[] = [
  // --- You ------------------------------------------------------------------------------------------
  {
    id: "general",
    route: "/settings/profile",
    group: "personal",
    labelEn: "Your profile",
    labelAr: "ملفك الشخصي",
    hintEn: "Your name, photo, phone and password.",
    hintAr: "اسمك وصورتك ورقمك وكلمة السر.",
    keywords: ["profile", "password", "photo", "الملف الشخصي", "كلمة المرور"],
    // Not the whole staff row — firestore.rules carves out exactly six fields a person may change
    // on their own record. Admin-only on the whole document meant nobody below Admin could set a
    // profile picture and the screen simply failed; that carve-out is what fixed it, and the test
    // asserts it is still there.
    writes: [{ kind: "selfStaffRow" }],
    view: { kind: "self" },
    edit: { kind: "self" },
  },
  {
    id: "interface",
    route: "/settings/interface",
    group: "personal",
    labelEn: "Your preferences",
    labelAr: "تفضيلاتك",
    hintEn: "Your home screen, how the booking form opens, and how patient history is sorted.",
    hintAr: "شاشتك الرئيسية، وطريقة فتح نموذج الحجز، وترتيب تاريخ المريض.",
    keywords: ["interface", "home screen", "layout", "واجهة الاستخدام"],
    // Stored on the person's own record since Phase 3, not in the browser. They lived in
    // localStorage and nowhere else, so setting the app up the way you like it on the desk
    // computer got you the defaults on a tablet, with nothing on screen to explain why. The
    // browser copy is kept as a cache so the first paint is not the default layout.
    writes: [{ kind: "userRecord", field: "uiPreferences" }],
    view: MEMBER,
    edit: MEMBER,
  },

  // --- Clinic ---------------------------------------------------------------------------------------
  {
    id: "clinic_profile",
    route: "/settings/clinic",
    group: "clinic",
    labelEn: "Clinic details",
    labelAr: "بيانات العيادة",
    hintEn: "Name, logo, phone and address — printed on every prescription and invoice.",
    hintAr: "الاسم والشعار والتليفون والعنوان — تُطبع على كل روشتة وفاتورة.",
    keywords: ["clinic profile", "logo", "letterhead", "address", "ملف العيادة", "الشعار"],
    // One document since Phase 2. It used to write two — `clinicProfile` for the logo and the
    // Google links, `clinic_info` for everything ~30 other readers consult — and hand-copied the
    // shared fields between them on every save, which is exactly how they drifted apart.
    // src/lib/clinicProfile.ts holds the merge and the fallback for clinics that have not saved
    // since; scripts/backfill-clinic-profile.mjs retires the old document for good.
    writes: [{ kind: "settingsDoc", docId: "clinic_info" }],
    view: ADMIN,
    edit: ADMIN,
    tourAnchor: "settings-tab-clinic",
  },
  {
    id: "locations",
    route: "/settings/branches",
    group: "clinic",
    labelEn: "Branches & rooms",
    labelAr: "الفروع والغرف",
    hintEn: "Each place you work from, and its chairs.",
    hintAr: "كل مكان تعمل منه، وكراسيه.",
    keywords: ["branch", "room", "chair", "فرع", "كرسي"],
    writes: [{ kind: "settingsDoc", docId: "locations" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "appearance",
    route: "/settings/theme",
    group: "clinic",
    labelEn: "Colours & look",
    labelAr: "الألوان والمظهر",
    hintEn: "The clinic's colours and theme, the same for everyone.",
    hintAr: "ألوان العيادة والمظهر، واحد للجميع.",
    keywords: ["theme", "colour", "color", "dark mode", "المظهر", "الثيم"],
    writes: [{ kind: "settingsDoc", docId: "appearance" }],
    // Visible to everyone, saveable by an admin. This is the shape the rest of the screen should
    // copy: ThemeContext already resolves `canEdit: isAdmin && !isReadOnly` and the panel says
    // "admin only" instead of failing on save.
    view: MEMBER,
    edit: ADMIN,
  },

  // --- Booking & patients ---------------------------------------------------------------------------
  {
    id: "clinical",
    route: "/settings/schedule",
    group: "booking",
    labelEn: "Working hours",
    labelAr: "ساعات العمل",
    hintEn: "Opening hours, appointment length and days off.",
    hintAr: "مواعيد الفتح، ومدة الموعد، والإجازات.",
    keywords: ["schedule", "opening", "days off", "holiday", "الجدول", "المواعيد", "إجازة"],
    writes: [{ kind: "settingsDoc", docId: "clinic_info" }],
    view: ADMIN,
    edit: ADMIN,
    tourAnchor: "settings-tab-schedule",
  },
  {
    id: "online_booking",
    route: "/settings/online-booking",
    group: "booking",
    labelEn: "Online booking",
    labelAr: "الحجز الإلكتروني",
    hintEn: "A booking page patients can use themselves.",
    hintAr: "صفحة حجز يستخدمها المرضى بأنفسهم.",
    keywords: ["booking page", "link", "رابط الحجز"],
    writes: [{ kind: "settingsDoc", docId: "onlineBooking" }],
    view: ADMIN,
    edit: ADMIN,
    feature: "onlineBooking",
  },
  {
    id: "visit_reasons",
    route: "/settings/visit-reasons",
    group: "booking",
    labelEn: "Visit reasons",
    labelAr: "أسباب الزيارة",
    hintEn: "The reasons reception picks from when booking.",
    hintAr: "الأسباب التي يختار منها الاستقبال عند الحجز.",
    keywords: ["reason", "complaint", "سبب"],
    writes: [{ kind: "settingsDoc", docId: "visit_reasons" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "recall",
    route: "/settings/recall",
    group: "booking",
    labelEn: "Come-back reminders",
    labelAr: "تذكير العودة",
    hintEn: "When patients are reminded to come back, and winning back those who stopped.",
    hintAr: "متى يُذكَّر المريض بالعودة، واسترجاع من انقطع.",
    keywords: ["recall", "reactivation", "follow-up", "المتابعة"],
    writes: [
      { kind: "settingsDoc", docId: "recall" },
      { kind: "settingsDoc", docId: "reactivation" },
    ],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "sources",
    route: "/settings/patient-sources",
    group: "booking",
    labelEn: "How patients find you",
    labelAr: "كيف يعرفك المرضى",
    hintEn: "Facebook, Google, a friend — where new patients come from.",
    hintAr: "فيسبوك، جوجل، صديق — من أين يأتي المرضى الجدد.",
    keywords: ["patient sources", "source", "marketing", "facebook", "مصادر المرضى", "مصدر"],
    writes: [{ kind: "settingsDoc", docId: "patient_sources" }],
    view: ADMIN,
    edit: ADMIN,
  },

  // --- Treatment & money ----------------------------------------------------------------------------
  {
    id: "services",
    route: "/settings/prices",
    group: "money",
    labelEn: "Treatments & prices",
    labelAr: "العلاجات والأسعار",
    hintEn: "Every treatment and its price, price lists and discounts.",
    hintAr: "كل علاج وسعره، وقوائم الأسعار والخصومات.",
    keywords: ["prices", "price list", "discount", "services", "الأسعار", "خصم"],
    writes: [
      { kind: "collection", name: "services" },
      { kind: "settingsDoc", docId: "price_lists" },
      { kind: "settingsDoc", docId: "discounts" },
    ],
    // Admin, not `access.settings`. See note 3 at the top of this file: every one of the three
    // targets above is Admin-only in firestore.rules, so the old `requires: "access.settings"`
    // gate opened a screen on which nothing could be saved. If prices should be delegable, the
    // rules change first and this line follows — not the other way round.
    view: ADMIN,
    edit: ADMIN,
    tourAnchor: "settings-tab-prices",
  },
  {
    id: "payers",
    route: "/settings/payers",
    group: "money",
    labelEn: "Insurance companies",
    labelAr: "شركات التأمين",
    hintEn: "The insurers you work with, what they pay, and what dentists earn on their cases.",
    hintAr: "شركات التأمين التي تتعامل معها، وما تدفعه، ونصيب الطبيب من حالاتها.",
    keywords: ["payers", "insurer", "insurance", "commission", "التأمين وجهات الدفع", "تأمين"],
    // The payer list itself, plus each dentist's per-payer commission rate, which lives on their
    // staff record. Both targets are Admin-only in firestore.rules, so this section is too — the
    // same reasoning as Prices above: a screen gated more loosely than the rules is a screen on
    // which nothing can be saved.
    writes: [
      { kind: "settingsDoc", docId: "payers" },
      { kind: "collection", name: "staff" },
    ],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "labs",
    route: "/settings/labs",
    group: "money",
    labelEn: "Dental labs",
    labelAr: "المعامل",
    hintEn: "The labs you send work to, and what they charge.",
    hintAr: "المعامل التي ترسل لها الشغل، وأسعارها.",
    keywords: ["lab", "معمل"],
    writes: [{ kind: "settingsDoc", docId: "labs" }],
    view: ADMIN,
    edit: ADMIN,
    feature: "lab",
  },
  {
    id: "prescriptions",
    route: "/settings/prescriptions",
    group: "money",
    labelEn: "Medicines",
    labelAr: "الأدوية",
    hintEn: "The medicine list used when writing a prescription.",
    hintAr: "قائمة الأدوية المستخدمة عند كتابة الروشتة.",
    keywords: ["prescriptions", "drug", "medicine", "الوصفات", "روشتة", "دواء"],
    writes: [{ kind: "collection", name: "drugs" }],
    // The one section in this group that a non-admin can genuinely be granted: the `drugs` block
    // in firestore.rules names `access.settings` explicitly. Which means it must NOT sit inside a
    // sidebar group that is itself admin-gated — the mistake that made the grant invisible.
    view: { kind: "permission", id: "access.settings" },
    edit: { kind: "permission", id: "access.settings" },
  },

  // --- Team -----------------------------------------------------------------------------------------
  {
    id: "users",
    route: "/settings/users",
    group: "team",
    labelEn: "Staff & logins",
    labelAr: "الموظفون وحساباتهم",
    hintEn: "Add staff, set their role, and what each person may do.",
    hintAr: "أضف الموظفين، وحدد دورهم وصلاحيات كل شخص.",
    keywords: ["users", "staff", "role", "permission", "invite", "المستخدمين", "صلاحيات", "دعوة"],
    writes: [
      { kind: "server", route: "/api/staff/create", guardedBy: "tests/permissions.test.mts" },
      { kind: "server", route: "/api/admin/update-user", guardedBy: "tests/permissions.test.mts" },
      { kind: "server", route: "/api/delete-user", guardedBy: "tests/permissions.test.mts" },
      { kind: "server", route: "/api/admin/transfer-ownership", guardedBy: "tests/permissions.test.mts" },
    ],
    view: ADMIN,
    edit: ADMIN,
    tourAnchor: "settings-tab-users",
  },
  {
    id: "join_requests",
    route: "/settings/join-requests",
    group: "team",
    labelEn: "Join requests",
    labelAr: "طلبات الانضمام",
    hintEn: "People who used your invite link and are waiting.",
    hintAr: "من استخدم رابط الدعوة وينتظر الموافقة.",
    keywords: ["invite", "join", "دعوة"],
    // Root collection, not `clinics/{id}/join_requests` — a request is filed before the person
    // holds any role at the clinic, so it cannot live inside it. Filing goes through the Admin
    // SDK (`allow create: if false`); the browser only ever flips `status`, and only an admin of
    // the clinic named on the request may do it.
    writes: [
      { kind: "rootCollection", name: "join_requests" },
      { kind: "server", route: "/api/join-requests/approve", guardedBy: "tests/permissions.test.mts" },
    ],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "dentists",
    route: "/settings/dentists",
    group: "team",
    labelEn: "Dentist home screen",
    labelAr: "شاشة الطبيب",
    hintEn: "Whether dentists see their share of what their patients paid.",
    hintAr: "هل يرى الطبيب نصيبه مما دفعه مرضاه.",
    keywords: ["dentists", "doctor", "share", "commission", "الأطباء", "دكتور"],
    // What a dentist's own home screen may show — today, whether they see their share of what
    // their patients paid. Clinic-wide and Admin-only: it is a pay-visibility decision, not a
    // preference, so it lives on clinic_info rather than on the person's record.
    writes: [{ kind: "settingsDoc", docId: "clinic_info" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "attendance",
    route: "/settings/attendance",
    group: "team",
    labelEn: "Clock-in rules",
    labelAr: "قواعد الحضور",
    hintEn: "Where staff must be for a phone clock-in to count.",
    hintAr: "المكان الذي يجب أن يكون فيه الموظف ليُحتسب حضوره من الموبايل.",
    keywords: ["attendance", "clock in", "location", "الحضور", "البصمة"],
    writes: [{ kind: "settingsDoc", docId: "clinic_info" }],
    view: ADMIN,
    edit: ADMIN,
  },

  // --- Messages -------------------------------------------------------------------------------------
  {
    id: "whatsapp",
    route: "/settings/whatsapp",
    group: "messages",
    labelEn: "WhatsApp setup",
    labelAr: "إعداد واتساب",
    hintEn: "Connect the number and set up the WhatsApp assistant.",
    hintAr: "ربط الرقم وإعداد مساعد واتساب.",
    keywords: ["whatsapp", "number", "assistant", "واتساب"],
    writes: [{ kind: "settingsDoc", docId: "whatsapp" }],
    view: ADMIN,
    edit: ADMIN,
    // Both WhatsApp add-ons are configured here, so either one opens it.
    feature: ["whatsappIntegration", "whatsappBot"],
  },
  // The bot and the AI are slices of the same document as WhatsApp above — one component,
  // three menu entries — because the seven-tab page they came from mixed the bot's switches
  // with the AI's and nobody could tell which was which.
  {
    id: "whatsapp_bot",
    route: "/settings/whatsapp-bot",
    group: "messages",
    labelEn: "WhatsApp ready answers",
    labelAr: "ردود واتساب الجاهزة",
    hintEn: "Fixed answers to common questions — free and instant.",
    hintAr: "ردود ثابتة على الأسئلة المتكررة — مجانية وفورية.",
    keywords: ["bot", "auto reply", "البوت", "رد تلقائي"],
    writes: [{ kind: "settingsDoc", docId: "whatsapp" }],
    view: ADMIN,
    edit: ADMIN,
    feature: "whatsappBot",
  },
  {
    id: "whatsapp_ai",
    route: "/settings/whatsapp-ai",
    group: "messages",
    labelEn: "WhatsApp AI answers",
    labelAr: "ردود واتساب الذكية",
    hintEn: "What the AI may say when no ready answer fits. Uses credits.",
    hintAr: "ما يمكن أن يرد به الذكاء الاصطناعي عندما لا يوجد رد جاهز. يستهلك رصيد.",
    keywords: ["ai assistant", "ai", "المساعد الذكي", "ذكاء"],
    writes: [{ kind: "settingsDoc", docId: "whatsapp" }],
    view: ADMIN,
    edit: ADMIN,
    feature: "aiChat",
  },
  {
    id: "sms",
    route: "/settings/sms",
    group: "messages",
    labelEn: "SMS",
    labelAr: "الرسائل النصية",
    hintEn: "Text messages from the clinic's phone, for patients without WhatsApp.",
    hintAr: "رسائل نصية من تليفون العيادة، للمرضى بدون واتساب.",
    keywords: ["sms", "text", "رسائل نصية"],
    // Deliberately not behind `whatsappIntegration`: sending from the clinic's own SIM needs no
    // gateway and no paid integration. It is the fallback for clinics that cannot have one.
    writes: [{ kind: "settingsDoc", docId: "sms" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "notifications",
    route: "/settings/alerts",
    group: "messages",
    labelEn: "Alerts & reminders",
    labelAr: "التنبيهات والتذكيرات",
    hintEn: "Who on the team gets alerts, and which automatic messages patients get.",
    hintAr: "من في الفريق يصله التنبيه، وأي رسائل تلقائية تصل للمرضى.",
    keywords: ["alerts", "notifications", "reminders", "التنبيهات", "إشعارات", "تذكير"],
    writes: [{ kind: "settingsDoc", docId: "clinic_info" }],
    view: ADMIN,
    edit: ADMIN,
  },

  // --- System ---------------------------------------------------------------------------------------
  {
    id: "ai_credits",
    route: "/settings/ai-credits",
    group: "system",
    labelEn: "AI credits",
    labelAr: "رصيد الذكاء الاصطناعي",
    hintEn: "What the AI has used this month, and by whom.",
    hintAr: "ما استهلكه الذكاء الاصطناعي هذا الشهر، ومن استخدمه.",
    keywords: ["credits", "usage", "رصيد"],
    // `ai_usage` and `ai_usage_log` are `allow write: if false` — the meter and its spend log are
    // written only by the server. A member who could write these could refill their own clinic's
    // credits and erase the record of what was spent. The one thing this screen writes is the
    // read-x-rays-on-upload switch, a settings document (Admin-only in the rules, as all are).
    writes: [{ kind: "readOnly", reads: "ai_usage" }, { kind: "settingsDoc", docId: "ai_xray" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "ai_connector",
    route: "/settings/ai-connector",
    group: "system",
    labelEn: "Connect an AI app",
    labelAr: "ربط تطبيق ذكاء اصطناعي",
    hintEn: "Let an outside AI app (like Claude) work with your clinic's data.",
    hintAr: "اسمح لتطبيق ذكاء اصطناعي خارجي (مثل Claude) بالعمل على بيانات عيادتك.",
    keywords: ["ai assistant", "mcp", "claude", "key", "المساعد الذكي", "ربط"],
    // Keys live in the root collection `mcp_keys`, which firestore.rules denies to every client
    // outright — so this screen writes nothing directly and everything through the API on the
    // Admin SDK. Admin rather than `access.settings` at the menu, even though the route accepts
    // the permission: a key is a standing grant to a program outside this system, and the
    // narrower of the two gates is the one worth showing on the menu.
    writes: [{ kind: "server", route: "/api/admin/mcp-keys", guardedBy: "tests/permissions.test.mts" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "logs",
    route: "/settings/activity",
    group: "system",
    labelEn: "Activity log",
    labelAr: "سجل النشاط",
    hintEn: "Who did what, and when.",
    hintAr: "من فعل ماذا، ومتى.",
    keywords: ["activity logs", "history", "audit", "سجل"],
    writes: [{ kind: "readOnly", reads: "system_logs" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "recently_deleted",
    route: "/settings/recently-deleted",
    group: "system",
    labelEn: "Recently deleted",
    labelAr: "المحذوفات",
    hintEn: "Anything deleted waits here until you restore it.",
    hintAr: "كل ما يُحذف ينتظر هنا حتى تسترجعه.",
    keywords: ["bin", "trash", "restore", "deleted", "المحذوفات", "استرجاع"],
    // The bin is a root collection the rules deny to the browser outright; everything goes
    // through the API on the Admin SDK. tests/recycleBin.test.mjs is the only thing enforcing its
    // boundaries, because firestore.rules never sees these writes.
    writes: [
      { kind: "server", route: "/api/records/bin", guardedBy: "tests/recycleBin.test.mjs" },
    ],
    view: MEMBER,
    edit: MEMBER,
  },
];

/**
 * Side-list order. A group with no sections is a bug, not an empty state. Within a group,
 * sections keep their order in SETTINGS_SECTIONS above.
 */
export const SETTINGS_GROUP_ORDER: SettingsGroup[] = [
  "personal",
  "clinic",
  "booking",
  "money",
  "team",
  "messages",
  "system",
];

export const SETTINGS_GROUP_LABELS: Record<SettingsGroup, { en: string; ar: string }> = {
  personal: { en: "You", ar: "حسابك" },
  clinic: { en: "Clinic", ar: "العيادة" },
  booking: { en: "Booking & patients", ar: "الحجز والمرضى" },
  money: { en: "Treatment & money", ar: "العلاج والحسابات" },
  team: { en: "Team", ar: "الفريق" },
  messages: { en: "Messages", ar: "الرسائل" },
  system: { en: "System", ar: "النظام" },
};

export function getSection(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s.id === id);
}

export function sectionsInGroup(group: SettingsGroup): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => s.group === group);
}

/** Every `settings/<docId>` this screen writes. Renaming one breaks server routes and Android. */
export function settingsDocIds(): string[] {
  const ids = new Set<string>();
  for (const section of SETTINGS_SECTIONS) {
    for (const target of section.writes) {
      if (target.kind === "settingsDoc") ids.add(target.docId);
    }
  }
  return [...ids].sort();
}
