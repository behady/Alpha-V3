"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { getDocs, limit, orderBy, query } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useTutorial } from "@/context/TutorialContext";
import { SETTINGS_SECTIONS } from "@/config/settingsRegistry";
import { visibleSections } from "@/lib/settingsAccess";
import { hasFeature } from "@/lib/subscriptions";
import {
  tourChaptersFor,
  tourStopsFor,
  type TourChapter,
  type TourStop,
} from "@/lib/grandTour";
import {
  WELCOME_CHANGED_EVENT,
  markTourComplete,
  markTourIntroSeen,
  readTourProgress,
  resetTourPosition,
  saveTourPosition,
  type TourProgress,
  type WelcomeScope,
} from "@/lib/welcomeStore";

/**
 * Where Sara is in the tour, and who she is showing around.
 *
 * The tour spans every route in the app, so its state cannot live in the overlay that draws it
 * or the page that started it. It lives here, mounted once in the dashboard layout, and four
 * parties talk to it: the intro screen and the welcome page start it, the overlay renders and
 * advances it, the chat widget can jump it to a stop the model chose, and the layout hides the
 * things that would talk over it.
 *
 * Position IS persisted (unlike a lesson's), because the tour is long and a person who closes
 * the tab at stop twenty-three of fifty has not abandoned it — they have gone to lunch. The
 * resume point is per clinic and per person, in the same local store as the rest of the welcome
 * guide, and "start over" is always one click away.
 *
 * The tour pauses while a lesson runs. Sara offers lessons as she goes ("teach me to add a
 * patient" mid-tour starts the ring), and a spotlight over a pulsing ring would be two guides
 * pointing at once. When the lesson ends, the tour picks up on the stop it left.
 */

interface TourContextType {
  /** Whether the tour is on screen (paused for a lesson still counts as active). */
  active: boolean;
  /** A lesson is running on top; the overlay renders nothing until it ends. */
  paused: boolean;
  /** The stops this person can be shown, in order. */
  stops: TourStop[];
  chapters: TourChapter[];
  stop: TourStop | null;
  stopIndex: number;
  /** The route the current stop resolved to — the dynamic ones differ from `stop.route`. */
  stopRoute: string | null;
  progress: TourProgress;
  /** Begins at the resume point, or at `stopId`, or at the top. */
  start: (opts?: { stopId?: string; fromStart?: boolean }) => void;
  next: () => void;
  back: () => void;
  goTo: (stopId: string) => boolean;
  /** Leaves the tour, remembering where it was. */
  leave: () => void;
  /** Closes the intro without starting. */
  declineIntro: () => void;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

export function TourProvider({
  children,
  visibleNavKeys,
  showSettings,
}: {
  children: React.ReactNode;
  /** Nav keys the layout actually renders for this person. */
  visibleNavKeys: readonly string[];
  showSettings: boolean;
}) {
  const { clinic, clinicId, isAdmin, isReadOnly } = useClinic();
  const { user } = useAuth();
  const { activeTutorial } = useTutorial();
  const router = useRouter();
  const pathname = usePathname();

  const scope: WelcomeScope = useMemo(() => ({ clinicId, uid: user?.uid }), [clinicId, user?.uid]);

  const stops = useMemo(() => {
    const viewer = { isAdmin, isReadOnly, role: user?.role, permissions: user?.permissions };
    const settingsIds = visibleSections(SETTINGS_SECTIONS, viewer, (f) =>
      hasFeature(clinic, f as Parameters<typeof hasFeature>[1]),
    ).map((s) => s.id);
    return tourStopsFor({
      isAdmin,
      visibleNavKeys,
      showSettings,
      visibleSettingsIds: settingsIds,
    });
  }, [isAdmin, isReadOnly, user?.role, user?.permissions, clinic, visibleNavKeys, showSettings]);

  const chapters = useMemo(() => tourChaptersFor(stops), [stops]);

  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stopIndex, setStopIndex] = useState(0);
  /** Which way the last move went, so a stop that cannot be shown is skipped onward, not back. */
  const direction = useRef<1 | -1>(1);

  /**
   * The first patient on file, for the "a patient's file" stop. Three states: unknown (not yet
   * asked), null (asked, the clinic has none), or an id. Asked once per clinic; a fresh clinic
   * with no patients simply skips that stop.
   */
  const [firstPatientId, setFirstPatientId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setFirstPatientId(undefined);
  }, [clinicId]);

  // Re-read the local marks whenever anything writes them.
  const [localTick, setLocalTick] = useState(0);
  useEffect(() => {
    const onChanged = () => setLocalTick((n) => n + 1);
    window.addEventListener(WELCOME_CHANGED_EVENT, onChanged);
    window.addEventListener("storage", onChanged);
    return () => {
      window.removeEventListener(WELCOME_CHANGED_EVENT, onChanged);
      window.removeEventListener("storage", onChanged);
    };
  }, []);
  const progress = useMemo(
    () => readTourProgress(scope),
    // localTick is the whole point: the store is not React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, localTick],
  );

  const stop = active ? (stops[stopIndex] ?? null) : null;

  const stopRoute = useMemo(() => {
    if (!stop) return null;
    if (stop.dynamic === "firstPatient") {
      return firstPatientId ? `/patients/${firstPatientId}` : null;
    }
    return stop.route;
  }, [stop, firstPatientId]);

  /** Resolve the dynamic stop's data the moment it is reached. */
  useEffect(() => {
    if (!stop || stop.dynamic !== "firstPatient" || firstPatientId !== undefined || !clinicId) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDocs(query(getClinicCollection("patients"), orderBy("name"), limit(1)));
        if (!cancelled) setFirstPatientId(snap.empty ? null : snap.docs[0].id);
      } catch {
        if (!cancelled) setFirstPatientId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stop, firstPatientId, clinicId]);

  /** A stop whose route cannot be resolved (no patient yet) is passed over in the travel direction. */
  useEffect(() => {
    if (!stop || !stop.dynamic) return;
    if (firstPatientId === undefined) return; // still asking
    if (firstPatientId) return; // resolved, show it
    setStopIndex((i) => {
      const n = i + direction.current;
      if (n < 0) return 0;
      if (n >= stops.length) return i; // nowhere to go; the overlay's Next will finish
      return n;
    });
  }, [stop, firstPatientId, stops.length]);

  /** Go where the stop lives, and remember being here. */
  useEffect(() => {
    if (!active || paused || !stop || !stopRoute) return;
    saveTourPosition(scope, stop.id);
    if (pathname !== stopRoute) router.push(stopRoute);
    // pathname deliberately absent: arriving is the result of the push, not a reason to re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paused, stop, stopRoute, scope, router]);

  /** A lesson on top pauses the tour; its end resumes it on the same stop. */
  useEffect(() => {
    if (!active) return;
    if (activeTutorial) {
      setPaused(true);
    } else if (paused) {
      setPaused(false);
      if (stopRoute && pathname !== stopRoute) router.push(stopRoute);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTutorial, active]);

  const start = useCallback(
    (opts?: { stopId?: string; fromStart?: boolean }) => {
      if (stops.length === 0) return;
      let index = 0;
      if (opts?.stopId) {
        const i = stops.findIndex((s) => s.id === opts.stopId);
        if (i >= 0) index = i;
      } else if (!opts?.fromStart) {
        const last = readTourProgress(scope).lastStopId;
        const i = last ? stops.findIndex((s) => s.id === last) : -1;
        if (i >= 0) index = i;
      }
      if (opts?.fromStart) resetTourPosition(scope);
      markTourIntroSeen(scope);
      direction.current = 1;
      setStopIndex(index);
      setPaused(false);
      setActive(true);
    },
    [stops, scope],
  );

  const leave = useCallback(() => {
    setActive(false);
    setPaused(false);
  }, []);

  const next = useCallback(() => {
    direction.current = 1;
    setStopIndex((i) => {
      if (i >= stops.length - 1) {
        markTourComplete(scope);
        setActive(false);
        return 0;
      }
      return i + 1;
    });
  }, [stops.length, scope]);

  const back = useCallback(() => {
    direction.current = -1;
    setStopIndex((i) => Math.max(0, i - 1));
  }, []);

  const goTo = useCallback(
    (stopId: string): boolean => {
      const i = stops.findIndex((s) => s.id === stopId);
      if (i < 0) return false;
      direction.current = i >= stopIndex ? 1 : -1;
      markTourIntroSeen(scope);
      setStopIndex(i);
      setPaused(false);
      setActive(true);
      return true;
    },
    [stops, stopIndex, scope],
  );

  const declineIntro = useCallback(() => markTourIntroSeen(scope), [scope]);

  const value = useMemo<TourContextType>(
    () => ({
      active,
      paused,
      stops,
      chapters,
      stop,
      stopIndex,
      stopRoute,
      progress,
      start,
      next,
      back,
      goTo,
      leave,
      declineIntro,
    }),
    [active, paused, stops, chapters, stop, stopIndex, stopRoute, progress, start, next, back, goTo, leave, declineIntro],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within TourProvider");
  return ctx;
}

/** For components that render both inside and outside the dashboard shell. */
export function useTourOptional() {
  return useContext(TourContext);
}
