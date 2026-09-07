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
 *  - **Coach snoozed / switched off.** A preference, on the surface it was expressed on. Syncing
 *    "not now" to the owner's other laptop is not a feature anybody asked for.
 *
 * Nothing here is a record. Every read is wrapped, every write is wrapped, and a browser with
 * storage blocked (private window, a locked-down device) gets a guide that works and simply
 * forgets — which is the correct failure for a coach, and would be the wrong one for a ledger.
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

interface StoredState {
  /** `TUTORIALS[].id` values this person has finished, at this clinic. */
  lessons: string[];
  /** Epoch millis the coach stays quiet until. */
  snoozedUntil: number;
  /** The coach was switched off for good. Reversible from the guide page. */
  dismissed: boolean;
}

const EMPTY: StoredState = { lessons: [], snoozedUntil: 0, dismissed: false };

/**
 * One key per (clinic, person). Two owners sharing a laptop, or one owner with two clinics, each
 * get their own progress rather than inheriting the other's.
 */
function keyFor(scope: WelcomeScope): string | null {
  if (!scope.clinicId || !scope.uid) return null;
  return `alphaWelcome:${scope.clinicId}:${scope.uid}`;
}

export function readWelcomeState(scope: WelcomeScope): StoredState {
  const key = keyFor(scope);
  if (!key || typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      // Re-validated rather than trusted: this is hand-editable text, and a `lessons` that came
      // back as a string would break every `.includes` downstream.
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons.filter((l) => typeof l === "string") : [],
      snoozedUntil: typeof parsed.snoozedUntil === "number" ? parsed.snoozedUntil : 0,
      dismissed: parsed.dismissed === true,
    };
  } catch {
    return EMPTY;
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

/** Quiets the coach until `until` (epoch millis). */
export function snoozeCoach(scope: WelcomeScope, until: number): void {
  writeWelcomeState(scope, { ...readWelcomeState(scope), snoozedUntil: until });
}

/** Switches the coach off for good at this clinic. The guide page can turn it back on. */
export function dismissCoach(scope: WelcomeScope): void {
  writeWelcomeState(scope, { ...readWelcomeState(scope), dismissed: true });
}

/** Brings the coach back — both the "for good" flag and any live snooze. */
export function restoreCoach(scope: WelcomeScope): void {
  writeWelcomeState(scope, { ...readWelcomeState(scope), dismissed: false, snoozedUntil: 0 });
}
