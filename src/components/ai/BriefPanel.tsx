"use client";

import { useState } from "react";
import { CalendarRange, Sun } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import BriefingView from "@/components/dashboard/BriefingView";

/**
 * The Brief, as one tab of the Intelligence page rather than a page of its own.
 *
 * The period toggle stays here rather than moving up next to the tab strip: it belongs to this
 * tab and nothing else, and a control that only applies to one of three tabs reads as broken
 * when it is sitting in the row that switches between them.
 *
 * The two periods mount separately rather than sharing one fetch: each is its own request with
 * its own date window, and keeping the inactive one unmounted means switching back re-reads
 * rather than showing figures from ten minutes ago.
 */
export default function BriefPanel() {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const [period, setPeriod] = useState<"day" | "week">("day");

  const periods = [
    { key: "day" as const, icon: Sun, label: isAr ? "اليوم" : "Today" },
    { key: "week" as const, icon: CalendarRange, label: isAr ? "الأسبوع" : "This week" },
  ];

  return (
    <div className="space-y-5">
      <div className="inline-flex items-center gap-1 rounded-full bg-surface border border-slate-200/60 p-1 shadow-sm">
        {periods.map((p) => {
          const Icon = p.icon;
          const active = period === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-bold transition-colors ${
                active ? "bg-ink-slab text-white" : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <Icon size={13} />
              {p.label}
            </button>
          );
        })}
      </div>

      <BriefingView key={period} period={period} />
    </div>
  );
}
