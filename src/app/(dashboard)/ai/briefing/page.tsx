"use client";

import { useState } from "react";
import { CalendarRange, Sparkles, Sun } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import PermissionGuard from "@/components/PermissionGuard";
import BriefingView from "@/components/dashboard/BriefingView";

/**
 * Its own page rather than a card bolted onto the main dashboard.
 *
 * The root dashboard already lists today's appointments and is a height-constrained flex layout
 * with separate desktop and mobile implementations, so adding a brief this long there would
 * duplicate the schedule and wreck the layout. BriefingView is self-contained, so it can still be
 * dropped into either dashboard later without changing anything here.
 *
 * The two tabs mount separately rather than sharing one fetch: each period is its own request with
 * its own date window, and keeping the inactive one unmounted means switching back re-reads rather
 * than showing figures from ten minutes ago.
 */
export default function BriefingPage() {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";
  const [period, setPeriod] = useState<"day" | "week">("day");

  const tabs = [
    { key: "day" as const, icon: Sun, label: isAr ? "اليوم" : "Today" },
    { key: "week" as const, icon: CalendarRange, label: isAr ? "الأسبوع" : "This week" },
  ];

  return (
    <PermissionGuard permission="dashboard.view">
      <div className="min-h-screen bg-slate-50/50 pb-24 lg:pb-10 text-slate-800" dir={isRTL ? "rtl" : "ltr"}>
        <div className="max-w-[1100px] mx-auto p-4 md:p-6 space-y-5">
          <div>
            <div className="flex items-center gap-2 text-violet-600">
              <Sparkles size={16} />
              <span className="text-[11px] font-black uppercase tracking-widest">
                {isAr ? "ذكاء ألفا" : "Alpha Intelligence"}
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-ink tracking-tight mt-1">
              {isAr ? "الملخص" : "The Brief"}
            </h1>
            <p className="text-sm font-medium text-ink-muted mt-1 max-w-2xl">
              {isAr
                ? "الأرقام والأسماء التي تحتاجها لإدارة اليوم: الحسابات، الإنتاج، فريق العمل، وما سيضيع إن لم يتحرك أحد. كل رقم مقروء من سجلاتك، وليس تقديراً."
                : "The numbers and names it takes to run the place: money, production, the floor, and what slips if nobody acts. Every figure is read from your records — nothing is estimated."}
            </p>
          </div>

          <div className="inline-flex items-center gap-1 rounded-full bg-surface border border-slate-200/60 p-1 shadow-sm">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = period === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setPeriod(tab.key)}
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-xs font-bold transition-colors ${
                    active ? "bg-ink-slab text-white" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <BriefingView key={period} period={period} />
        </div>
      </div>
    </PermissionGuard>
  );
}
