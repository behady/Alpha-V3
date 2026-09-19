// src/lib/welcomeStore.ts
"use client";

/**
 * The two things about the welcome guide that only this browser knows.
 *
 * Everything else the guide shows is derived from the clinic's own data (see `welcomeSignals.ts`),
 * which is right: whether a clinic has taken a payment is a fact about the clinic, the same on
 * every device, and storing a second copy of it would only create something to disagree with.
 *
 * These two are genuinely local, and deliberately so:
 *
 *  - **Lessons finished.** Being *shown* how to read a report is a fact about a person, not about
 *    the clinic. A receptionist who joins in month three has learned nothing because the owner
 *    watched the walkthrough in week one, and their guide should say so. Scoped per clinic AND per
 *    user for exactly that reason.
 *  - **Coach snoozed.** "Not now" is about this hour on this screen; there is nothing to sync.
 *
 * Nothing here is a record. Every read is wrapped, every write is wrapped, and a browser with
 * storage blocked (private window, a locked-down device) gets a guide that works and simply
 * forgets — which is the correct failure for a coach, and would be the wrong one for a ledger.
 *
 * Two answers are the exception, and they are NOT only local: "this person has met Sara" and
 * "this person told the coach to stop". Both were browser-only once, and both came back for
 * people who had already said no — a cleared browser, a second laptop or a phone read as somebody
 * who had never been asked. Those two are stored per person here AND on the person's own user
 * document (see TourContext and WelcomeContext), and any copy saying "no" is enough.
 *
 * Writes fire a window event so the provider re-reads: two components in the same tab share this
 * state, and `storage` events famously do not fire in the tab that made the change.
 */

/** Fired after any write here. The provider listens; nothing else needs to. */
export const WELCOME_CHANGED_EVENT = "alpha:welcome-changed";

export interface WelcomeScope {
  clinicId: string | null | undefined;
  uid: string | null | undefined;
}

/**
 * Where this person is in Sara's tour.
 *
 * Local for the same reason lessons are: having been shown around is a fact about a person on a
 * device, and a receptionist who joins later deserves the tour even though the owner took it.
 */
export interface TourProgress {
  /** The "Meet Sara" screen was shown once. Never shown again by itself after this. */
  introSeen: boolean;
  /** Where to resume. Null: not started, or finished. */
  lastStopId: string | null;
  /** Stops opened at least once — the chapter list ticks these. */
  visited: string[];
  /** Epoch millis the tour was finished, 0 if never. */
  completedAt: number;
  /**
   * Whether Sara may add and delete test records. Remembered with the position, so a tour resumed
   * after a reload still reaches its cleanup stops rather than leaving her test patient behind.
   */
  demoMode: "unasked" | "on" | "off";
  /** Which run the resume point belongs to: "core", or a chapter id. */
  run: string | null;
  /** Release walks this person has been offered — offered once, then never again. */
  whatsNewSeen: string[];
}

interface StoredState {
  /** `TUTORIALS[].id` values this person has finished, at this clinic. */
  lessons: string[];
  /** Epoch millis the coach stays quiet until. */
  snoozedUntil: number;
  /** How many times the coach has been closed. Each close buys a longer silence than the last. */
  snoozeCount: number;
  /**
   * The coach was switched off for good — for this person, on every device. Reversible from the
   * guide page, and only from there: closing the bubble is what sets it, so nothing else may.
   */
  dismissed: boolean;
  tour: TourProgress;
}

const EMPTY_TOUR: TourProgress = { introSeen: false, lastStopId: null, visited: [], completedAt: 0, demoMode: "unasked", run: null, whatsNewSeen: [] };

const EMPTY: StoredState = {
  lessons: [],
  snoozedUntil: 0,
  snoozeCount: 0,
  dismissed: false,
  tour: EMPTY_TOUR,
};

function readTour(raw: unknown): TourProgress {
  const t = (raw && typeof raw === "object" ? raw : {}) as Partial<TourProgress>;
  return {
    introSeen: t.introSeen === true,
    lastStopId: typeof t.lastStopId === "string" && t.lastStopId ? t.lastStopId : null,
    visited: Array.isArray(t.visited) ? t.visited.filter((v) => typeof v === "string") : [],
    completedAt: typeof t.completedAt === "number" ? t.completedAt : 0,
    demoMode: t.demoMode === "on" || t.demoMode === "off" ? t.demoMode : "unasked",
    run: typeof t.run === "string" && t.run ? t.run : null,
    whatsNewSeen: Array.isArray(t.whatsNewSeen) ? t.whatsNewSeen.filter((x): x is string => typeof x === "string") : [],
  };
}

/**
 * One key per (clinic, person). Two owners sharing a laptop, or one owner with two clinics, each
 * get their own progress rather than inheriting the other's.
 */
function keyFor(scope: WelcomeScope): string | null {
  if (!scope.clinicId || !scope.uid) return null;
  return `alphaWelcome:${scope.clinicId}:${scope.uid}`;
}

/**
 * The two answers that are about a PERSON, not about a (clinic, person): has this person met
 * Sara, and have they told her to stop talking first.
 *
 * The scoped key above needs a clinic, and everything else it holds is genuinely per clinic —
 * these two are not. Closing Sara's welcome screen, or her coach bubble, a moment before the
 * clinic pointer settled wrote the answer nowhere at all (`keyFor` returns null, and the write is
 * a silent no-op); switching clinic asked again from a fresh key. Either way the person had
 * already said no, and got the same thing back. So both live here, and the answer to "may this
 * appear?" is the OR of this, the scoped copy, and the flag on their own user document.
 */
function personKey(name: "alphaTourIntroSeen" | "alphaCoachOff", uid: string | null | undefined): string | null {
  return uid ? `${name}:${uid}` : null;
}

function readPersonFlag(name: "alphaTourIntroSeen" | "alphaCoachOff", uid: string | null | undefined): boolean {
  const key = personKey(name, uid);
  if (!key || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writePersonFlag(name: "alphaTourIntroSeen" | "alphaCoachOff", uid: string | null | undefined, on: boolean): void {
  const key = personKey(name, uid);
  if (!key || typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    /* Storage blocked. The user document still carries both; see TourContext and WelcomeContext. */
  }
}

/** Was the welcome screen already shown to this person on this browser? */
export function readIntroSeenLocal(uid: string | null | undefined): boolean {
  return readPersonFlag("alphaTourIntroSeen", uid);
}

/** Has this person switched the coach bubble off, on this browser? */
export function readCoachOffLocal(uid: string | null | undefined): boolean {
  return readPersonFlag("alphaCoachOff", uid);
}

export function readWelcomeState(scope: WelcomeScope): StoredState {
  const key = keyFor(scope);
  // No clinic (or no browser): there is no scoped record to read, but the two person-wide answers
  // still hold — and "the coach is off" has to survive being asked before the clinic arrives.
  if (!key || typeof window === "undefined") return { ...EMPTY, dismissed: readCoachOffLocal(scope.uid) };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ...EMPTY, dismissed: readCoachOffLocal(scope.uid) };
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      // Re-validated rather than trusted: this is hand-editable text, and a `lessons` that came
      // back as a string would break every `.includes` downstream.
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons.filter((l) => typeof l === "string") : [],
      snoozedUntil: typeof parsed.snoozedUntil === "number" ? parsed.snoozedUntil : 0,
      snoozeCount: typeof parsed.snoozeCount === "number" ? parsed.snoozeCount : 0,
      dismissed: parsed.dismissed === true || readCoachOffLocal(scope.uid),
      tour: readTour(parsed.tour),
    };
  } catch {
    return { ...EMPTY, dismissed: readCoachOffLocal(scope.uid) };
  }
}

function writeWelcomeState(scope: WelcomeScope, next: StoredState): void {
  const key = keyFor(scope);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Quota, private mode, or storage switched off. The guide still works for this session.
  }
  try {
    window.dispatchEvent(new CustomEvent(WELCOME_CHANGED_EVENT));
  } catch {
    /* CustomEvent is universally available in the browsers this app supports; belt and braces. */
  }
}

/** Records that this person finished a lesson. Idempotent — finishing twice is not two marks. */
export function markLessonDone(scope: WelcomeScope, tutorialId: string): void {
  if (!tutorialId) return;
  const state = readWelcomeState(scope);
  if (state.lessons.includes(tutorialId)) return;
  writeWelcomeState(scope, { ...state, lessons: [...state.lessons, tutorialId] });
}

/** Quiets the coach until `until` (epoch millis), and remembers that it was closed again. */
export function snoozeCoach(scope: WelcomeScope, until: number): void {
  const state = readWelcomeState(scope);
  writeWelcomeState(scope, { ...state, snoozedUntil: until, snoozeCount: state.snoozeCount + 1 });
}

/**
 * Switches the coach off for good — for this person, everywhere, not just at this clinic.
 *
 * The person-wide flag is written first and unconditionally, for the same reason the welcome
 * screen's is: the clinic pointer may not have arrived yet, and that is exactly the moment
 * somebody reaches for the close button. Reversible from the guide page, and only from there.
 */
export function dismissCoach(scope: WelcomeScope): void {
  writePersonFlag("alphaCoachOff", scope.uid, true);
  writeWelcomeState(scope, { ...readWelcomeState(scope), dismissed: true });
}

/** Brings the coach back — the "for good" flag, its person-wide copy, and any live snooze. */
export function restoreCoach(scope: WelcomeScope): void {
  writePersonFlag("alphaCoachOff", scope.uid, false);
  writeWelcomeState(scope, { ...readWelcomeState(scope), dismissed: false, snoozedUntil: 0, snoozeCount: 0 });
}

/* --- Sara's tour ------------------------------------------------------------------------- */

/** Did this person finish this lesson? Written by the lesson overlay on its last step. */
export function isLessonDone(scope: WelcomeScope, tutorialId: string): boolean {
  return readWelcomeState(scope).lessons.includes(tutorialId);
}

export function readTourProgress(scope: WelcomeScope): TourProgress {
  const tour = readWelcomeState(scope).tour;
  // The per-person flag can only ever turn `introSeen` ON. A "yes, shown" recorded under any
  // clinic — or with no clinic loaded at all — still means shown.
  return tour.introSeen ? tour : { ...tour, introSeen: readIntroSeenLocal(scope.uid) };
}

function writeTour(scope: WelcomeScope, patch: Partial<TourProgress>): void {
  const state = readWelcomeState(scope);
  writeWelcomeState(scope, { ...state, tour: { ...state.tour, ...patch } });
}

/**
 * The intro was shown (and either taken or declined). It does not come back on its own.
 *
 * The per-person flag is written first and unconditionally: it is the one that still lands when
 * the clinic pointer has not arrived yet, which is exactly the moment somebody clicks the X.
 */
export function markTourIntroSeen(scope: WelcomeScope): void {
  writePersonFlag("alphaTourIntroSeen", scope.uid, true);
  if (readWelcomeState(scope).tour.introSeen) return;
  writeTour(scope, { introSeen: true });
}

/** Where the tour is now. Called on every stop, so leaving mid-way resumes at the right place. */
export function saveTourPosition(scope: WelcomeScope, stopId: string, run: string | null = null): void {
  const tour = readWelcomeState(scope).tour;
  const visited = tour.visited.includes(stopId) ? tour.visited : [...tour.visited, stopId];
  writeTour(scope, { lastStopId: stopId, visited, introSeen: true, run: run ?? tour.run });
}

/** The last stop was reached. The resume point clears; the visited list stays for the ticks. */
export function markTourComplete(scope: WelcomeScope): void {
  writeTour(scope, { lastStopId: null, completedAt: Date.now(), introSeen: true, run: null });
}

/** A chapter run reached its end: the resume point clears, the ticks stay. */
export function clearTourRun(scope: WelcomeScope): void {
  writeTour(scope, { lastStopId: null, run: null });
}

/** This release has been offered. It does not come back, whether or not they watched it. */
export function markWhatsNewSeen(scope: WelcomeScope, releaseId: string): void {
  const seen = readWelcomeState(scope).tour.whatsNewSeen;
  if (seen.includes(releaseId)) return;
  writeTour(scope, { whatsNewSeen: [...seen, releaseId] });
}

/** Start over: forgets the resume point but keeps the intro as seen. */
export function resetTourPosition(scope: WelcomeScope): void {
  writeTour(scope, { lastStopId: null, run: null });
}

/** The answer to "shall I do it for real?" — kept so a resumed tour still cleans up after itself. */
export function saveTourDemoMode(scope: WelcomeScope, demoMode: TourProgress["demoMode"]): void {
  writeTour(scope, { demoMode });
}
