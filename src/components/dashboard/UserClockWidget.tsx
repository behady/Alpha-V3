"use client";

import { useState, useEffect } from "react";
import { Clock, AlertCircle, TrendingUp, LogIn, Loader2, Wallet } from "lucide-react";
import { db, auth } from "@/lib/firebase";
import { collection, query, where, onSnapshot, getDocs, Timestamp } from "firebase/firestore";
import { useLanguage } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

export default function UserClockWidget({ mobileVariant = false, compact = false }: { mobileVariant?: boolean; compact?: boolean }) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();

  const [activeSession, setActiveSession] = useState<any>(null);
  const [liveDuration, setLiveDuration] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // 1. Fetch active session
  useEffect(() => {
    if (!user) return;
    const q = query(
      getClinicCollection("attendance"),
      where("userId", "==", user.uid),
      where("status", "==", "active")
    );
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setActiveSession({ id: snap.docs[0].id, ...snap.docs[0].data() });
      } else {
        setActiveSession(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  // 2. Timer for active session
  useEffect(() => {
    if (!activeSession?.checkIn) {
      setLiveDuration("");
      return;
    }
    const interval = setInterval(() => {
      const now = new Date();
      const start = activeSession.checkIn.toDate();
      const diffMs = now.getTime() - start.getTime();
      const h = Math.floor(diffMs / 3600000);
      const m = Math.floor((diffMs % 3600000) / 60000);
      const s = Math.floor((diffMs % 60000) / 1000);
      setLiveDuration(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [activeSession]);

  // 3. Calculate Monthly Income
  useEffect(() => {
    if (!user) return;
    const now = new Date();
    // Use local start and end of month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

    const q = query(
      getClinicCollection("ledger"),
      where("date", ">=", startOfMonth),
      where("date", "<=", endOfMonth)
    );

    const unsub = onSnapshot(q, (snap) => {
      let total = 0;
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.type === "payment") {
            const rawId = data.doctorId != null ? String(data.doctorId).trim() : "";
            const nameRaw = (data.doctorName || data.doctor || "").trim();
            
            // Check if this payment belongs to the current user
            const isUserPayment = rawId === user.uid || (nameRaw && user.name && nameRaw.toLowerCase() === user.name.toLowerCase());

            if (isUserPayment) {
                total += Number(data.doctorCommissionAmount || 0);
            }
        }
      });
      setMonthlyIncome(total);
    });

    return () => unsub();
  }, [user]);

  if (loading) {
    if (compact) {
      return (
        <div className="bg-white/90 backdrop-blur-md rounded-2xl px-4 py-2.5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 flex items-center justify-center shrink-0">
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        </div>
      );
    }

    return (
      <div className="bg-white/80 backdrop-blur-md rounded-[2rem] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.04)] border border-white flex items-center justify-center min-w-[200px]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }


  // Not clocked in state
  if (!activeSession) {
    if (compact) {
      return (
        <Link
          href="/attendance"
          title={language === 'ar' ? 'تنبيه الحضور' : 'Attendance Action Needed'}
          className="group flex items-center gap-2.5 shrink-0 bg-surface border border-slate-200 text-slate-700 rounded-full px-3.5 py-2 shadow-sm transition-all duration-300 hover:bg-slate-50 active:scale-95"
        >
          <div className="relative flex h-3 w-3 shrink-0 items-center justify-center">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-200 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
          </div>
          <span className="hidden 2xl:inline text-xs font-extrabold uppercase tracking-wider whitespace-nowrap drop-shadow-sm text-slate-500">
            {language === 'ar' ? 'لم تسجل الحضور' : 'Not clocked in'}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 rounded-full px-3 py-1 shrink-0 group-hover:bg-slate-200 transition-all">
            <LogIn size={12} strokeWidth={3} /> {language === 'ar' ? 'تسجيل' : 'Clock in'}
          </span>
        </Link>
      );
    }

    if (mobileVariant) {
      return (
        <Link href="/attendance" className="flex bg-rose-50 border border-rose-100 rounded-2xl p-3 items-center justify-between shadow-sm hover:scale-[1.02] transition-transform w-full">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-rose-500 animate-pulse" />
            <span className="text-sm font-bold text-rose-700 tracking-tight">
              {language === 'ar' ? 'لم تقم بتسجيل الحضور' : 'Not Clocked In!'}
            </span>
          </div>
          <div className="bg-rose-500 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-sm">
             <LogIn size={12} /> {language === 'ar' ? 'تسجيل' : 'Clock in'}
          </div>
        </Link>
      );
    }

    return (
      <Link href="/attendance" className="flex-1 bg-rose-50/80 backdrop-blur-md text-rose-600 p-5 rounded-[2rem] shadow-[0_12px_40px_rgba(244,63,94,0.1)] flex flex-col justify-center min-w-[250px] border border-rose-100 hover:scale-[1.02] transition-transform cursor-pointer relative overflow-hidden group">
        <div className="absolute inset-0 bg-rose-500/5 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
        <div className="flex items-center justify-between mb-2 relative z-10">
          <span className="text-base font-bold text-rose-600/80 uppercase tracking-wider">{language === 'ar' ? 'تنبيه الحضور' : 'Attendance'}</span>
          <AlertCircle size={20} className="text-rose-500 animate-pulse" />
        </div>
        <div className="flex items-center justify-between gap-4 relative z-10">
          <span className="text-2xl font-light leading-none tracking-tight">
            {language === 'ar' ? 'لم تقم بتسجيل الدخول!' : 'You haven\'t clocked in!'}
          </span>
          <div className="text-xs font-bold text-white uppercase tracking-widest bg-rose-500 hover:bg-rose-600 transition-colors rounded-xl px-4 py-2.5 flex items-center gap-1.5 shrink-0 shadow-sm shadow-rose-500/30">
            <LogIn size={14} /> {language === 'ar' ? 'تسجيل' : 'Clock in'}
          </div>
        </div>
      </Link>
    );
  }

  // Clocked in state
  if (compact) {
    return (
      <Link
        href="/attendance"
        title={language === 'ar' ? 'الوقت الحالي' : 'Active Shift'}
        className="group flex items-center gap-3 shrink-0 bg-surface border border-slate-200 text-slate-700 rounded-full px-4 py-2 shadow-sm transition-all hover:bg-slate-50"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-200 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 m-auto"></span>
        </span>
        <span className="text-[17px] font-mono font-bold tracking-tight leading-none whitespace-nowrap text-slate-800">
          {liveDuration || "00:00:00"}
        </span>
        <span className="hidden 2xl:flex items-center gap-2 border-s border-slate-200 ps-3 text-xs font-black whitespace-nowrap bg-slate-50 rounded-e-full py-0.5 pr-2 -mr-1">
          <Wallet size={14} className="text-slate-400 shrink-0" strokeWidth={2.5} />
          {monthlyIncome === null ? (
            <Loader2 size={12} className="animate-spin text-slate-400" />
          ) : (
            <>
              <span className="text-slate-700">{monthlyIncome.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}</span>
              <span className="font-medium text-slate-400 text-[10px] uppercase tracking-widest ms-1">{language === 'ar' ? 'ج.م' : 'EGP'}</span>
            </>
          )}
        </span>
      </Link>
    );
  }

  if (mobileVariant) {
    return (
      <Link href="/attendance" className="flex bg-gradient-to-r from-emerald-500 to-teal-500 text-white p-3 rounded-2xl shadow-sm hover:scale-[1.02] transition-transform w-full items-center justify-between">
        <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-200 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-100"></span>
            </span>
            <span className="text-xs font-bold text-emerald-50 tracking-wide uppercase">{language === 'ar' ? 'الوقت الحالي' : 'Active Shift'}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xl font-mono font-light tracking-tight leading-none drop-shadow-sm">
            {liveDuration || "00:00:00"}
          </span>
          <Clock size={16} className="text-emerald-200" />
        </div>
      </Link>
    );
  }

  return (
    <Link href="/attendance" className="flex-1 bg-gradient-to-br from-emerald-500 to-teal-600 text-white p-5 rounded-[2rem] shadow-[0_12px_40px_rgba(16,185,129,0.3)] flex flex-col justify-center min-w-[250px] hover:scale-[1.02] transition-transform cursor-pointer relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10"></div>
      
      <div className="flex items-center justify-between mb-2 relative z-10">
        <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-200 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-100"></span>
            </span>
            <span className="text-base font-bold text-emerald-50 tracking-wider uppercase">{language === 'ar' ? 'الوقت الحالي' : 'Active Shift'}</span>
        </div>
        <Clock size={20} className="text-emerald-100" />
      </div>

      <div className="flex items-end justify-between gap-4 relative z-10 mt-2">
          <span className="text-4xl font-light tracking-tight drop-shadow-sm font-mono leading-none">
            {liveDuration || "00:00:00"}
          </span>
          
          <div className="flex items-center gap-2 bg-black/10 rounded-xl px-4 py-2 backdrop-blur-md border border-white/10 shrink-0">
             <Wallet size={16} className="text-emerald-100 hidden lg:block" />
             <div className="flex flex-col">
                <span className="text-xs text-emerald-100/80 font-bold uppercase tracking-widest mb-1">{language === 'ar' ? 'دخل الشهر' : 'Month Income'}</span>
                {monthlyIncome === null ? (
                    <Loader2 size={14} className="animate-spin text-emerald-100" />
                ) : (
                    <span className="text-base font-bold leading-none mt-0.5">
                        {monthlyIncome.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')} <span className="text-xs font-normal opacity-80">{language === 'ar' ? 'ج.م' : 'EGP'}</span>
                    </span>
                )}
             </div>
          </div>
      </div>
    </Link>
  );
}
