"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Check, GraduationCap, ListChecks, X } from "lucide-react";
import AvatarFace from "@/components/appointments/AvatarFace";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { useTutorial } from "@/context/TutorialContext";
import { useWelcome } from "@/context/WelcomeContext";
import { useAuth } from "@/context/AuthContext";
import { RECEPTIONIST_NAME } from "@/lib/receptionist";
import { coachGreeting } from "@/lib/welcomeJourney";

/**
 * The assistant, speaking first.
 *
 * A new clinic's problem is not that the system lacks a guide — it has a shelf of walkthroughs — it is
 * that nothing ever mentions them. They live behind a floating orb, inside a tab called Trainer,
 * under a heading called "Teach me". So this is the one part of the welcome experience that is not
 * waiting to be found: a bubble above the orb saying what to do next, why it is worth three
 * minutes, and offering to point at it on the real screen.
 *
 * It says exactly one thing at a time. A checklist of thirteen items is a page (`/welcome`); a
 * bubble that interrupts is allowed one sentence and one button, and it earns the next one by
 * being right about this one.
 *
 * When it stays quiet, and why — all decided in `coachDecision`, not here:
 *  - the guide is finished (the only ending that needs no goodbye),
 *  - a lesson is running: its ring owns the screen and this would talk over it,
 *  - it was closed, which means for good and on every device this person signs in from,
 *  - the signals have not come back yet, so "next" would be a guess.
 *
 * And two it decides for itself, because they are about where it is standing rather than what it
 * has to say: the assistant's own chat panel unfolds over this exact spot, and `/welcome` already
 * shows all of it in full.
 */
export default function WelcomeCoach() {
  const { language, isRTL } = useLanguage();
  const { receptionPanelActive, assistantPanelOpen } = useUI();
  const { startTutorial } = useTutorial();
  const { progress, trial, coach, dismiss } = useWelcome();
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isAr = language === "ar";

  /**
   * The same corner arithmetic as `AiChatWidget`, deliberately duplicated rather than shared.
   *
   * Both are ten lines of Tailwind that describe one visual relationship — this bubble sits on
   * top of that orb — and a helper spanning two files would hide it rather than express it. The
   * one rule to keep: if the orb moves in the widget, it moves here, or the bubble points at
   * nothing.
   */
  const onFarSide = receptionPanelActive ? !isRTL : isRTL;
  const lifted = pathname === "/chats";

  if (!coach.speak) return null;
  // The chat panel unfolds from the orb directly below this bubble and would bury it.
  if (assistantPanelOpen) return null;
  // On the guide itself, every word of this is already on the page in full.
  if (pathname === "/welcome") return null;

  const next = progress.next;
  if (!next) return null;

  const alphaName = isAr ? RECEPTIONIST_NAME.ar : RECEPTIONIST_NAME.en;
  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;
  const firstName = (user?.name || "").trim().split(/\s+/)[0] || "";

  const greeting = coachGreeting({ progress, trial, isAr, firstName });

  /**
   * "Show me" — the ring, when the mission has a lesson; the screen itself when it does not.
   *
   * Never both: pushing the route AND starting the lesson makes the overlay navigate a second
   * time from its own first step. Every mission today carries a lesson, so the route branch is
   * the fallback for a mission added later without one.
   */
  const showMe = () => {
    if (next.tutorialId && startTutorial(next.tutorialId)) return;
    router.push(next.route);
  };

  const pct = progress.percent;

  return (
    <div
      /*
       * Pinned to BOTH side edges rather than one edge plus a width.
       *
       * With `right-6 w-[22rem]` the card is only on screen while the browser agrees that its
       * containing block is the viewport — and a single transformed or contained ancestor
       * anywhere above it silently makes that untrue, which puts the card's right half past the
       * window with its text cut mid-word. Pinning both edges and capping the width means the
       * worst case is a card that is narrower than intended, never one that is off screen.
       */
      className={`fixed z-[60] bottom-24 ${lifted ? "lg:bottom-44" : "lg:bottom-20"} inset-x-4 sm:inset-x-6 ${
        onFarSide ? "sm:end-auto" : "sm:start-auto"
      } sm:w-[22rem] sm:max-w-[calc(100vw-3rem)] max-h-[calc(100dvh-8rem)] overflow-y-auto`}
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="rounded-[1.75rem] border border-white/60 bg-white/90 shadow-[0_8px_40px_rgba(0,0,0,0.14)] backdrop-blur-3xl animate-in slide-in-from-bottom-4 fade-in duration-300 overflow-hidden">
        {/* A thread of progress across the top: the shortest way to say "this has an end". */}
        <div className="h-1 w-full bg-surface-muted">
          <div
            className="h-full bg-[#FACC15] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="px-4 pt-3 pb-3.5">
          <div className="flex items-start gap-2.5">
            <div className="shrink-0 -mt-0.5">
              <AvatarFace state="idle" size={34} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-black tracking-tight text-slate-800 truncate">
                  {alphaName}
                </span>
                <span className="text-[9px] font-black uppercase tracking-widest text-ink bg-[#FACC15] px-1.5 py-0.5 rounded-full shrink-0">
                  {isAr ? "مدرّب" : "Coach"}
                </span>
                <span className="ms-auto text-[10px] font-black text-slate-400 tabular-nums shrink-0">
                  {progress.done}/{progress.total}
                </span>
                {/* The X means never again, and says so.

                    It has been through three versions. First it opened a menu asking whether you
                    meant "later" or "never" — a question nobody wants after pressing a close
                    button, and because neither option had been chosen, nothing was remembered and
                    the bubble came straight back. Then it snoozed, for six hours, then a day, then
                    a week, then a week for ever: a bubble that always came back eventually, which
                    is the definition of a nag however politely it is spaced. Now closing it is the
                    answer, and it is final. Getting started has a button to bring her back, and
                    that page is the only thing that can. */}
                <button
                  onClick={dismiss}
                  aria-label={isAr ? "مش عايز الشرح" : "Don't show this again"}
                  title={
                    isAr
                      ? "مش هتظهر تاني — تقدر ترجّعها من صفحة البداية"
                      : "It won't come back — you can turn it on again from Getting started"
                  }
                  className="w-6 h-6 -me-1 rounded-full text-ink-muted hover:text-ink hover:bg-surface-muted flex items-center justify-center transition-colors shrink-0"
                >
                  <X size={14} />
                </button>
              </div>

              <p className="mt-1 text-[12.5px] font-semibold leading-relaxed text-slate-700">
                {greeting}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={showMe}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#FACC15] hover:brightness-105 px-3 py-2 text-[11.5px] font-black text-ink shadow-sm transition-all active:scale-[0.98]"
            >
              {next.tutorialId ? <GraduationCap size={13} /> : <ArrowIcon size={13} />}
              {isAr ? "وريني إزاي" : "Show me how"}
            </button>
            <Link
              href="/welcome"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-[11.5px] font-black text-ink-body hover:bg-surface-subtle transition-colors"
            >
              <ListChecks size={13} />
              {isAr ? "كل الخطوات" : "All steps"}
            </Link>
          </div>

          {/* The line that was only ever a demand now also carries its own off switch, in plain
              words and always on screen. Anything that talks first has to say how to stop it. */}
          <div className="mt-2.5 flex items-center gap-3 border-t border-line pt-2">
            {progress.done > 0 ? (
              <p className="flex min-w-0 items-center gap-1 text-[10.5px] font-bold text-ink-muted">
                <Check size={11} className="shrink-0" />
                <span className="truncate">
                  {isAr
                    ? `خلّصت ${progress.done} خطوة — فاضل حوالي ${progress.minutesLeft} دقيقة`
                    : `${progress.done} done — about ${progress.minutesLeft} minutes left`}
                </span>
              </p>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            <button
              onClick={dismiss}
              title={
                isAr
                  ? "تقدر ترجّعه من صفحة البداية"
                  : "You can turn it back on from Getting started"
              }
              className="ms-auto shrink-0 text-[10.5px] font-bold text-ink-faint underline decoration-dotted underline-offset-2 transition-colors hover:text-[#c0392b]"
            >
              {isAr ? "بطّل الشرح خالص" : "Stop coaching me"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
