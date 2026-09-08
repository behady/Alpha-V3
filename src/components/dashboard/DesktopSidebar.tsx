"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Languages,
  LifeBuoy,
  LogOut,
  Rocket,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicLogo } from "@/lib/clinicLogo";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";

export interface SidebarNavItem {
  key: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
}

export const SECTION_GROUPS = [
  {
    titleEn: "Front Desk",
    titleAr: "مكتب الاستقبال",
    keys: ["dashboard", "chats", "patients", "appointments", "leads"],
  },
  {
    titleEn: "Operations",
    titleAr: "العمليات",
    keys: ["finance", "inventory", "lab", "attendance"],
  },
  {
    titleEn: "Insights & Growth",
    titleAr: "الرؤى والنمو",
    keys: ["intelligence", "marketing", "reports"],
  },
];

export default function DesktopSidebar({
  items,
  showSettings,
  isSuperAdmin,
  onLogout,
  onReturnToSuperAdmin,
}: {
  items: SidebarNavItem[];
  showSettings: boolean;
  isSuperAdmin: boolean;
  onLogout: () => void;
  onReturnToSuperAdmin: () => void;
}) {
  const pathname = usePathname();
  const { t, language, toggleLanguage } = useLanguage();
  const { clinicId } = useClinic();
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const url = clinicId ? (await getClinicLogo()).url : "";
      if (!cancelled) setLogoUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  const isRouteActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));

  const labelFor = (key: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t(key as any) || key.charAt(0).toUpperCase() + key.slice(1);

  // YELLOW ACTIVE STATE AS REQUESTED
  const activeClass = "bg-[#FACC15] text-ink font-black shadow-md shadow-[#FACC15]/20";
  const idleClass = "text-ink-body hover:bg-surface-subtle hover:text-ink transition-colors font-bold";

  const railRow = (
    key: string,
    href: string | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Icon: any,
    label: string,
    active: boolean,
    onClick?: () => void,
    tone?: "danger" | "success",
    badge?: number
  ) => {
    const toneIdle =
      tone === "danger"
        ? "text-[#c0392b] hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors font-bold"
        : tone === "success"
          ? "text-[#008f72] hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors font-bold"
          : idleClass;

    const badgeDot =
      badge && badge > 0 ? (
        <span className="ms-auto shrink-0 min-w-[20px] h-[20px] px-1 rounded-full bg-[#c0392b] text-white text-[11px] font-black flex items-center justify-center shadow-sm">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null;

    const body = (
      <>
        <Icon size={20} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
        <div className="flex items-center justify-between flex-1 min-w-0 opacity-0 group-hover:opacity-100 group-hover:ms-3 ms-0 transition-all duration-200">
          <span className="text-[14px] truncate">{label}</span>
          {badgeDot}
        </div>
      </>
    );

    const shared = `flex w-full items-center px-[18px] py-2.5 rounded-xl transition-all duration-200 whitespace-nowrap overflow-hidden ${
      active ? activeClass : toneIdle
    }`;

    if (href) {
      return (
        <Link key={key} href={href} className={shared} onClick={onClick} data-tour={`nav-${String(key).replace(/^\//, "")}`}>
          {body}
        </Link>
      );
    }
    
    return (
      <button key={key} type="button" onClick={onClick} className={shared} data-tour={`nav-${String(key).replace(/^\//, "")}`}>
        {body}
      </button>
    );
  };

  return (
    <>
      {/* Spacer to push content exactly 88px */}
      <div className="hidden lg:block w-[88px] shrink-0" />

      {/* Floating Hover Sidebar */}
      <aside className="fixed inset-y-0 start-0 z-[150] hidden lg:flex flex-col bg-surface dark:bg-slate-900 border-e border-line dark:border-slate-800 w-[88px] hover:w-[260px] group transition-[width] duration-300 shadow-[4px_0_24px_rgba(0,0,0,0.02)] overflow-hidden">
        <div className="flex flex-col h-full w-full">
          {/* LOGO AREA */}
          <div className="flex shrink-0 items-center px-5 py-5 h-[88px]">
            <div className="flex items-center justify-center overflow-hidden bg-transparent shrink-0 w-12 h-12">
              {logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain rounded-lg" />
              ) : (
                <div className="w-10 h-10 bg-[#FACC15] text-ink rounded-xl flex items-center justify-center shadow-sm">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                </div>
              )}
            </div>
            <span className="text-[17px] font-black tracking-tight text-ink dark:text-slate-100 truncate ms-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">Alpha</span>
          </div>

          {/* CLINIC SWITCHER */}
          <div className="px-4 mb-4">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-75">
              <ClinicSwitcher expanded={true} />
            </div>
          </div>

          {/* MAIN NAV */}
          <nav className="flex-1 overflow-y-auto no-scrollbar px-4 pb-4 space-y-6">
            {SECTION_GROUPS.map((section) => {
              const sectionItems = items.filter((item) => section.keys.includes(item.key));
              if (sectionItems.length === 0) return null;

              return (
                <div key={section.titleEn} className="space-y-1 relative">
                  <h3 className="px-3 mb-2 text-[11px] font-black uppercase tracking-wider text-ink-muted dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    {language === "ar" ? section.titleAr : section.titleEn}
                  </h3>
                  {sectionItems.map((item) =>
                    railRow(item.key, item.href, item.icon, labelFor(item.key), isRouteActive(item.href), undefined, undefined, item.badge)
                  )}
                </div>
              );
            })}
          </nav>

          {/* FOOTER */}
          <div className="shrink-0 px-4 py-4 border-t border-line dark:border-slate-800 bg-surface dark:bg-slate-900 space-y-1">
            {showSettings &&
              railRow(
                "settings",
                "/settings",
                Settings,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                t("settings" as any) || (language === "ar" ? "الإعدادات" : "Settings"),
                isRouteActive("/settings")
              )}

            {railRow(
              "welcome",
              "/welcome",
              Rocket,
              language === "ar" ? "البداية" : "Getting started",
              isRouteActive("/welcome")
            )}

            {railRow(
              "help",
              "/help",
              LifeBuoy,
              language === "ar" ? "مركز المساعدة" : "Help Center",
              isRouteActive("/help")
            )}

            {railRow("lang", null, Languages, language === "ar" ? "English" : "عربي", false, toggleLanguage)}

            {isSuperAdmin &&
              railRow("hub", null, ShieldCheck, "Return to Hub", false, onReturnToSuperAdmin, "success")}

            {railRow("logout", null, LogOut, language === "ar" ? "تسجيل الخروج" : "Logout", false, onLogout, "danger")}
          </div>
        </div>
      </aside>
    </>
  );
}
