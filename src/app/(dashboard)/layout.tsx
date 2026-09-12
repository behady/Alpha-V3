"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus_Jakarta_Sans, Cairo } from "next/font/google";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, Calendar, Wallet, Settings, Sparkles,
  FileBarChart, Menu, X, LogOut, Languages,
  Package, Clock, FlaskConical, ShieldCheck,
  LifeBuoy, Inbox, Megaphone, Rocket, ShoppingBag
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicLogo } from "@/lib/clinicLogo";
import { canAccessNavItem, canShowSettingsNavLink } from "@/lib/navAccess";
import { hasFeature } from "@/lib/subscriptions";
import ReceptionSummonOverlay from "@/components/summon/ReceptionSummonOverlay";
import { useUI } from "@/context/UIContext";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";
import TopNav from "@/components/dashboard/TopNav";
import { SECTION_GROUPS } from "@/components/dashboard/navGroups";
import { PageHeaderProvider, usePageHeaderSlot } from "@/context/PageHeaderContext";
import AiChatWidget from "@/components/AiChatWidget";
import { TutorialProvider, useTutorial } from "@/context/TutorialContext";
import TutorialOverlay from "@/components/TutorialOverlay";
import { TourProvider, useTour } from "@/context/TourContext";
import GrandTourOverlay from "@/components/tour/GrandTourOverlay";
import TourIntro from "@/components/tour/TourIntro";
import { TOUR_GUIDE } from "@/lib/grandTour";
import { WelcomeProvider } from "@/context/WelcomeContext";
import WelcomeCoach from "@/components/welcome/WelcomeCoach";
import TrialCountdownBanner from "@/components/welcome/TrialCountdownBanner";
import { DemoTourBanner } from "@/components/welcome/DemoTour";
import WhatsAppIcon from "@/components/icons/WhatsAppIcon";
import { useUnreadChatCount } from "@/lib/useUnreadChatCount";
import { useChatAlerts } from "@/lib/useChatAlerts";
import { useSupplyStoreStatus } from "@/lib/useSupplyStore";

const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const cairo = Cairo({ subsets: ["arabic"] });

/**
 * Sits between the two providers so the welcome guide can know whether a lesson is on screen.
 *
 * `WelcomeProvider` takes that as a prop rather than reading `useTutorial()` itself — the guide
 * works perfectly well in an app with no tutorials, and the only reason it cares is to stop the
 * coach talking over a walkthrough's ring. A component is needed here because `DashboardLayout`
 * is the thing that renders `TutorialProvider` and therefore cannot consume it.
 */
function WelcomeLayer({ children }: { children: React.ReactNode }) {
  const { activeTutorial } = useTutorial();
  // Sara's tour owns the screen the same way a lesson does: the coach stays quiet under it.
  const { active: tourActive } = useTour();
  return <WelcomeProvider tutorialRunning={!!activeTutorial || tourActive}>{children}</WelcomeProvider>;
}

/**
 * "Tour with Sara" as a menu row. A component of its own because the layout renders the tour
 * provider and therefore cannot consume it; the mobile sheet needs the row inside that provider.
 */
function TourMenuRow({ className, onPick }: { className: string; onPick: () => void }) {
  const tour = useTour();
  const { language } = useLanguage();
  if (tour.stops.length === 0) return null;
  const guide = language === "ar" ? TOUR_GUIDE.ar : TOUR_GUIDE.en;
  return (
    <button
      type="button"
      onClick={() => {
        onPick();
        tour.start();
      }}
      className={className}
    >
      <Sparkles size={22} />
      <span className="text-base truncate">{language === "ar" ? `جولة مع ${guide}` : `Tour with ${guide}`}</span>
    </button>
  );
}

/**
 * The lower half of the black band: whatever the page portalled into it.
 *
 * Must be a separate component because it consumes the context that `DashboardLayout` itself
 * renders. `fallbackTitle` shows when a page has not adopted <PageHeader> yet, so the band never
 * appears as a bare black stripe with nothing in it.
 */
function PageHeaderStrip({ fallbackTitle }: { fallbackTitle: string }) {
  const ctx = usePageHeaderSlot();
  const compact = !!ctx?.compact;
  const empty = (ctx?.count ?? 0) === 0;
  const slotRef = useRef<HTMLDivElement>(null);
  const setSlot = ctx?.setSlot;

  /**
   * An effect, not an inline `ref={(el) => setSlot(el)}`. React runs a fresh ref callback on every
   * render — cleaning up with null first — so an inline one would call setState twice per render
   * and spin forever.
   */
  useEffect(() => {
    setSlot?.(slotRef.current);
    return () => setSlot?.(null);
  }, [setSlot]);

  return (
    <div
      className={`px-4 lg:px-7 ${compact ? "pb-3 pt-0.5" : "pb-6 pt-1 lg:pb-7"}`}
    >
      {/* The portal target. Kept mounted always, so a page's header has somewhere to land on the
          very first render after a route change. */}
      <div ref={slotRef} />
      {empty && (
        <h1 className="truncate text-xl font-semibold tracking-tight text-white lg:text-[1.7rem] lg:leading-tight">
          {fallbackTitle}
        </h1>
      )}
    </div>
  );
}

/**
 * The black band, and when it gets out of the way.
 *
 * On a laptop or a phone the band — nav row plus the page's title strip — is a fifth of the
 * screen, and on Settings (which stacks its own search, group tabs and section chips under it)
 * the actual settings started below the fold. So on small screens the title strip folds away
 * when you scroll down and comes back the moment you scroll up or point at the band. The nav
 * row never hides: the menus must stay reachable without a scroll gesture.
 *
 * Small means a short or narrow viewport (a laptop is short; a phone is narrow). A big monitor
 * has room and keeps the band still, because a header that moves is a header you have to watch.
 *
 * Off entirely while Sara's tour runs — her spotlight points at things in the band.
 */
function BandShell({ nav, strip }: { nav: React.ReactNode; strip: React.ReactNode }) {
  const { active: tourActive } = useTour();
  const [collapsed, setCollapsed] = useState(false);
  const lastTops = useRef(new WeakMap<EventTarget, number>());

  useEffect(() => {
    const small = () => window.innerHeight < 900 || window.innerWidth < 1024;
    const onScroll = (e: Event) => {
      if (!small()) {
        setCollapsed(false);
        return;
      }
      const target = e.target;
      if (!target) return;
      const top =
        target === document || target === window
          ? window.scrollY
          : target instanceof Element
            ? target.scrollTop
            : 0;
      const last = lastTops.current.get(target) ?? 0;
      lastTops.current.set(target, top);
      const delta = top - last;
      if (top <= 8 || delta < -8) setCollapsed(false);
      else if (top > 64 && delta > 8) setCollapsed(true);
    };
    const onResize = () => {
      if (!small()) setCollapsed(false);
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const folded = collapsed && !tourActive;

  return (
    <header
      className="relative z-[45] shrink-0 bg-ink-slab text-white"
      onMouseEnter={() => setCollapsed(false)}
      onFocusCapture={() => setCollapsed(false)}
    >
      {nav}
      {/* Animated with grid rows, which — unlike max-height — needs no guess at the strip's height. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${folded ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}
        aria-hidden={folded}
      >
        <div className="min-h-0 overflow-hidden">{strip}</div>
      </div>
    </header>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, toggleLanguage, language, isRTL } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const { clinicId, clinic, role, isAdmin, isReadOnly, readOnlyReason } = useClinic();
  const { appointmentsVisibility, homeView } = useUI();
  /**
   * Three pages are locked to the viewport height and manage their own scrolling: the calendar,
   * the WhatsApp inbox and the reception dashboard, all height-constrained flex layouts. The dentist's home lives at the
   * same URL as the desk but is an ordinary page that grows with its content — lock it and a
   * tablet in landscape (wide enough for the desktop rule) simply cannot scroll to the report.
   */
  const ownHome = role === "Dentist" || homeView === "chair" || (homeView === "owner" && isAdmin);
  const isFullHeightPage =
    pathname === "/appointments" || pathname === "/chats" || (pathname === "/" && !ownHome);
  // Unopened patient WhatsApp messages, for the count on the WhatsApp icon in both navs.
  const unreadChats = useUnreadChatCount();
  // And the chime + desktop notification when a new one arrives, on whichever page is open.
  useChatAlerts();
  // Whether a partner supply shop is connected at all. Decides if the Store nav item exists.
  const supplyStore = useSupplyStoreStatus();

  const [isOpen, setIsOpen] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [logoUrl, setLogoUrl] = useState("");

  // Same mark as the top bar, fetched here for the mobile menu header.
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
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) setIsCheckingAuth(false);
      else router.push("/login");
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push("/login");
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleReturnToSuperAdmin = () => {
    sessionStorage.removeItem('superAdminClinicId');
    router.push('/superadmin');
  };

  /**
   * Collect Dues (/finance/recovery), Recovery (/ai/revenue), Reactivation (/ai/reactivation)
   * and Recalls (/ai/operations) were deliberately dropped from this list — the navigation had
   * grown past what anyone could scan. Their pages still exist at those URLs, but nothing links to
   * them anymore; delete the routes outright once they are confirmed unmissed.
   */
  const allNavItems = [
    { key: "dashboard", href: "/", icon: LayoutDashboard },
    { key: "leads", href: "/leads", icon: Inbox },
    /**
     * The clinic's WhatsApp, with the unread count on the icon. First in Front Desk because it is
     * the one page a receptionist opens all day — a patient writing is a patient at the desk.
     */
    { key: "chats", href: "/chats", icon: WhatsAppIcon, badge: unreadChats },
    { key: "marketing", href: "/marketing", icon: Megaphone },
    { key: "patients", href: "/patients", icon: Users },
    { key: "appointments", href: "/appointments", icon: Calendar },
    { key: "inventory", href: "/inventory", icon: Package },
    /**
     * The partner supplier's shop. Absent unless a shop is actually connected — see hasAccess —
     * because a menu item that opens onto "no store configured" reads as broken rather than as
     * something the platform has not switched on yet.
     */
    { key: "store", href: "/store", icon: ShoppingBag },
    // Gated on access.lab, which canAccessNavItem derives from the key. The permission and both
    // translations of this label already existed and pointed at nothing until the page was built.
    { key: "lab", href: "/lab", icon: FlaskConical },
    { key: "finance", href: "/finance", icon: Wallet },
    { key: "reports", href: "/reports", icon: FileBarChart },
    { key: "attendance", href: "/attendance", icon: Clock },
    /**
     * It replaces three separate items — the brief, the WhatsApp send queue and patient no-shows —
     * which are now three tabs of one page. Their old URLs redirect into it.
     */
    { key: "intelligence", href: "/ai", icon: Sparkles },
  ];

  const hasAccess = useCallback((key: string, isMobile: boolean = false) => {
    if (key === 'appointments') {
      if (appointmentsVisibility === 'hidden') return false;
      if (appointmentsVisibility === 'desktop' && isMobile) return false;
    }

    // Not a paid tier feature: the supply store costs the clinic nothing and the platform earns
    // on what it sells, so gating it behind a plan would only shrink what it earns. It appears
    // when a shop is connected and the person holds access.store, and not otherwise.
    if (key === 'store') {
      if (!supplyStore.connected) return false;
      return canAccessNavItem('store', user, isAdmin);
    }

    // Tier based gating
    if (key === 'inventory' && !hasFeature(clinic, 'inventory')) return false;
    if (key === 'attendance' && !hasFeature(clinic, 'attendance')) return false;

    // The marketing studio is a paid add-on, and switching it off in the superadmin panel has to
    // make it disappear for EVERYONE — admins included. It used to stay in the nav for admins as
    // an upsell, which read as the switch not working. Staff additionally need access.marketing.
    if (key === 'marketing') {
      if (!hasFeature(clinic, 'marketingText')) return false;
      if (isAdmin) return true;
      return canAccessNavItem('marketing', user, isAdmin);
    }

    /**
     * The Intelligence page holds three tabs that used to be three nav items, each with its own
     * permission. It shows if ANY of them would — the page itself drops the tabs a person may not
     * open, so a receptionist with patient access lands on the message queue and never sees the
     * brief. `patients` is what the queue used to be gated on: reception already holds it, so no
     * clinic has to edit permissions for this to keep working.
     */
    if (key === 'intelligence') {
      return canAccessNavItem('briefing', user, isAdmin)
        || canAccessNavItem('attendanceAi', user, isAdmin)
        || canAccessNavItem('patients', user, isAdmin);
    }

    if (key === 'leads') {
      return canAccessNavItem('leads', user, isAdmin) || canAccessNavItem('patients', user, isAdmin);
    }

    // Same key the message queue has always used, so reception has it without a permissions edit.
    if (key === 'chats') return canAccessNavItem('patients', user, isAdmin);

    return canAccessNavItem(key, user, isAdmin);
  }, [user, isAdmin, appointmentsVisibility, clinic, supplyStore.connected]);

  const visibleItems = allNavItems.filter((item) => hasAccess(item.key, false));
  const showSettings = canShowSettingsNavLink(user, isAdmin);

  /**
   * What the black strip says on a page that has not adopted <PageHeader> yet — the section's own
   * name, matched longest-prefix first so /patients/abc still reads "Patients" rather than falling
   * through to the dashboard.
   */
  const fallbackTitle = (() => {
    const extras: Record<string, string> = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "/settings": (t("settings" as any) as string) || (language === "ar" ? "الإعدادات" : "Settings"),
      "/welcome": language === "ar" ? "البداية" : "Getting started",
      "/help": language === "ar" ? "مركز المساعدة" : "Help Center",
      "/ortho": language === "ar" ? "التقويم" : "Orthodontics",
      "/setup": language === "ar" ? "الإعداد" : "Setup",
      "/migrate": language === "ar" ? "استيراد البيانات" : "Import data",
    };
    const fromNav = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      allNavItems.filter((i) => i.href !== "/").map((i) => [i.href, (t(i.key as any) as string) || i.key])
    );
    const table = { ...fromNav, ...extras };
    const match = Object.keys(table)
      .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (match) return table[match];
    return clinic?.name || "Alpha";
  })();

  if (isCheckingAuth || authLoading) {
    return (
      <div className="min-h-screen bg-surface-page">
        {/* Black band skeleton, so the first paint is the shape the app actually has */}
        <div className="bg-ink-slab">
          <div className="flex h-16 items-center gap-3 px-4 lg:px-7">
            <div className="size-9 shrink-0 animate-pulse rounded-xl bg-white/10" />
            <div className="hidden h-8 w-40 animate-pulse rounded-full bg-white/10 lg:block" />
            <div className="ms-auto flex items-center gap-2">
              <div className="size-9 animate-pulse rounded-full bg-white/10" />
              <div className="size-9 animate-pulse rounded-full bg-white/10" />
            </div>
          </div>
          <div className="px-4 pb-6 pt-1 lg:px-7 lg:pb-7">
            <div className="h-8 w-56 animate-pulse rounded-lg bg-white/10" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 p-4 md:grid-cols-3 lg:p-7">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      </div>
    );
  }

  // Reports gave up its slot to WhatsApp: on a phone, reports is a monthly visit and a patient
  // writing is now. Reports stays in the menu sheet.
  const mobileCandidates = [
    { key: "dashboard", href: "/", icon: LayoutDashboard },
    { key: "chats", href: "/chats", icon: WhatsAppIcon, badge: unreadChats },
    { key: "intelligence", href: "/ai", icon: Sparkles },
    { key: "appointments", href: "/appointments", icon: Calendar },
    { key: "finance", href: "/finance", icon: Wallet },
    { key: "patients", href: "/patients", icon: Users },
  ];

  const mobileNavItems = [
    ...mobileCandidates.filter(item => hasAccess(item.key, true)),
    { key: "menu", href: "#menu", icon: Menu },
  ];

  const sheetRow = (active: boolean) =>
    `flex items-center gap-4 px-4 py-3 rounded-2xl font-bold transition-all ${
      active ? "bg-[#FACC15] text-ink shadow-md shadow-[#FACC15]/20" : "text-ink-body hover:bg-surface-subtle hover:text-ink"
    }`;

  return (
    <TutorialProvider>
    {/* The tour may show the calendar even when this person hid its link (a preference, not a
        permission): the page exists and the day cannot be taught without it. */}
    <TourProvider
      visibleNavKeys={[
        ...visibleItems.map((i) => i.key),
        ...(!visibleItems.some((i) => i.key === "appointments") && canAccessNavItem("appointments", user, isAdmin) ? ["appointments"] : []),
      ]}
      showSettings={showSettings}
    >
    <WelcomeLayer>
    <PageHeaderProvider>
    <div className={`min-h-[100dvh] lg:h-[100dvh] lg:overflow-hidden bg-surface-page text-slate-700 flex flex-col ${isRTL ? cairo.className : plusJakartaSans.className} relative z-0`} dir={isRTL ? 'rtl' : 'ltr'}>
      <ReceptionSummonOverlay />

      {/* =================== THE BLACK BAND ===================
          Navigation on top, the page's own title and buttons underneath it. One dark block, then
          white: everything below this is the page. */}
      {/*
        z-[45] is chosen, not arbitrary. The band has to sit ABOVE the sticky toolbars pages mount
        inside the scroll area (the patients search, the prescription tools, the odontogram tools —
        all `sticky top-0 z-40`), or a dropdown hanging down from the bar is painted over by them.
        It has to sit BELOW every modal, and the lowest modal overlay in the product is `z-50`.
        Hence 45, in the gap.

        It used to be z-[120], inherited from the left rail's z-[150]. That was safe for a rail:
        88px down the side of the screen, where a centred dialog never reached it. A bar across the
        whole top clipped the top of every modal instead.
      */}
      <BandShell
        nav={
          <TopNav
            items={visibleItems}
            showSettings={showSettings}
            isSuperAdmin={!!user?.isSuperAdmin}
            onLogout={handleLogout}
            onReturnToSuperAdmin={handleReturnToSuperAdmin}
          />
        }
        strip={<PageHeaderStrip fallbackTitle={fallbackTitle} />}
      />

      {/* MOBILE MENU OVERLAY */}
      {isOpen && (
         <div className="lg:hidden fixed inset-0 z-[200] bg-surface flex flex-col animate-in fade-in slide-in-from-bottom-8 duration-300">
            <div className="flex items-center justify-between p-5 border-b border-line">
               {logoUrl ? (
                  /* White tile, not the black one: a dark logo on a black square is invisible. */
                  <div className="w-10 h-10 bg-surface border border-line rounded-xl flex items-center justify-center overflow-hidden shadow-sm p-1">
                     {/* eslint-disable-next-line @next/next/no-img-element */}
                     <img src={logoUrl} alt={clinic?.name || ""} className="max-h-full max-w-full object-contain" />
                  </div>
               ) : (
                  <div className="w-10 h-10 bg-ink-slab text-white rounded-xl flex items-center justify-center rounded-tr-3xl shadow-sm">
                     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                  </div>
               )}
               <button onClick={() => setIsOpen(false)} className="p-2 bg-surface-muted text-ink rounded-full hover:bg-line"><X size={20}/></button>
            </div>

            <div className="px-5 pt-4 pb-2 border-b border-line flex items-center justify-center">
               <ClinicSwitcher />
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-6">
               {/* Dashboard is not in any group — it is a destination of its own in the top bar,
                   and dropping it from the sheet would make the phone menu lie about the app. */}
               {hasAccess("dashboard", true) && (
                 <Link href="/" data-tour="nav-" onClick={() => setIsOpen(false)} className={sheetRow(pathname === "/")}>
                   <LayoutDashboard size={22} strokeWidth={pathname === "/" ? 2.5 : 2} />
                   {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                   <span className="text-base truncate">{t("dashboard" as any) || "Dashboard"}</span>
                 </Link>
               )}

               {SECTION_GROUPS.map((section) => {
                  const sectionItems = allNavItems.filter((item) => hasAccess(item.key, true) && section.keys.includes(item.key));
                  if (sectionItems.length === 0) return null;

                  return (
                    <div key={section.titleEn} className="space-y-1">
                      <h3 className="px-3 mb-2 text-[11px] font-black uppercase tracking-wider text-ink-muted">
                        {language === "ar" ? section.titleAr : section.titleEn}
                      </h3>
                      {sectionItems.map((item) => {
                        const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const label = t(item.key as any) || item.key.charAt(0).toUpperCase() + item.key.slice(1);

                        return (
                             <Link
                             key={item.href} data-tour={`nav-${String(item.href).replace(/^\//, "")}`}
                             href={item.href}
                             onClick={() => setIsOpen(false)}
                             className={sheetRow(isActive)}
                           >
                             <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                             <span className="text-base truncate">{label}</span>
                             {"badge" in item && (item.badge ?? 0) > 0 && (
                               <span className="ms-auto min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#c0392b] text-white text-[11px] font-black flex items-center justify-center">
                                 {item.badge}
                               </span>
                             )}
                           </Link>
                        )
                      })}
                    </div>
                  );
               })}

               <div className="pt-2 border-t border-line space-y-1">
               <button onClick={() => { toggleLanguage(); setIsOpen(false); }} className="flex items-center w-full gap-4 px-4 py-3 rounded-2xl font-bold text-ink-body hover:bg-surface-subtle transition-all">
                  <Languages size={22} />
                  <span className="text-base truncate">{language === 'en' ? 'Switch to Arabic' : 'English'}</span>
               </button>
               {showSettings && (
                 <Link href="/settings" data-tour="nav-settings" onClick={() => setIsOpen(false)} className={sheetRow(pathname.startsWith('/settings'))}>
                    <Settings size={22} />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <span className="text-base truncate">{t('settings' as any) || (language === 'ar' ? 'الإعدادات' : 'Settings')}</span>
                 </Link>
               )}
               {/* Ungated for the same reason Help is: the people who most need the guide are
                   the ones with the fewest permissions, and it already shows each role only the
                   steps that role can finish. */}
               <Link href="/welcome" data-tour="menu-welcome" onClick={() => setIsOpen(false)} className={sheetRow(pathname.startsWith('/welcome'))}>
                  <Rocket size={22} />
                  <span className="text-base truncate">{language === 'ar' ? 'البداية' : 'Getting started'}</span>
               </Link>
               <TourMenuRow className={`w-full text-left rtl:text-right ${sheetRow(false)}`} onPick={() => setIsOpen(false)} />
               <Link href="/help" data-tour="menu-help" onClick={() => setIsOpen(false)} className={sheetRow(pathname.startsWith('/help'))}>
                  <LifeBuoy size={22} />
                  <span className="text-base truncate">{language === 'ar' ? 'مركز المساعدة' : 'Help Center'}</span>
               </Link>
               {user?.isSuperAdmin && (
                 <button onClick={() => { setIsOpen(false); handleReturnToSuperAdmin(); }} className="flex items-center w-full gap-4 px-4 py-3 rounded-2xl font-bold text-[#008f72] hover:bg-emerald-50 transition-all mt-2 text-left rtl:text-right">
                    <ShieldCheck size={22} />
                    <span className="text-base truncate">Return to Hub</span>
                 </button>
               )}
               <button onClick={() => { setIsOpen(false); handleLogout(); }} className="flex items-center w-full gap-4 px-4 py-3 rounded-2xl font-bold text-[#c0392b] hover:bg-rose-50 transition-all mt-2 text-left rtl:text-right">
                  <LogOut size={22} />
                  <span className="text-base truncate">{language === 'en' ? 'Logout' : 'تسجيل الخروج'}</span>
               </button>
               </div>
            </div>
         </div>
      )}

      {/* =================== THE WHITE HALF =================== */}
      <div className="flex min-h-0 flex-1 flex-col">
         {/* The last few days of a trial. Mutually exclusive with the read-only notice below —
             the countdown stops the moment the date passes and that one takes over. */}
         <TrialCountdownBanner />

         {/* Only while the sample clinic is open: where you are, and the way back. */}
         <DemoTourBanner />

         {isReadOnly && (
           <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-center justify-center gap-3 z-50 shadow-sm relative shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-600"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <p className="text-red-800 font-bold text-sm md:text-base">
                 {/* Which of the two it is, rather than both at once. "Suspended or expired"
                     made the reader work out their own situation, and the two have different
                     next steps — renewing versus asking why you were suspended. */}
                 {readOnlyReason === 'suspended'
                    ? (language === 'ar'
                        ? 'تم تعليق هذه العيادة. السجلات ما زالت متاحة للقراءة، لكن الإضافات الجديدة متوقفة. يرجى الاتصال بنا.'
                        : 'This clinic is suspended. Records are still readable, but new entries are paused. Please contact us.')
                    : (language === 'ar'
                        ? 'انتهى اشتراك هذه العيادة. السجلات ما زالت متاحة للقراءة، لكن الإضافات الجديدة متوقفة حتى التجديد.'
                        : "This clinic's subscription has ended. Records are still readable, but new entries are paused until it is renewed.")}
              </p>
           </div>
         )}

         {/* --- MAIN PAGE CONTENT --- */}
         <main
           data-tour="page-main"
           className={`flex-1 min-h-0 relative z-0 animate-in fade-in duration-300 ${
             isFullHeightPage
               ? "flex flex-col overflow-hidden"
               : "overflow-x-hidden overflow-y-auto pb-24 lg:pb-0"
           }`}
         >
             {children}
         </main>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <div className="lg:hidden fixed bottom-4 left-4 right-4 h-16 rounded-[2rem] bg-ink-slab backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.2)] z-[80] px-6 flex justify-between items-center border border-white/10">
          {mobileNavItems.map((item) => {
             if (item.key === 'menu') {
                 return (
                    <button key="menu" data-tour="nav-menu"
                       /* Everything in the sheet is reachable through this button — for the tour's hand. */
                       data-tour-opens={[...allNavItems.map((i) => `nav-${String(i.href).replace(/^\//, "")}`), "nav-settings", "menu-welcome", "menu-help"].join(" ")}
                       onClick={() => setIsOpen(true)} className="flex items-center justify-center transition-all active:scale-95 group outline-none">
                       <div className="p-2.5 rounded-full text-white/50 group-hover:bg-white/10 group-hover:text-white transition-all">
                          <Menu size={24} strokeWidth={2.5} />
                       </div>
                    </button>
                 );
             }
             const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
             return (
                <Link key={item.key} href={item.href} data-tour={`nav-${item.key}`} className="flex items-center justify-center transition-all active:scale-95 group outline-none">
                   <div className={`relative p-2.5 rounded-full transition-all duration-300 flex items-center justify-center ${isActive ? 'bg-[#FACC15] text-ink scale-110 shadow-sm' : 'text-white/50 group-hover:bg-white/10 group-hover:text-white'}`}>
                      <item.icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                      {"badge" in item && (item.badge ?? 0) > 0 && (
                        <span className="absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#c0392b] text-white text-[10px] font-black flex items-center justify-center ring-2 ring-ink-slab">
                          {item.badge}
                        </span>
                      )}
                   </div>
                </Link>
             );
          })}
      </div>

      {/* AI CHAT WIDGET & BUBBLE */}
      <AiChatWidget />

      {/* The assistant speaking first: the next setup step, above the same orb. Renders nothing
          once the guide is finished, while a lesson runs, or after it has been sent away. */}
      <WelcomeCoach />

      {/* Guided-tutorial ring + instruction card; renders nothing unless a lesson is running. */}
      <TutorialOverlay />

      {/* Sara: the one-time "meet me" screen, and the tour itself when it is running. */}
      <TourIntro />
      <GrandTourOverlay />
    </div>
    </PageHeaderProvider>
    </WelcomeLayer>
    </TourProvider>
    </TutorialProvider>
  );
}
