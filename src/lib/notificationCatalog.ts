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
export type NotifyGroup = "unanswered" | "frontdesk" | "leads" | "briefs" | "money" | "clinic" | "delivery";

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
    id: "briefs",
    en: "Daily briefs",
    ar: "ملخص اليوم",
    noteEn: "The morning summary. One version for the desk, one for each dentist.",
    noteAr: "ملخص الصباح. نسخة للاستقبال ونسخة لكل دكتور.",
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
  kind: "minutes" | "hours" | "hourOfDay";
  en: string;
  ar: string;
  /** What the code used before any of this was configurable. */
  fallback: number;
  min: number;
  max: number;
}

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
    en: "A message the bot refused to answer",
    ar: "رسالة البوت رفض يردّ عليها",
    whenEn: "Pain, bleeding, or anything clinical. The bot hands these straight to a human by design.",
    whenAr: "وجع أو نزيف أو أي حاجة طبية. البوت بيسلّمها لحد فوراً بالتصميم.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    ignoresQuietHours: true,
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
    en: "A patient is asking to cancel, move, or says they'll be late",
    ar: "مريض بيطلب إلغاء أو تعديل أو بيقول هيتأخر",
    whenEn: "Asked for, not done — somebody has to act on it.",
    whenAr: "طلب، مش تنفيذ — لازم حد يتصرّف.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    ignoresQuietHours: true,
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
    group: "briefs",
    en: "The clinic's morning brief",
    ar: "ملخص الصباح للعيادة",
    whenEn: "How many are booked today and what time the first one is.",
    whenAr: "كام محجوز النهارده وأول ميعاد إمتى.",
    roles: ["Owner", "Admin", "Receptionist"],
    bell: true,
    push: true,
    timings: [{ key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 7, min: 0, max: 23 }],
  },
  {
    id: "morningBriefDentist",
    group: "briefs",
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
  {
    id: "eveningDigest",
    group: "money",
    en: "The day, closed out",
    ar: "اليوم بعد ما يخلص",
    whenEn: "What came through the door today, and who was late or absent.",
    whenAr: "اللي دخل النهارده، ومين اتأخر أو غاب.",
    roles: ["Owner", "Admin"],
    rolesMax: ["Owner", "Admin"],
    bell: true,
    push: true,
    timings: [{ key: "hour", kind: "hourOfDay", en: "Send at", ar: "ابعت الساعة", fallback: 21, min: 0, max: 23 }],
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
    id: "labCaseBack",
    group: "clinic",
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
    id: "aiCreditsOut",
    group: "delivery",
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
export interface NotifyEventPref {
  bell?: boolean;
  push?: boolean;
  roles?: string[];
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
  roles: NotifyRole[];
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

  return { event, bell, push, roles };
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
