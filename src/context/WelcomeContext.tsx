"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { hasFeature } from "@/lib/subscriptions";
import { expiryDate } from "@/lib/clinicStatus";
import {
  DEFAULT_TRIAL_POLICY,
  PLATFORM_SETTINGS_COLLECTION,
  TRIAL_POLICY_DOC,
  normalizeTrialPolicy,
  trialWarning,
  type TrialPolicy,
  type TrialWarning,
} from "@/lib/trialPolicy";
import { readWelcomeSignals } from "@/lib/welcomeSignals";
import {
  WELCOME_CHANGED_EVENT,
  dismissCoach,
  readWelcomeState,
  restoreCoach,
  snoozeCoach,
  type WelcomeScope,
} from "@/lib/welcomeStore";
import {
  coachSnoozeMs,
  coachDecision,
  journeyProgress,
  lockedMissionsFor,
  missionsFor,
  trialStatus,
  type CoachDecision,
  type JourneyProgress,
  type Mission,
  type MissionFeature,
  type MissionSignals,
  type TrialStatus,
} from "@/lib/welcomeJourney";

/**
 * Where the welcome guide's state lives.
 *
 * Three surfaces read it — the coach bubble in the corner, the guide at `/welcome`, and the
 * progress card on the dashboard — and all three must agree, to the tick, at the same instant.
 * Given how the answer is assembled, that is not a nicety:
 *
 *  - the signal probes cost thirteen Firestore reads, so they run ONCE per clinic per tab, not
 *    once per component that wants to know;
 *  - the answer changes underneath the app (a lesson finishes, a payment posts), so a stale
 *    checklist beside a fresh coach would be two different opinions on screen at the same time.
 *
 * Mounted inside `TutorialProvider` in the dashboard layout, because the coach must fall silent
 * while a lesson's ring owns the screen — and outside nothing, because a page that is not the
 * dashboard has no clinic to be welcomed to.
 */

interface WelcomeContextType {
  /** Still fetching the first round of signals. Surfaces render skeletons, not "0 of 13". */
  loading: boolean;
  /** The missions this person can finish, already filtered by role, permission and plan. */
  missions: Mission[];
  /** Missions their role allows but the clinic's plan does not. Never counted; shown as locked. */
  locked: Mission[];
  progress: JourneyProgress;
  trial: TrialStatus;
  /**
   * Whether to tell the clinic its trial is about to end, and how many days are left.
   *
   * It lives here because this provider already holds the trial clock, and because the answer
   * needs the platform policy's `warnWithinDays` — one document read, made only for clinics
   * actually on a trial.
   */
  trialEnding: TrialWarning;
  /** Whether the coach should be on screen, and why not when it should not. */
  coach: CoachDecision;
  /** True while the coach has been switched off for good at this clinic. */
  coachDismissed: boolean;
  /** Re-read the clinic signals. Called after a lesson finishes and from the guide's refresh. */
  refresh: () => void;
  /** "Later" — quiet for the rest of the working day. */
  snooze: () => void;
  /** "Don't show this again" at this clinic. */
  dismiss: () => void;
  /** Bring the coach back, from the guide page. */
  restore: () => void;
}

const WelcomeContext = createContext<WelcomeContextType | undefined>(undefined);

export function WelcomeProvider({
  children,
  /**
   * Whether a lesson is currently running. Passed in rather than read from `useTutorial()` so
   * this provider carries no dependency on the tutorial system — the guide is perfectly coherent
   * without one, and the coupling would only exist to silence a bubble.
   */
  tutorialRunning = false,
}: {
  children: React.ReactNode;
  tutorialRunning?: boolean;
}) {
  const { clinic, clinicId, isAdmin } = useClinic();
  const { user } = useAuth();

  const scope: WelcomeScope = useMemo(
    () => ({ clinicId, uid: user?.uid }),
    [clinicId, user?.uid],
  );

  const [signals, setSignals] = useState<MissionSignals>({});
  const [loading, setLoading] = useState(true);
  /** Bumped to force a re-read of localStorage; the store is not React state. */
  const [localTick, setLocalTick] = useState(0);
  /** Bumped by refresh() to re-run the probes. */
  const [signalTick, setSignalTick] = useState(0);

  /**
   * The thirteen probes, run once per clinic per tab — and once more each time `refresh()` bumps
   * `signalTick`.
   *
   * The dependency array is the whole guard, deliberately. An earlier version also held the last
   * `clinicId#tick` in a ref and returned early on a repeat, which is exactly the wrong shape
   * under React's development double-invoke: mount, unmount (cleanup sets `cancelled`), mount
   * again — and the second mount matched the ref, returned before starting a fetch, while the
   * first mount's answer was thrown away by its own cleanup. The result was a checklist stuck on
   * its skeleton, in dev only. The deps already say "re-run when the clinic or the tick changes",
   * which is the entire requirement.
   */
  useEffect(() => {
    if (!clinicId) {
      setSignals({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      const found = await readWelcomeSignals();
      // A clinic switch mid-flight would otherwise paint the previous clinic's answers onto the
      // new one's checklist — the one failure mode that would make the guide actively lie.
      if (!cancelled) {
        setSignals(found);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clinicId, signalTick]);

  // Re-read the local marks whenever anything writes them — including from another component in
  // this same tab, which a plain `storage` listener would never hear.
  useEffect(() => {
    const onChanged = () => setLocalTick((n) => n + 1);
    window.addEventListener(WELCOME_CHANGED_EVENT, onChanged);
    window.addEventListener("storage", onChanged);
    return () => {
      window.removeEventListener(WELCOME_CHANGED_EVENT, onChanged);
      window.removeEventListener("storage", onChanged);
    };
  }, []);

  const local = useMemo(
    () => readWelcomeState(scope),
    // localTick is the whole point of this memo: the store is not React state, so nothing else
    // here changes when it is written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, localTick],
  );

  const viewer = useMemo(
    () => ({
      isAdmin,
      permissions: user?.permissions,
      hasFeature: (f: MissionFeature) => hasFeature(clinic, f),
    }),
    [isAdmin, user?.permissions, clinic],
  );

  const missions = useMemo(() => missionsFor(viewer), [viewer]);
  const locked = useMemo(() => lockedMissionsFor(viewer), [viewer]);
  const progress = useMemo(
    () => journeyProgress(missions, signals, local.lessons),
    [missions, signals, local.lessons],
  );
  const trial = useMemo(() => trialStatus(clinic as Record<string, unknown> | null), [clinic]);

  /**
   * The platform trial policy, for the countdown banner's window.
   *
   * Read only for clinics that are actually on a trial — a paying clinic has no countdown, so
   * asking would be a Firestore read spent on an answer nothing renders. A failure falls back to
   * the built-in default rather than switching the warning off: a clinic about to go read-only
   * with no notice is the outcome this banner exists to prevent, and a settings document that
   * cannot be read is not a reason to accept it.
   */
  const [policy, setPolicy] = useState<TrialPolicy>(DEFAULT_TRIAL_POLICY);
  useEffect(() => {
    if (!trial.isTrial) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, PLATFORM_SETTINGS_COLLECTION, TRIAL_POLICY_DOC));
        if (!cancelled && snap.exists()) setPolicy(normalizeTrialPolicy(snap.data()));
      } catch {
        /* Default stands. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trial.isTrial]);

  const trialEnding = useMemo(
    () =>
      trialWarning({
        // The clinic's own `expiresAt`, never the estimate `trialStatus` derives from `createdAt`.
        // Only the stored field is what the rules will actually hold the clinic to, and warning
        // someone about a deadline nothing enforces is how a banner stops being believed.
        expiresAt: expiryDate((clinic as Record<string, unknown> | null)?.expiresAt),
        isTrial: trial.isTrial,
        policy,
      }),
    [clinic, trial.isTrial, policy],
  );

  const coach = useMemo(
    () =>
      // While the probes are still out, every mission looks unfinished. Speaking then means a
      // fully set-up clinic is greeted with "register your first patient" for a second — so the
      // coach waits for the answer rather than guessing at it.
      loading
        ? ({ speak: false, reason: "nothing-to-say" } as CoachDecision)
        : coachDecision({
            progress,
            snoozedUntil: local.snoozedUntil,
            dismissedForever: local.dismissed,
            tutorialRunning,
          }),
    [loading, progress, local.snoozedUntil, local.dismissed, tutorialRunning],
  );

  const refresh = useCallback(() => setSignalTick((n) => n + 1), []);
  /**
   * Each close buys a longer silence than the last — see `coachSnoozeMs`. Closing the bubble is
   * an answer, and asking the same question again tomorrow of somebody who has answered it three
   * times is the behaviour people mean when they say an app nags.
   */
  const snooze = useCallback(
    () => snoozeCoach(scope, Date.now() + coachSnoozeMs(local.snoozeCount)),
    [scope, local.snoozeCount],
  );
  const dismiss = useCallback(() => dismissCoach(scope), [scope]);
  const restore = useCallback(() => restoreCoach(scope), [scope]);

  const value = useMemo(
    () => ({
      loading,
      missions,
      locked,
      progress,
      trial,
      trialEnding,
      coach,
      coachDismissed: local.dismissed,
      refresh,
      snooze,
      dismiss,
      restore,
    }),
    [loading, missions, locked, progress, trial, trialEnding, coach, local.dismissed, refresh, snooze, dismiss, restore],
  );

  return <WelcomeContext.Provider value={value}>{children}</WelcomeContext.Provider>;
}

export function useWelcome() {
  const ctx = useContext(WelcomeContext);
  if (!ctx) throw new Error("useWelcome must be used within WelcomeProvider");
  return ctx;
}

/**
 * The same context, for components that render both inside and outside the dashboard shell.
 *
 * Returns `undefined` rather than throwing, so a shared component can offer the guide when it is
 * available and simply not mention it when it is not.
 */
export function useWelcomeOptional() {
  return useContext(WelcomeContext);
}
