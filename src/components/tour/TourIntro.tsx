"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
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
 * dashboard in English. Then her name, one offer, and two buttons. It appears once per person
 * per clinic and never by itself again; declining is one click and the tour stays a menu item
 * away.
 *
 * Deliberately not a modal over the dashboard. A card over a busy screen competes with the
 * screen. The point of this moment is that there is nothing else on it.
 */
export default function TourIntro() {
  const tour = useTour();
  const { activeTutorial } = useTutorial();
  const { language, isRTL, toggleLanguage } = useLanguage();
  const { user } = useAuth();
  const { clinic, clinicId } = useClinic();
  const { receptionPanelActive } = useUI();
  const pathname = usePathname();
  const isAr = language === "ar";

  // A beat after the page paints, so the app is seen first and this arrives over it.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 700);
    return () => clearTimeout(t);
  }, []);

  /** First the language, then the welcome. */
  const [languageChosen, setLanguageChosen] = useState(false);

  if (!ready || !clinicId || !user) return null;
  if (tour.progress.introSeen || tour.active) return null;
  if (tour.stops.length === 0) return null;
  // Not over the setup wizard (it comes first), a lesson, or the reception desk mid-call.
  if (pathname === "/setup" || activeTutorial || receptionPanelActive) return null;

  const firstName = (user.name || "").trim().split(/\s+/)[0] || "";
  const guide = isAr ? TOUR_GUIDE.ar : TOUR_GUIDE.en;
  const minutes = tourMinutes(tour.stops.length);
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
                ? `هاخدك في جولة على ${clinic?.name || "النظام"} كله — كل شاشة، وكل إعداد، وكل مفتاح. هساعدك تجهّز العيادة بجد، وهعمل كل حاجة قدامك بإيدي، وتقدر تسألني أي حاجة في أي وقت. وقّفني لما تحب وارجع من نفس المكان.`
                : `I'll show you the whole of ${clinic?.name || "the system"} — every screen, every setting, every switch. I'll help you set the clinic up for real, do things in front of you with my own hands, and you can ask me anything along the way. Stop whenever you like and pick up where you left off.`}
            </p>
            <p className="mt-4 flex items-center gap-1.5 text-[12px] font-bold text-white/40">
              <Clock size={13} />
              {isAr ? `حوالي ${minutes} دقيقة · ${tour.stops.length} محطة · تقدر تسمعني بصوتي كمان` : `About ${minutes} minutes · ${tour.stops.length} stops · you can hear me too`}
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
                onClick={tour.declineIntro}
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
