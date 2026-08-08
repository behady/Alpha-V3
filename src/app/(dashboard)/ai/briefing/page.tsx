"use client";

import { Sparkles } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import PermissionGuard from "@/components/PermissionGuard";
import DailyBriefingCard from "@/components/dashboard/DailyBriefingCard";

/**
 * Its own page rather than a card bolted onto the main dashboard.
 *
 * The root dashboard already lists today's appointments and is a height-constrained flex layout
 * with separate desktop and mobile implementations, so adding a large card there would duplicate
 * the schedule and risk the layout. DailyBriefingCard is self-contained, so it can still be
 * dropped into either dashboard later without changing anything here.
 */
export default function BriefingPage() {
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";

  return (
    <PermissionGuard permission="dashboard.view">
      <div className="min-h-screen bg-slate-50/50 pb-24 lg:pb-10 text-slate-800" dir={isRTL ? "rtl" : "ltr"}>
        <div className="max-w-[1100px] mx-auto p-4 md:p-6 space-y-6">
          <div>
            <div className="flex items-center gap-2 text-violet-600">
              <Sparkles size={16} />
              <span className="text-[11px] font-black uppercase tracking-widest">
                {isAr ? "ذكاء ألفا" : "Alpha Intelligence"}
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight mt-1">
              {isAr ? "ملخص اليوم" : "Daily Briefing"}
            </h1>
            <p className="text-sm font-medium text-slate-500 mt-1 max-w-2xl">
              {isAr
                ? "جدول اليوم والأرصدة التي لم تشهد حركة منذ فترة. كل رقم هنا مأخوذ من سجلاتك، وليس تقديراً."
                : "Today's schedule, and balances that have gone quiet. Every number here is read from your records — nothing is estimated."}
            </p>
          </div>

          <DailyBriefingCard />
        </div>
      </div>
    </PermissionGuard>
  );
}
