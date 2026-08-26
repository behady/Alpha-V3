"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Languages,
  LifeBuoy,
  LogOut,
  MoreHorizontal,
  Settings,
  ShieldCheck,
  UserCircle2,
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicLogo } from "@/lib/clinicLogo";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";

export interface SidebarNavItem {
  key: string;
  href: string;
  icon: any;
}

/**
 * Pages that move behind "More" when the rail is icon-only.
 *
 * Chosen because they are periodic rather than daily — a receptionist opens Appointments twenty
 * times a shift and Reports once a month. Everything else stays one click away.
 */
const OVERFLOW_KEYS = new Set(["inventory", "attendanceAi", "reports", "attendance"]);

const STORAGE_KEY = "alphaSidebarExpanded";

/**
 * The desktop rail.
 *
 * It used to be a single fixed column of 46px circles with no scrolling, inside a container locked
 * to `100dvh`. For an admin that is ~918px of content, so on anything shorter than a 1080p screen
 * flexbox shrank the circles until they collided — the icons deformed instead of the list
 * overflowing. Three things keep that from happening now: items never shrink, the main list can
 * scroll, and the whole rail tightens on short viewports. Two more reclaim the space that caused
 * it: the periodic pages live behind "More", and the account actions behind one button.
 */
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
  const { t, language, isRTL, toggleLanguage } = useLanguage();

  // Read after mount, never during render: the server has no localStorage, and seeding state from
  // it directly makes the first client render disagree with the HTML it is hydrating.
  const [expanded, setExpanded] = useState(false);
  const { clinicId } = useClinic();
  const [logoUrl, setLogoUrl] = useState("");

  // The clinic's uploaded logo replaces the generic sparkle mark. Keyed on the clinic so a
  // super-admin switching tenants never keeps the previous clinic's branding on screen.
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
  useEffect(() => {
    try {
      setExpanded(localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      /* private mode — stay collapsed */
    }
  }, []);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* nothing to persist to; the session still works */
      }
      return next;
    });
  };

  const [openMenu, setOpenMenu] = useState<"more" | "account" | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (footerRef.current && !footerRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [openMenu]);

  const isRouteActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));

  const labelFor = (key: string) =>
    t(key as any) || key.charAt(0).toUpperCase() + key.slice(1);

  // Expanded shows everything inline — there is room for it, and hiding pages behind a menu in a
  // rail that already has space to spell their names out would be the wrong trade.
  const primaryItems = expanded ? items : items.filter((i) => !OVERFLOW_KEYS.has(i.key));
  const overflowItems = expanded ? [] : items.filter((i) => OVERFLOW_KEYS.has(i.key));
  const overflowIsActive = overflowItems.some((i) => isRouteActive(i.href));

  /**
   * Every measurement that tightens on a short screen. 840px is just above a 1366×768 laptop's
   * usable viewport, so those machines get the compact rail and larger monitors never do.
   */
  const SHORT = "[@media(max-height:840px)]";
  const buttonSize = `w-[46px] h-[46px] ${SHORT}:w-[38px] ${SHORT}:h-[38px]`;
  const iconSize = `size-5 ${SHORT}:size-[18px]`;
  const rowGap = `gap-2 ${SHORT}:gap-1`;

  const activeClass = "bg-[#2D3748] text-white shadow-[0_4px_12px_rgba(45,55,72,0.2)]";
  const idleClass =
    "bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 shadow-sm border border-slate-100";

  const tooltipSide = isRTL ? "right-full mr-4" : "left-full ml-4";
  const popoverSide = isRTL ? "right-full mr-3" : "left-full ml-3";

  /** One rail entry. Collapsed it is a circle with a hover tooltip; expanded it is a labelled row. */
  const railRow = (
    key: string,
    href: string | null,
    Icon: any,
    label: string,
    active: boolean,
    onClick?: () => void,
    tone?: "danger" | "success"
  ) => {
    const toneIdle =
      tone === "danger"
        ? "bg-white text-rose-500 hover:bg-rose-50 hover:text-rose-600 shadow-sm border border-rose-100"
        : tone === "success"
          ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 shadow-sm border border-emerald-100"
          : idleClass;

    const inner = expanded ? (
      <>
        <span
          className={`${buttonSize} shrink-0 rounded-full flex items-center justify-center transition-all duration-300 ${
            active ? activeClass : toneIdle
          }`}
        >
          <Icon className={iconSize} strokeWidth={active ? 2.5 : 2} />
        </span>
        <span
          className={`text-sm font-bold truncate ${
            active ? "text-slate-900" : tone === "danger" ? "text-rose-600" : "text-slate-600"
          }`}
        >
          {label}
        </span>
      </>
    ) : (
      <span
        className={`${buttonSize} rounded-full flex items-center justify-center transition-all duration-300 ${
          active ? activeClass : toneIdle
        }`}
      >
        <Icon className={iconSize} strokeWidth={active ? 2.5 : 2} />
      </span>
    );

    const shared = `flex w-full items-center ${
      expanded ? "gap-3 px-3 py-0.5 rounded-2xl hover:bg-white/60" : "justify-center px-3"
    }`;

    const body = href ? (
      <Link href={href} className={shared} onClick={onClick}>
        {inner}
      </Link>
    ) : (
      <button type="button" onClick={onClick} className={shared}>
        {inner}
      </button>
    );

    // `group` and `relative` belong on this wrapper, not on the link: the tooltip is a sibling of
    // the link, so anchoring them to the link would leave it positioned against a far-off ancestor
    // and never triggered by hover.
    return (
      <div key={key} data-tour={`nav-${String(key).replace(/^\//, "")}`} className="group relative w-full shrink-0">
        {body}
        {/* The tooltip is the only label when collapsed, and pure noise when expanded. */}
        {!expanded && (
          <div
            className={`pointer-events-none absolute top-1/2 z-[200] hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-[#2D3748] px-3 py-1.5 text-xs font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 lg:block ${tooltipSide}`}
          >
            {label}
          </div>
        )}
      </div>
    );
  };

  const menuPanel = (children: React.ReactNode) => (
    <div
      className={`absolute bottom-0 z-[250] w-60 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_10px_40px_-10px_rgba(0,0,0,0.25)] ${popoverSide}`}
    >
      {children}
    </div>
  );

  const menuRow = (
    key: string,
    href: string | null,
    Icon: any,
    label: string,
    active: boolean,
    onClick?: () => void,
    tone?: "danger" | "success"
  ) => {
    const cls = `flex w-full items-center gap-3 px-4 py-3 text-sm font-bold transition-colors ${
      active
        ? "bg-slate-900 text-white"
        : tone === "danger"
          ? "text-rose-600 hover:bg-rose-50"
          : tone === "success"
            ? "text-emerald-700 hover:bg-emerald-50"
            : "text-slate-600 hover:bg-slate-50"
    }`;
    const inner = (
      <>
        <Icon size={18} className="shrink-0" />
        <span className="truncate">{label}</span>
      </>
    );
    return href ? (
      <Link key={key} href={href} className={cls} onClick={onClick}>
        {inner}
      </Link>
    ) : (
      <button key={key} type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  };

  return (
    <aside
      className={`z-[100] hidden shrink-0 flex-col items-center bg-transparent py-6 lg:flex ${SHORT}:py-3 ${
        expanded ? "w-[232px]" : "w-[88px]"
      } transition-[width] duration-200`}
    >
      {/* LOGO */}
      <div className={`flex shrink-0 items-center justify-center mb-4 ${SHORT}:mb-1 ${expanded ? "w-full gap-2 px-4" : ""}`}>
        <div className={`flex items-center justify-center overflow-hidden bg-transparent text-slate-800 w-12 h-12 ${SHORT}:w-9 ${SHORT}:h-9`}>
          {logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={logoUrl} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={iconSize}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
          )}
        </div>
        {expanded && <span className="text-base font-black tracking-tight text-slate-800 truncate">Alpha</span>}
      </div>

      <ClinicSwitcher expanded={expanded} />

      {/* MAIN NAV — the only part allowed to scroll, so a long list never squashes the rest */}
      <nav className={`flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto no-scrollbar ${rowGap} mt-1`}>
        {primaryItems.map((item) =>
          railRow(item.href, item.href, item.icon, labelFor(item.key), isRouteActive(item.href))
        )}
      </nav>

      {/* FOOTER — outside the scroll area, so its pop-overs are never clipped by it */}
      <div ref={footerRef} className={`mt-auto flex w-full shrink-0 flex-col items-center ${rowGap} pt-2`}>
        {overflowItems.length > 0 && (
          <div className="relative w-full">
            {railRow(
              "more",
              null,
              MoreHorizontal,
              language === "ar" ? "المزيد" : "More",
              overflowIsActive || openMenu === "more",
              () => setOpenMenu(openMenu === "more" ? null : "more")
            )}
            {openMenu === "more" &&
              menuPanel(
                <div className="py-1.5">
                  {overflowItems.map((item) =>
                    menuRow(item.href, item.href, item.icon, labelFor(item.key), isRouteActive(item.href), () =>
                      setOpenMenu(null)
                    )
                  )}
                </div>
              )}
          </div>
        )}

        {showSettings &&
          railRow(
            "settings",
            "/settings",
            Settings,
            t("settings" as any) || (language === "ar" ? "الإعدادات" : "Settings"),
            isRouteActive("/settings")
          )}

        <div className="relative w-full">
          {railRow(
            "account",
            null,
            UserCircle2,
            language === "ar" ? "الحساب" : "Account",
            openMenu === "account" || isRouteActive("/help"),
            () => setOpenMenu(openMenu === "account" ? null : "account")
          )}
          {openMenu === "account" &&
            menuPanel(
              <div className="py-1.5">
                {/* Help is deliberately ungated: the people most likely to need it are the ones
                    with the fewest permissions. */}
                {menuRow(
                  "help",
                  "/help",
                  LifeBuoy,
                  language === "ar" ? "مركز المساعدة" : "Help Center",
                  isRouteActive("/help"),
                  () => setOpenMenu(null)
                )}
                {menuRow("lang", null, Languages, language === "ar" ? "English" : "عربي", false, () => {
                  toggleLanguage();
                  setOpenMenu(null);
                })}
                {isSuperAdmin &&
                  menuRow("hub", null, ShieldCheck, "Return to Hub", false, () => {
                    setOpenMenu(null);
                    onReturnToSuperAdmin();
                  }, "success")}
                <div className="my-1 border-t border-slate-100" />
                {menuRow("logout", null, LogOut, language === "ar" ? "تسجيل الخروج" : "Logout", false, () => {
                  setOpenMenu(null);
                  onLogout();
                }, "danger")}
              </div>
            )}
        </div>

        {railRow(
          "toggle",
          null,
          expanded ? (isRTL ? ChevronRight : ChevronLeft) : isRTL ? ChevronLeft : ChevronRight,
          expanded
            ? language === "ar" ? "طيّ القائمة" : "Collapse menu"
            : language === "ar" ? "توسيع القائمة" : "Expand menu",
          false,
          toggleExpanded
        )}
      </div>
    </aside>
  );
}
