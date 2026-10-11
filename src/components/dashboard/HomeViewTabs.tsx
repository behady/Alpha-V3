"use client";

import { Armchair, CalendarDays, Landmark, Lock } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useHomeView } from "@/lib/useHomeView";

/**
 * The three home screens as tabs in the black band: the owner's view, the calendar and the
 * dentist's chair.
 *
 * The same choice lives at Settings → Interface, and this writes to the very same stored
 * preference — switch here and Settings agrees. A home screen is not really a setting: it is a
 * thing you flick between during a day (the calendar to see who is waiting, the owner's numbers
 * between patients), and walking to Settings for that was why nobody used the other screens.
 *
 * Everyone gets all three (the owner's decision, 2026-10-11). One they may not open keeps its tab,
 * with a small lock, and opens onto the "ask the owner" page — see lib/homeView for who may open
 * which.
 */
export default function HomeViewTabs() {
  const { language } = useLanguage();
  const { view, setView, access } = useHomeView();
  const isAr = language === "ar";

  const tabs = [
    { key: "owner" as const, icon: Landmark, label: isAr ? "المالك" : "Owner" },
    { key: "desk" as const, icon: CalendarDays, label: isAr ? "المواعيد" : "Calendar" },
    { key: "chair" as const, icon: Armchair, label: isAr ? "الدكتور" : "Dentist" },
  ];

  return (
    <div
      data-tour="home-view-tabs"
      role="tablist"
      aria-label={isAr ? "شكل الشاشة الرئيسية" : "Home screen view"}
      className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1"
    >
      {tabs.map((tab) => {
        const active = view === tab.key;
        const locked = !access[tab.key];
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active}
            onClick={() => setView(tab.key)}
            title={locked ? `${tab.label} — ${isAr ? "محتاج إذن من المالك" : "needs the owner's permission"}` : tab.label}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold transition-colors whitespace-nowrap ${
              active ? "bg-[#FACC15] text-ink" : "text-white/65 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon size={15} strokeWidth={2.5} className="shrink-0" />
            {/* The label goes when the band gets tight; the icon and the tooltip carry it there. */}
            <span className="hidden sm:inline">{tab.label}</span>
            {locked && <Lock size={11} strokeWidth={2.75} className="shrink-0 opacity-70" aria-label={isAr ? "مقفول" : "locked"} />}
          </button>
        );
      })}
    </div>
  );
}
