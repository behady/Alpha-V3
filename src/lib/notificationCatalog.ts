/**
 * Every alert this system can raise, in one list, with the rules for deciding whether to raise it.
 *
 * Before this file there were twenty-eight alerts and two switches. The other twenty-six fired
 * unconditionally, spread across four Cloud Functions and five API routes, each with its own
 * hard-coded audience and its own hard-coded threshold. Nothing could say what the clinic would
 * be told today, because the answer was only knowable by reading nine files.
 *
 * Two bugs that came out of that, both fixed by everything now going through one resolver:
 *
 *  - **The arrival switch never worked.** The settings screen saved `alertPreferences` into
 *    `clinics/{id}/settings/clinic_info`; `onPatientCheckedIn` read it from `clinics/{id}` — a
 *    different document. The toggle moved, saved, and changed nothing, for as long as it existed.
 *  - **Owners could be unreachable.** Targeting filtered `clinics/{id}/staff` by its `role`
 *    field, but signup writes the owner's role to `users.clinicRoles` and creates no staff row at
 *    all. An owner nobody had added on the Users screen received none of this — including the
 *    21:00 money digest and every escalation addressed specifically to them.
 *
 * This module is pure. It reads no database and imports nothing from the app, because it has two
 * consumers that cannot share a runtime: the Next app, and the Cloud Functions package, which
 * gets a generated CommonJS copy (`functions/notificationCatalog.js`, see
 * `scripts/generate-functions-notification-catalog.mjs`). Edit this file; never that one.
 */

/** The roles an alert can be addressed to. Matches `lib/permissions`, spelled out to stay pure. */
export type NotifyRole = "Owner" | "Admin" | "Dentist" | "Receptionist" | "Assistant";

export const NOTIFY_ROLES: readonly NotifyRole[] = ["Owner", "Admin", "Dentist", "Receptionist", "Assistant"];

/** The seven headings on the settings page, in the order they appear. */
export type NotifyGroup = "unanswered" | "frontdesk" | "leads" | "reports" | "money" | "clinic" | "delivery";

export const NOTIFY_GROUPS: readonly { id: NotifyGroup; en: string; ar: string; noteEn: string; noteAr: string }[] = [
  {
    id: "unanswered",
    en: "Patients waiting for a reply",
    ar: "مرضى مستنيين رد",
    noteEn: "The only alerts here that cost you money if you switch them off.",
    noteAr: "دي التنبيهات اللي إغلاقها بيكلّفك فلوس فعلاً.",
  },
  {
    id: "frontdesk",
    en: "Front desk",
    ar: "الاستقبال",
    noteEn: "Arrivals, bookings, and anything the WhatsApp bot changed in the diary.",
    noteAr: "الوصول والحجوزات وأي حاجة البوت غيّرها في اليومية.",
  },
  {
    id: "leads",
    en: "Leads",
    ar: "العملاء المحتملين",
    noteEn: "New enquiries and the ones nobody has answered yet.",
    noteAr: "الاستفسارات الجديدة واللي محدش رد عليها.",
  },
  {
    id: "reports",
    en: "Reports",
    ar: "التقارير",
    noteEn: "The morning brief and the day's close-out. On WhatsApp they arrive as a full report; each one has its own sections, detail level and hour below.",
    noteAr: "ملخص الصباح وإقفال اليوم. على واتساب بيوصلوا تقرير كامل؛ كل واحد ليه أقسامه ومستوى تفاصيله وساعته تحت.",
  },
  {
    id: "money",
    en: "Money",
    ar: "الفلوس",
    noteEn: "Never sent to anyone but owners and admins, whatever you set here.",
    noteAr: "مش بتوصل غير للمالك والمدير، مهما تظبّط هنا.",
  },
  {
    id: "clinic",
    en: "Running the clinic",
    ar: "إدارة العيادة",
    noteEn: "Stock, the lab, reviews and marketing that is ready to send.",
    noteAr: "المخزون والمعمل والتقييمات والتسويق الجاهز للإرسال.",
  },
  {
    id: "delivery",
    en: "Is anything broken?",
    ar: "في حاجة واقفة؟",
    noteEn: "Messages that never left the building. Switch these off and a dead WhatsApp connection is silent.",
    noteAr: "رسايل مخرجتش. لو قفلتها، انقطاع الواتساب مش هيبان.",
  },
];

/** A number the clinic may change, on an alert that waits before it fires. */
export interface NotifyTiming {
  /** Stored under `alertPreferences.timings.<eventId>.<key>`. */
  key: string;
  /**
   * `weekday` is 0–6 Sunday-first (JS getDay); `dayOfMonth` is 1–28 so every month has it.
   * `percent`, `egp`, `count` and `days` are thresholds: the alert fires at or beyond the number.
   */
  kind: "minutes" | "hours" | "hourOfDay" | "weekday" | "dayOfMonth" | "percent" | "egp" | "count" | "days";
  en: string;
  ar: string;
  /** What the code used before any of this was configurable. */
  fallback: number;
  min: number;
  max: number;
}

/** Which of the scheduled reports an event is, when it is one. Decides what the WhatsApp text contains. */
export type ReportKind = "morning" | "evening" | "dentistDay" | "summary" | "weekly" | "monthly" | "payroll";

export interface NotifyEvent {
  id: string;
  group: NotifyGroup;
  en: string;
  ar: string;
  /** What actually triggers it, in one line. The page shows this under the label. */
  whenEn: string;
  whenAr: string;
  /** Who it goes to unless the clinic says otherwise. */
  roles: readonly NotifyRole[];
  /**
   * The audience is a property of the event, not a preference.
   *
   * An arrival goes to the dentist treating that patient; a dentist's morning brief contains only
   * their own day. "Send it to reception instead" is not a setting, it is a different alert that
   * does not exist. These rows show who gets it and offer no role picker.
   */
  rolesFixed?: boolean;
  /** Roles that can never be added, whatever the clinic picks. Money is the whole list today. */
  rolesMax?: readonly NotifyRole[];
  /** In the bell, out of the box. */
  bell: boolean;
  /** Pushed to phones and desktops, out of the box. */
  push: boolean;
  /**
   * Sent to each recipient's WhatsApp, out of the box. Off for everything by default: WhatsApp is
   * the channel a person reads away from the clinic, and an alert that follows them home has to
   * be one they asked for.
   */
  whatsapp?: boolean;
  /**
   * The WhatsApp switch is offered for this alert.
   *
   * Only alerts raised by the web server can leave on WhatsApp today — the Cloud Functions half
   * has push and the bell but no gateway. Showing a switch for an alert that cannot honour it
   * would be the settings-page lie this catalogue exists to end, so the page hides it instead.
   */
  waReady?: boolean;
  /** One of the scheduled reports. The WhatsApp text is a full report rather than a line. */
  report?: ReportKind;
  /**
   * The key this alert's WhatsApp switch was stored under on the old Settings → WhatsApp grid
   * (`settings/whatsapp.ownerAlerts.<key>`). Read as a fallback so a clinic that ticked
   * "finance › add" years ago keeps getting it, on the same channel, without touching anything.
   */
  legacyOwnerKey?: string;
  /**
   * Quiet hours do not apply. An urgent alert that waits until 09:00 is not an alert — and the
   * things in this group are the ones a clinic loses money by hearing late.
   */
  ignoresQuietHours?: boolean;
  timings?: readonly NotifyTiming[];
  /**
   * The key this event's switch was stored under before the catalogue existed.
   *
   * Two clinics' saved answers live under `alertPreferences.inApp.patientArrival` and
   * `.labReady`. Reading the old key as a fallback is the difference between honouring a
   * preference somebody set and silently resetting it.
   */
  legacyKey?: string;
}

/**
 * The catalogue.
 *
 * `id` values are storage keys — they are written into `alertPreferences`, into every bell row as
 * `eventType`, and into each person's mute list. Renaming one silently resets every clinic's
 * answer for that alert and orphans their bell history, so they do not get renamed.
 */
export const NOTIFY_EVENTS: readonly NotifyEvent[] = [
  // --- Patients waiting for a reply ----------------------------------------------------------
  {
    id: "patientWaitingReply",
    group: "unanswered",
    en: "A patient is waiting for a reply",
    ar: "مريض مستني رد",
    whenEn: "A patient wrote on WhatsApp and nobody at the desk has answered.",
    whenAr: "مريض كتب على واتساب ومحدش من الاستقبال رد.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    ignoresQuietHours: true,
    timings: [
      { key: "afterMinutes", kind: "minutes", en: "Alert after", ar: "نبّه بعد", fallback: 15, min: 2, max: 240 },
    ],
  },
  {
    id: "patientWaitingReplyEscalated",
    group: "unanswered",
    en: "Still waiting — tell the owner",
    ar: "لسه مستني — بلّغ المالك",
    whenEn: "The same patient is still unanswered well past the first alert.",
    whenAr: "نفس المريض لسه مفيش رد عليه بعد التنبيه الأول بكتير.",
    roles: ["Owner", "Admin"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: true,
    ignoresQuietHours: true,
    timings: [
      { key: "afterMinutes", kind: "minutes", en: "Escalate after", ar: "صعّد بعد", fallback: 45, min: 5, max: 480 },
    ],
  },
  {
    id: "botHandedOff",
    group: "unanswered",
    waReady: true,
    en: "The bot has passed a patient to a person",
    ar: "البوت سلّم مريض لحد",
    whenEn: "The bot could not answer and said reception would. Somebody has to, now.",
    whenAr: "البوت مقدرش يرد وقال إن الاستقبال هيرد. لازم حد يرد، حالاً.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    ignoresQuietHours: true,
  },
  {
    id: "patientRepliedAfterClaim",
    group: "unanswered",
    en: "Someone took the chat, then went quiet",
    ar: "حد مسك المحادثة وسكت",
    whenEn: "A member of staff took a conversation off the bot, the patient replied, and it was left.",
    whenAr: "حد من الفريق مسك المحادثة من البوت، المريض رد، والمحادثة اتسابت.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    ignoresQuietHours: true,
  },
  {
    id: "optedOutPatientNeedsReply",
    group: "unanswered",
    waReady: true,
    en: "A patient who blocked messages needs a person",
    ar: "مريض موقف الرسايل ومحتاج حد",
    whenEn: "Somebody who asked to stop receiving messages has written in. The bot will not answer them, ever.",
    whenAr: "حد طلب إيقاف الرسايل بعت. البوت مش هيرد عليه أبداً.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    ignoresQuietHours: true,
  },
  {
    id: "urgentPatientMessage",
    group: "unanswered",
    waReady: true,
    en: "A message the bot refused to answer",
    ar: "رسالة البوت رفض يردّ عليها",
    whenEn: "Pain, bleeding, or anything clinical. The bot hands these straight to a human by design.",
    whenAr: "وجع أو نزيف أو أي حاجة طبية. البوت بيسلّمها لحد فوراً بالتصميم.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    ignoresQuietHours: true,
  },
  {
    id: "complaintKeyword",
    group: "unanswered",
    waReady: true,
    en: "A message that reads as a complaint",
    ar: "رسالة شكلها شكوى",
    whenEn: "A patient's WhatsApp contains a complaint word — angry, refund, lawyer, never coming back. A person should answer it, not the bot.",
    whenAr: "رسالة مريض فيها كلمة شكوى — زعلان، استرجاع، محامي، مش هرجع. لازم يرد عليها بني آدم مش البوت.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },

  // --- Front desk ----------------------------------------------------------------------------
  {
    id: "patientArrived",
    group: "frontdesk",
    en: "A patient has arrived",
    ar: "مريض وصل",
    whenEn: "Goes to the dentist treating them, and nobody else.",
    whenAr: "بتوصل للدكتور بتاع الحالة، ومحدش تاني.",
    roles: ["Dentist"],
    rolesFixed: true,
    bell: true,
    push: true,
    ignoresQuietHours: true,
    legacyKey: "patientArrival",
  },
  {
    id: "slotFreed",
    group: "frontdesk",
    en: "A slot just freed up",
    ar: "ميعاد فضي",
    whenEn: "An appointment was cancelled or marked a no-show, so the time is available again.",
    whenAr: "ميعاد اتلغى أو المريض مجاش، فالوقت بقى فاضي.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },
  {
    id: "onlineBooking",
    group: "frontdesk",
    waReady: true,
    en: "A new online booking",
    ar: "حجز جديد أونلاين",
    whenEn: "Somebody booked themselves through the clinic's public booking page.",
    whenAr: "حد حجز لنفسه من صفحة الحجز العامة.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },
  {
    id: "botBooked",
    group: "frontdesk",
    waReady: true,
    en: "The bot booked an appointment",
    ar: "البوت حجز ميعاد",
    whenEn: "A patient booked over WhatsApp without a person being involved.",
    whenAr: "مريض حجز على واتساب من غير أي حد.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },
  {
    id: "botRescheduled",
    group: "frontdesk",
    waReady: true,
    en: "The bot moved an appointment",
    ar: "البوت عدّل ميعاد",
    whenEn: "A patient changed their own time over WhatsApp.",
    whenAr: "مريض غيّر ميعاده بنفسه على واتساب.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },
  {
    id: "botCancelled",
    group: "frontdesk",
    waReady: true,
    en: "The bot cancelled an appointment",
    ar: "البوت لغى ميعاد",
    whenEn: "A patient cancelled over WhatsApp. The slot is now free.",
    whenAr: "مريض لغى على واتساب. الميعاد بقى فاضي.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },
  {
    id: "patientRequestedChange",
    group: "frontdesk",
    waReady: true,
    en: "A patient is asking to cancel, move, or says they'll be late",
    ar: "مريض بيطلب إلغاء أو تعديل أو بيقول هيتأخر",
    whenEn: "Asked for, not done — somebody has to act on it.",
    whenAr: "طلب، مش تنفيذ — لازم حد يتصرّف.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    ignoresQuietHours: true,
  },

  // The three appointment alerts that used to be the "Appointments" row of the owner-alert grid on
  // Settings → WhatsApp. Staff actions only: the bot's and the public page's bookings have their
  // own rows above, and an owner who wants "every booking" switches all of them on.
  {
    id: "appointmentAdded",
    group: "frontdesk",
    waReady: true,
    legacyOwnerKey: "appointment_add",
    en: "The desk booked an appointment",
    ar: "الاستقبال حجز ميعاد",
    whenEn: "Every booking made by a staff member, as it is saved. Bot and online bookings are the rows above.",
    whenAr: "كل حجز بيعمله موظف، لحظة ما يتحفظ. حجوزات البوت والصفحة العامة ليها صفوفها فوق.",
    roles: ["Owner"],
    bell: false,
    push: false,
  },
  {
    id: "appointmentEdited",
    group: "frontdesk",
    waReady: true,
    legacyOwnerKey: "appointment_edit",
    en: "An appointment was moved or changed",
    ar: "ميعاد اتنقل أو اتعدّل",
    whenEn: "A staff member rescheduled, changed the dentist, or edited the details.",
    whenAr: "موظف غيّر الميعاد أو الدكتور أو التفاصيل.",
    roles: ["Owner"],
    bell: false,
    push: false,
  },
  {
    id: "appointmentDeleted",
    group: "frontdesk",
    waReady: true,
    legacyOwnerKey: "appointment_delete",
    en: "An appointment was deleted",
    ar: "ميعاد اتمسح",
    whenEn: "A staff member removed a booking from the diary altogether.",
    whenAr: "موظف مسح حجز من اليومية خالص.",
    roles: ["Owner"],
    bell: false,
    push: false,
  },
  // Patient flow: what the day actually did, as it happens.
  {
    id: "noShowMarked",
    group: "frontdesk",
    waReady: true,
    en: "A patient did not show up",
    ar: "مريض مجاش",
    whenEn: "An appointment was marked No Show.",
    whenAr: "ميعاد اتعلّم عليه إنه مجاش.",
    roles: ["Owner"],
    bell: true,
    push: false,
  },
  {
    id: "sameDayCancellation",
    group: "frontdesk",
    waReady: true,
    en: "A same-day cancellation",
    ar: "إلغاء في نفس اليوم",
    whenEn: "Today's appointment was cancelled today — a chair that will probably stay empty.",
    whenAr: "ميعاد النهارده اتلغى النهارده — كرسي غالباً هيفضل فاضي.",
    roles: ["Owner", "Receptionist"],
    bell: true,
    push: true,
  },
  {
    id: "walkInBooked",
    group: "frontdesk",
    waReady: true,
    en: "A walk-in was booked",
    ar: "حجز لنفس اليوم",
    whenEn: "An appointment was created for today.",
    whenAr: "ميعاد اتحجز لنفس اليوم.",
    roles: ["Owner"],
    bell: true,
    push: false,
  },
  {
    id: "patientWaitingLong",
    group: "frontdesk",
    waReady: true,
    en: "A patient has waited too long",
    ar: "مريض مستني كتير",
    whenEn: "A checked-in patient has been in the waiting room longer than the minutes below. Once per patient.",
    whenAr: "مريض عمل تسجيل وصول وقاعد في الانتظار أكتر من الدقايق اللي تحت. مرة واحدة لكل مريض.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    ignoresQuietHours: true,
    timings: [{ key: "minutes", kind: "minutes", en: "Longer than", ar: "أكتر من", fallback: 20, min: 5, max: 180 }],
  },

  // --- Leads ---------------------------------------------------------------------------------
  {
    id: "newLead",
    group: "leads",
    en: "A new lead came in",
    ar: "عميل محتمل جديد",
    whenEn: "From a Facebook or Instagram ad, the moment the form is submitted.",
    whenAr: "من إعلان فيسبوك أو إنستجرام، لحظة إرسال الفورم.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },
  {
    id: "leadWaiting",
    group: "leads",
    en: "A lead is waiting for an answer",
    ar: "عميل محتمل مستني رد",
    whenEn: "Nobody has replied to a new enquiry. The first minutes are what win it.",
    whenAr: "محدش رد على استفسار جديد. أول دقايق هي اللي بتكسبه.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    timings: [
      { key: "afterMinutes", kind: "minutes", en: "Alert after", ar: "نبّه بعد", fallback: 15, min: 2, max: 240 },
    ],
  },
  {
    id: "leadAbandoned",
    group: "leads",
    en: "A paid lead has been abandoned",
    ar: "عميل مدفوع اتسيب",
    whenEn: "You paid for this enquiry and hours later nobody has replied. Goes over the desk's head on purpose.",
    whenAr: "دفعت فلوس على الاستفسار ده وبعد ساعات محدش رد. بتتعدّى الاستقبال بالتصميم.",
    roles: ["Owner", "Admin"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: true,
    timings: [
      { key: "afterMinutes", kind: "minutes", en: "Escalate after", ar: "صعّد بعد", fallback: 120, min: 15, max: 1440 },
    ],
  },
  {
    id: "leadFollowupsDue",
    group: "leads",
    en: "Follow-up calls are due today",
    ar: "مكالمات متابعة مستحقة النهارده",
    whenEn: "A once-a-day count of the leads somebody promised to call back.",
    whenAr: "عدّ مرة في اليوم للعملاء اللي حد وعد يكلّمهم.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    timings: [{ key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 10, min: 0, max: 23 }],
  },

  // --- Daily briefs --------------------------------------------------------------------------
  {
    id: "morningBriefClinic",
    group: "reports",
    waReady: true,
    report: "morning",
    en: "The clinic's morning brief",
    ar: "ملخص الصباح للعيادة",
    whenEn: "Today's bookings and first slot; on WhatsApp also yesterday's money, what to chase, and who is rostered.",
    whenAr: "حجوزات النهارده وأول ميعاد؛ وعلى واتساب كمان فلوس إمبارح، اللي محتاج متابعة، ومين شغال.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    timings: [{ key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 7, min: 0, max: 23 }],
  },
  {
    id: "morningBriefDentist",
    group: "reports",
    waReady: true,
    report: "dentistDay",
    en: "Each dentist's own day",
    ar: "يوم كل دكتور",
    whenEn: "Sent to each dentist separately, containing only their own patients.",
    whenAr: "بتتبعت لكل دكتور لوحده، وفيها مرضاه بس.",
    roles: ["Dentist"],
    rolesFixed: true,
    bell: true,
    push: true,
    timings: [{ key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 7, min: 0, max: 23 }],
  },

  // --- Money ---------------------------------------------------------------------------------
  // The "Finance" row of the old owner-alert grid, one alert per action. Money stays with the
  // people who own it: the ceiling is Owner and Admin, and a receptionist cannot be added.
  {
    id: "paymentAdded",
    group: "money",
    waReady: true,
    legacyOwnerKey: "finance_add",
    en: "A payment was recorded",
    ar: "دفعة اتسجّلت",
    whenEn: "Every payment or expense entered, with the amount, the patient and who took it.",
    whenAr: "كل دفعة أو مصروف بيتسجّل، بالمبلغ والمريض ومين استلم.",
    roles: ["Owner"],
    rolesMax: ["Owner", "Admin"],
    bell: false,
    push: false,
  },
  {
    id: "paymentEdited",
    group: "money",
    waReady: true,
    legacyOwnerKey: "finance_edit",
    en: "A payment was changed after the fact",
    ar: "دفعة اتعدّلت بعد ما اتسجّلت",
    whenEn: "An amount, method or date on an existing ledger row was edited.",
    whenAr: "مبلغ أو طريقة دفع أو تاريخ في سطر موجود اتعدّل.",
    roles: ["Owner"],
    rolesMax: ["Owner", "Admin"],
    bell: false,
    push: false,
  },
  {
    id: "paymentDeleted",
    group: "money",
    waReady: true,
    legacyOwnerKey: "finance_delete",
    en: "A payment was deleted",
    ar: "دفعة اتمسحت",
    whenEn: "A ledger row was removed. The one money alert worth leaving on everywhere.",
    whenAr: "سطر من الدفتر اتمسح. تنبيه الفلوس الوحيد اللي يستاهل يفضل شغال في كل مكان.",
    roles: ["Owner"],
    rolesMax: ["Owner", "Admin"],
    bell: false,
    push: false,
  },
  // The money risks: not every payment, only the ones that should raise an eyebrow.
  {
    id: "discountAbove",
    group: "money",
    waReady: true,
    en: "A discount above the line",
    ar: "خصم أكبر من الحد",
    whenEn: "A charge was discounted by more than the percentage below, from any screen.",
    whenAr: "إجراء اتخصم منه أكتر من النسبة اللي تحت، من أي شاشة.",
    roles: ["Owner"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: true,
    timings: [{ key: "percent", kind: "percent", en: "Above", ar: "أكتر من", fallback: 20, min: 1, max: 100 }],
  },
  {
    id: "expenseAbove",
    group: "money",
    waReady: true,
    en: "An expense above the line",
    ar: "مصروف أكبر من الحد",
    whenEn: "An expense was entered for more than the amount below.",
    whenAr: "مصروف اتسجّل بأكتر من المبلغ اللي تحت.",
    roles: ["Owner"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: true,
    timings: [{ key: "amount", kind: "egp", en: "Above", ar: "أكتر من", fallback: 2000, min: 1, max: 10000000 }],
  },
  {
    id: "paymentBackdated",
    group: "money",
    waReady: true,
    en: "A backdated entry",
    ar: "قيد بتاريخ قديم",
    whenEn: "A payment or expense was entered with a date further back than the days below.",
    whenAr: "دفعة أو مصروف اتسجّل بتاريخ أقدم من عدد الأيام اللي تحت.",
    roles: ["Owner"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: false,
    timings: [{ key: "days", kind: "days", en: "Older than", ar: "أقدم من", fallback: 1, min: 0, max: 365 }],
  },
  {
    id: "eveningDigest",
    group: "reports",
    waReady: true,
    report: "evening",
    en: "The day, closed out",
    ar: "اليوم بعد ما يخلص",
    whenEn: "Collected, seen and missed today; on WhatsApp the full close-out with per-dentist figures, new patients and leads, and attendance.",
    whenAr: "اللي اتحصّل واللي اتشاف واللي غاب النهارده؛ وعلى واتساب الإقفال الكامل بأرقام كل دكتور والمرضى والعملاء الجداد والحضور.",
    roles: ["Owner", "Admin"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: true,
    timings: [{ key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 21, min: 0, max: 23 }],
  },

  {
    id: "ownerSummary",
    group: "reports",
    waReady: true,
    report: "summary",
    legacyOwnerKey: "daily_digest",
    en: "The day in three lines",
    ar: "اليوم في تلات سطور",
    whenEn: "Three sentences about the day, written by the AI from the day's figures — the same lines the owner's home shows next morning. One AI credit a day; without credits, the plain version.",
    whenAr: "تلات جمل عن اليوم، الذكاء الاصطناعي بيكتبها من أرقام اليوم — نفس السطور اللي شاشة المالك بتوريها الصبح. رصيد ذكاء اصطناعي واحد في اليوم؛ ومن غير رصيد، النسخة العادية.",
    roles: ["Owner"],
    rolesMax: ["Owner", "Admin"],
    bell: false,
    push: false,
    timings: [{ key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 21, min: 0, max: 23 }],
  },

  {
    id: "weeklyReport",
    group: "reports",
    waReady: true,
    report: "weekly",
    en: "The week in numbers",
    ar: "الأسبوع في أرقام",
    whenEn: "Seven days against the seven before: money, patients seen and missed, new patients and leads, best and quietest day, top procedures, the team.",
    whenAr: "سبع أيام مقابل السبعة اللي قبلهم: الفلوس، اللي اتشاف واللي غاب، المرضى والعملاء الجداد، أحسن يوم وأهدأ يوم، أكتر إجراءات، والفريق.",
    roles: ["Owner", "Admin"],
    rolesMax: ["Owner", "Admin"],
    bell: false,
    push: false,
    timings: [
      { key: "weekday", kind: "weekday", en: "On", ar: "يوم", fallback: 6, min: 0, max: 6 },
      { key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 8, min: 0, max: 23 },
    ],
  },
  {
    id: "monthlyReport",
    group: "reports",
    waReady: true,
    report: "monthly",
    en: "The month, closed",
    ar: "الشهر بعد ما يقفل",
    whenEn: "Last month against the month before, once it has ended: revenue, expenses, per dentist, collection rate, growth, and the payroll estimate.",
    whenAr: "الشهر اللي فات مقابل اللي قبله، بعد ما يخلص: الإيراد والمصروفات ولكل دكتور ونسبة التحصيل والنمو وتقدير المرتبات.",
    roles: ["Owner"],
    rolesMax: ["Owner", "Admin"],
    bell: false,
    push: false,
    timings: [
      { key: "dayOfMonth", kind: "dayOfMonth", en: "On day", ar: "يوم", fallback: 1, min: 1, max: 28 },
      { key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 8, min: 0, max: 23 },
    ],
  },
  {
    id: "payrollReport",
    group: "reports",
    waReady: true,
    report: "payroll",
    en: "Attendance and pay for the month",
    ar: "كشف الحضور والمرتبات للشهر",
    whenEn: "For each person: days and hours worked, late minutes, absences, overtime waiting for approval, and the estimated pay. Commission stays on the payroll screen.",
    whenAr: "لكل شخص: أيام وساعات الشغل، دقايق التأخير، الغياب، الإضافي المستني موافقة، والمرتب التقديري. العمولات في شاشة المرتبات.",
    roles: ["Owner"],
    rolesMax: ["Owner", "Admin"],
    bell: false,
    push: false,
    timings: [
      { key: "dayOfMonth", kind: "dayOfMonth", en: "On day", ar: "يوم", fallback: 1, min: 1, max: 28 },
      { key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 9, min: 0, max: 23 },
    ],
  },

  // --- Running the clinic --------------------------------------------------------------------
  {
    id: "stockLow",
    group: "clinic",
    en: "Something is running low",
    ar: "حاجة قربت تخلص",
    whenEn: "An item dropped to its reorder point.",
    whenAr: "صنف وصل لحد إعادة الطلب.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },
  {
    id: "staffLate",
    group: "clinic",
    waReady: true,
    en: "Someone is late",
    ar: "حد اتأخر",
    whenEn: "A rostered staff member has not clocked in this many minutes after their shift start. Once per person per day.",
    whenAr: "موظف في الجدول مسجّلش حضور بعد بداية شيفته بالدقايق اللي تحت. مرة في اليوم لكل شخص.",
    roles: ["Owner", "Admin"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: true,
    timings: [{ key: "minutes", kind: "minutes", en: "After", ar: "بعد", fallback: 15, min: 1, max: 240 }],
  },
  {
    id: "staffAbsent",
    group: "clinic",
    waReady: true,
    en: "Someone is absent",
    ar: "حد غايب",
    whenEn: "A rostered staff member still has no clock-in at the hour below.",
    whenAr: "موظف في الجدول لسه مسجّلش حضور لحد الساعة اللي تحت.",
    roles: ["Owner", "Admin"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: true,
    timings: [{ key: "hour", kind: "hourOfDay", en: "At", ar: "الساعة", fallback: 11, min: 0, max: 23 }],
  },
  {
    id: "labCaseOverdue",
    group: "clinic",
    waReady: true,
    en: "A lab case is overdue",
    ar: "حالة معمل اتأخرت",
    whenEn: "A case still at the lab is past its due date by the days below. Once per case.",
    whenAr: "حالة لسه في المعمل عدّى ميعادها بالأيام اللي تحت. مرة لكل حالة.",
    roles: ["Owner", "Admin"],
    bell: true,
    push: true,
    timings: [{ key: "days", kind: "days", en: "Overdue by", ar: "متأخرة بـ", fallback: 1, min: 0, max: 60 }],
  },
  {
    id: "labCaseBack",
    group: "clinic",
    waReady: true,
    en: "A lab case is back",
    ar: "حالة معمل وصلت",
    whenEn: "Somebody marked a case received. Call the patient and book the fitting.",
    whenAr: "حد سجّل إن الحالة وصلت. كلّم المريض واحجزله التركيب.",
    roles: ["Owner", "Admin", "Receptionist"],
    // Off out of the box, as it has always been. A clinic that switched it on keeps it on: the
    // old `labReady` key is read as the fallback.
    bell: false,
    push: false,
    legacyKey: "labReady",
  },
  {
    id: "reviewRequestsReady",
    group: "clinic",
    en: "Review requests are ready to send",
    ar: "طلبات تقييم جاهزة",
    whenEn: "Today's happy patients, drafted and waiting for one tap in Marketing.",
    whenAr: "مرضى النهارده المبسوطين، الرسايل متجهزة ومستنية ضغطة في التسويق.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },
  {
    id: "birthdayWishesReady",
    group: "clinic",
    en: "Birthday wishes are ready to send",
    ar: "تهاني أعياد ميلاد جاهزة",
    whenEn: "Drafted for today's birthdays, waiting for you to look and send.",
    whenAr: "متجهزة لأعياد ميلاد النهارده، مستنية تبصّ وتبعت.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },
  {
    id: "occasionSoon",
    group: "clinic",
    en: "A season is coming up",
    ar: "مناسبة جاية",
    whenEn: "Ten days before Ramadan, back-to-school and the rest, so there is time to prepare.",
    whenAr: "عشر أيام قبل رمضان والمدارس وغيرهم، عشان يبقى في وقت للتحضير.",
    roles: ["Owner", "Admin"],
    bell: true,
    push: true,
  },
  {
    id: "unhappyReview",
    group: "clinic",
    waReady: true,
    en: "A patient rated their visit poorly",
    ar: "مريض قيّم الزيارة وحش",
    whenEn: "Reaches the manager's pocket instead of Google. A call the same day is what turns it around.",
    whenAr: "بتوصل للمدير مش لجوجل. مكالمة في نفس اليوم هي اللي بتقلبها.",
    roles: ["Owner", "Admin"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: true,
    // Time-sensitive in the same way a waiting patient is: tomorrow the review is already public.
    ignoresQuietHours: true,
  },
  {
    id: "fiveStarReview",
    group: "clinic",
    waReady: true,
    en: "A patient left five stars",
    ar: "مريض قيّم ٥ نجوم",
    whenEn: "Worth knowing the same day — that is when to ask them for a video.",
    whenAr: "يستحق تعرفه في نفس اليوم — ده وقت ما تطلب منه فيديو.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },

  // --- Is anything broken? -------------------------------------------------------------------
  {
    id: "messagesStuck",
    group: "delivery",
    en: "Messages to patients are not going out",
    ar: "رسايل المرضى مش بتخرج",
    whenEn: "The queue has stopped moving. Usually a dead WhatsApp connection, and otherwise silent.",
    whenAr: "الطابور واقف. عادةً انقطاع واتساب، ومن غير كده مفيش أي علامة.",
    roles: ["Owner", "Admin"],
    bell: true,
    push: true,
    timings: [
      { key: "hour", kind: "hourOfDay", en: "Check at", ar: "اتشيّك الساعة", fallback: 11, min: 0, max: 23 },
      { key: "stuckHours", kind: "hours", en: "Count as stuck after", ar: "اعتبرها واقفة بعد", fallback: 3, min: 1, max: 48 },
    ],
  },
  {
    id: "aiCreditsLow",
    group: "delivery",
    waReady: true,
    en: "AI credits are running low",
    ar: "رصيد الذكاء الاصطناعي قرب يخلص",
    whenEn: "Fewer credits than the number below remain this month. Once a month.",
    whenAr: "الرصيد المتبقي الشهر ده أقل من الرقم اللي تحت. مرة في الشهر.",
    roles: ["Owner", "Admin"],
    bell: true,
    push: true,
    timings: [{ key: "credits", kind: "count", en: "Below", ar: "أقل من", fallback: 20, min: 1, max: 10000 }],
  },
  {
    id: "aiCreditsOut",
    group: "delivery",
    waReady: true,
    en: "The AI ran out of credit",
    ar: "رصيد الذكاء الاصطناعي خلص",
    whenEn: "The bot has stopped answering patients and is sending them all to reception.",
    whenAr: "البوت وقف عن الرد على المرضى وبيحوّلهم كلهم للاستقبال.",
    roles: ["Owner", "Admin"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: true,
    // The bot being down is not a thing to hear about in the morning.
    ignoresQuietHours: true,
  },
  {
    id: "messageWaitingManual",
    group: "delivery",
    waReady: true,
    en: "A message is waiting to be sent by hand",
    ar: "رسالة مستنية تتبعت بالإيد",
    whenEn: "Only happens when WhatsApp sending is set to manual. Switch this off and nobody knows to send them.",
    whenAr: "بتحصل بس لما إرسال واتساب يكون يدوي. لو قفلتها محدش هيعرف يبعتها.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
  },
];

const BY_ID = new Map(NOTIFY_EVENTS.map((e) => [e.id, e]));

export function notifyEvent(id: string): NotifyEvent | undefined {
  return BY_ID.get(id);
}

export function notifyEventsIn(group: NotifyGroup): NotifyEvent[] {
  return NOTIFY_EVENTS.filter((e) => e.group === group);
}

/* --- what the clinic has saved ---------------------------------------------------------------- */

/** One alert's saved answers. Anything absent means "the catalogue's default". */
/**
 * How an alert reaches the phone and WhatsApp: as it happens, once an hour in one message, or
 * folded into the evening. The bell row is always written immediately — batching is about the
 * buzz, not the record. Reports are never batched; they already have an hour.
 */
export type BatchingMode = "instant" | "hourly" | "daily";
export const BATCHING_MODES: readonly BatchingMode[] = ["instant", "hourly", "daily"];

export interface NotifyEventPref {
  bell?: boolean;
  push?: boolean;
  whatsapp?: boolean;
  roles?: string[];
  batching?: BatchingMode;
}

/** The four blocks a scheduled report is built from. Each can be switched off per report. */
export type ReportSection = "money" | "appointments" | "patients" | "team";
export const REPORT_SECTIONS: readonly ReportSection[] = ["money", "appointments", "patients", "team"];

/** How much of the money a report spells out. */
export type ReportMoneyDetail = "totals" | "dentists" | "full";
export const REPORT_MONEY_DETAILS: readonly ReportMoneyDetail[] = ["totals", "dentists", "full"];

export type ReportLanguage = "ar" | "en";

/**
 * One scheduled report's own settings, stored under `alertPreferences.reports.<eventId>`.
 *
 * Everything optional, for the same reason as the rest of this document: a clinic that never
 * opened the page has `{}` and must still get a sensible report.
 */
export interface ReportPrefs {
  sections?: Partial<Record<ReportSection, boolean>>;
  moneyDetail?: ReportMoneyDetail;
  /** Arrows against the same weekday last week and month-to-date. */
  comparisons?: boolean;
  language?: ReportLanguage;
  /** A branded PDF alongside the text. Not built yet; stored so the switch survives the build. */
  pdf?: boolean;
}

export interface ResolvedReportPrefs {
  sections: Record<ReportSection, boolean>;
  moneyDetail: ReportMoneyDetail;
  comparisons: boolean;
  language: ReportLanguage;
  pdf: boolean;
}

/**
 * One person's WhatsApp answers, stored under `alertPreferences.people.<uid>`.
 *
 * The phone lives here rather than on the staff row because nothing in this system ever asked a
 * staff member for a WhatsApp number — staff rows have a name and a role and nothing else — and
 * because this page's Save button already owns this document. `whatsapp: false` is a person-level
 * mute the owner sets: "Dr Ahmed does not want these on his phone" without touching every row.
 */
export interface PersonPrefs {
  phone?: string;
  whatsapp?: boolean;
}

export interface QuietHours {
  enabled?: boolean;
  /** Inclusive start hour, exclusive end hour, clinic time. 22 → 8 means "22:00 until 08:00". */
  fromHour?: number;
  toHour?: number;
}

/**
 * `alertPreferences`, as it is stored on `clinics/{id}/settings/clinic_info`.
 *
 * `inApp` is the shape the two old switches used and is still read; `events` is where everything
 * written from now on lands. Both are optional at every level, because the answer to "what does
 * this clinic want?" has to be derivable from an empty object — that is what every clinic has
 * until somebody opens the page.
 */
export interface AlertPreferences {
  events?: Record<string, NotifyEventPref>;
  timings?: Record<string, Record<string, number>>;
  quietHours?: QuietHours;
  reports?: Record<string, ReportPrefs>;
  people?: Record<string, PersonPrefs>;
  /**
   * The old Settings → WhatsApp grid (`settings/whatsapp.ownerAlerts`), merged in by the server
   * when it reads preferences. Never written here — see `legacyOwnerKey` on the event.
   */
  legacyOwnerAlerts?: Record<string, boolean>;
  /** The two pre-catalogue switches. Read as a fallback, never written. */
  inApp?: Record<string, boolean>;
  /** Kept so nothing breaks for clinics that filled in the old, removed email section. */
  email?: Record<string, unknown>;
}

/** What one alert resolves to for a clinic: where it goes, and to whom. */
export interface ResolvedNotify {
  event: NotifyEvent;
  bell: boolean;
  push: boolean;
  whatsapp: boolean;
  roles: NotifyRole[];
  batching: BatchingMode;
}

function legacyAnswer(event: NotifyEvent, prefs: AlertPreferences | null | undefined): boolean | undefined {
  if (!event.legacyKey) return undefined;
  const v = prefs?.inApp?.[event.legacyKey];
  return typeof v === "boolean" ? v : undefined;
}

/**
 * What this clinic has actually asked for, for one alert.
 *
 * The order is: the clinic's own answer, then the answer it gave before this page existed, then
 * the catalogue default. A `rolesMax` is a ceiling the clinic cannot raise — money goes to owners
 * and admins and that is not a preference — and a `rolesFixed` event ignores a saved role list
 * entirely, because its audience is part of what the alert *is*.
 */
export function resolveNotify(eventId: string, prefs: AlertPreferences | null | undefined): ResolvedNotify | null {
  const event = BY_ID.get(eventId);
  if (!event) return null;

  const saved = prefs?.events?.[eventId];
  const legacy = legacyAnswer(event, prefs);

  const bell = typeof saved?.bell === "boolean" ? saved.bell : legacy !== undefined ? legacy : event.bell;
  const push = typeof saved?.push === "boolean" ? saved.push : legacy !== undefined ? legacy : event.push;
  // WhatsApp: the clinic's answer here, else the tick it left on the old owner-alert grid, else
  // the catalogue — and never on for an alert the server cannot actually put on WhatsApp.
  const legacyOwner = event.legacyOwnerKey ? prefs?.legacyOwnerAlerts?.[event.legacyOwnerKey] : undefined;
  const whatsapp =
    event.waReady === true &&
    (typeof saved?.whatsapp === "boolean"
      ? saved.whatsapp
      : typeof legacyOwner === "boolean"
        ? legacyOwner
        : event.whatsapp === true);

  let roles: NotifyRole[] = [...event.roles];
  if (!event.rolesFixed && Array.isArray(saved?.roles)) {
    const asked = saved.roles.filter((r): r is NotifyRole => (NOTIFY_ROLES as readonly string[]).includes(r));
    // An empty saved list is a real answer ("nobody"), not a missing one — but nobody plus push
    // on is a contradiction the page cannot produce, so it is left to mean exactly what it says.
    roles = asked;
  }
  if (event.rolesMax) {
    const max = event.rolesMax;
    roles = roles.filter((r) => max.includes(r));
  }

  const batching: BatchingMode =
    !event.report && (saved?.batching === "hourly" || saved?.batching === "daily") ? saved.batching : "instant";

  return { event, bell, push, whatsapp, roles, batching };
}

/* --- the scheduled reports ---------------------------------------------------------------------- */

/** Every event that is a report, in page order. */
export function reportEvents(): NotifyEvent[] {
  return NOTIFY_EVENTS.filter((e) => e.report);
}

/**
 * A report's settings as this clinic has them, defaults filled in.
 *
 * Arabic by default: the clinics this is sold to read Arabic, and a report is read by the owner
 * at night on a phone, not by a developer. The team block is off on the morning brief because
 * attendance is a fact about the day that has ended, not the one starting.
 */
export function reportPrefs(eventId: string, prefs: AlertPreferences | null | undefined): ResolvedReportPrefs {
  const event = BY_ID.get(eventId);
  const saved = prefs?.reports?.[eventId];
  const isMorning = event?.report === "morning";
  const pick = (key: ReportSection, fallback: boolean) =>
    typeof saved?.sections?.[key] === "boolean" ? (saved.sections[key] as boolean) : fallback;
  const detail = saved?.moneyDetail;
  return {
    sections: {
      money: pick("money", true),
      appointments: pick("appointments", true),
      patients: pick("patients", true),
      team: pick("team", !isMorning),
    },
    moneyDetail: detail && REPORT_MONEY_DETAILS.includes(detail) ? detail : "dentists",
    comparisons: saved?.comparisons !== false,
    language: saved?.language === "en" ? "en" : "ar",
    pdf: saved?.pdf === true,
  };
}

/* --- one person's WhatsApp ---------------------------------------------------------------------- */

/**
 * Is this report due at this moment of the clinic's day?
 *
 * The hourly tick asks it for every report event. The hour must match; a report with a weekday
 * or a day-of-month timing must also be on that day. Pure, so the calendar arithmetic is pinned
 * by a test rather than by waiting for the first of the month.
 */
export function reportDueOn(
  eventId: string,
  prefs: AlertPreferences | null | undefined,
  when: { hour: number; weekday: number; dayOfMonth: number },
): boolean {
  const event = BY_ID.get(eventId);
  if (!event?.report) return false;
  const timings = event.timings || [];
  for (const t of timings) {
    const want = notifyTiming(eventId, t.key, prefs);
    if (t.kind === "hourOfDay" && want !== when.hour) return false;
    if (t.kind === "weekday" && want !== when.weekday) return false;
    if (t.kind === "dayOfMonth" && want !== when.dayOfMonth) return false;
  }
  return timings.some((t) => t.kind === "hourOfDay");
}

/** Whether this person receives WhatsApp at all, and the number the owner entered for them. */
export function personWhatsapp(
  uid: string,
  prefs: AlertPreferences | null | undefined,
): { enabled: boolean; phone: string } {
  const p = prefs?.people?.[uid];
  return {
    enabled: p?.whatsapp !== false,
    phone: typeof p?.phone === "string" ? p.phone.trim() : "",
  };
}

/** One of an alert's numbers, as this clinic has set it — or what the code used before. */
export function notifyTiming(eventId: string, key: string, prefs: AlertPreferences | null | undefined): number {
  const event = BY_ID.get(eventId);
  const timing = event?.timings?.find((t) => t.key === key);
  if (!timing) return 0;
  const raw = prefs?.timings?.[eventId]?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return timing.fallback;
  return Math.min(Math.max(Math.round(raw), timing.min), timing.max);
}

/**
 * Is it quiet hours right now, in the clinic's own day?
 *
 * `hour` is the clinic-local hour, passed in rather than computed: this module is shared with the
 * Cloud Functions package, which knows the clinic's timezone, and with the browser, which knows
 * the reader's. A window that wraps midnight (22 → 8) is the normal case, not the exception.
 */
export function inQuietHours(prefs: AlertPreferences | null | undefined, hour: number): boolean {
  const q = prefs?.quietHours;
  if (!q?.enabled) return false;
  const from = typeof q.fromHour === "number" ? q.fromHour : 22;
  const to = typeof q.toHour === "number" ? q.toHour : 8;
  if (from === to) return false; // a zero-length window is off, not "always"
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/**
 * Should this alert push right now?
 *
 * Quiet hours silence the buzz, never the record: the bell row is still written, so a clinic that
 * sleeps through a 03:00 booking still finds it in the morning. The alerts marked
 * `ignoresQuietHours` are the ones where being told late is the same as not being told — a
 * patient waiting for a reply, a patient in pain, a patient who has arrived.
 */
export function pushAllowedNow(
  eventId: string,
  prefs: AlertPreferences | null | undefined,
  hour: number,
): boolean {
  const resolved = resolveNotify(eventId, prefs);
  if (!resolved || !resolved.push) return false;
  if (resolved.event.ignoresQuietHours) return true;
  return !inQuietHours(prefs, hour);
}

/* --- what one person has muted ---------------------------------------------------------------- */

/**
 * Per-person mutes, stored on the person's own user document as
 * `notificationMutes: { [clinicId]: string[] }`.
 *
 * On the user document and not on their staff row for two reasons: the person has to be able to
 * write it themselves (rules allow a user to edit their own profile, and deliberately do not let
 * them edit a staff row that carries permissions), and it is already live-subscribed by
 * AuthContext, so a mute takes effect without another read.
 *
 * The clinic's setting is the ceiling and this only ever subtracts. Nobody can switch on an alert
 * their clinic has switched off — which is the whole reason the clinic setting is worth anything.
 */
export type NotificationMutes = Record<string, string[]> | null | undefined;

export function mutedEventsFor(mutes: NotificationMutes, clinicId: string | null | undefined): string[] {
  if (!clinicId) return [];
  const list = mutes?.[clinicId];
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

export function isMutedFor(
  eventId: string,
  mutes: NotificationMutes,
  clinicId: string | null | undefined,
): boolean {
  return mutedEventsFor(mutes, clinicId).includes(eventId);
}

/**
 * The mute list a person should have after switching one alert on or off for themselves.
 *
 * Returns a fresh array rather than mutating, and stays sorted so two devices writing the same
 * intent produce the same document — an unordered list makes every save look like a change.
 */
export function withMute(
  current: string[],
  eventId: string,
  muted: boolean,
): string[] {
  const set = new Set(current);
  if (muted) set.add(eventId);
  else set.delete(eventId);
  return [...set].sort();
}
