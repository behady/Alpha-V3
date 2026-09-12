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
import { doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTutorial } from "@/context/TutorialContext";
import { useUI } from "@/context/UIContext";
import { SETTINGS_SECTIONS } from "@/config/settingsRegistry";
import { visibleSections } from "@/lib/settingsAccess";
import { hasFeature } from "@/lib/subscriptions";
import { parseClinicSchedule } from "@/lib/clinicSchedule";
import { isDentistStaff } from "@/lib/staffRoles";
import { categoryOf, suggestCategory, suggestIcon } from "@/lib/dentalIcons";
import { DEFAULT_SCHEDULE, initialServiceChoices, scheduleDocFrom, serviceDocsFrom } from "@/lib/setupWizard";
import {
  tourChaptersFor,
  tourStopsFor,
  type TourChapter,
  type TourStop,
} from "@/lib/grandTour";
import { demoValues as makeDemoValues, type DemoValues, type TourCheck, type TourOffer } from "@/lib/tourDemo";
import {
  WELCOME_CHANGED_EVENT,
  markTourComplete,
  markTourIntroSeen,
  readTourProgress,
  resetTourPosition,
  saveTourDemoMode,
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
 * The tour pauses while a lesson runs; when the lesson ends, the tour picks up on the stop it
 * left. Getting from stop to stop is NOT done here — the overlay walks there with a visible
 * cursor (see tourDemo.ts); this provider only says which stop is current and where it lives.
 *
 * This provider is also the only thing that WRITES for the tour, and only in two shapes: the
 * test-record helpers (mark the test patient unmessageable) and the two setup offers, which
 * write exactly what the setup wizard writes. Everything else Sara does goes through the real
 * buttons.
 */

export type DemoMode = "unasked" | "on" | "off";
export type HomeView = "desk" | "owner" | "chair";

interface TourContextType {
  active: boolean;
  paused: boolean;
  stops: TourStop[];
  chapters: TourChapter[];
  stop: TourStop | null;
  stopIndex: number;
  stopRoute: string | null;
  progress: TourProgress;
  /** True until this person has finished the tour once — questions are free until then. */
  firstTour: boolean;
  start: (opts?: { stopId?: string; fromStart?: boolean }) => void;
  next: () => void;
  back: () => void;
  goTo: (stopId: string) => boolean;
  leave: () => void;
  declineIntro: () => void;
  demoMode: DemoMode;
  setDemoMode: (mode: DemoMode) => void;
  demoValues: DemoValues;
  /**
   * The values a hand script should run with right now. Same as `demoValues`, except that
   * `procedureName` is checked against the clinic's price list first: when Sara's own test
   * treatment is not on it (the setup stop was skipped, or the person deleted it), the clinic's
   * first real service stands in, so the procedure demo always picks something that exists.
   * `serviceName` itself never changes — it is what the cleanup deletes.
   */
  liveDemoValues: () => Promise<DemoValues>;
  firstPatientName: string | null;
  resolveDemoPatient: () => Promise<string | null>;
  markDemoPatient: () => Promise<boolean>;
  /** Facts an `if` action asks about. */
  check: (name: TourCheck) => Promise<boolean>;
  /** Performs an accepted offer: the wizard's own documents, nothing else. */
  applyOffer: (offer: TourOffer) => Promise<boolean>;
  /** Switch the home screen for a demo; `restoreHomeView` puts the person's own choice back. */
  setHomeView: (view: HomeView) => void;
  restoreHomeView: () => void;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

export function TourProvider({
  children,
  visibleNavKeys,
  showSettings,
}: {
  children: React.ReactNode;
  visibleNavKeys: readonly string[];
  showSettings: boolean;
}) {
  const { clinic, clinicId, isAdmin, isReadOnly } = useClinic();
  const { user } = useAuth();
  const { language } = useLanguage();
  const { activeTutorial } = useTutorial();
  const ui = useUI();

  const scope: WelcomeScope = useMemo(() => ({ clinicId, uid: user?.uid }), [clinicId, user?.uid]);

  const stops = useMemo(() => {
    const viewer = { isAdmin, isReadOnly, role: user?.role, permissions: user?.permissions };
    const settingsIds = visibleSections(SETTINGS_SECTIONS, viewer, (f) =>
      hasFeature(clinic, f as Parameters<typeof hasFeature>[1]),
    ).map((s) => s.id);
    return tourStopsFor({ isAdmin, visibleNavKeys, showSettings, visibleSettingsIds: settingsIds });
  }, [isAdmin, isReadOnly, user?.role, user?.permissions, clinic, visibleNavKeys, showSettings]);

  const chapters = useMemo(() => tourChaptersFor(stops), [stops]);

  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stopIndex, setStopIndex] = useState(0);
  const direction = useRef<1 | -1>(1);

  /* --- demos ------------------------------------------------------------------------------ */
  const [demoMode, setDemoModeState] = useState<DemoMode>(() => readTourProgress(scope).demoMode);
  useEffect(() => {
    setDemoModeState(readTourProgress(scope).demoMode);
  }, [scope]);
  const [demoValues, setDemoValues] = useState<DemoValues>(() => makeDemoValues(language === "ar", clinicId));
  const setDemoMode = useCallback(
    (mode: DemoMode) => {
      if (mode === "on") setDemoValues(makeDemoValues(language === "ar", clinicId));
      setDemoModeState(mode);
      saveTourDemoMode(scope, mode);
    },
    [language, scope, clinicId],
  );

  const resolveDemoPatient = useCallback(async (): Promise<string | null> => {
    if (!clinicId) return null;
    try {
      const snap = await getDocs(query(getClinicCollection("patients"), where("name", "==", demoValues.patientName), limit(1)));
      return snap.empty ? null : snap.docs[0].id;
    } catch {
      return null;
    }
  }, [clinicId, demoValues.patientName]);

  const markDemoPatient = useCallback(async (): Promise<boolean> => {
    const id = await resolveDemoPatient();
    if (!id) return false;
    try {
      await updateDoc(getClinicDoc("patients", id), { whatsappOptOut: true, isTourDemo: true });
      return true;
    } catch {
      return false;
    }
  }, [resolveDemoPatient]);

  const liveDemoValues = useCallback(async (): Promise<DemoValues> => {
    if (!clinicId) return demoValues;
    try {
      const own = await getDocs(query(getClinicCollection("services"), where("name", "==", demoValues.serviceName), limit(1)));
      if (!own.empty) return demoValues;
      const first = await getDocs(query(getClinicCollection("services"), orderBy("name"), limit(1)));
      const data = first.docs[0]?.data() as { name?: unknown; price?: unknown } | undefined;
      if (typeof data?.name === "string" && data.name.trim()) {
        return { ...demoValues, procedureName: data.name.trim() };
      }
    } catch {
      /* Fall through to the fixed values. */
    }
    return demoValues;
  }, [clinicId, demoValues]);

  /* --- facts about the clinic, for `if` actions ------------------------------------------ */
  const check = useCallback(
    async (name: TourCheck): Promise<boolean> => {
      if (!clinicId) return false;
      try {
        switch (name) {
          case "isAdmin":
            return isAdmin;
          case "anyService": {
            const snap = await getDocs(query(getClinicCollection("services"), limit(1)));
            return !snap.empty;
          }
          case "scheduleSet": {
            const snap = await getDoc(getClinicDoc("settings", "clinic_info"));
            return parseClinicSchedule(snap.data()).isConfigured;
          }
          case "anyDentist": {
            const snap = await getDocs(query(getClinicCollection("staff"), limit(60)));
            return snap.docs.some((d) => isDentistStaff(d.data() as Parameters<typeof isDentistStaff>[0]));
          }
          case "demoDentistExists": {
            const snap = await getDocs(query(getClinicCollection("staff"), where("name", "==", demoValues.dentistName), limit(1)));
            return !snap.empty;
          }
          case "demoPatientExists":
            return !!(await resolveDemoPatient());
          case "demoAppointmentExists": {
            const id = await resolveDemoPatient();
            if (!id) return false;
            const snap = await getDocs(query(getClinicCollection("appointments"), where("patientId", "==", id), limit(1)));
            return !snap.empty;
          }
        }
      } catch {
        return false;
      }
      return false;
    },
    [clinicId, isAdmin, demoValues.dentistName, resolveDemoPatient],
  );

  /* --- the two real writes: exactly what the setup wizard writes ------------------------- */
  const applyOffer = useCallback(
    async (offer: TourOffer): Promise<boolean> => {
      if (!clinicId || !isAdmin) return false;
      try {
        if (offer === "defaultHours") {
          await setDoc(
            getClinicDoc("settings", "clinic_info"),
            { schedule: scheduleDocFrom({ ...DEFAULT_SCHEDULE, offDays: [...DEFAULT_SCHEDULE.offDays] }), updatedAt: new Date().toISOString() },
            { merge: true },
          );
          return true;
        }
        // Starter price list, in the tour's language, categorised the way the wizard does it.
        const docs = serviceDocsFrom(initialServiceChoices(), language === "ar" ? "ar" : "en");
        if (docs.length === 0) return false;
        const batch = writeBatch(db);
        const col = getClinicCollection("services");
        for (const { englishName, doc: fields } of docs) {
          const category = suggestCategory(englishName);
          const icon = suggestIcon(englishName) || categoryOf(category).icon;
          batch.set(doc(col), { ...fields, category, icon, seededBy: "sara-tour" });
        }
        await batch.commit();
        return true;
      } catch {
        return false;
      }
    },
    [clinicId, isAdmin, language],
  );

  /* --- home screen switching -------------------------------------------------------------- */
  const originalHomeView = useRef<HomeView | null>(null);
  const setHomeView = useCallback(
    (view: HomeView) => {
      if (originalHomeView.current === null) originalHomeView.current = ui.homeView;
      ui.setHomeView(view);
    },
    [ui],
  );
  const restoreHomeView = useCallback(() => {
    if (originalHomeView.current !== null) {
      ui.setHomeView(originalHomeView.current);
      originalHomeView.current = null;
    }
  }, [ui]);

  /* --- dynamic stops ---------------------------------------------------------------------- */
  const [firstPatientId, setFirstPatientId] = useState<string | null | undefined>(undefined);
  const [firstPatientName, setFirstPatientName] = useState<string | null>(null);
  useEffect(() => {
    setFirstPatientId(undefined);
    setFirstPatientName(null);
  }, [clinicId, demoMode]);
  const [demoPatientId, setDemoPatientId] = useState<string | null | undefined>(undefined);

  const stop = active ? (stops[stopIndex] ?? null) : null;

  const stopRoute = useMemo(() => {
    if (!stop) return null;
    if (stop.dynamic === "firstPatient") return firstPatientId ? `/patients/${firstPatientId}` : null;
    if (stop.dynamic === "demoPatient") {
      return demoPatientId ? `/patients/${demoPatientId}${stop.demoPatientTab ? `?tab=${stop.demoPatientTab}` : ""}` : null;
    }
    return stop.route;
  }, [stop, firstPatientId, demoPatientId]);

  useEffect(() => {
    if (!stop || stop.dynamic !== "firstPatient" || firstPatientId !== undefined || !clinicId) return;
    let cancelled = false;
    void (async () => {
      try {
        const demo = demoMode === "on" ? await resolveDemoPatient() : null;
        if (demo) {
          if (!cancelled) {
            setFirstPatientName(demoValues.patientName);
            setFirstPatientId(demo);
          }
          return;
        }
        const snap = await getDocs(query(getClinicCollection("patients"), orderBy("name"), limit(1)));
        if (!cancelled) {
          const d = snap.empty ? null : snap.docs[0];
          const name = d ? String((d.data() as { name?: unknown }).name ?? "") : "";
          setFirstPatientName(name || null);
          setFirstPatientId(d ? d.id : null);
        }
      } catch {
        if (!cancelled) setFirstPatientId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stop, firstPatientId, clinicId, demoMode, resolveDemoPatient, demoValues.patientName]);

  useEffect(() => {
    if (!stop || stop.dynamic !== "demoPatient") return;
    let cancelled = false;
    setDemoPatientId(undefined);
    void (async () => {
      const id = await resolveDemoPatient();
      if (!cancelled) setDemoPatientId(id);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop?.id, active]);

  /** Stops that cannot be shown are passed over in the travel direction. */
  useEffect(() => {
    if (!active || !stop) return;
    let skip = false;
    if (stop.demoOnly && demoMode !== "on") skip = true;
    else if (stop.dynamic === "firstPatient") {
      if (firstPatientId === undefined) return;
      skip = !firstPatientId;
    } else if (stop.dynamic === "demoPatient") {
      if (demoPatientId === undefined) return;
      skip = !demoPatientId;
    }
    if (!skip) return;
    setStopIndex((i) => {
      const n = i + direction.current;
      if (n < 0) return 0;
      if (n >= stops.length) {
        markTourComplete(scope);
        setActive(false);
        return 0;
      }
      return n;
    });
  }, [active, stop, demoMode, firstPatientId, demoPatientId, stops.length, scope]);

  useEffect(() => {
    if (!active || paused || !stop) return;
    saveTourPosition(scope, stop.id);
  }, [active, paused, stop, scope]);

  useEffect(() => {
    if (!active) return;
    if (activeTutorial) setPaused(true);
    else if (paused) setPaused(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTutorial, active]);

  // Leaving the tour (any way) puts the home screen back.
  useEffect(() => {
    if (!active) restoreHomeView();
  }, [active, restoreHomeView]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, localTick],
  );
  const firstTour = progress.completedAt === 0;

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
      active, paused, stops, chapters, stop, stopIndex, stopRoute, progress, firstTour,
      start, next, back, goTo, leave, declineIntro,
      demoMode, setDemoMode, demoValues, liveDemoValues, firstPatientName,
      resolveDemoPatient, markDemoPatient, check, applyOffer, setHomeView, restoreHomeView,
    }),
    [
      active, paused, stops, chapters, stop, stopIndex, stopRoute, progress, firstTour,
      start, next, back, goTo, leave, declineIntro,
      demoMode, setDemoMode, demoValues, liveDemoValues, firstPatientName,
      resolveDemoPatient, markDemoPatient, check, applyOffer, setHomeView, restoreHomeView,
    ],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within TourProvider");
  return ctx;
}

export function useTourOptional() {
  return useContext(TourContext);
}
