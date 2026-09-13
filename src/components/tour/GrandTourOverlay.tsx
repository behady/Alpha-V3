"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Footprints,
  Hand,
  Languages,
  ListTree,
  Loader2,
  Minus,
  Play,
  Send,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import AvatarFace, { type AvatarState } from "@/components/appointments/AvatarFace";
import TourCursor from "@/components/tour/TourCursor";
import { useTour } from "@/context/TourContext";
import { useTutorial } from "@/context/TutorialContext";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { auth } from "@/lib/firebase";
import { TOUR_GUIDE, type Localized, type TourStop } from "@/lib/grandTour";
import { navPlanFor, stopRouteMatches, type DemoAction, type TourOffer } from "@/lib/tourDemo";
import { findAnchorInRowContaining, findFirstVisibleAnchor } from "@/lib/tourDom";
import { toSpeechText, trimForSpeech } from "@/lib/speechText";
import { useTourRunner, type Pace } from "@/lib/useTourRunner";

/**
 * Sara on screen.
 *
 * Layers, bottom to top: a dimmed sheet with one bright window cut out (the spotlight — it does
 * NOT catch clicks: the page stays live under it), her hand (a cursor that walks to what she is
 * about to touch), and her panel — full while she talks and takes questions, a one-line caption
 * while her hand is working.
 *
 * A stop plays out in phases:
 *   navigating — her hand walks to the page the way a person would.
 *   narrating  — the stop's line, typed (and spoken, if voice is on).
 *   walk       — she shrinks to a caption; the hand points at each part of the screen.
 *   asking     — once, whether she may add and delete real test records.
 *   demo       — the hand does the thing for real, narrated step by step.
 *   done       — chips and the question box.
 *
 * The person is never locked out. Click anything yourself while her hand is moving and she
 * stops where she is and asks whether to carry on — Continue picks up at the very action she
 * was on. "Let me look" shrinks her to a pill until you are ready. Pacing is theirs too: auto
 * moves on when a line has been read; step waits for Next after every line.
 *
 * Voice is sequence-guarded: one line at a time, and a reply that arrives after the tour moved
 * on is dropped. Questions cost one credit each — except during a person's first tour, when the
 * server does not charge them (it tells the widget so, and the placeholder says so).
 */

const POLL_MS = 250;
const SPOT_PAD = 10;
const TYPE_MS_PER_CHAR = 16;
const VOICE_KEY = "alphaTourVoice";
const PACE_KEY = "alphaTourPace";
const HISTORY_TURNS = 8;

type Phase = "idle" | "navigating" | "narrating" | "walk" | "asking" | "demo" | "done";
type HandPhase = "walk" | "demo";

interface QaMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  stopId: string;
}

function readPref(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* fine */
  }
}

/** Reveals `text` a character at a time. Clicking the text (or a key change) shows all of it. */
function useTypewriter(text: string, key: string) {
  const [shown, setShown] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setShown("");
    setDone(false);
    if (!text) {
      setDone(true);
      return;
    }
    let i = 0;
    const timer = setInterval(() => {
      i = Math.min(text.length, i + 2);
      setShown(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(timer);
        setDone(true);
      }
    }, TYPE_MS_PER_CHAR);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const finish = useCallback(() => {
    setShown(text);
    setDone(true);
  }, [text]);
  return { shown, done, finish };
}

export default function GrandTourOverlay() {
  const tour = useTour();
  const { startTutorial } = useTutorial();
  const { language, isRTL, toggleLanguage } = useLanguage();
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const { showToast } = useUI();
  const router = useRouter();
  const pathname = usePathname();
  const isAr = language === "ar";
  const guideName = isAr ? TOUR_GUIDE.ar : TOUR_GUIDE.en;

  const { active, paused, stop, stopIndex, stops, chapters, demoMode } = tour;
  const shownStops = useMemo(() => stops.filter((s) => !s.demoOnly || demoMode === "on"), [stops, demoMode]);
  const total = shownStops.length;
  const shownIndex = Math.max(0, stop ? shownStops.findIndex((s) => s.id === stop.id) : 0);
  const isLast = stopIndex >= stops.length - 1;

  /* --- preferences: voice, pace ----------------------------------------------------------- */
  const [voiceOn, setVoiceOn] = useState(false);
  const [pace, setPaceState] = useState<Pace>("auto");
  const paceRef = useRef<Pace>("auto");
  useEffect(() => {
    setVoiceOn(readPref(VOICE_KEY, "off") === "on");
    const p = readPref(PACE_KEY, "auto") === "step" ? "step" : "auto";
    setPaceState(p);
    paceRef.current = p;
  }, []);
  const setPace = (p: Pace) => {
    paceRef.current = p;
    setPaceState(p);
    writePref(PACE_KEY, p);
    if (p === "auto") runnerRef.current?.pressNext();
  };

  /* --- voice ------------------------------------------------------------------------------ */
  const [fetchingVoice, setFetchingVoice] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCache = useRef<Map<string, string>>(new Map());
  const speakSeq = useRef(0);
  const pendingResolve = useRef<(() => void) | null>(null);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;

  const stopSpeaking = useCallback(() => {
    speakSeq.current += 1;
    const a = audioRef.current;
    if (a) {
      try {
        a.pause();
      } catch {
        /* ignore */
      }
      audioRef.current = null;
    }
    setSpeaking(false);
    pendingResolve.current?.();
    pendingResolve.current = null;
  }, []);

  const speakAsync = useCallback(
    async (text: string): Promise<void> => {
      if (!voiceOnRef.current || !clinicId) return;
      const spoken = trimForSpeech(toSpeechText(text, isAr), 600);
      if (!spoken) return;
      stopSpeaking();
      const seq = speakSeq.current;
      const cacheKey = `${isAr ? "ar" : "en"}::${spoken}`;
      let src = audioCache.current.get(cacheKey) ?? null;
      if (!src) {
        setFetchingVoice(true);
        try {
          const idToken = await auth.currentUser?.getIdToken();
          if (!idToken) return;
          const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
            // Tour speech never carries clinic data (fixed narration, or an answer from the shared
            // notes), so the server may keep it for every clinic.
            body: JSON.stringify({ clinicId, text: spoken, language: isAr ? "ar" : "en", shared: true }),
          });
          if (res.status === 403 || res.status === 429) {
            setVoiceOn(false);
            writePref(VOICE_KEY, "off");
            showToast(
              res.status === 403
                ? isAr ? "الصوت جزء من المساعد الذكي — متاح في باقات Pro وPremium." : "Voice is part of the AI assistant — available on Pro and Premium plans."
                : isAr ? "رصيد الصوت للشهر ده خلص. الجولة هتكمل مكتوبة." : "This month's voice allowance is used up. The tour continues in text.",
              "info",
            );
            return;
          }
          if (!res.ok) return;
          const data = await res.json();
          src = `data:${data.mimeType || "audio/wav"};base64,${data.audio}`;
          audioCache.current.set(cacheKey, src);
        } catch {
          return;
        } finally {
          setFetchingVoice(false);
        }
      }
      if (seq !== speakSeq.current) return;
      await new Promise<void>((resolve) => {
        const audio = new Audio(src as string);
        audioRef.current = audio;
        pendingResolve.current = resolve;
        const finish = () => {
          if (pendingResolve.current === resolve) pendingResolve.current = null;
          setSpeaking(false);
          resolve();
        };
        audio.onplay = () => setSpeaking(true);
        audio.onended = finish;
        audio.onerror = finish;
        void audio.play().catch(finish);
      });
    },
    [clinicId, isAr, stopSpeaking, showToast],
  );

  /* --- offers (real setup writes, after a yes) ------------------------------------------- */
  const [offer, setOffer] = useState<{ offer: TourOffer; say: Localized; resolve: (yes: boolean) => void } | null>(null);
  const askOffer = useCallback(
    (o: TourOffer, say: Localized) =>
      new Promise<boolean>((resolve) => {
        setOffer({ offer: o, say, resolve });
      }),
    [],
  );
  const answerOffer = (yes: boolean) => {
    offer?.resolve(yes);
    setOffer(null);
  };

  /* --- the hand --------------------------------------------------------------------------- */
  const navigate = useCallback((path: string) => router.push(path), [router]);
  const runner = useTourRunner({
    isAr,
    speak: speakAsync,
    navigate,
    resolveDemoPatient: tour.resolveDemoPatient,
    markDemoPatient: tour.markDemoPatient,
    check: tour.check,
    askOffer,
    applyOffer: tour.applyOffer,
    setHomeView: tour.setHomeView,
    getPace: () => paceRef.current,
  });
  const runnerRef = useRef(runner);
  runnerRef.current = runner;

  /* --- the stop's life -------------------------------------------------------------------- */
  const [phase, setPhase] = useState<Phase>("idle");
  const [failureLine, setFailureLine] = useState<string | null>(null);
  /** Where the hand stopped when the person took over, so Continue resumes there. */
  const [takeover, setTakeover] = useState<{ actions: DemoAction[]; index: number; phase: HandPhase } | null>(null);
  const takeoverRef = useRef<typeof takeover>(null);
  takeoverRef.current = takeover;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const resolvedRoute = tour.stopRoute;
  const dynamicReady = !stop?.dynamic || !!resolvedRoute;

  useEffect(() => {
    if (!active || paused || !stop) {
      runnerRef.current.abort();
      stopSpeaking();
      setPhase("idle");
      setTakeover(null);
      return;
    }
    setFailureLine(null);
    setTakeover(null);
    setOffer(null);
    setPhase("navigating");
    if (!dynamicReady) return;
    let cancelled = false;
    void (async () => {
      if (!stopRouteMatches(stop, pathnameRef.current, resolvedRoute)) {
        const targetName = stop.dynamic === "demoPatient" ? tour.demoValues.patientName : tour.firstPatientName;
        const plan = navPlanFor(stop, resolvedRoute, targetName);
        const values = { ...tour.demoValues, targetPatientName: targetName ?? tour.demoValues.patientName };
        const r = plan.length > 0 ? await runnerRef.current.run(plan, values) : { outcome: "failed" as const, index: 0 };
        if (cancelled || r.outcome === "aborted") return;
        if (r.outcome === "failed") {
          const target = resolvedRoute ?? stop.route;
          if (target && !stopRouteMatches(stop, pathnameRef.current, resolvedRoute)) router.push(target);
        }
      }
      if (!cancelled) setPhase("narrating");
    })();
    return () => {
      cancelled = true;
      runnerRef.current.abort();
      stopSpeaking();
      // A stop that switched the home screen gives it back on the way out.
      tour.restoreHomeView();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paused, stop?.id, dynamicReady, resolvedRoute]);

  /* --- what she is saying ----------------------------------------------------------------- */
  const stopLine = stop ? (isAr ? stop.say.ar : stop.say.en) : "";
  const subLine = runner.state.say ? (isAr ? runner.state.say.ar : runner.state.say.en) : null;
  const displayed = phase === "navigating" ? "" : subLine ?? failureLine ?? stopLine;
  const typed = useTypewriter(displayed, `${stop?.id ?? ""}:${language}:${displayed}`);

  useEffect(() => {
    if (phase !== "narrating" || !stop) return;
    void speakAsync(stopLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stop?.id]);

  const failed = useCallback(() => {
    setFailureLine(
      isAr
        ? "الخطوة دي معدّتش — يا إما صلاحيتك مش بتسمح، أو الشاشة اتغيرت. لو فضل حاجة باسمي، هتلاقيها في الإعدادات ← المحذوفات. نكمّل."
        : "That step didn't go through — your role may not allow it, or the screen has changed. If anything of mine is left behind, it is named after me and sits in Recently Deleted. Let's carry on.",
    );
  }, [isAr]);

  /** Runs a hand script for a phase; a takeover parks it for Continue. */
  const runHand = useCallback(
    async (s: TourStop, actions: DemoAction[], which: HandPhase, from = 0): Promise<"done" | "failed" | "aborted"> => {
      setPhase(which);
      const values = which === "demo" ? await tour.liveDemoValues() : tour.demoValues;
      const r = await runnerRef.current.run(actions, values, from);
      if (r.outcome === "aborted") {
        // Aborted by the person's own click (a stop change clears takeover in its effect).
        if (takeoverRef.current === null && userClickRef.current) {
          setTakeover({ actions, index: r.index, phase: which });
          userClickRef.current = false;
        }
        return "aborted";
      }
      if (r.outcome === "failed") failed();
      return r.outcome;
    },
    [tour.demoValues, tour.liveDemoValues, failed],
  );

  const runDemo = useCallback(
    async (s: TourStop, from = 0) => {
      if (!s.demo) return;
      if (from === 0) {
        if (s.dynamic === "demoPatient") {
          // The file's title arrives with its data: give it a few seconds before deciding whose
          // file this is, or a slow load reads as a stranger's file.
          const headingIsTestPatient = async () => {
            const deadline = Date.now() + 8000;
            for (;;) {
              const heading = (document.querySelector("h1")?.textContent || "").trim();
              if (heading.includes(tour.demoValues.patientName)) return true;
              if (Date.now() > deadline) return false;
              await new Promise((r) => setTimeout(r, 250));
            }
          };
          if (!(await headingIsTestPatient())) {
            setFailureLine(isAr ? "دي مش ملف المريض التجريبي بتاعي، فمش هلمس حاجة هنا. نكمّل." : "This isn't my test patient's file, so I won't touch anything here. Let's carry on.");
            setPhase("done");
            return;
          }
        }
        if (s.demoSkipIf) {
          const exists =
            s.demoSkipIf === "serviceRowExists"
              ? !!findAnchorInRowContaining("price-row-delete", tour.demoValues.serviceName)
              : await tour.check(s.demoSkipIf);
          if (exists) {
            setFailureLine(isAr ? "أنا عملت ده قبل كده في جولة سابقة، فمش هعمله تاني — نكمّل." : "I already did this on an earlier run of the tour, so I won't make a second one — let's carry on.");
            setPhase("done");
            return;
          }
        }
      }
      const outcome = await runHand(s, s.demo, "demo", from);
      if (outcome !== "aborted") setPhase("done");
    },
    [tour, isAr, runHand],
  );

  const afterWalk = useCallback(
    (s: TourStop) => {
      if (s.demo && demoMode === "on") void runDemo(s);
      else if (s.demo && demoMode === "unasked") setPhase("asking");
      else setPhase("done");
    },
    [demoMode, runDemo],
  );

  const runWalk = useCallback(
    async (s: TourStop, from = 0) => {
      if (!s.walk || s.walk.length === 0) {
        afterWalk(s);
        return;
      }
      const outcome = await runHand(s, s.walk, "walk", from);
      if (outcome === "aborted") return;
      afterWalk(s);
    },
    [afterWalk, runHand],
  );

  useEffect(() => {
    if (phase !== "narrating" || !typed.done || !stop) return;
    void runWalk(stop);
  }, [phase, typed.done, stop, runWalk]);

  const answerDemo = (yes: boolean) => {
    tour.setDemoMode(yes ? "on" : "off");
    if (yes && stop) void runDemo(stop);
    else setPhase("done");
  };

  const skipHand = () => {
    runnerRef.current.abort();
    stopSpeaking();
    setTakeover(null);
    setPhase("done");
  };

  /** The person clicked something themselves while the hand was moving: stop and ask. */
  const userClickRef = useRef(false);
  useEffect(() => {
    if (!active || paused) return;
    const onClick = (e: MouseEvent) => {
      if (!e.isTrusted) return; // the hand's own clicks
      const target = e.target as HTMLElement | null;
      if (!target || target.closest("[data-tour-chrome]")) return;
      if (!runnerRef.current.state.running) return;
      userClickRef.current = true;
      runnerRef.current.abort();
      stopSpeaking();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, paused, stopSpeaking]);

  const continueHand = () => {
    if (!takeover || !stop) return;
    const t = takeover;
    setTakeover(null);
    if (t.phase === "walk") void runWalk(stop, t.index);
    else void runDemo(stop, t.index);
  };

  /* --- the spotlight ---------------------------------------------------------------------- */
  const [rect, setRect] = useState<DOMRect | null>(null);
  const scrolledFor = useRef<string | null>(null);
  const runnerAnchor = runner.state.anchor;
  const runnerTarget = runner.state.target;
  useEffect(() => {
    if (!active || paused || !stop) return;
    let raf = 0;
    const anchors = runnerAnchor ? [runnerAnchor, "page-main"] : [...(stop.spot ?? []), "page-main"];
    const measure = () => {
      if (runnerTarget && runnerTarget.isConnected) {
        const r = runnerTarget.getBoundingClientRect();
        if (r.width >= 2 || r.height >= 2) {
          setRect(r);
          return;
        }
      }
      const found = findFirstVisibleAnchor(anchors);
      if (!found) {
        setRect(null);
        return;
      }
      const key = `${stop.id}:${runnerAnchor ?? ""}`;
      if (scrolledFor.current !== key && !runnerAnchor) {
        scrolledFor.current = key;
        const r = found.rect;
        if (r.top < 0 || r.bottom > window.innerHeight) {
          try {
            found.el.scrollIntoView({ block: "center", behavior: "smooth" });
          } catch {
            /* ignore */
          }
        }
      }
      setRect(found.rect);
    };
    measure();
    const interval = setInterval(measure, POLL_MS);
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      clearInterval(interval);
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [active, paused, stop, runnerAnchor, runnerTarget]);

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    voiceOnRef.current = next;
    writePref(VOICE_KEY, next ? "on" : "off");
    if (!next) stopSpeaking();
    else if (displayed) void speakAsync(displayed);
  };

  /* --- questions -------------------------------------------------------------------------- */
  const [qa, setQa] = useState<QaMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) setQa([]);
  }, [active]);
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [qa.length, asking]);

  const ask = useCallback(
    async (text: string, standalone = false) => {
      const prompt = text.trim();
      if (!prompt || asking || !stop || !clinicId) return;
      setQuestion("");
      const userMsg: QaMessage = { id: `${Date.now()}u`, role: "user", content: prompt, stopId: stop.id };
      // Context is this stop's own exchange only. A suggested chip is a standalone question: it
      // goes without history so the server can answer it from the shared cache, for free.
      const history = standalone
        ? []
        : qa.filter((m) => m.stopId === stop.id).slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content }));
      setQa((q) => [...q, userMsg]);
      setAsking(true);
      stopSpeaking();
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error(isAr ? "انتهت الجلسة. سجّل الدخول تاني." : "Session expired. Please sign in again.");
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            prompt,
            clinicId,
            userName: user?.name,
            client: "web-tour",
            assistantMode: "trainer",
            language: isAr ? "ar" : "en",
            tour: { stopId: stop.id, firstTour: tour.firstTour },
            tourStopIds: stops.map((s) => s.id),
            history,
          }),
        });
        if (!res.ok) {
          if (res.status === 429) throw new Error(isAr ? "رصيد الذكاء الاصطناعي للشهر ده خلص. الجولة نفسها ببلاش — كمّل، وأسئلتك تستنى الشهر الجاي أو شحن الرصيد." : "This month's AI credits are used up. The tour itself is free — keep going; questions wait for next month or a top-up.");
          if (res.status === 403) throw new Error(isAr ? "الأسئلة الحية جزء من المساعد الذكي (باقات Pro وPremium). الجولة نفسها شغالة عادي." : "Live questions are part of the AI assistant (Pro and Premium). The tour itself works on every plan.");
          throw new Error(isAr ? "معرفتش أجاوب دلوقتي. جرّب تاني." : "I couldn't answer just now. Try again.");
        }
        const data = await res.json();
        const reply = String(data.reply || "…");
        setQa((q) => [...q, { id: `${Date.now()}a`, role: "assistant", content: reply, stopId: stop.id }]);
        void speakAsync(reply);
        if (typeof data.tourGoTo?.stopId === "string") tour.goTo(data.tourGoTo.stopId);
        if (typeof data.startTutorial?.id === "string") startTutorial(data.startTutorial.id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setQa((q) => [...q, { id: `${Date.now()}e`, role: "assistant", content: `⚠️ ${message}`, stopId: stop.id }]);
      } finally {
        setAsking(false);
      }
    },
    [asking, stop, clinicId, qa, isAr, user?.name, tour, stops, startTutorial, speakAsync, stopSpeaking],
  );

  /* --- chapters / minimize ---------------------------------------------------------------- */
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    setChaptersOpen(false);
    setMinimized(false);
  }, [stop?.id]);
  const minimize = () => {
    runnerRef.current.abort();
    stopSpeaking();
    setChaptersOpen(false);
    setTakeover(null);
    setMinimized(true);
  };

  /* --- keys ------------------------------------------------------------------------------- */
  useEffect(() => {
    if (!active || paused) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (e.key === "Escape") {
        if (chaptersOpen) setChaptersOpen(false);
        else tour.leave();
        return;
      }
      if (typing) return;
      const forward = isRTL ? "ArrowLeft" : "ArrowRight";
      const backward = isRTL ? "ArrowRight" : "ArrowLeft";
      if (e.key === forward) {
        if (runnerRef.current.state.waitingForNext) runnerRef.current.pressNext();
        else tour.next();
      } else if (e.key === backward) tour.back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, paused, isRTL, tour, chaptersOpen]);

  /* --- derived ---------------------------------------------------------------------------- */
  const chapter = useMemo(() => chapters.find((c) => c.id === stop?.chapter) ?? null, [chapters, stop?.chapter]);
  const chapterStops = useMemo(() => {
    const byChapter = new Map<string, TourStop[]>();
    for (const s of stops) {
      const list = byChapter.get(s.chapter) ?? [];
      list.push(s);
      byChapter.set(s.chapter, list);
    }
    return byChapter;
  }, [stops]);
  const visited = useMemo(() => new Set(tour.progress.visited), [tour.progress.visited]);

  const busy = runner.state.running || phase === "navigating";
  const avatarState: AvatarState = asking || fetchingVoice ? "thinking" : busy || speaking || !typed.done ? "speaking" : "idle";
  const dockTop = !!rect && rect.top > (typeof window !== "undefined" ? window.innerHeight : 800) * 0.55;
  const thisStopQa = qa.filter((m) => m.stopId === stop?.id);
  const showChips = phase === "done" && stop && stop.ask.length > 0 && thisStopQa.length === 0;
  const captionMode = (phase === "walk" || phase === "demo") && !takeover && !offer;

  if (!active || paused || !stop) return null;

  const ArrowNext = isRTL ? ArrowLeft : ArrowRight;
  const ArrowBack = isRTL ? ArrowRight : ArrowLeft;
  const pct = total > 0 ? Math.round(((shownIndex + 1) / total) * 100) : 0;
  const spotStyle = rect
    ? { top: rect.top - SPOT_PAD, left: rect.left - SPOT_PAD, width: rect.width + SPOT_PAD * 2, height: rect.height + SPOT_PAD * 2 }
    : undefined;

  /* The dimmed sheet never catches a click: the page stays live. */
  const sheet = (
    <div className="pointer-events-none fixed inset-0 z-[9960]" aria-hidden data-tour-chrome>
      {rect ? (
        <div
          className="absolute rounded-2xl ring-2 ring-[#FACC15]/80 transition-all duration-300 ease-out"
          style={{ ...spotStyle, boxShadow: `0 0 0 100vmax rgba(8, 9, 12, ${captionMode ? 0.5 : 0.62})` }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(8,9,12,0.55)]" />
      )}
    </div>
  );

  const paceToggle = (
    <div className="inline-flex rounded-full border border-white/15 p-0.5" title={isAr ? "السرعة" : "Pacing"}>
      <button
        type="button"
        onClick={() => setPace("auto")}
        className={`rounded-full px-2.5 py-1 text-[10.5px] font-black ${pace === "auto" ? "bg-[#FACC15] text-ink" : "text-white/60 hover:text-white"}`}
      >
        <Play size={10} className="me-1 inline" />
        {isAr ? "تلقائي" : "Auto"}
      </button>
      <button
        type="button"
        onClick={() => setPace("step")}
        className={`rounded-full px-2.5 py-1 text-[10.5px] font-black ${pace === "step" ? "bg-[#FACC15] text-ink" : "text-white/60 hover:text-white"}`}
      >
        <Footprints size={10} className="me-1 inline" />
        {isAr ? "خطوة بخطوة" : "Step by step"}
      </button>
    </div>
  );

  if (minimized) {
    return (
      <div className="fixed bottom-24 end-4 z-[10001] sm:bottom-5 sm:end-6" dir={isRTL ? "rtl" : "ltr"} role="dialog" aria-label={guideName} data-tour-chrome>
        <div className="flex items-center gap-2 rounded-full bg-ink-slab py-1.5 pe-2 ps-1.5 text-white shadow-[0_16px_50px_rgba(0,0,0,0.4)] ring-1 ring-white/10 animate-in fade-in zoom-in-95 duration-200">
          <button type="button" onClick={() => setMinimized(false)} className="flex items-center gap-2 rounded-full py-0.5 pe-2 transition-colors hover:bg-white/10">
            <AvatarFace state="idle" size={32} />
            <span className="max-w-[10rem] truncate text-[12px] font-bold">{isAr ? stop.title.ar : stop.title.en}</span>
            <span className="text-[10.5px] font-black tabular-nums text-white/45">{shownIndex + 1}/{total}</span>
          </button>
          <button type="button" onClick={tour.back} disabled={stopIndex === 0} className="grid size-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30" aria-label={isAr ? "رجوع" : "Back"}>
            <ArrowBack size={14} />
          </button>
          <button type="button" onClick={() => setMinimized(false)} className="rounded-full bg-[#FACC15] px-3.5 py-1.5 text-[12px] font-black text-ink hover:brightness-105">
            {isAr ? "كمّلي" : "Continue"}
          </button>
          <button type="button" onClick={tour.next} className="grid size-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white" aria-label={isLast ? (isAr ? "إنهاء" : "Finish") : isAr ? "التالي" : "Next"}>
            {isLast ? <Check size={14} strokeWidth={3} /> : <ArrowNext size={14} />}
          </button>
          <button type="button" onClick={tour.leave} className="grid size-8 place-items-center rounded-full text-white/40 hover:bg-white/10 hover:text-white" aria-label={isAr ? "إنهاء الجولة" : "Leave the tour"}>
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (captionMode) {
    const waiting = runner.state.waitingForNext;
    return (
      <>
        {sheet}
        <TourCursor cursor={runner.cursor} label={guideName} />
        <div className={`fixed z-[10001] inset-x-3 ${dockTop ? "top-3" : "bottom-3"} sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[min(44rem,calc(100vw-2rem))]`} dir={isRTL ? "rtl" : "ltr"} role="dialog" aria-label={guideName} data-tour-chrome>
          <div className="flex items-center gap-3 rounded-full bg-ink-slab py-2 pe-2 ps-2 text-white shadow-[0_16px_50px_rgba(0,0,0,0.4)] ring-1 ring-white/10 animate-in fade-in zoom-in-95 duration-200">
            <div className="shrink-0 rounded-full bg-white/5 p-0.5">
              <AvatarFace state={avatarState} size={36} />
            </div>
            <p onClick={typed.finish} className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-white/90">
              {typed.shown || "…"}
              {!typed.done && <span className="ms-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[#FACC15]" />}
            </p>
            <span className="hidden shrink-0 text-[10.5px] font-black tabular-nums text-white/40 md:block">{shownIndex + 1}/{total}</span>
            <span className="hidden shrink-0 md:block">{paceToggle}</span>
            <button type="button" onClick={minimize} className="hidden shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] font-bold text-white/70 hover:bg-white/10 hover:text-white sm:block">
              {isAr ? "خليني أتفرج" : "Let me look"}
            </button>
            <button type="button" onClick={skipHand} className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] font-bold text-white/70 hover:bg-white/10 hover:text-white">
              {isAr ? "كفاية" : "Skip"}
            </button>
            <button
              type="button"
              onClick={() => (waiting ? runner.pressNext() : tour.next())}
              className={`grid h-8 shrink-0 place-items-center rounded-full bg-[#FACC15] text-ink transition-all hover:brightness-105 active:scale-[0.98] ${waiting ? "animate-pulse px-3" : "w-8"}`}
              aria-label={waiting ? (isAr ? "التالي" : "Next") : isLast ? (isAr ? "إنهاء" : "Finish") : isAr ? "المحطة الجاية" : "Next stop"}
            >
              {waiting ? <span className="text-[11px] font-black">{isAr ? "التالي" : "Next"}</span> : isLast ? <Check size={14} strokeWidth={3} /> : <ArrowNext size={14} />}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {sheet}
      <TourCursor cursor={runner.cursor} label={guideName} />

      <div className={`fixed z-[10001] inset-x-3 ${dockTop ? "top-3" : "bottom-3"} sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[min(44rem,calc(100vw-2rem))]`} dir={isRTL ? "rtl" : "ltr"} role="dialog" aria-label={guideName} data-tour-chrome>
        <div className="relative rounded-[1.75rem] bg-ink-slab text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)] ring-1 ring-white/10 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="h-1 w-full overflow-hidden rounded-t-[1.75rem] bg-white/10">
            <div className="h-full bg-[#FACC15] transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>

          {/* Header */}
          <div className="flex items-center gap-3 px-4 pt-3 sm:px-5">
            <div className="shrink-0 rounded-full bg-white/5 p-0.5">
              <AvatarFace state={avatarState} size={40} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-black tracking-tight">{guideName}</span>
                <span className="rounded-full bg-[#FACC15] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-ink">{isAr ? "الجولة" : "Tour"}</span>
              </div>
              <p className="truncate text-[11px] font-semibold text-white/50">
                {chapter ? (isAr ? chapter.title.ar : chapter.title.en) : ""}
                <span className="mx-1.5 text-white/25">·</span>
                <span className="tabular-nums">{shownIndex + 1} / {total}</span>
              </p>
            </div>
            <button type="button" onClick={toggleLanguage} title={isAr ? "English" : "العربية"} className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 text-white/60 hover:bg-white/10 hover:text-white">
              <Languages size={16} />
            </button>
            <button type="button" onClick={minimize} title={isAr ? "خليني أتفرج (الصفحة بتفتح)" : "Let me look"} className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 text-white/60 hover:bg-white/10 hover:text-white">
              <Minus size={16} />
            </button>
            <button
              type="button"
              onClick={toggleVoice}
              title={voiceOn ? (isAr ? "إيقاف الصوت" : "Voice off") : (isAr ? "تشغيل الصوت" : "Read aloud")}
              className={`grid size-9 shrink-0 place-items-center rounded-full border transition-colors ${voiceOn ? "border-[#FACC15]/50 bg-[#FACC15]/15 text-[#FACC15]" : "border-white/15 text-white/60 hover:bg-white/10 hover:text-white"}`}
            >
              {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <div className="relative shrink-0">
              <button type="button" onClick={() => setChaptersOpen((o) => !o)} title={isAr ? "الفصول" : "Chapters"} className="grid size-9 place-items-center rounded-full border border-white/15 text-white/60 hover:bg-white/10 hover:text-white">
                <ListTree size={16} />
              </button>
              {chaptersOpen && (
                <div className={`absolute ${dockTop ? "top-full mt-2" : "bottom-full mb-2"} end-0 z-10 max-h-[60vh] w-72 overflow-y-auto rounded-2xl border border-white/10 bg-[#111318] p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-150`}>
                  {chapters.map((c) => (
                    <div key={c.id} className="mb-1.5">
                      <p className="px-2 pb-1 pt-1.5 text-[10px] font-black uppercase tracking-widest text-white/40">{isAr ? c.title.ar : c.title.en}</p>
                      {(chapterStops.get(c.id) ?? []).filter((s) => !s.demoOnly || demoMode === "on").map((s) => {
                        const current = s.id === stop.id;
                        return (
                          <button key={s.id} type="button" onClick={() => tour.goTo(s.id)} className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-start text-[12px] font-bold transition-colors ${current ? "bg-[#FACC15] text-ink" : "text-white/80 hover:bg-white/10"}`}>
                            <span className={`grid size-4 shrink-0 place-items-center rounded-full ${current ? "bg-ink/15" : visited.has(s.id) ? "bg-emerald-400/20 text-emerald-300" : "bg-white/10"}`}>
                              {visited.has(s.id) && !current ? <Check size={10} strokeWidth={3} /> : null}
                            </span>
                            <span className="truncate">{isAr ? s.title.ar : s.title.en}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={tour.leave} title={isAr ? "إنهاء الجولة (تقدر ترجعلها)" : "Leave the tour (you can come back)"} className="grid size-9 shrink-0 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white">
              <X size={16} />
            </button>
          </div>

          {/* The stop */}
          <div className="px-4 pb-3 pt-3 sm:px-5">
            <h2 className="font-display text-[1.35rem] font-bold leading-tight tracking-tight sm:text-2xl">{isAr ? stop.title.ar : stop.title.en}</h2>
            <p onClick={typed.finish} className="mt-1.5 min-h-[3.2em] cursor-default text-[13.5px] font-medium leading-relaxed text-white/85 sm:text-[14px]">
              {phase === "navigating" ? (
                <span className="inline-flex items-center gap-2 text-white/50">
                  <Loader2 size={13} className="animate-spin" />
                  {isAr ? "بمشي معاك للصفحة…" : "Walking you there…"}
                </span>
              ) : (
                <>
                  {typed.shown}
                  {!typed.done && <span className="ms-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[#FACC15]" />}
                </>
              )}
            </p>

            {/* The person took over */}
            {takeover && (
              <div className="mt-3 rounded-2xl border border-white/15 bg-white/5 p-3.5">
                <p className="text-[13px] font-semibold leading-relaxed text-white/90">
                  {isAr ? "شكلك عايز تجرّب بنفسك — خدني راحتك. أكمّل من نفس المكان لما تحب؟" : "Looks like you want a go yourself — take your time. Shall I carry on from where I was when you're ready?"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={continueHand} className="inline-flex items-center gap-1.5 rounded-full bg-[#FACC15] px-4 py-2 text-[12px] font-black text-ink hover:brightness-105">
                    <Play size={12} strokeWidth={3} />
                    {isAr ? "كمّلي" : "Continue"}
                  </button>
                  <button type="button" onClick={minimize} className="rounded-full border border-white/15 px-4 py-2 text-[12px] font-bold text-white/75 hover:bg-white/10 hover:text-white">
                    {isAr ? "خليني أتفرج" : "Let me look"}
                  </button>
                  <button type="button" onClick={skipHand} className="rounded-full px-3 py-2 text-[12px] font-bold text-white/50 hover:text-white">
                    {isAr ? "كفاية كده" : "Skip the rest"}
                  </button>
                </div>
              </div>
            )}

            {/* A real setup offer */}
            {offer && (
              <div className="mt-3 rounded-2xl border border-[#FACC15]/30 bg-[#FACC15]/10 p-3.5">
                <p className="text-[13px] font-semibold leading-relaxed text-white/90">{isAr ? offer.say.ar : offer.say.en}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => answerOffer(true)} className="inline-flex items-center gap-1.5 rounded-full bg-[#FACC15] px-4 py-2 text-[12px] font-black text-ink hover:brightness-105">
                    <Check size={13} strokeWidth={3} />
                    {isAr ? "أيوه، اعمليها" : "Yes, do it"}
                  </button>
                  <button type="button" onClick={() => answerOffer(false)} className="rounded-full border border-white/15 px-4 py-2 text-[12px] font-bold text-white/75 hover:bg-white/10 hover:text-white">
                    {isAr ? "لأ، هعملها بنفسي" : "No, I'll do it myself"}
                  </button>
                </div>
              </div>
            )}

            {/* May she do it for real? Asked once. */}
            {phase === "asking" && (
              <div className="mt-3 rounded-2xl border border-[#FACC15]/30 bg-[#FACC15]/10 p-3.5">
                <p className="text-[13px] font-semibold leading-relaxed text-white/90">
                  {isAr
                    ? `تحب أعملها بجد؟ هضيف مريض تجريبي وموعد وعلاج ودفعة وإحنا ماشيين — كلهم باسم «${guideName}» — وفي الآخر هحذفهم كلهم قدامك وأوريك إزاي ترجّع حاجة اتحذفت. مفيش حاجة تانية بتتغير.`
                    : `Shall I do it for real? I'll add a test patient, an appointment, a treatment and a payment as we go — all named "${guideName}" — and at the end delete every one of them in front of you, and show you how to restore something. Nothing else changes.`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => answerDemo(true)} className="inline-flex items-center gap-1.5 rounded-full bg-[#FACC15] px-4 py-2 text-[12px] font-black text-ink hover:brightness-105">
                    <Hand size={13} />
                    {isAr ? "أيوه، اعمليها قدامي" : "Yes, do it for real"}
                  </button>
                  <button type="button" onClick={() => answerDemo(false)} className="rounded-full border border-white/15 px-4 py-2 text-[12px] font-bold text-white/75 hover:bg-white/10 hover:text-white">
                    {isAr ? "اشرحي بس" : "Just explain"}
                  </button>
                </div>
              </div>
            )}

            {(thisStopQa.length > 0 || asking) && (
              <div ref={threadRef} className="mt-3 max-h-40 space-y-1.5 overflow-y-auto pe-1 sm:max-h-48">
                {thisStopQa.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed ${m.role === "user" ? "bg-[#FACC15] text-ink" : "bg-white/10 text-white/90"}`}>{m.content}</div>
                  </div>
                ))}
                {asking && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-3.5 py-2 text-[12px] text-white/60">
                      <Loader2 size={13} className="animate-spin" />
                      {isAr ? "بفكر…" : "Thinking…"}
                    </div>
                  </div>
                )}
              </div>
            )}

            {showChips && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {stop.ask.map((q) => {
                  const label = isAr ? q.ar : q.en;
                  return (
                    <button key={label} type="button" onClick={() => void ask(label, true)} className="rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] font-bold text-white/75 hover:border-[#FACC15]/60 hover:text-white">
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask(question);
              }}
              className="mt-3 flex items-center gap-2"
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                autoFocus={isLast && phase === "done"}
                placeholder={
                  tour.firstTour
                    ? isAr ? `اسأل ${guideName} أي حاجة — الأسئلة ببلاش في أول جولة` : `Ask ${guideName} anything — questions are free on your first tour`
                    : isAr ? `اسأل ${guideName} أي حاجة عن الشاشة دي (السؤال بيتكلف رصيد واحد)` : `Ask ${guideName} anything about this screen (one credit a question)`
                }
                className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[13px] font-medium text-white placeholder:text-white/35 outline-none focus:border-[#FACC15]/60"
              />
              <button type="submit" disabled={!question.trim() || asking} className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-40" aria-label={isAr ? "إرسال" : "Send"}>
                <Send size={15} className={isRTL ? "-scale-x-100" : ""} />
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3 sm:px-5">
            <button type="button" onClick={tour.back} disabled={stopIndex === 0} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-black text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30">
              <ArrowBack size={14} />
              {isAr ? "رجوع" : "Back"}
            </button>
            {paceToggle}
            <button type="button" onClick={minimize} className="hidden items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-2 text-[12px] font-bold text-white/70 hover:bg-white/10 hover:text-white sm:inline-flex">
              <Minus size={13} />
              {isAr ? "خليني أتفرج" : "Let me look"}
            </button>
            <span className="ms-auto hidden text-[10.5px] font-semibold text-white/35 lg:block">{isAr ? "الأسهم للتنقل · Esc للخروج" : "Arrow keys to move · Esc to leave"}</span>
            <button type="button" onClick={tour.next} className="ms-auto inline-flex items-center gap-1.5 rounded-full bg-[#FACC15] px-5 py-2 text-[12.5px] font-black text-ink shadow-lg shadow-[#FACC15]/20 hover:brightness-105 active:scale-[0.98] lg:ms-0">
              {isLast ? (isAr ? "إنهاء الجولة" : "Finish the tour") : isAr ? "التالي" : "Next"}
              {!isLast && <ArrowNext size={14} />}
              {isLast && <Check size={14} strokeWidth={3} />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
