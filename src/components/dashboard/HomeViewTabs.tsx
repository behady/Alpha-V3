"use client";

import { Armchair, LayoutDashboard, Landmark } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { useAlsoDentist } from "@/lib/useAlsoDentist";

/**
 * The three ways to look at the clinic's home screen, as tabs in the black band.
 *
 * The same choice already lives at Settings → Interface, and this writes to the very same stored
 * preference rather than a second one — switch here and Settings agrees, switch there and the tab
 * moves. A dashboard view is not really a setting: it is a thing you flick between during a day
 * (the desk to see who is waiting, the owner's numbers between patients), and walking to Settings
 * for that was the reason nobody used the other two screens.
 *
 * Only for people who have more than one screen to choose from — an admin or an owner. A plain
 * dentist has the chair and nothing else, and the chair is offered only to an admin whose team row
 * says they also treat, so the strip is two tabs for a manager who never holds a handpiece.
 */
export default function HomeViewTabs() {
  const { language } = useLanguage();
  const { isAdmin } = useClinic();
  const { homeView, setHomeView } = useUI();
  const alsoDentist = useAlsoDentist();
  const isAr = language === "ar";

  if (!isAdmin) return null;

  const tabs = [
    { key: "desk" as const, icon: LayoutDashboard, label: isAr ? "المكتب" : "Desk" },
    { key: "owner" as const, icon: Landmark, label: isAr ? "المالك" : "Owner" },
    ...(alsoDentist ? [{ key: "chair" as const, icon: Armchair, label: isAr ? "الكرسي" : "Chair" }] : []),
  ];

  // A stored "chair" for an admin who no longer treats would light no tab at all, so it reads as
  // the desk — exactly what the page itself falls back to.
  const current = homeView === "chair" && !alsoDentist ? "desk" : homeView;

  return (
    <div
      data-tour="home-view-tabs"
      role="tablist"
      aria-label={isAr ? "شكل الشاشة الرئيسية" : "Home screen view"}
      className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1"
    >
      {tabs.map((tab) => {
        const active = current === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active}
            onClick={() => setHomeView(tab.key)}
            title={tab.label}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold transition-colors whitespace-nowrap ${
              active ? "bg-[#FACC15] text-ink" : "text-white/65 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon size={15} strokeWidth={2.5} className="shrink-0" />
            {/* The label goes when the band gets tight; the icon and the tooltip carry it there. */}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
