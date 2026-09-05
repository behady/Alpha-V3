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

/** Where a section appears in the sidebar. A section belongs to exactly one group. */
export type SettingsGroup = "personal" | "clinic" | "people" | "system";

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
  /** Everything this section can write. Empty means it is a viewer. */
  writes: SettingsTarget[];
  /** Who may open it. Never stricter than `edit` — a section you may change but not see is a bug. */
  view: SettingsAccess;
  /** Who may save. Must match what firestore.rules enforces for every target above. */
  edit: SettingsAccess;
  /** Frozen tutorial anchor. The walkthrough's pulsing ring attaches to this exact string. */
  tourAnchor?: string;
  /** Subscription feature this section is gated behind, if any. */
  feature?: string;
}

const ADMIN: SettingsAccess = { kind: "admin" };
const MEMBER: SettingsAccess = { kind: "member" };

export const SETTINGS_SECTIONS: SettingsSection[] = [
  // --- Personal -------------------------------------------------------------------------------
  {
    id: "general",
    route: "/settings/profile",
    group: "personal",
    labelEn: "Profile",
    labelAr: "الملف الشخصي",
    // Not the whole staff row — firestore.rules carves out exactly six fields a person may change
    // on their own record. Admin-only on the whole document meant nobody below Admin could set a
    // profile picture and the screen simply failed; that carve-out is what fixed it, and the test
    // asserts it is still there.
    writes: [{ kind: "selfStaffRow" }],
    view: { kind: "self" },
    edit: { kind: "self" },
  },
  {
    id: "appearance",
    route: "/settings/theme",
    group: "personal",
    labelEn: "Theme",
    labelAr: "المظهر",
    writes: [{ kind: "settingsDoc", docId: "appearance" }],
    // Visible to everyone, saveable by an admin. This is the shape the rest of the screen should
    // copy: ThemeContext already resolves `canEdit: isAdmin && !isReadOnly` and the panel says
    // "admin only" instead of failing on save.
    view: MEMBER,
    edit: ADMIN,
  },
  {
    id: "interface",
    route: "/settings/interface",
    group: "personal",
    labelEn: "Interface",
    labelAr: "واجهة الاستخدام",
    // Stored on the person's own record since Phase 3, not in the browser. They lived in
    // localStorage and nowhere else, so setting the app up the way you like it on the desk
    // computer got you the defaults on a tablet, with nothing on screen to explain why. The
    // browser copy is kept as a cache so the first paint is not the default layout.
    writes: [{ kind: "userRecord", field: "uiPreferences" }],
    view: MEMBER,
    edit: MEMBER,
  },

  // --- Clinic ---------------------------------------------------------------------------------
  {
    id: "clinic_profile",
    route: "/settings/clinic",
    group: "clinic",
    labelEn: "Clinic profile",
    labelAr: "ملف العيادة",
    // One document since Phase 2. It used to write two — `clinicProfile` for the logo and the
    // Google links, `clinic_info` for everything ~30 other readers consult — and hand-copied the
    // shared fields between them on every save, which is exactly how they drifted apart.
    // src/lib/clinicProfile.ts holds the merge and the fallback for clinics that have not saved
    // since; scripts/backfill-clinic-profile.mjs retires the old document for good.
    writes: [{ kind: "settingsDoc", docId: "clinic_info" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "clinical",
    route: "/settings/schedule",
    group: "clinic",
    labelEn: "Schedule",
    labelAr: "الجدول",
    writes: [{ kind: "settingsDoc", docId: "clinic_info" }],
    view: ADMIN,
    edit: ADMIN,
    tourAnchor: "settings-tab-schedule",
  },
  {
    id: "locations",
    route: "/settings/branches",
    group: "clinic",
    labelEn: "Branches & Rooms",
    labelAr: "الفروع والغرف",
    writes: [{ kind: "settingsDoc", docId: "locations" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "labs",
    route: "/settings/labs",
    group: "clinic",
    labelEn: "Dental Labs",
    labelAr: "المعامل",
    writes: [{ kind: "settingsDoc", docId: "labs" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "services",
    route: "/settings/prices",
    group: "clinic",
    labelEn: "Prices",
    labelAr: "الأسعار",
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
    id: "prescriptions",
    route: "/settings/prescriptions",
    group: "clinic",
    labelEn: "Prescriptions",
    labelAr: "الوصفات",
    writes: [{ kind: "collection", name: "drugs" }],
    // The one section in this group that a non-admin can genuinely be granted: the `drugs` block
    // in firestore.rules names `access.settings` explicitly. Which means it must NOT sit inside a
    // sidebar group that is itself admin-gated — the mistake that made the grant invisible.
    view: { kind: "permission", id: "access.settings" },
    edit: { kind: "permission", id: "access.settings" },
  },
  {
    id: "visit_reasons",
    route: "/settings/visit-reasons",
    group: "clinic",
    labelEn: "Visit Reasons",
    labelAr: "أسباب الزيارة",
    writes: [{ kind: "settingsDoc", docId: "visit_reasons" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "sources",
    route: "/settings/patient-sources",
    group: "clinic",
    labelEn: "Patient Sources",
    labelAr: "مصادر المرضى",
    writes: [{ kind: "settingsDoc", docId: "patient_sources" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "attendance",
    route: "/settings/attendance",
    group: "clinic",
    labelEn: "Attendance",
    labelAr: "الحضور",
    writes: [{ kind: "settingsDoc", docId: "clinic_info" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "online_booking",
    route: "/settings/online-booking",
    group: "clinic",
    labelEn: "Online Booking",
    labelAr: "الحجز الإلكتروني",
    writes: [{ kind: "settingsDoc", docId: "onlineBooking" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "recall",
    route: "/settings/recall",
    group: "clinic",
    labelEn: "Recall",
    labelAr: "المتابعة",
    writes: [
      { kind: "settingsDoc", docId: "recall" },
      { kind: "settingsDoc", docId: "reactivation" },
    ],
    view: ADMIN,
    edit: ADMIN,
  },

  // --- People ---------------------------------------------------------------------------------
  {
    id: "users",
    route: "/settings/users",
    group: "people",
    labelEn: "Users",
    labelAr: "المستخدمين",
    writes: [
      { kind: "server", route: "/api/staff/create", guardedBy: "tests/permissions.test.mts" },
      { kind: "server", route: "/api/admin/update-user", guardedBy: "tests/permissions.test.mts" },
      { kind: "server", route: "/api/delete-user", guardedBy: "tests/permissions.test.mts" },
      { kind: "server", route: "/api/admin/transfer-ownership", guardedBy: "tests/permissions.test.mts" },
    ],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "join_requests",
    route: "/settings/join-requests",
    group: "people",
    labelEn: "Join Requests",
    labelAr: "طلبات الانضمام",
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
    group: "people",
    labelEn: "Dentists",
    labelAr: "الأطباء",
    // What a dentist's own home screen may show — today, whether they see their share of what
    // their patients paid. Clinic-wide and Admin-only: it is a pay-visibility decision, not a
    // preference, so it lives on clinic_info rather than on the person's record.
    writes: [{ kind: "settingsDoc", docId: "clinic_info" }],
    view: ADMIN,
    edit: ADMIN,
  },

  // --- System ---------------------------------------------------------------------------------
  {
    id: "notifications",
    route: "/settings/alerts",
    group: "system",
    labelEn: "Alerts",
    labelAr: "التنبيهات",
    writes: [{ kind: "settingsDoc", docId: "clinic_info" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "whatsapp",
    route: "/settings/whatsapp",
    group: "system",
    labelEn: "WhatsApp",
    labelAr: "واتساب",
    writes: [{ kind: "settingsDoc", docId: "whatsapp" }],
    view: ADMIN,
    edit: ADMIN,
    feature: "whatsappIntegration",
  },
  {
    id: "sms",
    route: "/settings/sms",
    group: "system",
    labelEn: "SMS",
    labelAr: "رسائل نصية",
    // Deliberately not behind `whatsappIntegration`: sending from the clinic's own SIM needs no
    // gateway and no paid integration. It is the fallback for clinics that cannot have one.
    writes: [{ kind: "settingsDoc", docId: "sms" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "logs",
    route: "/settings/activity",
    group: "system",
    labelEn: "Activity Logs",
    labelAr: "سجل النشاط",
    writes: [{ kind: "readOnly", reads: "system_logs" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "ai_credits",
    route: "/settings/ai-credits",
    group: "system",
    labelEn: "AI Credits",
    labelAr: "رصيد الذكاء الاصطناعي",
    // `ai_usage` and `ai_usage_log` are `allow write: if false` — the meter and its spend log are
    // written only by the server. A member who could write these could refill their own clinic's
    // credits and erase the record of what was spent.
    writes: [{ kind: "readOnly", reads: "ai_usage" }],
    view: ADMIN,
    edit: ADMIN,
  },
  {
    id: "recently_deleted",
    route: "/settings/recently-deleted",
    group: "system",
    labelEn: "Recently Deleted",
    labelAr: "المحذوفات",
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

/** Sidebar order. A group with no sections is a bug, not an empty state. */
export const SETTINGS_GROUP_ORDER: SettingsGroup[] = ["personal", "clinic", "people", "system"];

export const SETTINGS_GROUP_LABELS: Record<SettingsGroup, { en: string; ar: string }> = {
  personal: { en: "Personal", ar: "شخصي" },
  clinic: { en: "Clinic", ar: "العيادة" },
  people: { en: "People", ar: "الفريق" },
  system: { en: "System & Automation", ar: "النظام والأتمتة" },
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
