"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CircleHelp,
  Loader2,
  RefreshCw,
  UserCheck,
  UserX,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import type { UnresolvedReport } from "@/lib/automation/unresolvedAppointments";
import type { NoShowReport, RiskBand } from "@/lib/automation/noShowRisk";

const BAND_TONE: Record<Exclude<RiskBand, "insufficient_data">, string> = {
  high: "text-rose-700 bg-rose-50 border-rose-200",
  elevated: "text-amber-700 bg-amber-50 border-amber-200",
  low: "text-emerald-700 bg-emerald-50 border-emerald-200",
};

/**
 * Patient no-shows, as one tab of the Intelligence page.
 *
 * The staff time clock at /attendance is a different screen entirely — this one is about patients
 * who did or did not turn up, and closing out the past appointments nobody answered for.
 *
 * The scan is a manual fetch rather than a live subscription, so it gets a refresh button: after
 * resolving a run of appointments the figures below them are stale until it is pressed.
 */
export default function NoShowPanel() {
  const { clinicId } = useClinic();
  const { user } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";

  const [unresolved, setUnresolved] = useState<UnresolvedReport | null>(null);
  const [risk, setRisk] = useState<NoShowReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error(isAr ? "انتهت الجلسة." : "Session expired.");

      const res = await fetch(`/api/ai/attendance?clinicId=${encodeURIComponent(clinicId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Scan failed");

      setUnresolved(data.unresolved as UnresolvedReport);
      setRisk(data.risk as NoShowReport);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Scan failed", "error");
    } finally {
      setLoading(false);
    }
  }, [clinicId, isAr, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (appointmentId: string, outcome: "Completed" | "No Show") => {
    if (!clinicId || busy) return;
    setBusy(appointmentId);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error(isAr ? "انتهت الجلسة." : "Session expired.");

      const res = await fetch("/api/ai/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clinicId, appointmentId, outcome, userName: user?.name }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not update");

      setUnresolved((prev) =>
        prev
          ? {
              ...prev,
              appointments: prev.appointments.filter((a) => a.id !== appointmentId),
              count: prev.count - 1,
            }
          : prev
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not update", "error");
    } finally {
      setBusy(null);
    }
  };

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  if (loading) {
    return (
      <div className="bg-surface rounded-3xl border border-line p-12 flex justify-center">
        <Loader2 size={24} className="animate-spin text-slate-300" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => void load()}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-line text-xs font-black uppercase tracking-wide text-ink-body hover:bg-surface-subtle transition-colors"
      >
        <RefreshCw size={14} />
        {isAr ? "تحديث" : "Refresh"}
      </button>

      {/* --- Unresolved: the data-generating step --- */}
      <div className="bg-surface rounded-3xl border border-line shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CircleHelp size={16} className="text-violet-600" />
            <h2 className="text-sm font-black text-ink uppercase tracking-widest">
              {isAr ? "بحاجة إلى إجابة" : "Needs an answer"}
            </h2>
          </div>
          <span className="text-xs font-black text-slate-400">{unresolved?.count ?? 0}</span>
        </div>

        {unresolved && unresolved.appointments.length === 0 ? (
          <div className="p-10 text-center">
            <Check size={24} className="text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-ink-body">
              {isAr ? "كل المواعيد السابقة مُغلقة." : "Every past appointment is closed out."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {unresolved?.appointments.map((a) => (
              <div key={a.id} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={a.patientId ? `/patients/${a.patientId}` : "/appointments"}
                    className="inline-flex items-center gap-1.5 font-bold text-ink hover:text-violet-600 transition-colors"
                  >
                    {a.patientName}
                    <ArrowUpRight size={13} />
                  </Link>
                  <p className="text-[12px] font-medium text-ink-muted mt-0.5">
                    {a.date} {a.time && `· ${a.time}`}
                    {a.treatment && ` · ${a.treatment}`}
                    {" · "}
                    {isAr ? `منذ ${a.daysAgo} يوم` : `${a.daysAgo}d ago`}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => void resolve(a.id, "Completed")}
                    disabled={busy === a.id}
                    className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-2 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98]"
                  >
                    {busy === a.id ? <Loader2 size={12} className="animate-spin" /> : <UserCheck size={12} />}
                    {isAr ? "حضر" : "Attended"}
                  </button>
                  <button
                    onClick={() => void resolve(a.id, "No Show")}
                    disabled={busy === a.id}
                    className="inline-flex items-center gap-1.5 bg-surface hover:bg-surface-subtle disabled:opacity-50 text-ink-body border border-line px-3 py-2 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98]"
                  >
                    <UserX size={12} />
                    {isAr ? "لم يحضر" : "No show"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {unresolved && unresolved.notes.length > 0 && (
          <div className="px-6 py-3 bg-surface-subtle border-t border-slate-100">
            {unresolved.notes.map((n, i) => (
              <p key={i} className="text-[11px] font-medium text-slate-400 leading-relaxed">{n}</p>
            ))}
          </div>
        )}
      </div>

      {/* --- What the closed-out history implies --- */}
      {risk && (
        <div className="bg-surface rounded-3xl border border-line shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-sm font-black text-ink uppercase tracking-widest">
              {isAr ? "سجل الحضور" : "Attendance record"}
            </h2>
          </div>

          <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: isAr ? "مواعيد سابقة" : "Past appointments", value: risk.summary.totalPastAppointments },
              { label: isAr ? "تم إغلاقها" : "Closed out", value: pct(risk.summary.resolvedRate) },
              { label: isAr ? "حالات غياب" : "No-shows recorded", value: risk.summary.totalMissed },
              { label: isAr ? "مرضى لديهم سجل كافٍ" : "Patients with enough history", value: risk.summary.patientsScored },
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl bg-surface-subtle border border-slate-200/60 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{tile.label}</p>
                <p className="text-2xl font-black text-ink mt-1">{tile.value}</p>
              </div>
            ))}
          </div>

          {/* The caveats are the point, not fine print — they say when these numbers
              cannot yet be trusted. */}
          {risk.notes.length > 0 && (
            <div className="mx-6 mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
              <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <ul className="text-[12px] font-medium text-amber-900 space-y-1 leading-relaxed">
                {risk.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          {risk.summary.patientsScored > 0 && (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {risk.patients
                .filter((p) => p.missRate !== null)
                .map((p) => (
                  <div key={p.patientId} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/patients/${p.patientId}`}
                        className="inline-flex items-center gap-1.5 font-bold text-ink hover:text-violet-600 transition-colors"
                      >
                        {p.patientName}
                        <ArrowUpRight size={13} />
                      </Link>
                      <p className="text-[12px] font-medium text-ink-muted mt-0.5">
                        {isAr
                          ? `حضر ${p.attended} · غاب ${p.missed}`
                          : `${p.attended} attended · ${p.missed} missed`}
                        {p.unresolved > 0 &&
                          (isAr
                            ? ` · ${p.unresolved} بلا إجابة`
                            : ` · ${p.unresolved} unanswered`)}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border ${
                        BAND_TONE[p.band as Exclude<RiskBand, "insufficient_data">]
                      }`}
                    >
                      {pct(p.missRate as number)} {isAr ? "غياب" : "missed"}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
