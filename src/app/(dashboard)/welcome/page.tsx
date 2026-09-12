"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  GraduationCap,
  Loader2,
  Lock,
  PartyPopper,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useClinic } from "@/context/ClinicContext";
import { useAuth } from "@/context/AuthContext";
import { useTutorial } from "@/context/TutorialContext";
import { useWelcome } from "@/context/WelcomeContext";
import { DemoTourCard } from "@/components/welcome/DemoTour";
import { TUTORIALS, tutorialsFor } from "@/lib/tutorials";
import { MISSIONS, type Mission } from "@/lib/welcomeJourney";
import PageHeader from "@/components/dashboard/PageHeader";

/**
 * Getting started — the whole route, on one page.
 *
 * The coach bubble says one thing at a time, which is right for an interruption and wrong for
 * someone who has sat down to set the clinic up properly. This is the other half: every step in
 * order, what each one buys, what is already done and how it was proved, and how long the rest
 * takes. Nothing here is a demo — every button either rings the real screen or opens it.
 *
 * A step is ticked because the clinic HAS the thing (a patient exists, the schedule was saved) or
 * because this person finished its lesson. Both are shown the same way and neither can be clicked
 * to fake: there is no "mark as done". A checklist you can lie to is a checklist that tells you
 * nothing a week later, and the whole value of this page on day nine of a trial is that its
 * percentage is true.
 */

/** The completion ring at the top. Plain SVG — one number deserves no charting library. */
function ProgressRing({ percent, size = 92 }: { percent: number; size?: number }) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.min(100, Math.max(0, percent)) / 100) * circumference;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        className="text-white/15"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        className="text-accent transition-[stroke-dasharray] duration-700"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        // Start at twelve o'clock rather than three, so the ring reads as a clock face.
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export default function WelcomePage() {
  const { language, isRTL } = useLanguage();
  const { clinic, clinicId, isAdmin } = useClinic();
  const { user } = useAuth();
  const { startTutorial } = useTutorial();
  const { loading, progress, trial, locked, coachDismissed, restore, refresh } = useWelcome();
  const router = useRouter();

  const isAr = language === "ar";
  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;

  /**
   * Lessons that teach something no mission covers.
   *
   * Empty today — every walkthrough is on the route. It exists so that stays true by construction:
   * add a lesson to `tutorials.ts` and forget to give it a mission, and it appears here instead of
   * vanishing from the guide, which is the failure this page is supposed to end.
   */
  const extraLessons = useMemo(() => {
    const claimed = new Set(MISSIONS.map((m) => m.tutorialId).filter(Boolean));
    return tutorialsFor(isAdmin, user?.permissions).filter((t) => !claimed.has(t.id));
  }, [isAdmin, user?.permissions]);

  const openMission = (mission: Mission) => {
    if (mission.tutorialId && startTutorial(mission.tutorialId)) return;
    router.push(mission.route);
  };

  if (!clinicId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-accent" size={26} />
      </div>
    );
  }

  const firstName = (user?.name || "").trim().split(/\s+/)[0] || "";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-10 space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      {/* Who you are and what this is: in the layout's black band. This card kept the part that
          cannot live in a header — how far in you are, and how long is left. */}
      <PageHeader
        eyebrow={isAr ? "البداية" : "Getting started"}
        title={firstName
                ? isAr
                  ? `أهلاً يا ${firstName} — يلا نظبط ${clinic?.name || "العيادة"}`
                  : `Welcome, ${firstName} — let's set ${clinic?.name || "your clinic"} up`
                : isAr
                  ? `يلا نظبط ${clinic?.name || "العيادة"}`
                  : `Let's set ${clinic?.name || "your clinic"} up`}
        subtitle={isAr
                ? "كل خطوة تحت بتتشرح على الشاشة الحقيقية — بتضغط «وريني إزاي» وبتظهر دايرة بتشاور على المكان بالظبط. والخطوة بتتشطب لما تعملها بجد، مش لما تتفرج عليها."
                : "Every step below is taught on the real screen — press \"Show me how\" and a ring points at the exact spot. A step ticks itself when you actually do it, not when you watch it."}
      />

      <header className="relative overflow-hidden rounded-[2rem] bg-ink-slab px-6 py-7 text-white shadow-xl shadow-ink-slab/20 sm:px-8">
        <div className="absolute -top-24 -end-20 h-64 w-64 rounded-full bg-accent-soft/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex shrink-0 items-center gap-4">
            <div className="relative flex items-center justify-center">
              <ProgressRing percent={loading ? 0 : progress.percent} />
              <span className="absolute inset-0 flex flex-col items-center justify-center">
                {loading ? (
                  <Loader2 size={18} className="animate-spin text-white/60" />
                ) : (
                  <>
                    <span className="font-figure text-xl font-bold leading-none text-white tabular-nums">
                      {progress.percent}%
                    </span>
                    <span className="mt-0.5 text-[9px] font-black uppercase tracking-widest text-white/40">
                      {progress.done}/{progress.total}
                    </span>
                  </>
                )}
              </span>
            </div>

            <div className="space-y-1.5 text-[11px] font-bold">
              {trial.isTrial && trial.endsAt && (
                <p className={trial.ended ? "text-rose-300" : "text-white/70"}>
                  {trial.ended
                    ? isAr
                      ? "فترة التجربة خلصت"
                      : "Your trial has ended"
                    : isAr
                      ? `فاضل ${trial.daysLeft} يوم في التجربة`
                      : `${trial.daysLeft} ${trial.daysLeft === 1 ? "day" : "days"} left in your trial`}
                </p>
              )}
              {!loading && !progress.complete && (
                <p className="flex items-center gap-1.5 text-white/50">
                  <Clock size={12} />
                  {isAr
                    ? `حوالي ${progress.minutesLeft} دقيقة لباقي الخطوات`
                    : `About ${progress.minutesLeft} min of steps left`}
                </p>
              )}
              <button
                onClick={refresh}
                className="inline-flex items-center gap-1.5 text-white/45 transition-colors hover:text-white"
              >
                <RotateCcw size={11} />
                {isAr ? "تحديث" : "Refresh"}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* --- A populated clinic to look at, while this one is still empty --------------------- */}
      {!loading && !progress.complete && <DemoTourCard />}

      {/* --- Finished ------------------------------------------------------------------------ */}
      {!loading && progress.complete && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <PartyPopper size={20} className="mt-0.5 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-black text-emerald-800">
              {isAr ? "خلصت كل الخطوات 🎉" : "Every step is done 🎉"}
            </p>
            <p className="mt-0.5 text-[12.5px] font-medium leading-relaxed text-emerald-700">
              {isAr
                ? "العيادة شغالة بالكامل. لو احتجت أي حاجة، افتح المساعد من الدايرة اللي تحت واسأل عادي."
                : "Your clinic is fully up and running. Anything you need, open the assistant from the orb below and just ask."}
            </p>
          </div>
        </div>
      )}

      {/* --- The coach was switched off; offer it back ---------------------------------------- */}
      {coachDismissed && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-subtle px-5 py-4">
          <p className="text-[12.5px] font-semibold text-ink-body">
            {isAr
              ? "المدرّب متوقف. تحب يرجع يقولك الخطوة اللي بعدها وانت شغال؟"
              : "Coaching is switched off. Want the next step offered to you again as you work?"}
          </p>
          <button
            onClick={restore}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[11.5px] font-black text-ink-on-accent transition-colors hover:bg-accent-strong"
          >
            <Sparkles size={13} />
            {isAr ? "رجّع المدرّب" : "Turn coaching back on"}
          </button>
        </div>
      )}

      {/* --- The route ------------------------------------------------------------------------ */}
      {loading ? (
        <div className="space-y-3" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-surface-subtle" />
          ))}
        </div>
      ) : (
        progress.stages.map((stage, stageIndex) => (
          <section key={stage.stage.id} className="rounded-[1.75rem] border border-line bg-surface p-5 sm:p-6">
            <div className="mb-4 flex items-start gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-black ${
                  stage.done === stage.total
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-accent-tint text-accent"
                }`}
              >
                {stage.done === stage.total ? <Check size={15} /> : stageIndex + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base font-bold tracking-tight text-ink">
                  {isAr ? stage.stage.title.ar : stage.stage.title.en}
                </h2>
                <p className="mt-0.5 text-[12px] font-medium leading-relaxed text-ink-muted">
                  {isAr ? stage.stage.blurb.ar : stage.stage.blurb.en}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-surface-subtle px-2.5 py-1 text-[10px] font-black tabular-nums text-ink-muted">
                {stage.done}/{stage.total}
              </span>
            </div>

            <ul className="space-y-2">
              {stage.missions.map(({ mission, done }) => (
                <li
                  key={mission.id}
                  className={`flex flex-col gap-3 rounded-2xl border px-4 py-3.5 transition-colors sm:flex-row sm:items-center ${
                    done ? "border-emerald-200/70 bg-emerald-50/40" : "border-line bg-surface-subtle"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                      done
                        ? "border-emerald-300 bg-emerald-500 text-white"
                        : "border-line-strong bg-surface text-ink-muted"
                    }`}
                    aria-hidden
                  >
                    {done ? <Check size={14} strokeWidth={3} /> : <span className="h-2 w-2 rounded-full bg-current opacity-40" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[13.5px] font-bold leading-snug ${
                        done ? "text-emerald-900" : "text-ink"
                      }`}
                    >
                      {isAr ? mission.title.ar : mission.title.en}
                    </p>
                    <p className="mt-0.5 text-[12px] font-medium leading-relaxed text-ink-muted">
                      {isAr ? mission.payoff.ar : mission.payoff.en}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {!done && (
                      <span className="hidden text-[10.5px] font-black tabular-nums text-ink-muted sm:inline">
                        {mission.minutes} {isAr ? "د" : "min"}
                      </span>
                    )}
                    <button
                      onClick={() => openMission(mission)}
                      className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[11.5px] font-black transition-colors active:scale-[0.98] ${
                        done
                          ? "border border-line bg-surface text-ink-body hover:bg-surface-subtle"
                          : "bg-accent text-ink-on-accent shadow-md hover:bg-accent-strong"
                      }`}
                    >
                      {mission.tutorialId ? <GraduationCap size={13} /> : <ArrowIcon size={13} />}
                      {done
                        ? isAr
                          ? "راجعها"
                          : "Show again"
                        : isAr
                          ? "وريني إزاي"
                          : "Show me how"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* --- Lessons no mission claims -------------------------------------------------------- */}
      {extraLessons.length > 0 && (
        <section className="rounded-[1.75rem] border border-line bg-surface p-5 sm:p-6">
          <h2 className="font-display text-base font-bold tracking-tight text-ink">
            {isAr ? "دروس كمان" : "More lessons"}
          </h2>
          <ul className="mt-3 space-y-2">
            {extraLessons.map((t) => (
              <li
                key={t.id}
                className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-subtle px-4 py-3.5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold leading-snug text-ink">
                    {isAr ? t.title.ar : t.title.en}
                  </p>
                  <p className="mt-0.5 text-[12px] font-medium leading-relaxed text-ink-muted">
                    {isAr ? t.description.ar : t.description.en}
                  </p>
                </div>
                <button
                  onClick={() => startTutorial(t.id)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-[11.5px] font-black text-ink-body transition-colors hover:bg-surface-subtle"
                >
                  <GraduationCap size={13} />
                  {isAr ? "وريني إزاي" : "Show me how"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- What the plan does not include yet ------------------------------------------------ */}
      {locked.length > 0 && (
        <section className="rounded-[1.75rem] border border-dashed border-line bg-surface-subtle p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-base font-bold tracking-tight text-ink">
            <Lock size={15} className="text-ink-muted" />
            {isAr ? "مش متاح في باقتك الحالية" : "Not in your current plan"}
          </h2>
          <p className="mt-1 text-[12px] font-medium leading-relaxed text-ink-muted">
            {/* Named rather than hidden: "stock control is in the paid plans" is a useful fact for
                someone deciding at the end of a trial, and it is the honest reason the step is
                not on their list. Deliberately outside every count above. */}
            {isAr
              ? "الخطوات دي محتاجة باقة أعلى. مش محسوبة في نسبة الإنجاز فوق."
              : "These need a higher plan. They are not counted in the progress above."}
          </p>
          <ul className="mt-3 space-y-2">
            {locked.map((mission) => (
              <li key={mission.id} className="rounded-2xl border border-line bg-surface px-4 py-3">
                <p className="text-[13px] font-bold text-ink-muted">
                  {isAr ? mission.title.ar : mission.title.en}
                </p>
                <p className="mt-0.5 text-[12px] font-medium leading-relaxed text-ink-muted">
                  {isAr ? mission.payoff.ar : mission.payoff.en}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- Where to go when a lesson is not the answer --------------------------------------- */}
      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4">
        <p className="text-[12.5px] font-semibold text-ink-body">
          {isAr
            ? "محتاج شرح مكتوب أطول؟ مركز المساعدة فيه كل حاجة بالتفصيل."
            : "Want it written out in full? The Help Center has the long version."}
        </p>
        <Link
          href="/help"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface-subtle px-4 py-2 text-[11.5px] font-black text-ink-body transition-colors hover:bg-surface"
        >
          {isAr ? "مركز المساعدة" : "Help Center"}
          <ArrowIcon size={13} />
        </Link>
      </footer>

      {/* Kept honest: the count above is the count of lessons that exist, not a hard-coded one. */}
      <p className="pb-4 text-center text-[11px] font-medium text-ink-muted">
        {isAr
          ? `${TUTORIALS.length} درس تفاعلي على الشاشة الحقيقية`
          : `${TUTORIALS.length} interactive lessons, on the real screen`}
      </p>
    </div>
  );
}
