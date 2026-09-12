"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ListTree,
  Loader2,
  Send,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import AvatarFace, { type AvatarState } from "@/components/appointments/AvatarFace";
import { useTour } from "@/context/TourContext";
import { useTutorial } from "@/context/TutorialContext";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { auth } from "@/lib/firebase";
import { TOUR_GUIDE, type TourStop } from "@/lib/grandTour";
import { findFirstVisibleAnchor } from "@/lib/tourDom";
import { toSpeechText, trimForSpeech } from "@/lib/speechText";

/**
 * Sara on screen.
 *
 * Three layers, bottom to top: a dimmed sheet over the whole app with one bright window cut out
 * of it (the spotlight), an invisible click-catcher so nothing under the sheet reacts while she is
 * talking, and her panel — a black slab with her orb, the stop's title, the line she is saying
 * typed out as she says it, the questions worth asking here, a box to ask your own, and the
 * Back / Next controls.
 *
 * Why the page is locked: a tour and a lesson are different promises. A lesson (TutorialOverlay)
 * leaves the page live because the whole point is that you press the real button. The tour
 * describes fifty screens in fifteen minutes; a page that also reacts to stray clicks would open
 * modals under the spotlight and drag the narration off its subject. When someone wants to DO
 * the thing, Sara offers the lesson, the tour pauses, and the ring takes over.
 *
 * Where the panel sits: the bottom, unless the spotlight is in the bottom part of the screen (the
 * phone's bottom bar, a save button), in which case it moves to the top. It must never cover what
 * it is pointing at.
 *
 * Money: the narration is free — it is text in this repo. Every question typed into the box is
 * one assistant credit, the same as the chat orb, and the placeholder says so once. Voice is
 * off by default; switched on it reads each stop aloud through the clinic's server voice (the
 * same one the reception assistant uses) and quietly turns itself off again on a plan that has
 * no voice.
 */

const POLL_MS = 250;
const SPOT_PAD = 10;
/** Typing pace of the narration. Fast enough not to bore, slow enough to read as speech. */
const TYPE_MS_PER_CHAR = 16;
const VOICE_KEY = "alphaTourVoice";
/** How much of the conversation goes back to the model with each question. */
const HISTORY_TURNS = 8;

interface QaMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  stopId: string;
}

function readVoicePref(): boolean {
  try {
    return window.localStorage.getItem(VOICE_KEY) === "on";
  } catch {
    return false;
  }
}

function writeVoicePref(on: boolean): void {
  try {
    window.localStorage.setItem(VOICE_KEY, on ? "on" : "off");
  } catch {
    /* fine */
  }
}

/** Reveals `text` a character at a time. Clicking the text (or a stop change) shows all of it. */
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
      // Arabic and English both read fine at a per-character pace; two at a time keeps long
      // lines from dragging.
      i = Math.min(text.length, i + 2);
      setShown(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(timer);
        setDone(true);
      }
    }, TYPE_MS_PER_CHAR);
    return () => clearInterval(timer);
    // key, not text: the same line on a new stop id must retype.
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
  const { language, isRTL } = useLanguage();
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const { showToast } = useUI();
  const isAr = language === "ar";
  const guideName = isAr ? TOUR_GUIDE.ar : TOUR_GUIDE.en;

  const { active, paused, stop, stopIndex, stops, chapters } = tour;
  const total = stops.length;
  const isLast = stopIndex >= total - 1;

  /* --- the spotlight ---------------------------------------------------------------------- */
  const [rect, setRect] = useState<DOMRect | null>(null);
  const scrolledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!active || paused || !stop) return;
    let raf = 0;
    const anchors = [...(stop.spot ?? []), "page-main"];
    const measure = () => {
      const found = findFirstVisibleAnchor(anchors);
      if (!found) {
        setRect(null);
        return;
      }
      // Bring a target that is off screen into view once per stop; the dashboard's stat cards
      // may be below the fold on a phone.
      if (scrolledFor.current !== stop.id) {
        scrolledFor.current = stop.id;
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
  }, [active, paused, stop]);

  /* --- the narration ---------------------------------------------------------------------- */
  const line = stop ? (isAr ? stop.say.ar : stop.say.en) : "";
  const typed = useTypewriter(line, `${stop?.id ?? ""}:${language}`);

  /* --- voice ------------------------------------------------------------------------------ */
  const [voiceOn, setVoiceOn] = useState(false);
  const [fetchingVoice, setFetchingVoice] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    setVoiceOn(readVoicePref());
  }, []);

  const stopSpeaking = useCallback(() => {
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
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!voiceOn || !clinicId) return;
      const spoken = trimForSpeech(toSpeechText(text, isAr), 600);
      if (!spoken) return;
      stopSpeaking();
      const cacheKey = `${isAr ? "ar" : "en"}::${spoken}`;
      const play = (src: string) => {
        const audio = new Audio(src);
        audioRef.current = audio;
        audio.onplay = () => setSpeaking(true);
        audio.onended = () => setSpeaking(false);
        audio.onerror = () => setSpeaking(false);
        void audio.play().catch(() => setSpeaking(false));
      };
      const cached = audioCache.current.get(cacheKey);
      if (cached) {
        play(cached);
        return;
      }
      setFetchingVoice(true);
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) return;
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ clinicId, text: spoken, language: isAr ? "ar" : "en" }),
        });
        if (res.status === 403 || res.status === 429) {
          // No voice on this plan, or the month's voice allowance is spent. Stay quiet rather
          // than fail on every stop — and say so once.
          setVoiceOn(false);
          writeVoicePref(false);
          showToast(
            res.status === 403
              ? isAr
                ? "الصوت جزء من المساعد الذكي — متاح في باقات Pro وPremium."
                : "Voice is part of the AI assistant — available on Pro and Premium plans."
              : isAr
                ? "رصيد الصوت للشهر ده خلص. الجولة هتكمل مكتوبة."
                : "This month's voice allowance is used up. The tour continues in text.",
            "info",
          );
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        const src = `data:${data.mimeType || "audio/wav"};base64,${data.audio}`;
        audioCache.current.set(cacheKey, src);
        play(src);
      } catch {
        /* Silence is the correct failure for a narrator. */
      } finally {
        setFetchingVoice(false);
      }
    },
    [voiceOn, clinicId, isAr, stopSpeaking, showToast],
  );

  // Each stop: say the line (if voice is on). Leaving or pausing: stop mid-word.
  useEffect(() => {
    if (!active || paused || !stop) {
      stopSpeaking();
      return;
    }
    void speak(line);
    return () => stopSpeaking();
    // speak changes identity with voiceOn; re-speaking on toggle is handled by the toggle itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paused, stop?.id, language]);

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    writeVoicePref(next);
    if (!next) stopSpeaking();
  };
  // Speak the current line the moment voice is switched on.
  useEffect(() => {
    if (voiceOn && active && !paused && stop) void speak(line);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn]);

  /* --- questions -------------------------------------------------------------------------- */
  const [qa, setQa] = useState<QaMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askedOnce, setAskedOnce] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  // A fresh tour starts with a clean thread.
  useEffect(() => {
    if (!active) setQa([]);
  }, [active]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [qa.length, asking]);

  const ask = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || asking || !stop || !clinicId) return;
      setQuestion("");
      setAskedOnce(true);
      const userMsg: QaMessage = { id: `${Date.now()}u`, role: "user", content: prompt, stopId: stop.id };
      // History as the route expects it: role + content pairs, most recent last.
      const history = [...qa]
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.role, content: m.content }));
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
            tour: { stopId: stop.id },
            history,
          }),
        });
        if (!res.ok) {
          if (res.status === 429) {
            throw new Error(
              isAr
                ? "رصيد الذكاء الاصطناعي للشهر ده خلص. الجولة نفسها ببلاش — كمّل، وأسئلتك تستنى الشهر الجاي أو شحن الرصيد."
                : "This month's AI credits are used up. The tour itself is free — keep going; questions wait for next month or a top-up.",
            );
          }
          if (res.status === 403) {
            throw new Error(
              isAr
                ? "الأسئلة الحية جزء من المساعد الذكي (باقات Pro وPremium). الجولة نفسها شغالة عادي."
                : "Live questions are part of the AI assistant (Pro and Premium). The tour itself works on every plan.",
            );
          }
          throw new Error(isAr ? "معرفتش أجاوب دلوقتي. جرّب تاني." : "I couldn't answer just now. Try again.");
        }
        const data = await res.json();
        const reply = String(data.reply || "…");
        setQa((q) => [...q, { id: `${Date.now()}a`, role: "assistant", content: reply, stopId: stop.id }]);
        void speak(reply);
        // Sara chose to take them somewhere, or to hand over to a lesson.
        if (typeof data.tourGoTo?.stopId === "string") tour.goTo(data.tourGoTo.stopId);
        if (typeof data.startTutorial?.id === "string") startTutorial(data.startTutorial.id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setQa((q) => [...q, { id: `${Date.now()}e`, role: "assistant", content: `⚠️ ${message}`, stopId: stop.id }]);
      } finally {
        setAsking(false);
      }
    },
    [asking, stop, clinicId, qa, isAr, user?.name, tour, startTutorial, speak, stopSpeaking],
  );

  /* --- chapters drawer -------------------------------------------------------------------- */
  const [chaptersOpen, setChaptersOpen] = useState(false);
  useEffect(() => {
    setChaptersOpen(false);
  }, [stop?.id]);

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
      if (e.key === forward) tour.next();
      else if (e.key === backward) tour.back();
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

  const avatarState: AvatarState = asking || fetchingVoice ? "thinking" : speaking || !typed.done ? "speaking" : "idle";

  // The panel goes to the top when the spotlight is low — never over what it is pointing at.
  const dockTop = !!rect && rect.top > (typeof window !== "undefined" ? window.innerHeight : 800) * 0.55;

  const thisStopQa = qa.filter((m) => m.stopId === stop?.id);

  if (!active || paused || !stop) return null;

  const ArrowNext = isRTL ? ArrowLeft : ArrowRight;
  const ArrowBack = isRTL ? ArrowRight : ArrowLeft;
  const pct = total > 0 ? Math.round(((stopIndex + 1) / total) * 100) : 0;

  const spotStyle = rect
    ? {
        top: rect.top - SPOT_PAD,
        left: rect.left - SPOT_PAD,
        width: rect.width + SPOT_PAD * 2,
        height: rect.height + SPOT_PAD * 2,
      }
    : undefined;

  return (
    <>
      {/* The dimmed sheet. One element: the bright window is its box-shadow's absence. When no
          target is found yet the whole screen dims evenly rather than a spotlight jumping in
          from the corner. */}
      <div className="fixed inset-0 z-[9960]" aria-hidden onClick={() => setChaptersOpen(false)}>
        {rect ? (
          <div
            className="absolute rounded-2xl ring-2 ring-[#FACC15]/80 transition-all duration-300 ease-out"
            style={{ ...spotStyle, boxShadow: "0 0 0 100vmax rgba(8, 9, 12, 0.66)" }}
          />
        ) : (
          <div className="absolute inset-0 bg-[rgba(8,9,12,0.66)] transition-opacity duration-300" />
        )}
      </div>

      {/* Sara's panel. */}
      <div
        className={`fixed z-[9962] inset-x-3 ${dockTop ? "top-3" : "bottom-3"} sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-[min(44rem,calc(100vw-2rem))]`}
        dir={isRTL ? "rtl" : "ltr"}
        role="dialog"
        aria-label={guideName}
      >
        {/* No overflow-hidden here: the chapters drawer hangs outside the slab. */}
        <div className="relative rounded-[1.75rem] bg-ink-slab text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)] ring-1 ring-white/10 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Progress: the only colour on the slab besides the Next button. */}
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
                <span className="rounded-full bg-[#FACC15] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-ink">
                  {isAr ? "الجولة" : "Tour"}
                </span>
              </div>
              <p className="truncate text-[11px] font-semibold text-white/50">
                {chapter ? (isAr ? chapter.title.ar : chapter.title.en) : ""}
                <span className="mx-1.5 text-white/25">·</span>
                <span className="tabular-nums">{stopIndex + 1} / {total}</span>
              </p>
            </div>

            <button
              type="button"
              onClick={toggleVoice}
              title={voiceOn ? (isAr ? "إيقاف الصوت" : "Voice off") : (isAr ? "تشغيل الصوت" : "Read aloud")}
              className={`grid size-9 shrink-0 place-items-center rounded-full border transition-colors ${
                voiceOn ? "border-[#FACC15]/50 bg-[#FACC15]/15 text-[#FACC15]" : "border-white/15 text-white/60 hover:bg-white/10 hover:text-white"
              }`}
            >
              {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setChaptersOpen((o) => !o)}
                title={isAr ? "الفصول" : "Chapters"}
                className="grid size-9 place-items-center rounded-full border border-white/15 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ListTree size={16} />
              </button>
              {chaptersOpen && (
                <div
                  className={`absolute ${dockTop ? "top-full mt-2" : "bottom-full mb-2"} end-0 z-10 max-h-[60vh] w-72 overflow-y-auto rounded-2xl border border-white/10 bg-[#111318] p-2 shadow-2xl animate-in fade-in zoom-in-95 duration-150`}
                >
                  {chapters.map((c) => (
                    <div key={c.id} className="mb-1.5">
                      <p className="px-2 pb-1 pt-1.5 text-[10px] font-black uppercase tracking-widest text-white/40">
                        {isAr ? c.title.ar : c.title.en}
                      </p>
                      {(chapterStops.get(c.id) ?? []).map((s) => {
                        const current = s.id === stop.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => tour.goTo(s.id)}
                            className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-start text-[12px] font-bold transition-colors ${
                              current ? "bg-[#FACC15] text-ink" : "text-white/80 hover:bg-white/10"
                            }`}
                          >
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

            <button
              type="button"
              onClick={tour.leave}
              title={isAr ? "إنهاء الجولة (تقدر ترجعلها)" : "Leave the tour (you can come back)"}
              className="grid size-9 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          {/* The stop */}
          <div className="px-4 pb-3 pt-3 sm:px-5">
            <h2 className="font-display text-[1.35rem] font-bold leading-tight tracking-tight sm:text-2xl">
              {isAr ? stop.title.ar : stop.title.en}
            </h2>
            <p
              onClick={typed.finish}
              className="mt-1.5 min-h-[3.2em] cursor-default text-[13.5px] font-medium leading-relaxed text-white/85 sm:text-[14px]"
            >
              {typed.shown}
              {!typed.done && <span className="ms-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[#FACC15]" />}
            </p>

            {/* Questions and answers at this stop */}
            {(thisStopQa.length > 0 || asking) && (
              <div ref={threadRef} className="mt-3 max-h-40 space-y-1.5 overflow-y-auto pe-1 sm:max-h-48">
                {thisStopQa.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-[12.5px] leading-relaxed ${
                        m.role === "user" ? "bg-[#FACC15] text-ink" : "bg-white/10 text-white/90"
                      }`}
                    >
                      {m.content}
                    </div>
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

            {/* Things worth asking here */}
            {typed.done && stop.ask.length > 0 && thisStopQa.length === 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {stop.ask.map((q) => {
                  const label = isAr ? q.ar : q.en;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => void ask(label)}
                      className="rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] font-bold text-white/75 transition-colors hover:border-[#FACC15]/60 hover:text-white"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Ask your own */}
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
                placeholder={
                  askedOnce
                    ? isAr
                      ? `اسألي ${guideName}…`
                      : `Ask ${guideName}…`
                    : isAr
                      ? `اسأل ${guideName} أي حاجة عن الشاشة دي (السؤال بيتكلف رصيد واحد)`
                      : `Ask ${guideName} anything about this screen (one credit a question)`
                }
                className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[13px] font-medium text-white placeholder:text-white/35 outline-none transition-colors focus:border-[#FACC15]/60"
              />
              <button
                type="submit"
                disabled={!question.trim() || asking}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-40"
                aria-label={isAr ? "إرسال" : "Send"}
              >
                <Send size={15} className={isRTL ? "-scale-x-100" : ""} />
              </button>
            </form>
          </div>

          {/* Footer: back / next */}
          <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={tour.back}
              disabled={stopIndex === 0}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] font-black text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              <ArrowBack size={14} />
              {isAr ? "رجوع" : "Back"}
            </button>
            <span className="ms-auto hidden text-[10.5px] font-semibold text-white/35 sm:block">
              {isAr ? "الأسهم للتنقل · Esc للخروج" : "Arrow keys to move · Esc to leave"}
            </span>
            <button
              type="button"
              onClick={tour.next}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#FACC15] px-5 py-2 text-[12.5px] font-black text-ink shadow-lg shadow-[#FACC15]/20 transition-all hover:brightness-105 active:scale-[0.98]"
            >
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
