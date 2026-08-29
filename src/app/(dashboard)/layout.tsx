"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus_Jakarta_Sans, Cairo } from "next/font/google";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, Calendar, Wallet, Settings, Sparkles,
  FileBarChart, Menu, X, LogOut, Loader2, Languages,
  Package, ChevronLeft, ChevronRight, Clock, FlaskConical, MessageCircle, ShieldCheck, UserCheck,
  LifeBuoy, Inbox, Megaphone
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicLogo } from "@/lib/clinicLogo";
import { canAccessNavItem, canShowSettingsNavLink } from "@/lib/navAccess";
import { hasFeature } from "@/lib/subscriptions";
import NotificationBell from "@/components/NotificationBell";
import ReceptionSummonOverlay from "@/components/summon/ReceptionSummonOverlay";
import { useUI } from "@/context/UIContext";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";
import DesktopSidebar from "@/components/dashboard/DesktopSidebar";
import AiChatWidget from "@/components/AiChatWidget";
import { TutorialProvider } from "@/context/TutorialContext";
import TutorialOverlay from "@/components/TutorialOverlay";

const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const cairo = Cairo({ subsets: ["arabic"] });

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullHeightPage = pathname === "/appointments" || pathname === "/";
  const router = useRouter();
  const { t, toggleLanguage, language, isRTL } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const { clinicId, clinic, isAdmin, isReadOnly, readOnlyReason } = useClinic();
  const { appointmentsVisibility } = useUI();
  
  const [isOpen, setIsOpen] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [searchVal, setSearchVal] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  // Same mark as the desktop rail, fetched here for the mobile menu header.
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
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setSearchVal(params.get("search") || "");
    }
  }, [pathname]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchVal(val);
    const params = new URLSearchParams(window.location.search);
    if (val) {
      params.set("search", val);
    } else {
      params.delete("search");
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) setIsCheckingAuth(false);
      else router.push("/login");
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
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
   * and Recalls (/ai/operations) were deliberately dropped from this list — the rail had grown
   * past what anyone could scan. Their pages still exist at those URLs, but nothing links to
   * them anymore; delete the routes outright once they are confirmed unmissed.
   */
  const allNavItems = [
    { key: "dashboard", href: "/", icon: LayoutDashboard },
    { key: "briefing", href: "/ai/briefing", icon: Sparkles },
    { key: "leads", href: "/leads", icon: Inbox },
    { key: "marketing", href: "/marketing", icon: Megaphone },
    { key: "messages", href: "/messages", icon: MessageCircle },
    { key: "patients", href: "/patients", icon: Users },
    { key: "appointments", href: "/appointments", icon: Calendar },
    { key: "inventory", href: "/inventory", icon: Package },
    // Gated on access.lab, which canAccessNavItem derives from the key. The permission and both
    // translations of this label already existed and pointed at nothing until the page was built.
    { key: "lab", href: "/lab", icon: FlaskConical },
    { key: "finance", href: "/finance", icon: Wallet },
    { key: "attendanceAi", href: "/ai/attendance", icon: UserCheck },
    { key: "reports", href: "/reports", icon: FileBarChart },
    { key: "attendance", href: "/attendance", icon: Clock },
  ];

  const hasAccess = useCallback((key: string, isMobile: boolean = false) => {
    if (key === 'appointments') {
      if (appointmentsVisibility === 'hidden') return false;
      if (appointmentsVisibility === 'desktop' && isMobile) return false;
    }

    // Tier based gating
    if (key === 'inventory' && !hasFeature(clinic, 'inventory')) return false;
    if (key === 'attendance' && !hasFeature(clinic, 'attendance')) return false;

    // The marketing studio is a paid add-on. Admins see the entry even without it — the page
    // shows the upgrade pitch, which is how the add-on gets discovered. Staff only see it once
    // the add-on is active AND they hold the access.marketing grant.
    if (key === 'marketing') {
      if (isAdmin) return true;
      if (!hasFeature(clinic, 'marketingText')) return false;
      return canAccessNavItem('marketing', user, isAdmin);
    }

    // Leads are worked by whoever answers the desk. Reception already holds patient access, so
    // that grant carries over — no clinic has to edit permissions to start using the CRM.
    if (key === 'messages') {
      return canAccessNavItem('patients', user, isAdmin);
    }

    if (key === 'leads') {
      return canAccessNavItem('leads', user, isAdmin) || canAccessNavItem('patients', user, isAdmin);
    }

    return canAccessNavItem(key, user, isAdmin);
  }, [user, isAdmin, appointmentsVisibility, clinic]);

  const visibleItems = allNavItems.filter((item) => hasAccess(item.key, false));
  const showSettings = canShowSettingsNavLink(user, isAdmin);

  if (isCheckingAuth || authLoading) {
    return (
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
        {/* Desktop Sidebar Skeleton */}
        <aside className="hidden lg:flex w-64 flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 p-6 animate-pulse">
          <div className="h-8 bg-slate-200 dark:bg-slate-800 rounded-md w-3/4 mb-10"></div>
          <div className="space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-10 bg-slate-200 dark:bg-slate-800 rounded-lg w-full"></div>
            ))}
          </div>
        </aside>

        <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
          {/* Header Skeleton */}
          <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 lg:px-8 flex items-center justify-between shrink-0 animate-pulse">
            <div className="h-6 bg-slate-200 dark:bg-slate-800 rounded-md w-32 lg:w-48"></div>
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 bg-slate-200 dark:bg-slate-800 rounded-full"></div>
              <div className="w-8 h-8 bg-slate-200 dark:bg-slate-800 rounded-full hidden sm:block"></div>
            </div>
          </header>

          {/* Main Content Skeleton */}
          <div className="flex-1 p-4 lg:p-8 animate-pulse">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800"></div>
              ))}
            </div>
            <div className="h-64 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800"></div>
          </div>
        </main>
      </div>
    );
  }

  const mobileCandidates = [
    { key: "dashboard", href: "/", icon: LayoutDashboard },
    { key: "briefing", href: "/ai/briefing", icon: Sparkles },
    { key: "appointments", href: "/appointments", icon: Calendar },
    { key: "finance", href: "/finance", icon: Wallet },
    { key: "reports", href: "/reports", icon: FileBarChart },
    { key: "patients", href: "/patients", icon: Users },
  ];

  const mobileNavItems = [
    ...mobileCandidates.filter(item => hasAccess(item.key, true)),
    { key: "menu", href: "#menu", icon: Menu },
  ];

  return (
    <TutorialProvider>
    <div className={`min-h-[100dvh] lg:h-[100dvh] lg:overflow-hidden bg-surface-page text-slate-700 flex ${isRTL ? cairo.className : plusJakartaSans.className} relative z-0`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Decorative Minimal Background - Stronger Green/White Gradient */}
      <div className="hidden lg:block absolute inset-0 w-full h-full overflow-hidden pointer-events-none -z-10 bg-gradient-to-br from-[#F4F7F6] via-surface-page to-[#AEE2CD]">
         <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-white rounded-full blur-[120px] opacity-[0.8]"></div>
         <div className="absolute bottom-[-10%] right-[-5%] w-[50%] h-[70%] bg-[#8DE3C4] rounded-full blur-[140px] opacity-[0.3]"></div>
      </div>
      <ReceptionSummonOverlay />
      
      {/* MOBILE HEADER */}
      
      {/* MAIN APP CONTAINER */}
      <div className="flex flex-1 overflow-hidden relative h-full bg-transparent">
        {/* Premium Abstract Background - Minimalist */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 right-0 w-[60%] h-[70%] bg-gradient-to-bl from-white/[0.4] to-transparent blur-[120px] rounded-bl-full transform translate-x-1/4 -translate-y-1/4" />
        </div>
      
        {/* --- DESKTOP RAIL --- */}
        <DesktopSidebar
          items={visibleItems}
          showSettings={showSettings}
          isSuperAdmin={!!user?.isSuperAdmin}
          onLogout={handleLogout}
          onReturnToSuperAdmin={handleReturnToSuperAdmin}
        />

        {/* MOBILE MENU OVERLAY */}
        {isOpen && (
           <div className="lg:hidden fixed inset-0 z-[100] bg-white flex flex-col animate-in fade-in slide-in-from-bottom-8 duration-300">
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                 {logoUrl ? (
                    /* White tile, not the black one: a dark logo on a black square is invisible. */
                    <div className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center overflow-hidden shadow-sm p-1">
                       {/* eslint-disable-next-line @next/next/no-img-element */}
                       <img src={logoUrl} alt={clinic?.name || ""} className="max-h-full max-w-full object-contain" />
                    </div>
                 ) : (
                    <div className="w-10 h-10 bg-[#0a0a0a] text-white rounded-xl flex items-center justify-center rounded-tr-3xl shadow-sm">
                       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                    </div>
                 )}
                 <button onClick={() => setIsOpen(false)} className="p-2 bg-slate-100 text-slate-800 rounded-full hover:bg-slate-200"><X size={20}/></button>
              </div>
              
              <div className="px-5 pt-4 pb-2 border-b border-slate-100 flex items-center justify-center">
                 <ClinicSwitcher />
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-2">
                 {allNavItems.filter(item => hasAccess(item.key, true)).map((item) => {
                    const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                    const label = t(item.key as any) || item.key.charAt(0).toUpperCase() + item.key.slice(1);

                    return (
                       <Link 
                         key={item.href} data-tour={`nav-${String(item.href).replace(/^\//, "")}`} 
                         href={item.href}
                         onClick={() => setIsOpen(false)}
                         className={`flex items-center gap-4 px-5 py-3.5 rounded-2xl font-bold transition-all ${isActive ? 'bg-[#0a0a0a] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
                       >
                         <item.icon size={22} />
                         <span className="text-base">{label}</span>
                       </Link>
                    )
                 })}
                 <button onClick={() => { toggleLanguage(); setIsOpen(false); }} className="flex items-center w-full gap-4 px-5 py-3.5 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-all">
                    <Languages size={22} />
                    <span className="text-base">{language === 'en' ? 'Switch to Arabic' : 'English'}</span>
                 </button>
                 {showSettings && (
                   <Link href="/settings" onClick={() => setIsOpen(false)} className={`flex items-center gap-4 px-5 py-3.5 rounded-2xl font-bold transition-all ${pathname.startsWith('/settings') ? 'bg-[#0a0a0a] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>
                      <Settings size={22} />
                      <span className="text-base">{t('settings' as any) || (language === 'ar' ? 'الإعدادات' : 'Settings')}</span>
                   </Link>
                 )}
                 <Link href="/help" onClick={() => setIsOpen(false)} className={`flex items-center gap-4 px-5 py-3.5 rounded-2xl font-bold transition-all ${pathname.startsWith('/help') ? 'bg-[#0a0a0a] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}>
                    <LifeBuoy size={22} />
                    <span className="text-base">{language === 'ar' ? 'مركز المساعدة' : 'Help Center'}</span>
                 </Link>
                 {user?.isSuperAdmin && (
                   <button onClick={() => { setIsOpen(false); handleReturnToSuperAdmin(); }} className="flex items-center w-full gap-4 px-5 py-3.5 rounded-xl font-bold text-emerald-600 hover:bg-emerald-50 transition-all mt-4 text-left rtl:text-right">
                      <ShieldCheck size={22} />
                      <span className="text-base">Return to Hub</span>
                   </button>
                 )}
                 <button onClick={() => { setIsOpen(false); handleLogout(); }} className="flex items-center w-full gap-4 px-5 py-3.5 rounded-xl font-bold text-[#964734] hover:bg-[#964734]/10 transition-all mt-4 text-left rtl:text-right">
                    <LogOut size={22} />
                    <span className="text-base">{language === 'en' ? 'Logout' : 'تسجيل الخروج'}</span>
                 </button>
              </div>
           </div>
        )}

        {/* MAIN CONTENT AREA */}
        <div className="flex-1 flex flex-col min-w-0 bg-transparent">
           
           {isReadOnly && (
             <div className="bg-red-50 border-b border-red-200 px-4 py-3 flex items-center justify-center gap-3 z-50 shadow-sm relative">
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
             className={`flex-1 min-h-0 relative z-0 animate-in fade-in slide-in-from-bottom-3 duration-500 bg-transparent ${
               isFullHeightPage
                 ? "flex flex-col overflow-hidden"
                 : "overflow-x-hidden overflow-y-auto pb-24 lg:pb-0"
             }`}
           >
               {children}
           </main>
        </div>
      </div>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <div className="lg:hidden fixed bottom-4 left-4 right-4 h-16 rounded-[2rem] bg-[#0a0a0a] backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.2)] z-[80] px-6 flex justify-between items-center border border-white/10">
          {mobileNavItems.map((item) => {
             if (item.key === 'menu') {
                 return (
                    <button key="menu" data-tour="nav-menu" onClick={() => setIsOpen(true)} className="flex items-center justify-center transition-all active:scale-95 group outline-none">
                       <div className="p-2.5 rounded-full text-white/50 group-hover:bg-white/10 group-hover:text-white transition-all">
                          <Menu size={24} strokeWidth={2.5} />
                       </div>
                    </button>
                 );
             }
             const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
             return (
                <Link key={item.key} href={item.href} data-tour={`nav-${item.key}`} className="flex items-center justify-center transition-all active:scale-95 group outline-none">
                   <div className={`p-2.5 rounded-full transition-all duration-300 flex items-center justify-center ${isActive ? 'bg-white text-black scale-110 shadow-sm' : 'text-white/50 group-hover:bg-white/10 group-hover:text-white'}`}>
                      <item.icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                   </div>
                </Link>
             );
          })}
      </div>

      {/* AI CHAT WIDGET & BUBBLE */}
      <AiChatWidget />

      {/* Guided-tutorial ring + instruction card; renders nothing unless a lesson is running. */}
      <TutorialOverlay />
    </div>
    </TutorialProvider>
  );
}