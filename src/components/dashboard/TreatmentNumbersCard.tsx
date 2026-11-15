"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { getToday, rangeFor } from "@/lib/reportHelpers";
import { rowInScope } from "@/lib/branchAccess";
import { loadTreatmentNotes } from "@/lib/reports/treatmentNotesClient";
import { TREATMENT_STATES, buildTreatmentStatus, type TreatmentState } from "@/lib/reports/treatmentStatus";

type Row = Record<string, unknown> & { id: string };
const PRESET = { day: "today", week: "week", month: "month" } as const;

/**
 * Planned, in progress, done — three numbers on the owner's home.
 *
 * Each number opens the Treatments report on the same period and the same state, so the figure
 * pressed is the figure the list adds up to: both are counted by lib/reports/treatmentStatus from
 * the same reads. Draws nothing until the numbers are in, and nothing at all if they cannot be read.
 */
export default function TreatmentNumbersCard({ period, scopeBranchId }: { period: "day" | "week" | "month"; scopeBranchId: string }) {
  const { clinicId } = useClinic();
  const { language } = useLanguage();
  const isAr = language === "ar";
  const preset = PRESET[period];
  const today = getToday();
  const range = useMemo(() => rangeFor(preset, today), [preset, today]);
  const underBranch = scopeBranchId !== "";

  const [loaded, setLoaded] = useState<{ key: string; notes: Row[] } | null>(null);
  const key = `${clinicId}|${range.start}|${range.end}|${underBranch}`;
  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    loadTreatmentNotes(range, { branches: underBranch })
      .then((notes) => {
        if (!cancelled) setLoaded({ key, notes });
      })
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
    // `key` carries the clinic, the period and whether a branch is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const status = useMemo(() => {
    if (!loaded || loaded.key !== key) return null;
    const notes = loaded.notes.filter((n) => rowInScope(n, scopeBranchId));
    return buildTreatmentStatus(notes, [], [], range, today);
  }, [loaded, key, scopeBranchId, range, today]);

  if (!status) return null;

  const word = (s: TreatmentState) =>
    isAr ? { Planned: "مخطط", Ongoing: "جاري", Completed: "اتعمل" }[s] : { Planned: "Planned", Ongoing: "In progress", Completed: "Done" }[s];
  const periodWord = isAr ? { day: "النهارده", week: "الأسبوع ده", month: "الشهر ده" }[period] : { day: "today", week: "this week", month: "this month" }[period];
  const egp = isAr ? "ج.م" : "EGP";
  const href = (state?: TreatmentState) => `/reports?report=treatments&preset=${preset}${state ? `&state=${state}` : ""}`;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-label={isAr ? "العلاجات" : "Treatments"}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-black text-ink">
          {isAr ? "العلاجات" : "Treatments"} <span className="text-[12px] font-bold text-ink-faint">· {periodWord}</span>
        </h2>
        <Link href={href()} className="inline-flex items-center gap-1 text-[12px] font-black text-ink-muted hover:text-ink">
          {isAr ? "افتح القائمة" : "Open the list"} <ArrowUpRight size={13} />
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {TREATMENT_STATES.map((s) => (
          <Link key={s} href={href(s)} className="flex min-w-0 flex-col gap-1 rounded-xl border border-line px-3 py-2.5 transition-colors hover:bg-surface-subtle">
            <span className="text-[11.5px] font-black text-ink-muted">{word(s)}</span>
            <span className="font-figure text-[clamp(20px,6vw,28px)] font-extrabold leading-none text-ink">{status.totals[s].count}</span>
            <span className="font-figure text-[11px] text-ink-faint">
              {Math.round(status.totals[s].value).toLocaleString()} {egp}
            </span>
          </Link>
        ))}
      </div>
      {status.older.count > 0 && (
        <p className="mt-2 px-1 text-[11.5px] font-bold text-ink-muted">
          {isAr ? `${status.older.count} علاج أقدم ولسه مخلصش.` : `${status.older.count} older treatments are still not finished.`}
        </p>
      )}
    </section>
  );
}
