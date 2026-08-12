"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus_Jakarta_Sans, Cairo } from "next/font/google";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { 
  LayoutDashboard, Users, Calendar, Wallet, Settings, Sparkles, 
  FileBarChart, Menu, X, LogOut, Loader2, Languages, 
  Package, ChevronLeft, ChevronRight, Clock, FlaskConical, MessageCircle, ShieldCheck, UserPlus, CalendarClock, UserCheck,
  BadgeDollarSign
} from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { canAccessNavItem, canShowSettingsNavLink } from "@/lib/navAccess";
import { hasFeature } from "@/lib/subscriptions";
import NotificationBell from "@/components/NotificationBell";
import ReceptionSummonOverlay from "@/components/summon/ReceptionSummonOverlay";
import { useUI } from "@/context/UIContext";
import ClinicSwitcher from "@/components/dashboard/ClinicSwitcher";
import AiChatWidget from "@/components/AiChatWidget";

const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const cairo = Cairo({ subsets: ["arabic"] });

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullHeightPage = pathname === "/appointments" || pathname === "/";
  const router = useRouter();
  const { t, toggleLanguage, language, isRTL } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const { clinic, isAdmin, isReadOnly } = useClinic();
  const { appointmentsVisibility } = useUI();
  
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [searchVal, setSearchVal] = useState("");

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

  const allNavItems = [
    { key: "dashboard", href: "/", icon: LayoutDashboard },
    { key: "briefing", href: "/ai/briefing", icon: Sparkles },
    { key: "patients", href: "/patients", icon: Users },
    { key: "appointments", href: "/appointments", icon: Calendar },
    { key: "inventory", href: "/inventory", icon: Package },
    { key: "finance", href: "/finance", icon: Wallet },
    { key: "paymentRecovery", href: "/finance/recovery", icon: BadgeDollarSign },
    { key: "revenueRecovery", href: "/ai/revenue", icon: Sparkles },
    { key: "reactivation", href: "/ai/reactivation", icon: UserPlus },
    { key: "operations", href: "/ai/operations", icon: CalendarClock },
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

    // The debtors list is part of Finance, not a module anyone holds a permission for, so it
    // follows whoever can already see the money — which is exactly what the page itself enforces
    // with `access.finance`. Giving it its own nav key would hide it from every existing user.
    if (key === 'paymentRecovery') return canAccessNavItem('finance', user, isAdmin);

    // Premium-only, and admin-only: the report lists every outstanding balance in the clinic
    // plus procedures charged below list price, which effectively audits the team's own billing.
    if (key === 'revenueRecovery') {
      if (!hasFeature(clinic, 'aiProactive')) return false;
      return isAdmin;
    }

    // Same gating: the scan lists every lapsed patient in the clinic, and running it queues
    // messages that go out in the clinic's name. Reviewing and sending an individual draft is
    // staff-level — that happens on the page itself, not here.
    if (key === 'reactivation') {
      if (!hasFeature(clinic, 'aiProactive')) return false;
      return isAdmin;
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
    <div className={`min-h-[100dvh] lg:h-[100dvh] lg:overflow-hidden bg-[#E8F0ED] text-slate-700 flex ${isRTL ? cairo.className : plusJakartaSans.className} relative z-0`} dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Decorative Minimal Background - Stronger Green/White Gradient */}
      <div className="hidden lg:block absolute inset-0 w-full h-full overflow-hidden pointer-events-none -z-10 bg-gradient-to-br from-[#F4F7F6] via-[#E8F0ED] to-[#AEE2CD]">
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
      
        {/* --- SLIM DESKTOP SIDEBAR --- */}
        <aside className={`
          hidden lg:flex flex-col w-[88px] shrink-0 items-center py-6 bg-transparent z-[100]
          ${isRTL ? 'right-0' : 'left-0'}
        `}>
          {/* LOGO */}
          <div className="flex items-center justify-center mb-4 shrink-0">
             <div className="w-12 h-12 bg-transparent text-slate-800 flex items-center justify-center">
                {/* Simplified Sparkle logo from image */}
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
             </div>
          </div>

          {/* CLINIC SWITCHER */}
          <ClinicSwitcher />

          {/* MAIN NAV ICONS */}
          <nav className="flex-1 w-full flex flex-col items-center gap-2 mt-1">
            {visibleItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
              const label = t(item.key as any) || item.key.charAt(0).toUpperCase() + item.key.slice(1);

              return (
                <div key={item.href} className={`group relative flex w-full justify-center px-3`}>
                  <Link 
                    href={item.href}
                    className={`
                      w-[46px] h-[46px] flex items-center justify-center transition-all duration-300 relative z-10 rounded-full
                      ${isActive ? `bg-[#2D3748] text-white shadow-[0_4px_12px_rgba(45,55,72,0.2)]` : "bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 shadow-sm border border-slate-100"}
                    `}
                  >
                    <item.icon size={20} className={`transition-transform duration-300 ${isActive ? 'scale-105' : 'group-hover:scale-105'}`} strokeWidth={isActive ? 2.5 : 2} />
                  </Link>
                  {/* Tooltip */}
                  <div className={`absolute top-1/2 -translate-y-1/2 z-[200] bg-[#2D3748] text-white text-xs font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg whitespace-nowrap ${isRTL ? 'right-full mr-4' : 'left-full ml-4'}`}>
                    {label}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* BOTTOM ICONS (Settings, Support, Logout) */}
          <div className="flex flex-col items-center gap-2 mt-auto w-full">
             {showSettings && (
                 <div className={`group relative flex w-full justify-center px-3`}>
                  <Link href="/settings" className={`w-[46px] h-[46px] rounded-full flex items-center justify-center transition-all duration-300 ${pathname.startsWith('/settings') ? `bg-[#2D3748] text-white shadow-md` : 'bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 shadow-sm border border-slate-100'}`}>
                      <Settings size={20} strokeWidth={pathname.startsWith('/settings') ? 2.5 : 2}/>
                  </Link>
                  <div className={`absolute top-1/2 -translate-y-1/2 z-[200] bg-[#2D3748] text-white text-xs font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg whitespace-nowrap ${isRTL ? 'right-full mr-4' : 'left-full ml-4'}`}>
                    {t('settings' as any) || (language === 'ar' ? 'الإعدادات' : 'Settings')}
                  </div>
                </div>
             )}
             
             <div className={`group relative flex w-full justify-center px-3`}>
                <button onClick={toggleLanguage} className="w-[46px] h-[46px] rounded-full flex items-center justify-center transition-all duration-300 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-800 shadow-sm border border-slate-100">
                    <Languages size={20} strokeWidth={2}/>
                </button>
                <div className={`absolute top-1/2 -translate-y-1/2 z-[200] bg-[#2D3748] text-white text-xs font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg whitespace-nowrap ${isRTL ? 'right-full mr-4' : 'left-full ml-4'}`}>
                    {language === 'ar' ? 'English' : 'عربي'}
                </div>
             </div>

             {user?.isSuperAdmin && (
               <div className={`group relative flex w-full justify-center px-3 mb-2`}>
                  <button onClick={handleReturnToSuperAdmin} className="w-[46px] h-[46px] rounded-full flex items-center justify-center transition-all duration-300 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 shadow-sm border border-emerald-100">
                      <ShieldCheck size={20} strokeWidth={2}/>
                  </button>
                  <div className={`absolute top-1/2 -translate-y-1/2 z-[200] bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg whitespace-nowrap ${isRTL ? 'right-full mr-4' : 'left-full ml-4'}`}>
                      Return to Hub
                  </div>
               </div>
             )}

             <div className={`group relative flex w-full justify-center px-3`}>
                <button onClick={handleLogout} className="w-[46px] h-[46px] rounded-full flex items-center justify-center transition-all duration-300 bg-white text-rose-500 hover:bg-rose-50 hover:text-rose-600 shadow-sm border border-rose-100">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                </button>
                <div className={`absolute top-1/2 -translate-y-1/2 z-[200] bg-rose-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg whitespace-nowrap ${isRTL ? 'right-full mr-4' : 'left-full ml-4'}`}>
                  {language === 'en' ? 'Logout' : 'تسجيل الخروج'}
                </div>
             </div>
          </div>
        </aside>

        {/* MOBILE MENU OVERLAY */}
        {isOpen && (
           <div className="lg:hidden fixed inset-0 z-[100] bg-white flex flex-col animate-in fade-in slide-in-from-bottom-8 duration-300">
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                 <div className="w-10 h-10 bg-[#0a0a0a] text-white rounded-xl flex items-center justify-center rounded-tr-3xl shadow-sm">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                 </div>
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
                         key={item.href} 
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
                   {language === 'ar' 
                      ? 'اشتراكك منتهي أو معلق. يرجى الاتصال بنا لاستعادة الصلاحيات. النظام حالياً في وضع القراءة فقط.' 
                      : 'Your subscription is suspended or expired. Please contact us to restore full access. You are currently in read-only mode.'}
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
                    <button key="menu" onClick={() => setIsOpen(true)} className="flex items-center justify-center transition-all active:scale-95 group outline-none">
                       <div className="p-2.5 rounded-full text-white/50 group-hover:bg-white/10 group-hover:text-white transition-all">
                          <Menu size={24} strokeWidth={2.5} />
                       </div>
                    </button>
                 );
             }
             const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
             return (
                <Link key={item.key} href={item.href} className="flex items-center justify-center transition-all active:scale-95 group outline-none">
                   <div className={`p-2.5 rounded-full transition-all duration-300 flex items-center justify-center ${isActive ? 'bg-white text-black scale-110 shadow-sm' : 'text-white/50 group-hover:bg-white/10 group-hover:text-white'}`}>
                      <item.icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                   </div>
                </Link>
             );
          })}
      </div>

      {/* AI CHAT WIDGET & BUBBLE */}
      <AiChatWidget />
    </div>
  );
}