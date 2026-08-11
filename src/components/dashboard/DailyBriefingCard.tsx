"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowUpRight, CalendarDays, Loader2, Sparkles, Wallet } from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import type { DailyBriefing } from "@/lib/automation/dailyBriefing";/**
 * The day's schedule plus balances that have gone quiet.
 *
 * Scope is narrower than a "morning briefing" usually implies, on purpose — see the comment in
 * lib/automation/dailyBriefing for why no-show risk and overdue balances are absent rather than
 * estimated. Everything shown here is a record, not a prediction.
 */
export default function DailyBriefingCard() {
  const { clinicId } = useClinic();
  const { language, isRTL } = useLanguage();
  const isAr = language === "ar";

  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setFailed(false);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("no session");

      const res = await fetch(`/api/ai/daily-briefing?clinicId=${encodeURIComponent(clinicId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "failed");
      setBriefing(data.briefing as DailyBriefing);
    } catch {
      // Silent: this sits above the real dashboard and must never block it.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [clinicId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return null;

  const money = (n: number) =>
    n.toLocaleString(isAr ? "ar-EG" : "en-US", { maximumFractionDigits: 0 });

  return (
    <div
      className="bg-white rounded-[2rem] border border-slate-200/60 shadow-sm p-6 mb-6"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2 text-violet-600">
          <Sparkles size={15} />
          <span className="text-[11px] font-black uppercase tracking-widest">
            {isAr ? "ملخص اليوم" : "Today at a glance"}
          </span>
        </div>
        {briefing && (
          <span className="text-[11px] font-bold text-slate-400">{briefing.dateKey}</span>
        )}
      </div>

      {loading ? (
        <div className="py-8 flex justify-center">
          <Loader2 size={20} className="animate-spin text-slate-300" />
        </div>
      ) : !briefing ? null : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: isAr ? "مواعيد اليوم" : "Appointments", value: briefing.counts.total },
              { label: isAr ? "حضروا" : "Attended", value: briefing.counts.attended },
              { label: isAr ? "لم يُسجَّل وصولهم" : "Not checked in", value: briefing.counts.stillScheduled },
              { label: isAr ? "ملغاة" : "Cancelled", value: briefing.counts.cancelled },
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl bg-slate-50 border border-slate-200/60 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{tile.label}</p>
                <p className="text-2xl font-black text-slate-900 mt-1">{tile.value}</p>
              </div>
            ))}
          </div>

          {briefing.appointments.length > 0 && (
            <div className="rounded-2xl border border-slate-200/60 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200/60 flex items-center gap-2">
                <CalendarDays size={13} className="text-slate-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {isAr ? "جدول اليوم" : "Today's schedule"}
                </span>
              </div>
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {briefing.appointments.map((a) => (
                  <div key={a.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[11px] font-black text-slate-400 tabular-nums shrink-0 w-16">
                        {a.time || "—"}
                      </span>
                      <Link
                        href={a.patientId ? `/patients/${a.patientId}` : "/appointments"}
                        className="text-[13px] font-bold text-slate-800 hover:text-violet-600 truncate transition-colors"
                      >
                        {a.patientName}
                      </Link>
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">
                      {a.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {briefing.staleBalances.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 overflow-hidden">
              <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Wallet size={13} className="text-amber-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                    {/* Deliberately not "overdue" — nothing in this system records a due date. */}
                    {isAr ? "أرصدة بلا حركة حديثة" : "Balances with no recent activity"}
                  </span>
                </div>
                <span className="text-[11px] font-black text-amber-700">
                  {money(briefing.staleBalanceTotal)}
                </span>
              </div>
              <div className="divide-y divide-amber-100 max-h-40 overflow-y-auto">
                {briefing.staleBalances.slice(0, 6).map((b) => (
                  <div key={b.patientId} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <Link
                      href={`/patients/${b.patientId}?tab=finance`}
                      className="inline-flex items-center gap-1 text-[13px] font-bold text-slate-800 hover:text-violet-600 truncate transition-colors"
                    >
                      {b.patientName}
                      <ArrowUpRight size={11} className="shrink-0" />
                    </Link>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] font-bold text-amber-600">
                        {isAr ? `${b.daysSinceLastActivity} يوم` : `${b.daysSinceLastActivity}d quiet`}
                      </span>
                      <span className="text-[13px] font-black text-slate-900 tabular-nums">
                        {money(b.balance)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {briefing.counts.total === 0 && briefing.staleBalances.length === 0 && (
            <p className="text-[13px] font-medium text-slate-400 text-center py-4">
              {isAr ? "لا توجد مواعيد اليوم." : "Nothing scheduled today."}
            </p>
          )}

          {briefing.notes.length > 0 && (
            <div className="flex items-start gap-2 pt-1">
              <AlertCircle size={12} className="text-slate-300 shrink-0 mt-0.5" />
              <p className="text-[11px] font-medium text-slate-400 leading-relaxed">
                {briefing.notes[0]}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
