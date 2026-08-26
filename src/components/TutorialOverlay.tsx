"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X, ArrowRight, ArrowLeft, GraduationCap } from "lucide-react";
import { useTutorial } from "@/context/TutorialContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";

/**
 * The hand that points.
 *
 * When a tutorial is running, this draws a pulsing ring over the element the current step wants
 * clicked, and a card along the bottom of the screen saying what to do. It advances when the user
 * genuinely clicks the marked element — not a "Next" that merely describes clicking — so finishing
 * a tutorial and finishing the real task are the same thing. Steps that point at a field to type
 * into have nothing clickable to advance on, so those carry `advanceOn: "next"` and get a button.
 *
 * Mechanics worth knowing before editing:
 *
 * - Targets are found by `[data-tour="…"]`, polled rather than queried once: a step's element may
 *   be inside a modal still animating open, or on a route we only just pushed. Polling also makes
 *   the ring follow layout shifts and scrolling, since the rect is re-measured on every tick.
 * - The ring is pointer-events:none. The user's click lands on the REAL element — the app's own
 *   handler opens the modal / navigates / saves — and a capture-phase listener on the document
 *   merely observes that it happened and advances after a beat. The tutorial never performs the
 *   action itself; it only watches the user perform it. That is the difference between teaching
 *   and doing.
 * - Cancel is everywhere it could be looked for: the card's button, the Escape key, and (in the
 *   chat widget) typing "cancel". A guide that is hard to get rid of trains people never to open
 *   it again.
 * - If the element cannot be found after a few seconds (role-gated button, changed screen), the
 *   card says so and offers Skip — silently hanging on an invisible target reads as "the app
 *   froze", which is worse for a beginner than admitting the step cannot be shown.
 */

/** How long to hunt for a step's element before offering Skip. */
const LOST_AFTER_MS = 6000;
/** Optional steps (permission-gated nav links) give up sooner — and skip, not fail. */
const OPTIONAL_LOST_AFTER_MS = 2500;
/** Rect refresh cadence — cheap (a querySelectorAll + a few getBoundingClientRects). */
const POLL_MS = 250;
/** Breathing room between the element's edge and the ring. */
const RING_PAD = 8;

/**
 * First VISIBLE element carrying the anchor.
 *
 * Not querySelector: the desktop rail and the mobile nav are both permanently in the DOM with CSS
 * hiding whichever doesn't apply, and list rows repeat one attribute across every card. The first
 * match in document order is therefore often a display:none twin. display:none collapses the rect
 * to 0×0, so "has a real rect" is the visibility test — it also naturally picks "any patient card"
 * for repeated anchors.
 */
function findVisibleAnchor(anchor: string): { el: HTMLElement; rect: DOMRect } | null {
  const els = document.querySelectorAll<HTMLElement>(`[data-tour="${anchor}"]`);
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (rect.width >= 2 || rect.height >= 2) return { el, rect };
  }
  return null;
}

export default function TutorialOverlay() {
  const { activeTutorial, stepIndex, cancelTutorial, advanceStep } = useTutorial();
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";
  const router = useRouter();
  const pathname = usePathname();

  const [rect, setRect] = useState<DOMRect | null>(null);
  const [lost, setLost] = useState(false);
  const lostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Set the moment the watched element is clicked, cleared when the step changes. Guards against
   * one physical click advancing twice (React 18 double-invoke never applies to DOM listeners,
   * but a click can bubble through nested anchored elements) and freezes the ring in its
   * "acknowledged" state during the beat before the next step appears.
   */
  const advancing = useRef(false);

  const step = activeTutorial?.steps[stepIndex] ?? null;
  const isLastStep = !!activeTutorial && stepIndex === activeTutorial.steps.length - 1;

  /** Completion lives here, not in the provider: the toast needs UIContext and the language. */
  const finishOrAdvance = useCallback(() => {
    if (isLastStep) {
      showToast(
        isAr
          ? `أحسنت! خلّصت درس "${activeTutorial!.title.ar}" 🎉`
          : `Well done — you finished "${activeTutorial!.title.en}" 🎉`,
        "success",
      );
      cancelTutorial();
    } else {
      advanceStep();
    }
  }, [isLastStep, activeTutorial, isAr, showToast, cancelTutorial, advanceStep]);

  // New step: reset the found/lost state and, if the step lives on another route, go there.
  useEffect(() => {
    if (!step) return;
    advancing.current = false;
    setRect(null);
    setLost(false);
    // "Open the Patients page" is pointless teaching when the user is already on it.
    // finishOrAdvance, not advanceStep: a skipped LAST step must still end the lesson —
    // a bare increment past the end would leave the tutorial active forever with no card.
    if (step.skipIfRoute && pathname === step.skipIfRoute) {
      finishOrAdvance();
      return;
    }
    if (step.route && pathname !== step.route) {
      router.push(step.route);
    }
    if (lostTimer.current) clearTimeout(lostTimer.current);
    if (step.optional) {
      // A permission gate or a collapsed menu can remove this element entirely. An optional step
      // that cannot be shown moves on by itself — the next step carries a route of its own, so
      // the lesson continues instead of stalling on a link this user does not have.
      lostTimer.current = setTimeout(() => {
        if (!advancing.current) {
          advancing.current = true;
          finishOrAdvance();
        }
      }, OPTIONAL_LOST_AFTER_MS);
    } else {
      lostTimer.current = setTimeout(() => setLost(true), LOST_AFTER_MS);
    }
    return () => {
      if (lostTimer.current) clearTimeout(lostTimer.current);
    };
    // pathname is deliberately absent: it changing is the *result* of the push above, and
    // re-running this effect on arrival would restart the lost-timer for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTutorial, stepIndex, finishOrAdvance]);

  // Find and follow the target element.
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    const measure = () => {
      const found = findVisibleAnchor(step.anchor);
      if (!found) {
        setRect(null);
        return;
      }
      setRect(found.rect);
      setLost(false);
      if (lostTimer.current) {
        clearTimeout(lostTimer.current);
        lostTimer.current = null;
      }
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
  }, [step]);

  // Advance when the marked element is genuinely clicked.
  useEffect(() => {
    if (!step || step.advanceOn === "next") return;
    const onClickCapture = (e: MouseEvent) => {
      if (advancing.current) return;
      if (!(e.target instanceof Node)) return;
      // Any element carrying the anchor counts — repeated anchors (patient cards, the two
      // mounts of the booking form) mean the clicked one is not necessarily the ringed one.
      const els = document.querySelectorAll<HTMLElement>(`[data-tour="${step.anchor}"]`);
      let hit = false;
      for (const el of els) {
        if (el.contains(e.target)) {
          hit = true;
          break;
        }
      }
      if (!hit) return;
      advancing.current = true;
      // A beat before pointing at the next thing, so whatever this click opened (a modal, a
      // route) has begun appearing — the next ring then finds its element on the first polls.
      setTimeout(finishOrAdvance, 400);
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [step, finishOrAdvance]);

  // Escape ends the lesson, from anywhere.
  useEffect(() => {
    if (!activeTutorial) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelTutorial();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activeTutorial, cancelTutorial]);

  if (!activeTutorial || !step) return null;

  const ringStyle = rect
    ? {
        top: rect.top - RING_PAD,
        left: rect.left - RING_PAD,
        width: rect.width + RING_PAD * 2,
        height: rect.height + RING_PAD * 2,
      }
    : undefined;

  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;

  return (
    <>
      {/* The pulsing ring. pointer-events-none: the click must land on the real element. */}
      {rect && (
        <div className="fixed z-[9980] pointer-events-none transition-all duration-200" style={ringStyle}>
          <div className="absolute inset-0 rounded-2xl border-[3px] border-teal-500 shadow-[0_0_0_4px_rgba(20,184,166,0.25),0_0_24px_rgba(20,184,166,0.5)]" />
          <div className="absolute inset-0 rounded-2xl border-2 border-teal-400 animate-ping opacity-70" />
        </div>
      )}

      {/* The instruction card — fixed to the bottom so it never covers what the ring marks. */}
      <div
        className="fixed bottom-24 lg:bottom-4 left-1/2 -translate-x-1/2 z-[9981] w-[calc(100vw-2rem)] max-w-md"
        dir={isRTL ? "rtl" : "ltr"}
      >
        <div className="bg-white/90 backdrop-blur-3xl border border-white/60 shadow-[0_8px_40px_rgba(0,0,0,0.12)] rounded-[1.5rem] px-5 py-4 animate-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-7 h-7 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
              <GraduationCap size={15} />
            </div>
            <span className="text-[11px] font-black text-slate-800 tracking-tight truncate">
              {isAr ? activeTutorial.title.ar : activeTutorial.title.en}
            </span>
            <span className="text-[10px] font-bold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full tabular-nums ms-auto shrink-0">
              {stepIndex + 1} / {activeTutorial.steps.length}
            </span>
            <button
              onClick={cancelTutorial}
              className="w-7 h-7 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors shrink-0"
              aria-label={isAr ? "إلغاء الدرس" : "Cancel tutorial"}
            >
              <X size={15} />
            </button>
          </div>

          <p className="text-[13px] font-semibold text-slate-700 leading-relaxed">
            {isAr ? step.text.ar : step.text.en}
          </p>

          <div className="flex items-center gap-2 mt-3">
            {/* Searching / lost states — honesty beats a ring around nothing. */}
            {!rect && !lost && (
              <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />
                {isAr ? "بندوّر على المكان…" : "Finding the spot…"}
              </span>
            )}
            {lost && !rect && (
              <span className="text-[11px] font-bold text-amber-600">
                {isAr
                  ? "مش لاقي العنصر ده على الشاشة — ممكن يكون مقفول لصلاحيتك."
                  : "Can't find that on this screen — it may be hidden for your role."}
              </span>
            )}

            <div className="ms-auto flex items-center gap-2">
              {lost && !rect && (
                <button
                  onClick={finishOrAdvance}
                  className="px-3 py-1.5 rounded-full text-[11px] font-black text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  {isAr ? "تخطّي" : "Skip"}
                </button>
              )}
              {step.advanceOn === "next" && (
                <button
                  onClick={finishOrAdvance}
                  className="px-4 py-1.5 rounded-full text-[11px] font-black text-white bg-teal-600 hover:bg-teal-700 shadow-md shadow-teal-600/20 transition-colors flex items-center gap-1.5"
                >
                  {isLastStep ? (isAr ? "تم" : "Done") : (isAr ? "التالي" : "Next")}
                  <ArrowIcon size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
