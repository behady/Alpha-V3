// src/lib/welcomeJourney.ts
/**
 * What a brand-new clinic is walked through, in the order that pays off soonest.
 *
 * `lib/tutorials.ts` already holds the lessons — the pulsing ring that points at the real screen.
 * What it does not hold is a *route through them*: a clinic that signs up on a Monday sees a list
 * of twelve equally-weighted titles inside a chat panel they have to know to open, with nothing
 * saying which one matters first, whether they have already done it, or how many days of the trial
 * are left to find out. That is the gap this file fills.
 *
 * Three ideas hold it together:
 *
 *  1. **A mission is proved by data, not by clicking.** `signal` names a fact about the clinic —
 *     a patient exists, a payment posted, the schedule was saved — and that fact is what ticks the
 *     box. A clinic that registered its first patient before ever opening a lesson is finished
 *     with that mission, and being told otherwise is the fastest way to make the whole guide feel
 *     like a toy. Finishing the guided lesson counts too, for the few missions no stored record
 *     can prove (reading a report leaves no trace).
 *
 *  2. **Never offer what this person cannot do.** Same discipline as `tutorialsFor`: a mission
 *     whose screen is closed to the caller's role is worse than no mission. `adminOnly`,
 *     `requires` and `feature` are all read before anything is shown, and a mission gated behind
 *     a plan the clinic has not bought leaves the progress count entirely (see
 *     `lockedMissionsFor`) rather than sitting there permanently unfinishable.
 *
 *  3. **Payoff before mechanics.** Every mission carries `payoff` — what the clinic gets, in the
 *     owner's language, not the app's. "Follow the pulsing ring" is how; "so the calendar stops
 *     offering times you are closed" is why, and why is what gets someone to spend three minutes
 *     of a working day on setup.
 *
 * Deliberately pure data with no client imports, exactly like `tutorials.ts`: the guide page, the
 * coach bubble and `tests/welcomeJourney.test.mts` all read it, and the test is what keeps a
 * mission from pointing at a lesson that no longer exists.
 */

import { expiryDate } from "./clinicStatus";
import { DEFAULT_TRIAL_DAYS } from "./trialPolicy";

/**
 * How long to assume a trial runs when the clinic document does not say.
 *
 * Re-exported from `trialPolicy.ts` rather than declared, so the number the guide counts down and
 * the number signup stamps onto `expiresAt` cannot drift apart.
 *
 * This is only ever a fallback now. Signup writes a real `expiresAt` from the policy the
 * superadmin dashboard controls, and `trialStatus` below prefers that field whenever it is
 * present — which it will be for every clinic created from now on. The fallback still matters for
 * the clinics created before that existed, which genuinely have no expiry date at all.
 */
export const TRIAL_DAYS = DEFAULT_TRIAL_DAYS;

export interface Localized {
  en: string;
  ar: string;
}

export type JourneyStageId = "setup" | "firstday" | "money" | "grow";

export interface JourneyStage {
  id: JourneyStageId;
  title: Localized;
  /** One line under the heading: what finishing this stage buys the clinic. */
  blurb: Localized;
}

/**
 * The stages, in order. Four rather than fourteen "days": a clinic does not open on a schedule,
 * and a guide that says "Day 3" to someone on their eleventh day is telling them they are behind.
 */
export const JOURNEY_STAGES: JourneyStage[] = [
  {
    id: "setup",
    title: { en: "Open for business", ar: "افتح العيادة" },
    blurb: {
      en: "Twenty minutes that make every screen after this one correct.",
      ar: "عشرين دقيقة بتخلي كل شاشة بعد كده تطلع مظبوطة.",
    },
  },
  {
    id: "firstday",
    title: { en: "Run a real day", ar: "شغّل يوم حقيقي" },
    blurb: {
      en: "One patient, from the front desk to the chair — with a real patient, not a test one.",
      ar: "مريض واحد، من الاستقبال للكرسي — بمريض حقيقي مش تجربة.",
    },
  },
  {
    id: "money",
    title: { en: "Get the money right", ar: "ظبّط الفلوس" },
    blurb: {
      en: "What came in, what went out, and the report that tells you which treatments pay.",
      ar: "اللي دخل واللي خرج، والتقرير اللي بيقولك أنهي علاج بيكسب.",
    },
  },
  {
    id: "grow",
    title: { en: "Get more out of it", ar: "استفيد أكتر" },
    blurb: {
      en: "The parts that earn their keep once the basics are running.",
      ar: "الحاجات اللي بتفرق فلوس بجد بعد ما الأساسيات تمشي.",
    },
  },
];

/**
 * A fact about the clinic that proves a mission was really done.
 *
 * Each one is answered by `lib/welcomeSignals.ts` with a single cheap read. Names are the
 * question, not the collection, because two of them ask about the same collection with different
 * filters (`payments` and `expenses` are both `ledger`).
 */
export type MissionSignal =
  | "clinicProfile"
  | "schedule"
  | "services"
  | "team"
  | "patients"
  | "appointments"
  | "treatments"
  | "prescriptions"
  | "payments"
  | "expenses"
  | "leads"
  | "inventory"
  | "labCases";

/** Feature flags a mission can depend on, as named in `TIER_LIMITS[...].features`. */
export type MissionFeature = "inventory" | "attendance" | "whatsappIntegration" | "marketingText";

export interface Mission {
  id: string;
  stage: JourneyStageId;
  title: Localized;
  /** What the clinic gets out of it. Shown under the title, and spoken by the coach. */
  payoff: Localized;
  /** The lesson that teaches it, by `TUTORIALS[].id`. Absent means "no ring for this one". */
  tutorialId?: string;
  /** Where it lives, for the "Open it" link. */
  route: string;
  /**
   * The stored fact that ticks this off. Absent means the only proof available is finishing the
   * lesson — true of exactly one mission (reading a report leaves nothing behind).
   */
  signal?: MissionSignal;
  /** Rough minutes, for the "about N minutes left" line on the guide. */
  minutes: number;
  /** Same gate as `Tutorial.adminOnly` — the screen is Admin-only in firestore.rules. */
  adminOnly?: boolean;
  /** Same gate as `Tutorial.requires` — a permission the caller must hold. */
  requires?: string;
  /** A plan feature this needs. Missing feature moves it to the locked list, not the checklist. */
  feature?: MissionFeature;
}

/**
 * The route itself.
 *
 * Ordered within each stage by what unlocks what: prices before treatments, because choosing a
 * treatment from the price list is what fills its cost; a patient before an appointment, because
 * booking asks for one. Following the list top to bottom never leaves anybody stuck behind a step
 * they have not taken.
 */
export const MISSIONS: Mission[] = [
  // --- Stage 1: open for business ---------------------------------------------------------
  {
    id: "clinic-profile",
    stage: "setup",
    title: { en: "Put your clinic's name on it", ar: "حط اسم عيادتك عليه" },
    payoff: {
      en: "Your logo and details print on every prescription, invoice and report from here on.",
      ar: "شعارك وبياناتك هيتطبعوا على كل روشتة وفاتورة وتقرير من دلوقتي.",
    },
    tutorialId: "clinic-profile",
    route: "/settings/clinic",
    signal: "clinicProfile",
    minutes: 3,
    adminOnly: true,
  },
  {
    id: "working-hours",
    stage: "setup",
    title: { en: "Set your working hours", ar: "ظبط مواعيد العمل" },
    payoff: {
      en: "The calendar stops offering times you're closed, and the assistant stops guessing.",
      ar: "التقويم هيبطل يعرض مواعيد وانت قافل، والمساعد هيبطل يخمّن.",
    },
    tutorialId: "set-working-hours",
    route: "/settings/schedule",
    signal: "schedule",
    minutes: 3,
    adminOnly: true,
  },
  {
    id: "price-list",
    stage: "setup",
    title: { en: "Load your price list", ar: "حمّل قائمة أسعارك" },
    payoff: {
      en: "Pick a treatment and its price fills itself — that's what makes balances and reports add up.",
      ar: "تختار علاج فيتكتب سعره لوحده — وده اللي بيخلي الحسابات والتقارير تظبط.",
    },
    tutorialId: "update-prices",
    route: "/settings/prices",
    signal: "services",
    minutes: 6,
    adminOnly: true,
  },
  {
    id: "invite-team",
    stage: "setup",
    title: { en: "Bring your team in", ar: "ضم فريقك" },
    payoff: {
      en: "Everyone works in one file instead of four notebooks — and you choose what each of them can see.",
      ar: "الكل بيشتغل على ملف واحد بدل أربع كشاكيل — وانت اللي بتحدد كل واحد يشوف إيه.",
    },
    tutorialId: "invite-team",
    route: "/settings/users",
    signal: "team",
    minutes: 4,
    adminOnly: true,
  },

  // --- Stage 2: run a real day ------------------------------------------------------------
  {
    id: "first-patient",
    stage: "firstday",
    title: { en: "Register your first patient", ar: "سجّل أول مريض" },
    payoff: {
      en: "One file that holds their history, their money and their messages — for good.",
      ar: "ملف واحد فيه تاريخه وفلوسه ورسايله — للأبد.",
    },
    tutorialId: "add-patient",
    route: "/patients",
    signal: "patients",
    minutes: 2,
    requires: "patients.add",
  },
  {
    id: "first-appointment",
    stage: "firstday",
    title: { en: "Book your first appointment", ar: "احجز أول موعد" },
    payoff: {
      en: "Double-bookings become impossible, and the day's list is the same list for everyone.",
      ar: "الحجز المزدوج بيبقى مستحيل، وجدول اليوم بيبقى واحد للكل.",
    },
    tutorialId: "book-appointment",
    route: "/appointments",
    signal: "appointments",
    minutes: 2,
    requires: "appointments.add",
  },
  {
    id: "first-treatment",
    stage: "firstday",
    title: { en: "Record a treatment", ar: "سجّل علاج" },
    payoff: {
      en: "The note and its charge are saved together, so nothing is treated and never billed.",
      ar: "الملاحظة وتكلفتها بيتحفظوا مع بعض، فمفيش علاج يتعمل ومايتحسبش.",
    },
    tutorialId: "record-treatment",
    route: "/patients",
    signal: "treatments",
    minutes: 4,
    requires: "clinical.edit",
  },
  {
    id: "first-prescription",
    stage: "firstday",
    title: { en: "Write a prescription", ar: "اكتب روشتة" },
    payoff: {
      en: "Printed on your letterhead in seconds, and kept in the patient's history.",
      ar: "بتتطبع على ورق العيادة في ثواني، وبتتسجل في تاريخ المريض.",
    },
    tutorialId: "write-prescription",
    route: "/patients",
    signal: "prescriptions",
    minutes: 3,
    requires: "clinical.edit",
  },

  // --- Stage 3: get the money right -------------------------------------------------------
  {
    id: "first-payment",
    stage: "money",
    title: { en: "Take a payment", ar: "استلم دفعة" },
    payoff: {
      en: "It lands in the patient's balance and the clinic's day sheet at the same moment.",
      ar: "بتتسجل في حساب المريض وفي يومية العيادة في نفس اللحظة.",
    },
    tutorialId: "record-payment",
    route: "/patients",
    signal: "payments",
    minutes: 2,
    requires: "finance.add",
  },
  {
    id: "first-expense",
    stage: "money",
    title: { en: "Record what you spend", ar: "سجّل اللي بتصرفه" },
    payoff: {
      en: "Rent, materials, a bill — without them the profit figure is only half the story.",
      ar: "إيجار، خامات، فاتورة — من غيرهم رقم الربح نص الحكاية.",
    },
    tutorialId: "add-expense",
    route: "/finance",
    signal: "expenses",
    minutes: 2,
    requires: "finance.add",
  },
  {
    id: "read-reports",
    stage: "money",
    title: { en: "Read your first report", ar: "اقرا أول تقرير" },
    // The one mission with no stored proof: opening a report writes nothing anywhere, so
    // finishing the lesson is the only honest evidence available.
    payoff: {
      en: "Which treatments actually pay, which dentist is busiest, where your patients come from.",
      ar: "أنهي علاج بيكسب فعلاً، ومين أكتر دكتور مشغول، ومرضاك جايين منين.",
    },
    tutorialId: "explore-reports",
    route: "/reports",
    minutes: 4,
    requires: "access.reports",
  },

  // --- Stage 4: get more out of it --------------------------------------------------------
  {
    id: "first-lead",
    stage: "grow",
    title: { en: "Catch an inquiry", ar: "امسك استفسار" },
    payoff: {
      en: "Everyone who asked and hasn't booked, with a timer on how long they've waited for a reply.",
      ar: "كل اللي سأل ولسه محجزش، وعليه عدّاد بيقول مستني رد بقاله قد إيه.",
    },
    tutorialId: "handle-lead",
    route: "/leads",
    signal: "leads",
    minutes: 3,
    /**
     * `access.patients`, which looks wrong for a page called Leads and is not.
     *
     * There is no `access.leads` in the permissions catalogue, and the dashboard layout gates the
     * Leads rail item on `canAccessNavItem('leads') || canAccessNavItem('patients')` — where the
     * first half can only ever pass on a permission an admin cannot grant. So the grant that
     * actually opens that page is the patients one, and naming anything else here would offer the
     * mission to somebody whose sidebar has no Leads in it.
     */
    requires: "access.patients",
  },
  {
    id: "find-patient",
    stage: "grow",
    title: { en: "Find anyone in two seconds", ar: "لاقي أي حد في ثانيتين" },
    payoff: {
      en: "Name or any part of a phone number — the trick reception uses fifty times a day.",
      ar: "اسم أو أي جزء من رقم تليفون — الحركة اللي الاستقبال بيعملها خمسين مرة في اليوم.",
    },
    tutorialId: "find-patient",
    route: "/patients",
    /**
     * No signal, on purpose — and it briefly had one.
     *
     * Reusing `patients` here (the reasoning being "a clinic with patients has surely searched
     * for one") meant registering a single patient silently ticked this off too, so the trick
     * this step exists to teach was never shown to anybody. A search leaves no record, so
     * finishing the sixty-second lesson is the only honest evidence there is.
     */
    minutes: 1,
    requires: "access.patients",
  },
  {
    id: "lab-case",
    stage: "grow",
    title: { en: "Send a case to the lab", ar: "ابعت شغل للمعمل" },
    payoff: {
      en: "Every crown and denture out of the building tracked, so none of them is remembered late.",
      ar: "كل تركيبة وطقم خارج العيادة متتبّع، فمفيش واحد يتفتكر متأخر.",
    },
    tutorialId: "lab-order",
    route: "/lab",
    signal: "labCases",
    minutes: 3,
    requires: "access.lab",
  },
  {
    id: "stock-item",
    stage: "grow",
    title: { en: "Put your stock in", ar: "دخّل مخزونك" },
    payoff: {
      en: "A warning before you run out of the thing you're mid-procedure with.",
      ar: "تحذير قبل ما تخلص الحاجة اللي انت في نص إجراء بيها.",
    },
    tutorialId: "add-inventory-item",
    route: "/inventory",
    signal: "inventory",
    minutes: 2,
    requires: "inventory.add",
    feature: "inventory",
  },
];

/** Fast lookup, for the coach and the guide. */
export const MISSION_IDS = MISSIONS.map((m) => m.id);

export function missionById(id: string): Mission | undefined {
  return MISSIONS.find((m) => m.id === id);
}

/** Who is asking, and what their clinic's plan includes. */
export interface JourneyViewer {
  isAdmin: boolean;
  permissions?: readonly string[];
  /** `hasFeature(clinic, key)` from `lib/subscriptions`, passed in so this file stays pure. */
  hasFeature?: (feature: MissionFeature) => boolean;
}

function roleAllows(mission: Mission, viewer: JourneyViewer): boolean {
  if (viewer.isAdmin) return true;
  if (mission.adminOnly) return false;
  return !mission.requires || !!viewer.permissions?.includes(mission.requires);
}

function planAllows(mission: Mission, viewer: JourneyViewer): boolean {
  if (!mission.feature) return true;
  // No probe supplied means "don't gate on the plan" — the guide still works for a caller that
  // has not loaded the clinic document yet, rather than briefly hiding half the list.
  return viewer.hasFeature ? viewer.hasFeature(mission.feature) : true;
}

/**
 * The missions this person can actually finish today. Everything counted, ticked and coached is
 * drawn from here, so a receptionist's guide is a receptionist's guide and reaches 100%.
 */
export function missionsFor(viewer: JourneyViewer): Mission[] {
  return MISSIONS.filter((m) => roleAllows(m, viewer) && planAllows(m, viewer));
}

/**
 * Missions this person's ROLE allows but the clinic's PLAN does not.
 *
 * Kept separate rather than hidden: "stock control is in Pro" is a useful thing for a trialling
 * owner to know, and it is the honest reason the mission is not on their list. It is deliberately
 * excluded from every count — an unfinishable item inside a progress bar is a progress bar that
 * never completes.
 */
export function lockedMissionsFor(viewer: JourneyViewer): Mission[] {
  return MISSIONS.filter((m) => roleAllows(m, viewer) && !planAllows(m, viewer));
}

/** Which clinic facts are true. Absent or false both mean "not yet". */
export type MissionSignals = Partial<Record<MissionSignal, boolean>>;

/**
 * Is this mission finished?
 *
 * Two ways, and the data one is checked first on purpose. A clinic that has been registering
 * patients for a week is not asked to register their first patient just because nobody on this
 * browser has watched the lesson.
 */
export function isMissionDone(
  mission: Mission,
  signals: MissionSignals,
  lessonsDone: readonly string[] = [],
): boolean {
  if (mission.signal && signals[mission.signal]) return true;
  return !!mission.tutorialId && lessonsDone.includes(mission.tutorialId);
}

export interface StageProgress {
  stage: JourneyStage;
  missions: { mission: Mission; done: boolean }[];
  done: number;
  total: number;
}

export interface JourneyProgress {
  stages: StageProgress[];
  done: number;
  total: number;
  /** 0–100, rounded. 100 exactly when everything on this person's list is done. */
  percent: number;
  /** The next unfinished mission in route order, or null when there is nothing left. */
  next: Mission | null;
  /** Sum of `minutes` over what is left, for "about 12 minutes to go". */
  minutesLeft: number;
  complete: boolean;
}

/**
 * Roll the missions up into stages, in `JOURNEY_STAGES` order.
 *
 * A stage with nothing in it for this person is dropped rather than rendered empty — a
 * receptionist has no "Open for business" work, and an empty heading reads as something broken.
 */
export function journeyProgress(
  missions: readonly Mission[],
  signals: MissionSignals,
  lessonsDone: readonly string[] = [],
): JourneyProgress {
  const stages: StageProgress[] = [];
  let done = 0;
  let total = 0;
  let minutesLeft = 0;
  let next: Mission | null = null;

  for (const stage of JOURNEY_STAGES) {
    const mine = missions.filter((m) => m.stage === stage.id);
    if (mine.length === 0) continue;

    const rows = mine.map((mission) => {
      const isDone = isMissionDone(mission, signals, lessonsDone);
      if (isDone) done += 1;
      else {
        minutesLeft += mission.minutes;
        if (!next) next = mission;
      }
      total += 1;
      return { mission, done: isDone };
    });

    stages.push({
      stage,
      missions: rows,
      done: rows.filter((r) => r.done).length,
      total: rows.length,
    });
  }

  return {
    stages,
    done,
    total,
    // A viewer with no missions at all (no permissions that reach any of them) is "complete"
    // rather than 0% forever — 0/0 is nothing left to do, and NaN on a progress ring.
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
    next,
    minutesLeft,
    complete: done >= total,
  };
}

export interface TrialStatus {
  /** True only for the Free Trial tier. A paying clinic still gets the guide, without a clock. */
  isTrial: boolean;
  /** Days from signup to the end of the trial. */
  totalDays: number;
  /** Which day of the trial today is, 1-based and clamped to at least 1. */
  dayNumber: number;
  /** Whole days remaining, floor 0. */
  daysLeft: number;
  /** When it runs out, or null when the clinic's dates cannot be read. */
  endsAt: Date | null;
  /** Past the end. The clinic may well still be writable — see the TRIAL_DAYS note. */
  ended: boolean;
}

/**
 * How far into the trial this clinic is.
 *
 * `expiresAt` wins, because that is the date the clinic will actually be held to — by
 * `firestore.rules` on every browser write and by `clinicStatus` on every server one. Signup
 * stamps it from the platform trial policy, and the superadmin panel can move it per clinic.
 *
 * The `createdAt + TRIAL_DAYS` fallback is for the clinics that predate signup writing the field,
 * and for a policy with expiry switched off. It is a coaching estimate in both cases, never an
 * enforcement claim: nothing goes read-only on a date this function invented. A clinic whose
 * dates cannot be read at all gets `isTrial` from its tier and no countdown rather than a
 * made-up one.
 */
export function trialStatus(
  clinic: Record<string, unknown> | null | undefined,
  now: Date = new Date(),
): TrialStatus {
  const isTrial = (clinic?.subscriptionTier ?? "Free Trial") === "Free Trial";
  const createdAt = expiryDate(clinic?.createdAt);
  const explicitEnd = expiryDate(clinic?.expiresAt);

  const endsAt =
    explicitEnd ??
    (createdAt ? new Date(createdAt.getTime() + TRIAL_DAYS * 86400000) : null);

  if (!endsAt) {
    return { isTrial, totalDays: TRIAL_DAYS, dayNumber: 1, daysLeft: TRIAL_DAYS, endsAt: null, ended: false };
  }

  const startedAt = createdAt ?? new Date(endsAt.getTime() - TRIAL_DAYS * 86400000);
  const totalDays = Math.max(1, Math.round((endsAt.getTime() - startedAt.getTime()) / 86400000));
  const elapsedDays = Math.floor((now.getTime() - startedAt.getTime()) / 86400000);
  const msLeft = endsAt.getTime() - now.getTime();

  return {
    isTrial,
    totalDays,
    // Day 1 is the day they signed up, and a clock skew that puts "now" before signup must not
    // produce day zero or a negative day.
    dayNumber: Math.min(totalDays, Math.max(1, elapsedDays + 1)),
    daysLeft: Math.max(0, Math.ceil(msLeft / 86400000)),
    endsAt,
    ended: msLeft <= 0,
  };
}

/**
 * Should the coach bubble speak right now?
 *
 * The bar is deliberately high. An unprompted bubble is the single easiest thing in an app to
 * hate, and every "no" below is a way it has earned that reaction elsewhere: talking after the
 * work is done, talking over a lesson it started itself, talking again on a screen it was just
 * dismissed on, and talking to somebody who has told it to stop.
 */
export interface CoachDecision {
  speak: boolean;
  reason:
    | "next-mission"
    | "complete"
    | "snoozed"
    | "dismissed"
    | "tutorial-running"
    | "nothing-to-say";
}

export function coachDecision(args: {
  progress: JourneyProgress;
  /** Epoch millis the user snoozed until, or 0/undefined for "not snoozed". */
  snoozedUntil?: number;
  /** The user switched the coach off for this clinic for good. */
  dismissedForever?: boolean;
  /** A lesson is on screen; its ring owns the viewport. */
  tutorialRunning?: boolean;
  now?: number;
}): CoachDecision {
  const now = args.now ?? Date.now();
  if (args.tutorialRunning) return { speak: false, reason: "tutorial-running" };
  if (args.dismissedForever) return { speak: false, reason: "dismissed" };
  if (args.snoozedUntil && args.snoozedUntil > now) return { speak: false, reason: "snoozed" };
  if (args.progress.complete) return { speak: false, reason: "complete" };
  if (!args.progress.next) return { speak: false, reason: "nothing-to-say" };
  return { speak: true, reason: "next-mission" };
}

/** How long "Later" quiets the coach for: the rest of the working day, not a token five minutes. */
export const COACH_SNOOZE_MS = 6 * 60 * 60 * 1000;

/**
 * The line the coach opens with — greeting, then the one thing to do next.
 *
 * Kept here rather than in the component so the wording is testable and so the trial clock and
 * the mission stay in one sentence: "you have nine days left" on its own is a threat, and
 * "register your first patient" on its own is a chore. Together they are a reason.
 */
export function coachGreeting(args: {
  progress: JourneyProgress;
  trial: TrialStatus;
  isAr: boolean;
  /** Used to open with "Hi Nour"; omitted, the greeting simply starts at the step. */
  firstName?: string;
}): string {
  const { progress, trial, isAr } = args;
  const who = (args.firstName || "").trim();

  if (progress.complete) {
    return isAr
      ? "خلصت كل خطوات البداية 🎉 — لو احتجت أي حاجة أنا هنا."
      : "You've finished every setup step 🎉 — I'm here whenever you need me.";
  }

  const next = progress.next;
  if (!next) {
    return isAr ? "أنا هنا لو احتجت أي حاجة." : "I'm here whenever you need me.";
  }

  const title = isAr ? next.title.ar : next.title.en;
  const payoff = isAr ? next.payoff.ar : next.payoff.en;

  // The count is the honest hook: "3 of 12" says the guide has a shape and an end.
  const step = isAr
    ? `الخطوة ${progress.done + 1} من ${progress.total}`
    : `Step ${progress.done + 1} of ${progress.total}`;

  const clock =
    trial.isTrial && !trial.ended && trial.daysLeft > 0
      ? isAr
        ? ` — فاضل ${trial.daysLeft} يوم في التجربة`
        : ` — ${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left in your trial`
      : "";

  const hello = who
    ? isAr
      ? `أهلاً يا ${who}! `
      : `Hi ${who} — `
    : "";

  return isAr
    ? `${hello}${step}${clock}: ${title}. ${payoff}`
    : `${hello}${step}${clock}: ${title}. ${payoff}`;
}
