"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  Languages,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicLogo } from "@/lib/clinicLogo";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";
import NotificationBell from "@/components/NotificationBell";
import { SECTION_GROUPS, type NavItem } from "@/components/dashboard/navGroups";
import { useTourOptional } from "@/context/TourContext";
import { TOUR_GUIDE } from "@/lib/grandTour";

/**
 * The black bar across the top of the app, replacing the left rail.
 *
 * Thirteen destinations do not fit across a bar as labelled links, so the three groups that were
 * headings in the old rail became dropdown menus here. Dashboard stays a direct link because it
 * is the one thing people click without reading.
 */
export default function TopNav({
  items,
  showSettings,
  isSuperAdmin,
  onLogout,
  onReturnToSuperAdmin,
}: {
  items: NavItem[];
  showSettings: boolean;
  isSuperAdmin: boolean;
  onLogout: () => void;
  onReturnToSuperAdmin: () => void;
}) {
  const pathname = usePathname();
  const { t, language, toggleLanguage } = useLanguage();
  const { user } = useAuth();
  const { clinicId, role } = useClinic();
  const tour = useTourOptional();

  const [logoUrl, setLogoUrl] = useState("");
  /** Which dropdown is open: a group title, "account", or null. One at a time. */
  const [open, setOpen] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

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

  // Close on navigation, on click-away and on Escape. All three matter: without the first, the
  // menu you just used stays hanging over the page you asked for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(null);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isRouteActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const labelFor = (key: string) => t(key as any) || key.charAt(0).toUpperCase() + key.slice(1);

  const dashboard = items.find((i) => i.key === "dashboard");
  const settingsLabel = labelFor("settings");

  const groups = SECTION_GROUPS.map((section) => {
    const groupItems = items.filter((item) => section.keys.includes(item.key));
    return {
      title: language === "ar" ? section.titleAr : section.titleEn,
      id: section.titleEn,
      items: groupItems,
      active: groupItems.some((item) => isRouteActive(item.href)),
      // The count rides on the group button so an unread WhatsApp message is visible without
      // opening the menu it is hiding in.
      badge: groupItems.reduce((sum, item) => sum + (item.badge ?? 0), 0),
    };
  }).filter((g) => g.items.length > 0);

  const pill = "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13.5px] font-bold transition-colors whitespace-nowrap";
  const pillActive = "bg-[#FACC15] text-ink";
  const pillIdle = "text-white/65 hover:bg-white/10 hover:text-white";
  const iconButton =
    "grid size-9 place-items-center rounded-full border border-white/15 bg-white/5 text-white/70 transition-colors hover:bg-white/15 hover:text-white";

  const initials = (user?.name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  const menuPanel =
    "absolute top-full mt-2 z-[200] min-w-[240px] rounded-2xl border border-line bg-surface p-2 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.35)] animate-in fade-in slide-in-from-top-2 duration-150";

  const menuRow =
    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-bold transition-colors";

  return (
    <div ref={navRef} className="flex h-16 items-center gap-3 px-4 lg:px-7">
      {/* --- BRAND + CLINIC --- */}
      <Link href="/" className="flex shrink-0 items-center gap-2.5">
        {logoUrl ? (
          /* A white tile, never a black one: a dark logo on a black bar disappears. */
          <span className="grid size-9 place-items-center overflow-hidden rounded-xl bg-white p-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain" />
          </span>
        ) : (
          <span className="grid size-9 place-items-center rounded-xl bg-[#FACC15] text-ink">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>
          </span>
        )}
        <span className="hidden text-[16px] font-black tracking-tight text-white xl:block">Alpha</span>
      </Link>

      <div className="hidden shrink-0 lg:block">
        <ClinicSwitcher variant="topbar" />
      </div>

      {/* --- NAV --- */}
      <nav className="hidden min-w-0 flex-1 items-center gap-1 lg:flex" data-tour="topnav">
        {dashboard && (
          <Link
            href="/"
            data-tour="nav-dashboard"
            className={`${pill} ${pathname === "/" ? pillActive : pillIdle}`}
          >
            <LayoutDashboard size={16} strokeWidth={2.4} />
            {labelFor("dashboard")}
          </Link>
        )}

        {groups.map((group) => (
          <div key={group.id} className="relative">
            <button
              type="button"
              onClick={() => setOpen(open === group.id ? null : group.id)}
              /* Lets a guided lesson ring this button when the destination it wants is inside the
                 closed menu — see findVisibleAnchor in TutorialOverlay. */
              data-tour-opens={group.items
                .map((item) => `nav-${String(item.href).replace(/^\//, "")}`)
                .join(" ")}
              className={`${pill} ${group.active ? pillActive : pillIdle}`}
            >
              {group.title}
              {group.badge > 0 && (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#c0392b] px-1 text-[10px] font-black text-white">
                  {group.badge > 99 ? "99+" : group.badge}
                </span>
              )}
              <ChevronDown
                size={14}
                className={`transition-transform ${open === group.id ? "rotate-180" : ""}`}
              />
            </button>

            {open === group.id && (
              <div className={`${menuPanel} start-0`}>
                {group.items.map((item) => {
                  const active = isRouteActive(item.href);
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      data-tour={`nav-${String(item.href).replace(/^\//, "")}`}
                      className={`${menuRow} ${active ? "bg-[#FACC15] text-ink" : "text-ink-body hover:bg-surface-subtle hover:text-ink"}`}
                    >
                      <item.icon size={18} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                      <span className="truncate">{labelFor(item.key)}</span>
                      {(item.badge ?? 0) > 0 && (
                        <span className="ms-auto grid h-[20px] min-w-[20px] place-items-center rounded-full bg-[#c0392b] px-1 text-[11px] font-black text-white">
                          {(item.badge ?? 0) > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* --- SETTINGS / BELL / ACCOUNT --- */}
      <div className="ms-auto flex shrink-0 items-center gap-2">
        {showSettings && (
          <Link
            href="/settings"
            data-tour="nav-settings"
            title={settingsLabel}
            className={`hidden lg:grid ${iconButton} ${pathname.startsWith("/settings") ? "border-[#FACC15]/40 bg-[#FACC15] text-ink hover:bg-[#FACC15]" : ""}`}
          >
            <Settings size={17} />
          </Link>
        )}

        {/* The wrapper carries the tour anchor: the bell is its own component with its own DOM. */}
        <div data-tour="notification-bell" className="grid place-items-center">
          <NotificationBell variant="dark" />
        </div>

        <div className="relative">
          <button
            type="button"
            data-tour="account-menu"
            /* Sara's hand opens this to reach Getting started and Help — see tourDemo.ts. */
            data-tour-opens="menu-welcome menu-help"
            onClick={() => setOpen(open === "account" ? null : "account")}
            className="flex items-center gap-2.5 rounded-full py-1 ps-1 pe-2 transition-colors hover:bg-white/10"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#FACC15] text-[13px] font-black text-ink">
              {initials}
            </span>
            <span className="hidden min-w-0 text-start md:block">
              <span className="block truncate text-[13px] font-bold leading-tight text-white">
                {user?.name || "—"}
              </span>
              <span className="block truncate text-[11px] font-medium leading-tight text-white/50">
                {role || (language === "ar" ? "مستخدم" : "Member")}
              </span>
            </span>
            <ChevronDown size={14} className={`hidden text-white/50 transition-transform md:block ${open === "account" ? "rotate-180" : ""}`} />
          </button>

          {open === "account" && (
            <div className={`${menuPanel} end-0`}>
              <div className="border-b border-line px-3 pb-2.5 pt-1.5 md:hidden">
                <p className="truncate text-[13px] font-black text-ink">{user?.name || "—"}</p>
                <p className="truncate text-[11px] font-medium text-ink-muted">{role || ""}</p>
              </div>

              <Link href="/welcome" data-tour="menu-welcome" className={`${menuRow} text-ink-body hover:bg-surface-subtle hover:text-ink`}>
                <Rocket size={18} className="shrink-0" />
                {language === "ar" ? "البداية" : "Getting started"}
              </Link>
              <Link href="/help" data-tour="menu-help" className={`${menuRow} text-ink-body hover:bg-surface-subtle hover:text-ink`}>
                <LifeBuoy size={18} className="shrink-0" />
                {language === "ar" ? "مركز المساعدة" : "Help Center"}
              </Link>
              {tour && tour.stops.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(null);
                    tour.start();
                  }}
                  className={`${menuRow} text-ink-body hover:bg-surface-subtle hover:text-ink`}
                >
                  <Sparkles size={18} className="shrink-0" />
                  {language === "ar" ? `جولة مع ${TOUR_GUIDE.ar}` : `Tour with ${TOUR_GUIDE.en}`}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  toggleLanguage();
                  setOpen(null);
                }}
                className={`${menuRow} text-ink-body hover:bg-surface-subtle hover:text-ink`}
              >
                <Languages size={18} className="shrink-0" />
                {language === "ar" ? "English" : "العربية"}
              </button>

              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(null);
                    onReturnToSuperAdmin();
                  }}
                  className={`${menuRow} text-[#008f72] hover:bg-emerald-50`}
                >
                  <ShieldCheck size={18} className="shrink-0" />
                  Return to Hub
                </button>
              )}

              <div className="mt-1 border-t border-line pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(null);
                    onLogout();
                  }}
                  className={`${menuRow} text-[#c0392b] hover:bg-rose-50`}
                >
                  <LogOut size={18} className="shrink-0" />
                  {language === "ar" ? "تسجيل الخروج" : "Logout"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
