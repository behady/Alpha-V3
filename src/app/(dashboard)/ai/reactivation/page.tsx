"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Clock,
  Loader2,
  Lock,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  UserX,
  X,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import PermissionGuard from "@/components/PermissionGuard";
import { hasFeature } from "@/lib/subscriptions";
import type { DormancyReport, DormantPatient } from "@/lib/automation/dormantPatients";

type Draft = {
  id: string;
  patientId: string;
  patientName: string;
  phone: string;
  body: string;
  status: string;
  context?: { lastVisitDate?: string | null; daysSinceLastVisit?: number | null } | null;
};

export default function ReactivationPage() {
  const { clinic, clinicId } = useClinic();
  const { user } = useAuth();
  const { language, isRTL } = useLanguage();
  const { showToast } = useUI();
  const isAr = language === "ar";

  const [report, setReport] = useState<DormancyReport | null>(null);
  const [thresholdSource, setThresholdSource] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busyDraft, setBusyDraft] = useState<string | null>(null);

  const unlocked = hasFeature(clinic, "aiProactive");

  const token = useCallback(async () => {
    const t = await auth.currentUser?.getIdToken();
    if (!t) throw new Error(isAr ? "انتهت الجلسة. سجّل الدخول مرة أخرى." : "Session expired. Please sign in again.");
    return t;
  }, [isAr]);

  const loadDrafts = useCallback(async () => {
    if (!clinicId || !unlocked) return;
    setLoadingDrafts(true);
    try {
      const res = await fetch(
        `/api/message-drafts?clinicId=${encodeURIComponent(clinicId)}&status=pending_review`,
        { headers: { Authorization: `Bearer ${await token()}` } }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not load drafts");
      setDrafts(data.drafts as Draft[]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not load drafts", "error");
    } finally {
      setLoadingDrafts(false);
    }
  }, [clinicId, unlocked, token, showToast]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  const runScan = async (createDrafts: boolean) => {
    if (!clinicId) return;
    setScanning(true);
    try {
      const res = await fetch("/api/ai/reactivation", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ clinicId, createDrafts }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Scan failed");

      setReport(data.report as DormancyReport);
      setThresholdSource(String(data.thresholdSource || ""));

      if (createDrafts && data.drafted) {
        const { created, skipped } = data.drafted as { created: number; skipped: number };
        showToast(
          isAr
            ? `تم إنشاء ${created} رسالة للمراجعة${skipped ? ` (تم تخطي ${skipped} موجودة مسبقاً)` : ""}`
            : `${created} message${created === 1 ? "" : "s"} queued for review${skipped ? ` (${skipped} already queued)` : ""}`,
          "success"
        );
        await loadDrafts();
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Scan failed", "error");
    } finally {
      setScanning(false);
    }
  };

  const resolveDraft = async (draft: Draft, decision: "approve" | "reject") => {
    if (!clinicId || busyDraft) return;
    setBusyDraft(draft.id);
    try {
      const res = await fetch("/api/message-drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          clinicId,
          draftId: draft.id,
          decision,
          editedBody: editing[draft.id],
          userName: user?.name,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not update that draft");

      showToast(
        decision === "approve"
          ? isAr ? "تم الإرسال" : "Message sent"
          : isAr ? "تم الرفض" : "Draft dismissed",
        "success"
      );
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not update that draft", "error");
    } finally {
      setBusyDraft(null);
    }
  };

  const dormant = useMemo(
    () => (report?.patients || []).filter((p) => p.reason === "dormant"),
    [report]
  );
  const neverVisited = useMemo(
    () => (report?.patients || []).filter((p) => p.reason === "never_visited"),
    [report]
  );

  const monthsLabel = (days: number) => {
    const m = Math.floor(days / 30);
    if (m < 1) return isAr ? `${days} يوم` : `${days} days`;
    return isAr ? `${m} شهر` : `${m} month${m === 1 ? "" : "s"}`;
  };

  if (!unlocked) {
    return (
      <PermissionGuard permission="access.patients">
        <div className="min-h-screen bg-slate-50/50 flex items-center justify-center p-6" dir={isRTL ? "rtl" : "ltr"}>
          <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto mb-5">
              <Lock size={26} />
            </div>
            <h1 className="text-xl font-black text-slate-900">
              {isAr ? "إعادة تفعيل المرضى" : "Patient Reactivation"}
            </h1>
            <p className="text-sm font-medium text-slate-500 mt-3 leading-relaxed">
              {isAr
                ? "يجد المرضى الذين لم تتم رؤيتهم منذ فترة ويجهّز رسالة لكل منهم لمراجعتها. متاح في باقة Premium."
                : "Finds patients you have not seen in a while and drafts a message to each for your review. Available on the Premium plan."}
            </p>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-6">
              {isAr ? `باقتك الحالية: ${clinic?.subscriptionTier ?? "—"}` : `Your plan: ${clinic?.subscriptionTier ?? "—"}`}
            </p>
          </div>
        </div>
      </PermissionGuard>
    );
  }

  return (
    <PermissionGuard permission="access.patients">
      <div className="min-h-screen bg-slate-50/50 pb-24 lg:pb-10 text-slate-800" dir={isRTL ? "rtl" : "ltr"}>
        <div className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-violet-600">
                <Sparkles size={16} />
                <span className="text-[11px] font-black uppercase tracking-widest">
                  {isAr ? "ذكاء ألفا · بريميوم" : "Alpha Intelligence · Premium"}
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight mt-1">
                {isAr ? "إعادة تفعيل المرضى" : "Patient Reactivation"}
              </h1>
              <p className="text-sm font-medium text-slate-500 mt-1 max-w-2xl">
                {isAr
                  ? "يجد المرضى الذين لم يحضروا منذ فترة. لا تُرسل أي رسالة قبل موافقتك عليها."
                  : "Finds patients who have not been in for a while. Nothing is sent until you approve it."}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => void runScan(false)}
                disabled={scanning}
                className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-5 py-3 rounded-xl font-black text-xs uppercase tracking-widest shadow-sm active:scale-[0.98] disabled:opacity-50 transition-all"
              >
                {scanning ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                {isAr ? "فحص فقط" : "Scan only"}
              </button>
              <button
                onClick={() => void runScan(true)}
                disabled={scanning}
                className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-3 rounded-xl font-black text-xs uppercase tracking-widest shadow-md shadow-slate-200 active:scale-[0.98] disabled:opacity-50 transition-all"
              >
                {scanning ? <Loader2 size={16} className="animate-spin" /> : <MessageSquare size={16} />}
                {isAr ? "فحص وتجهيز الرسائل" : "Scan & draft messages"}
              </button>
            </div>
          </div>

          {/* Review queue first — it is the part with pending work attached to it. */}
          {(drafts.length > 0 || loadingDrafts) && (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-violet-600" />
                  <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">
                    {isAr ? "بانتظار مراجعتك" : "Waiting for your review"}
                  </h2>
                </div>
                <span className="text-xs font-black text-slate-400">{drafts.length}</span>
              </div>

              {loadingDrafts && drafts.length === 0 ? (
                <div className="p-10 flex justify-center">
                  <Loader2 size={20} className="animate-spin text-slate-300" />
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {drafts.map((draft) => (
                    <div key={draft.id} className="p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          href={`/patients/${draft.patientId}`}
                          className="inline-flex items-center gap-1.5 font-black text-slate-900 hover:text-violet-600 transition-colors"
                        >
                          {draft.patientName}
                          <ArrowUpRight size={13} />
                        </Link>
                        <div className="flex items-center gap-3 text-[11px] font-bold text-slate-400">
                          {draft.context?.daysSinceLastVisit != null && (
                            <span className="inline-flex items-center gap-1">
                              <Clock size={11} />
                              {isAr
                                ? `آخر زيارة منذ ${monthsLabel(draft.context.daysSinceLastVisit)}`
                                : `Last seen ${monthsLabel(draft.context.daysSinceLastVisit)} ago`}
                            </span>
                          )}
                          <span className="font-mono">{draft.phone}</span>
                        </div>
                      </div>

                      {/* Editable — the draft is a starting point, not something to rubber-stamp. */}
                      <textarea
                        value={editing[draft.id] ?? draft.body}
                        onChange={(e) => setEditing((prev) => ({ ...prev, [draft.id]: e.target.value }))}
                        rows={5}
                        className="w-full text-[13px] leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3 font-medium text-slate-700 outline-none focus:bg-white focus:border-violet-400 focus:ring-4 focus:ring-violet-500/10 transition-all resize-y"
                        dir="auto"
                      />

                      <div className="flex gap-2">
                        <button
                          onClick={() => void resolveDraft(draft, "approve")}
                          disabled={busyDraft === draft.id}
                          className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98]"
                        >
                          {busyDraft === draft.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                          {isAr ? "إرسال" : "Send"}
                        </button>
                        <button
                          onClick={() => void resolveDraft(draft, "reject")}
                          disabled={busyDraft === draft.id}
                          className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-600 border border-slate-200 px-4 py-2.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all active:scale-[0.98]"
                        >
                          <X size={13} />
                          {isAr ? "تجاهل" : "Dismiss"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!report && !scanning && (
            <div className="bg-white rounded-3xl border border-slate-200 border-dashed p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto mb-4">
                <UserX size={26} className="text-slate-400" />
              </div>
              <p className="text-base font-black text-slate-900">
                {isAr ? "لم يتم إجراء فحص بعد" : "No scan run yet"}
              </p>
              <p className="text-sm font-medium text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                {isAr
                  ? "يعتمد الفحص على الزيارات الفعلية: موعد حضره المريض أو ملاحظة سريرية. المواعيد الملغاة أو التي لم يحضرها لا تُحتسب زيارة."
                  : "The scan counts real visits only: an appointment the patient attended, or a clinical note. Cancelled and no-show appointments do not count."}
              </p>
            </div>
          )}

          {scanning && (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 flex flex-col items-center">
              <Loader2 size={26} className="animate-spin text-slate-300" />
              <p className="text-sm font-bold text-slate-500 mt-4">
                {isAr ? "جارٍ فحص سجلات المرضى..." : "Checking patient records..."}
              </p>
            </div>
          )}

          {report && !scanning && (
            <>
              {/* Headline */}
              <div className="bg-slate-900 rounded-3xl p-8 md:p-10 text-white">
                <p className="text-[11px] font-black uppercase tracking-widest text-white/50">
                  {isAr ? "مرضى لم تتم رؤيتهم" : "Patients not seen in"}{" "}
                  {monthsLabel(report.thresholdDays)}
                </p>
                <p className="text-5xl md:text-6xl font-black tracking-tight mt-2">{dormant.length}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-8">
                  <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                      {isAr ? "لم يزوروا مطلقاً" : "Never visited"}
                    </p>
                    <p className="text-xl font-black mt-1">{neverVisited.length}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                      {isAr ? "لديهم موعد قادم" : "Already returning"}
                    </p>
                    <p className="text-xl font-black mt-1">{report.counts.skippedUpcoming}</p>
                  </div>
                  <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                      {isAr ? "الحد المستخدم" : "Threshold used"}
                    </p>
                    <p className="text-xl font-black mt-1">{monthsLabel(report.thresholdDays)}</p>
                    {thresholdSource === "default" && (
                      // Says outright that this number is ours, not the clinic's, so the count
                      // above is never mistaken for a judgement the practice made.
                      <Link
                        href="/settings?tab=recall"
                        className="inline-block text-[10px] font-bold text-amber-300/90 hover:text-amber-200 underline underline-offset-2 mt-1"
                      >
                        {isAr ? "افتراضي — اضبطه" : "Default — set yours"}
                      </Link>
                    )}
                  </div>
                </div>
              </div>

              {/* Caveats, stated rather than buried. */}
              {report.notes.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <ul className="text-[12px] font-medium text-amber-900 space-y-1 leading-relaxed">
                      {report.notes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* List */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">
                    {isAr ? "المرضى" : "Patients"}
                  </h2>
                </div>

                {report.patients.length === 0 ? (
                  <div className="p-12 text-center">
                    <Check size={26} className="text-emerald-500 mx-auto mb-3" />
                    <p className="text-sm font-bold text-slate-600">
                      {isAr ? "لا يوجد مرضى متوقفين. عمل جيد." : "No lapsed patients. Nice work."}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {report.patients.map((p: DormantPatient) => (
                      <div key={p.patientId} className="px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/patients/${p.patientId}`}
                            className="inline-flex items-center gap-1.5 font-bold text-slate-900 hover:text-violet-600 transition-colors"
                          >
                            {p.patientName}
                            <ArrowUpRight size={13} />
                          </Link>
                          <p className="text-[12px] font-medium text-slate-500 mt-0.5">
                            {p.reason === "never_visited"
                              ? isAr
                                ? "مسجّل ولم تتم رؤيته مطلقاً"
                                : "Registered but never seen"
                              : isAr
                                ? `آخر زيارة ${p.lastVisitDate} · منذ ${monthsLabel(p.daysSinceLastVisit || 0)}`
                                : `Last visit ${p.lastVisitDate} · ${monthsLabel(p.daysSinceLastVisit || 0)} ago`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {!p.phone && (
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                              {isAr ? "بدون رقم" : "No phone"}
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border ${
                              p.reason === "never_visited"
                                ? "text-slate-600 bg-slate-50 border-slate-200"
                                : "text-violet-700 bg-violet-50 border-violet-200"
                            }`}
                          >
                            {p.reason === "never_visited"
                              ? isAr ? "لم يزر" : "Never seen"
                              : isAr ? "متوقف" : "Lapsed"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </PermissionGuard>
  );
}
