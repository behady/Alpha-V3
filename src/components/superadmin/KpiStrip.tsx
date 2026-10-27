"use client";

import React from "react";
import { balanceOwed, isTrial, monthlyValue, type ConsoleClinic } from "./clinicMath";
import { useSuperAdminText } from "./i18n";

/**
 * The platform's totals on one dark band. Every figure carries a line under it saying what it
 * means for today — "$933 still owed", "1 ends within 7 days" — so the band reads as a status, not
 * a scoreboard.
 */
export function KpiStrip({ clinics }: { clinics: ConsoleClinic[] }) {
  const { t, num, money } = useSuperAdminText();

  const active = clinics.filter((c) => c.status === "Active");
  const paying = active.filter((c) => monthlyValue(c) > 0);
  const mrr = active.reduce((sum, c) => sum + monthlyValue(c), 0);
  const collected = clinics.reduce((sum, c) => sum + (Number(c.amountPaid) || 0), 0);
  const owed = active.reduce((sum, c) => sum + balanceOwed(c), 0);
  const suspended = clinics.filter((c) => c.status === "Suspended").length;
  const trials = clinics.filter((c) => isTrial(c) && c.status !== "Suspended");
  const trialsSoon = trials.filter((c) => c.daysRemaining !== undefined && c.daysRemaining >= 0 && c.daysRemaining <= 7).length;
  const aiUsed = clinics.reduce((sum, c) => sum + c.aiUsed, 0);

  const cells: { label: string; value: React.ReactNode; sub: string; flag?: boolean }[] = [
    { label: t("kpiMrr"), value: money(mrr), sub: t("kpiMrrSub", { n: num(paying.length) }) },
    { label: t("kpiCollected"), value: money(collected), sub: owed > 0 ? t("kpiOwed", { n: money(owed) }) : t("kpiNothingOwed"), flag: owed > 0 },
    {
      label: t("kpiActive"),
      value: (
        <>
          {num(active.length)}
          <span className="text-2xl text-white/50"> / {num(clinics.length)}</span>
        </>
      ),
      sub: t("kpiSuspended", { n: num(suspended) }),
    },
    { label: t("kpiTrials"), value: num(trials.length), sub: t("kpiTrialsSoon", { n: num(trialsSoon) }), flag: trialsSoon > 0 },
    { label: t("kpiAi"), value: num(aiUsed), sub: t("kpiAiSub") },
  ];

  return (
    <section aria-label={t("clinicsTitle")} className="bg-ink-slab text-white rounded-3xl px-6 py-6 md:px-8 md:py-7 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-x-6 gap-y-6">
      {cells.map((c) => (
        <div key={c.label} className="flex flex-col gap-1.5 min-w-0">
          <span className="text-xs text-white/65">{c.label}</span>
          <span className="font-figure text-[2.25rem] md:text-[2.5rem] leading-none font-semibold">{c.value}</span>
          <span className="flex items-center gap-1.5 text-xs text-white/65">
            {c.flag && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-hidden />}
            {c.sub}
          </span>
        </div>
      ))}
    </section>
  );
}
