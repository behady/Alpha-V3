"use client";

import { ArrowLeft, ArrowRight, Check, Clock, Play, RotateCcw } from "lucide-react";
import AvatarFace from "@/components/appointments/AvatarFace";
import { useTour } from "@/context/TourContext";
import { useLanguage } from "@/context/LanguageContext";
import { TOUR_GUIDE, tourMinutes } from "@/lib/grandTour";

/**
 * The tour's card on the Getting started page: where it stands, and the way in.
 *
 * Three states, one card: not started (an invitation), part-way (resume from the stop it was
 * left on, with the chapters ticked so far), finished (a quiet "done" and a way to take it
 * again). The chapter list is clickable — a person who wants only the Settings chapter should
 * not have to sit through the front desk to get there.
 */
export default function TourHero() {
  const tour = useTour();
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const guide = isAr ? TOUR_GUIDE.ar : TOUR_GUIDE.en;
  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;

  const { stops, chapters, progress } = tour;
  if (stops.length === 0) return null;

  const visited = new Set(progress.visited);
  const seen = stops.filter((s) => visited.has(s.id)).length;
  const finished = progress.completedAt > 0 && !progress.lastStopId;
  const resumeStop = progress.lastStopId ? stops.find((s) => s.id === progress.lastStopId) : null;
  const pct = Math.round((seen / stops.length) * 100);

  const chapterState = (chapterId: string) => {
    const inChapter = stops.filter((s) => s.chapter === chapterId);
    const done = inChapter.filter((s) => visited.has(s.id)).length;
    return { total: inChapter.length, done, first: inChapter[0] };
  };

  return (
    <section
      className="relative overflow-hidden rounded-[2rem] bg-ink-slab px-6 py-6 text-white shadow-xl shadow-ink-slab/20 sm:px-8 sm:py-7"
      data-tour="tour-hero"
    >
      <div className="pointer-events-none absolute -top-24 -end-16 h-64 w-64 rounded-full bg-[#FACC15]/10 blur-3xl" aria-hidden />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="shrink-0 rounded-full bg-white/5 p-1 ring-1 ring-white/10">
            <AvatarFace state="idle" size={64} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#FACC15]">
              {isAr ? `جولة مع ${guide}` : `Tour with ${guide}`}
            </p>
            <h2 className="font-display mt-1.5 text-2xl font-bold leading-tight tracking-tight">
              {finished
                ? isAr
                  ? "شفت النظام كله"
                  : "You've seen the whole system"
                : resumeStop
                  ? isAr
                    ? `نكمّل من «${resumeStop.title.ar}»؟`
                    : `Pick up at "${resumeStop.title.en}"?`
                  : isAr
                    ? "كل شاشة، وكل إعداد، وكل مفتاح"
                    : "Every screen, every setting, every switch"}
            </h2>
            <p className="mt-2 max-w-xl text-[13px] font-medium leading-relaxed text-white/65">
              {isAr
                ? `${guide} بتمشي معاك على النظام كله وبتشرح كل حاجة وهي بتنوّر مكانها على الشاشة، وتقدر تسألها أي سؤال في أي محطة. الجولة نفسها ببلاش؛ كل سؤال بيتكلف رصيد واحد.`
                : `${guide} walks you through the whole system, lighting up each part on the real screen as she explains it, and you can ask her anything at any stop. The tour itself is free; each question costs one credit.`}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              {!finished && (
                <button
                  type="button"
                  onClick={() => tour.start()}
                  className="inline-flex items-center gap-2 rounded-full bg-[#FACC15] px-5 py-2.5 text-[12.5px] font-black text-ink shadow-lg shadow-[#FACC15]/20 transition-all hover:brightness-105 active:scale-[0.98]"
                >
                  <Play size={14} strokeWidth={3} />
                  {resumeStop ? (isAr ? "كمّل الجولة" : "Resume the tour") : isAr ? "ابدأ الجولة" : "Start the tour"}
                </button>
              )}
              <button
                type="button"
                onClick={() => tour.start({ fromStart: true })}
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[12.5px] font-black transition-colors ${
                  finished
                    ? "bg-[#FACC15] text-ink shadow-lg shadow-[#FACC15]/20 hover:brightness-105"
                    : "border border-white/15 text-white/75 hover:bg-white/10 hover:text-white"
                }`}
              >
                <RotateCcw size={14} />
                {finished ? (isAr ? "خدها تاني" : "Take it again") : isAr ? "من الأول" : "From the start"}
              </button>
              <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-white/40">
                <Clock size={12} />
                {isAr ? `حوالي ${tourMinutes(stops.length)} دقيقة` : `About ${tourMinutes(stops.length)} min`}
              </span>
            </div>
          </div>
        </div>

        {/* Chapters — each one a way in. */}
        <div className="w-full shrink-0 lg:w-72">
          <div className="mb-2 flex items-center justify-between text-[10.5px] font-black uppercase tracking-widest text-white/40">
            <span>{isAr ? "الفصول" : "Chapters"}</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <ul className="space-y-1">
            {chapters.map((c) => {
              const st = chapterState(c.id);
              const done = st.total > 0 && st.done === st.total;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => st.first && tour.start({ stopId: st.first.id })}
                    className="group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start transition-colors hover:bg-white/10"
                  >
                    <span
                      className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                        done ? "bg-emerald-400/20 text-emerald-300" : st.done > 0 ? "bg-[#FACC15]/20 text-[#FACC15]" : "bg-white/10 text-white/50"
                      }`}
                    >
                      {done ? <Check size={11} strokeWidth={3} /> : st.done > 0 ? st.done : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold text-white/90">{isAr ? c.title.ar : c.title.en}</span>
                      <span className="block truncate text-[11px] font-medium text-white/40">{isAr ? c.blurb.ar : c.blurb.en}</span>
                    </span>
                    <ArrowIcon size={13} className="shrink-0 text-white/30 transition-colors group-hover:text-white" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
