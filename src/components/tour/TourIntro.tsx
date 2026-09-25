"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock, X } from "lucide-react";
import AvatarFace from "@/components/appointments/AvatarFace";
import { useTour } from "@/context/TourContext";
import { useTutorial } from "@/context/TutorialContext";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { TOUR_GUIDE, tourMinutes } from "@/lib/grandTour";

/**
 * Meet Sara.
 *
 * The first thing a new person sees after the setup wizard: a black screen, her orb, and — before
 * anything else — the language question. Picking Arabic switches the whole system to Arabic,
 * not just the tour, because a receptionist who chose Arabic here should not then find the
 * dashboard in English. Then her name, one offer, and two buttons.
 *
 * It appears ONCE per person, ever, and never by itself again. Not once per clinic, not once per
 * browser: the flag is written the moment it appears, under the person's own id (so a clinic that
 * has not finished loading cannot swallow it) and onto their user document (so a cleared browser,
 * a second laptop or a phone does not count as a new person who has never met her). Declining is
 * one click, and the tour stays a menu item away.
 *
 * Deliberately not a modal over the dashboard. A card over a busy screen competes with the
 * screen. The point of this moment is that there is nothing else on it.
 *
 * Two components: a gate that decides whether to mount at all, and the screen itself.
 */
/**
 * The gate.
 *
 * Nothing is decided until this person is actually known: the answer to "have they met Sara?"
 * lives partly under their own id and partly on their user document, and reading it while the
 * account is still loading returns "no" for someone who met her months ago. So the screen itself
 * is not mounted until there is a user, a clinic and a settled page — and it reads the answer
 * once, at its own mount, in a `useState` initialiser.
 */
export default function TourIntro() {
  const tour = useTour();
  const { activeTutorial } = useTutorial();
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const { receptionPanelActive } = useUI();
  const pathname = usePathname();

  // A beat after the page paints, so the app is seen first and this arrives over it.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 700);
    return () => clearTimeout(t);
  }, []);

  if (!ready || !clinicId || !user) return null;
  if (tour.active || tour.allStops.length === 0) return null;
  // Not over the setup wizard (it comes first), a lesson, or the reception desk mid-call.
  if (pathname === "/setup" || activeTutorial || receptionPanelActive) return null;

  return <IntroScreen />;
}

function IntroScreen() {
  const tour = useTour();
  const { language, isRTL, toggleLanguage } = useLanguage();
  const { user } = useAuth();
  const { clinic } = useClinic();
  const isAr = language === "ar";

  /**
   * The answer as it stood when this screen opened, read once and never re-read.
   *
   * It has to be a snapshot, because the very next thing this component does is set the flag —
   * and a screen that reacted to its own write would disappear before anybody read a word of it.
   */
  const [alreadySeen] = useState(() => tour.progress.introSeen);

  /** Closed by hand. The stored flag says the same thing, but this one is instant. */
  const [closed, setClosed] = useState(false);
  const visible = !alreadySeen && !closed;

  /**
   * Shown once, and the "once" is banked the moment it appears — not when it is closed.
   *
   * Closing was never the only way off this screen. Reload it, navigate away, close the tab,
   * answer the language question and walk off: none of those wrote anything, so the full-screen
   * invitation came back the next time, and the time after that. Now the first paint is the
   * record. From here on the tour is a menu item under the name at the top, and this screen never
   * opens by itself again — on this browser or any other, at this clinic or the next one.
   */
  useEffect(() => {
    if (visible) tour.noteIntroShown();
  }, [visible, tour]);

  /**
   * Escape declines it, on either step. An invitation that cannot be turned down is a nag, and
   * this one covers the whole screen. Bound only while it is up.
   */
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setClosed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  const dismiss = useCallback(() => {
    setClosed(true);
    tour.declineIntro();
  }, [tour]);

  /**
   * First the language, then the welcome — unless the language is already settled.
   *
   * `alpha-lang` is written only when somebody actually uses the language switch, so its presence
   * means this person has chosen before. Asking them again is how a returning user ends up
   * staring at a question they answered weeks ago with no way past it: the language step had no
   * "not now", so anyone who reloaded instead of answering got it back on the next page, for ever.
   */
  const [languageChosen, setLanguageChosen] = useState(() => {
    try {
      return !!window.localStorage.getItem("alpha-lang");
    } catch {
      return false; // private mode: ask, it is only one question
    }
  });

  if (!visible || !user) return null;

  const firstName = (user.name || "").trim().split(/\s+/)[0] || "";
  const guide = isAr ? TOUR_GUIDE.ar : TOUR_GUIDE.en;
  const minutes = tourMinutes(tour.coreStops);
  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;

  const choose = (lang: "en" | "ar") => {
    if (lang !== language) toggleLanguage();
    setLanguageChosen(true);
  };

  return (
    <div
      className="fixed inset-0 z-[9970] flex items-center justify-center bg-[#0b0c10] px-6 text-white animate-in fade-in duration-500"
      dir={isRTL ? "rtl" : "ltr"}
      role="dialog"
      aria-label={guide}
      data-tour-chrome
    >
      <div className="pointer-events-none absolute -top-40 start-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-[#FACC15]/10 blur-3xl" aria-hidden />

      {/* The way out, on both steps. Declining is remembered; it does not come back on its own. */}
      <button
        type="button"
        onClick={dismiss}
        aria-label={isAr ? "مش دلوقتي" : "Not now"}
        title={isAr ? "مش دلوقتي" : "Not now"}
        className="absolute top-5 end-5 grid size-10 place-items-center rounded-full border border-white/15 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X size={18} />
      </button>

      <div className="relative flex w-full max-w-lg flex-col items-center text-center animate-in fade-in slide-in-from-bottom-6 duration-700">
        <div className="rounded-full bg-white/5 p-2 ring-1 ring-white/10">
          <AvatarFace state="idle" size={120} />
        </div>

        {!languageChosen ? (
          <>
            {/* Both languages on screen at once: the reader has not told us theirs yet. */}
            <p className="mt-8 text-[11px] font-black uppercase tracking-[0.3em] text-[#FACC15]">Welcome · أهلاً بيك</p>
            <h1 className="font-display mt-3 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              Which language do you prefer?
              <span className="mt-1 block" dir="rtl">تحب نتكلم بأنهي لغة؟</span>
            </h1>
            <p className="mt-4 max-w-md text-[14px] font-medium leading-relaxed text-white/60">
              The whole system switches to your choice. You can change it any time from the menu.
              <span className="mt-1 block" dir="rtl">النظام كله هيتحوّل للغة اللي تختارها. تقدر تغيّرها في أي وقت من القايمة.</span>
            </p>
            <div className="mt-9 flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => choose("ar")}
                className="inline-flex w-full items-center justify-center rounded-full bg-[#FACC15] px-8 py-3.5 text-[16px] font-black text-ink shadow-xl shadow-[#FACC15]/20 transition-all hover:brightness-105 active:scale-[0.98] sm:w-auto"
                dir="rtl"
              >
                العربية
              </button>
              <button
                type="button"
                onClick={() => choose("en")}
                className="inline-flex w-full items-center justify-center rounded-full border border-white/20 px-8 py-3.5 text-[16px] font-black text-white transition-colors hover:bg-white/10 sm:w-auto"
              >
                English
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-8 text-[11px] font-black uppercase tracking-[0.3em] text-[#FACC15]">
              {isAr ? "أهلاً بيك" : "Welcome"}
            </p>
            <h1 className="font-display mt-3 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              {isAr
                ? `${firstName ? `يا ${firstName}، ` : ""}أنا ${guide}.`
                : `${firstName ? `${firstName}, ` : ""}I'm ${guide}.`}
            </h1>
            <p className="mt-5 max-w-md text-[15px] font-medium leading-relaxed text-white/70">
              {isAr
                ? `عشر دقايق على أساسيات اليوم في ${clinic?.name || "النظام"}: مريض، وحجز، واليوم من المكتب، ودفعة. هعمل كل حاجة قدامك بإيدي، وبعدين تعملها إنت بنفسك. الباقي كله في فصول قصيرة تفتحها وقت ما تحب. اضغط في أي حتة وأنا هتنحّى.`
                : `Ten minutes on the daily basics of ${clinic?.name || "the system"}: a patient, a booking, the day from the desk, a payment. I do each one in front of you, then you do it yourself. Everything else is in short chapters you open whenever you like. Click anywhere and I step aside.`}
            </p>
            <p className="mt-4 flex items-center gap-1.5 text-[12px] font-bold text-white/40">
              <Clock size={13} />
              {isAr ? `حوالي ${minutes} دقيقة · ${tour.coreStops.length} محطة · بصوتي، أو اقرا` : `About ${minutes} minutes · ${tour.coreStops.length} stops · spoken, or read along`}
            </p>
            <div className="mt-9 flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => tour.start({ fromStart: true })}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#FACC15] px-7 py-3.5 text-[14px] font-black text-ink shadow-xl shadow-[#FACC15]/20 transition-all hover:brightness-105 active:scale-[0.98] sm:w-auto"
              >
                {isAr ? "يلا نبدأ الجولة" : "Take the tour"}
                <ArrowIcon size={16} />
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="inline-flex w-full items-center justify-center rounded-full border border-white/15 px-6 py-3.5 text-[14px] font-bold text-white/70 transition-colors hover:bg-white/10 hover:text-white sm:w-auto"
              >
                {isAr ? "مش دلوقتي" : "Not now"}
              </button>
            </div>
            <p className="mt-6 text-[11.5px] font-medium text-white/35">
              {isAr
                ? "هتلاقيني في أي وقت تحت اسمك فوق ← «جولة مع سارة»."
                : `You'll find me any time under your name at the top → "Tour with ${guide}".`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
