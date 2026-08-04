"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  BadgeDollarSign,
  Copy,
  FileWarning,
  Loader2,
  Lock,
  Search,
  Sparkles,
  Tag,
  Wallet,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import PermissionGuard from "@/components/PermissionGuard";
import { hasFeature } from "@/lib/subscriptions";
import type { FindingKind, RecoveryFinding, RecoveryReport } from "@/lib/revenueRecovery";

const KIND_META: Record<
  FindingKind,
  { icon: typeof Wallet; en: string; ar: string; tone: string; explainEn: string; explainAr: string }
> = {
  unbilled_work: {
    icon: FileWarning,
    en: "Never invoiced",
    ar: "لم تتم فوترته",
    tone: "text-rose-600 bg-rose-50 border-rose-200",
    explainEn: "Treatment was recorded in the clinical notes but never reached the ledger.",
    explainAr: "تم تسجيل العلاج في الملاحظات السريرية لكنه لم يصل إلى الحسابات.",
  },
  outstanding_balance: {
    icon: Wallet,
    en: "Unpaid balance",
    ar: "رصيد غير مدفوع",
    tone: "text-amber-700 bg-amber-50 border-amber-200",
    explainEn: "Patient owes money and has gone quiet for over 45 days.",
    explainAr: "المريض مدين ولم يتواصل منذ أكثر من 45 يومًا.",
  },
  duplicate_entry: {
    icon: Copy,
    en: "Duplicate entry",
    ar: "قيد مكرر",
    tone: "text-violet-700 bg-violet-50 border-violet-200",
    explainEn: "The same row was entered twice. A duplicated payment hides a real debt.",
    explainAr: "تم إدخال نفس القيد مرتين. الدفعة المكررة تخفي دينًا حقيقيًا.",
  },
  underpriced_procedure: {
    icon: Tag,
    en: "Below price list",
    ar: "أقل من قائمة الأسعار",
    tone: "text-slate-600 bg-slate-50 border-slate-200",
    explainEn: "Charged less than the service price. Often a deliberate discount — worth confirming.",
    explainAr: "تم تحصيل مبلغ أقل من سعر الخدمة. غالبًا خصم مقصود — يستحق المراجعة.",
  },
};

export default function RevenueRecoveryPage() {
  const { language, isRTL } = useLanguage();
  const { clinic, clinicId } = useClinic();
  const { showToast } = useUI();
  const isAr = language === "ar";

  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [activeKind, setActiveKind] = useState<FindingKind | "all">("all");

  const unlocked = hasFeature(clinic, "aiProactive");

  const money = useCallback(
    (n: number) => n.toLocaleString(isAr ? "ar-EG" : "en-US", { maximumFractionDigits: 0 }),
    [isAr]
  );

  const runScan = async () => {
    if (!clinicId) return;
    setScanning(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error(isAr ? "انتهت الجلسة" : "Session expired");

      const res = await fetch("/api/ai/revenue-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ clinicId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Scan failed");

      setReport(data.report as RecoveryReport);
      setActiveKind("all");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Scan failed", "error");
    } finally {
      setScanning(false);
    }
  };

  const visibleFindings = useMemo(() => {
    if (!report) return [];
    if (activeKind === "all") return report.findings;
    return report.findings.filter((f) => f.kind === activeKind);
  }, [report, activeKind]);

  const patientHref = (f: RecoveryFinding) =>
    f.patientId ? `/patients/${f.patientId}?tab=finance` : "/patients";

  if (!unlocked) {
    return (
      <PermissionGuard permission="access.finance">
        <div className="min-h-screen bg-slate-50/50 flex items-center justify-center p-6" dir={isRTL ? "rtl" : "ltr"}>
          <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto mb-5">
              <Lock size={26} />
            </div>
            <h1 className="text-xl font-black text-slate-900">
              {isAr ? "استعادة الإيرادات" : "Revenue Recovery"}
            </h1>
            <p className="text-sm font-medium text-slate-500 mt-3 leading-relaxed">
              {isAr
                ? "يفحص سجلاتك بحثًا عن علاجات لم تُفوتر، وأرصدة متأخرة، وقيود مكررة. متاح في باقة Premium."
                : "Scans your records for treatment that was never invoiced, stale balances, and duplicated entries. Available on the Premium plan."}
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
    <PermissionGuard permission="access.finance">
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
                {isAr ? "استعادة الإيرادات" : "Revenue Recovery"}
              </h1>
              <p className="text-sm font-medium text-slate-500 mt-1 max-w-2xl">
                {isAr
                  ? "يفحص كل سجل مالي وسريري بحثًا عن أموال استحققتها ولم تُحصّلها."
                  : "Scans every financial and clinical record for money you earned but never collected."}
              </p>
            </div>

            <button
              onClick={() => void runScan()}
              disabled={scanning}
              className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-3 rounded-xl font-black text-xs uppercase tracking-widest shadow-md shadow-slate-200 active:scale-[0.98] disabled:opacity-50 transition-all"
            >
              {scanning ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              {scanning ? (isAr ? "جارٍ الفحص..." : "Scanning...") : isAr ? "ابدأ الفحص" : "Run scan"}
            </button>
          </div>

          {/* Empty state — the scan is on-demand, so say what will happen before it runs. */}
          {!report && !scanning && (
            <div className="bg-white rounded-3xl border border-slate-200 border-dashed p-12 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto mb-4">
                <BadgeDollarSign size={26} className="text-slate-400" />
              </div>
              <p className="text-base font-black text-slate-900">
                {isAr ? "لم يتم إجراء فحص بعد" : "No scan run yet"}
              </p>
              <p className="text-sm font-medium text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                {isAr
                  ? "سيقارن الفحص ملاحظاتك السريرية بدفتر الحسابات وقائمة أسعارك. كل نتيجة مرتبطة بالسجل الأصلي حتى تتمكن من التحقق بنفسك."
                  : "The scan cross-checks your clinical notes against the ledger and your price list. Every finding links back to the source record so you can verify it yourself."}
              </p>
            </div>
          )}

          {scanning && (
            <div className="bg-white rounded-3xl border border-slate-200 p-12 flex flex-col items-center">
              <Loader2 size={28} className="animate-spin text-violet-500" />
              <p className="text-sm font-bold text-slate-500 mt-4">
                {isAr ? "يقرأ دفتر الحسابات والملاحظات السريرية..." : "Reading the ledger and clinical notes..."}
              </p>
            </div>
          )}

          {report && (
            <>
              {/* Headline figure */}
              <div className="bg-slate-900 rounded-3xl p-8 md:p-10 text-white relative overflow-hidden">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
                  {isAr ? "قابل للاسترداد" : "Recoverable"}
                </p>
                <p className="text-5xl md:text-6xl font-black tracking-tight mt-2">
                  {money(report.totals.recoverable)}
                </p>
                <p className="text-sm font-medium text-slate-400 mt-3 max-w-lg leading-relaxed">
                  {isAr
                    ? `عبر ${report.findings.length} نتيجة. لا تشمل البنود الأقل من قائمة الأسعار — فمعظمها خصومات مقصودة.`
                    : `Across ${report.findings.length} findings. Excludes below-price-list items, since most are deliberate discounts.`}
                </p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
                  {(
                    [
                      ["unbilled_work", report.totals.unbilledWork, report.counts.unbilled_work],
                      ["outstanding_balance", report.totals.outstandingBalance, report.counts.outstanding_balance],
                      ["duplicate_entry", report.totals.duplicates, report.counts.duplicate_entry],
                      ["underpriced_procedure", report.totals.underpriced, report.counts.underpriced_procedure],
                    ] as [FindingKind, number, number][]
                  ).map(([kind, total, count]) => {
                    const meta = KIND_META[kind];
                    const Icon = meta.icon;
                    return (
                      <button
                        key={kind}
                        onClick={() => setActiveKind(activeKind === kind ? "all" : kind)}
                        className={`text-start rounded-2xl p-4 border transition-colors ${
                          activeKind === kind
                            ? "bg-white/15 border-white/40"
                            : "bg-white/5 border-white/10 hover:bg-white/10"
                        }`}
                      >
                        <Icon size={15} className="text-slate-300" />
                        <p className="text-lg font-black mt-2">{money(total)}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">
                          {isAr ? meta.ar : meta.en} · {count}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Caveats — a financial claim without its limits stated is not trustworthy. */}
              {report.notes.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-start gap-3">
                  <AlertCircle size={16} className="text-slate-400 shrink-0 mt-0.5" />
                  <ul className="text-xs font-medium text-slate-500 space-y-1 leading-relaxed">
                    {report.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Findings */}
              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
                  <h2 className="text-xs font-black uppercase tracking-widest text-slate-800">
                    {activeKind === "all"
                      ? isAr
                        ? "كل النتائج"
                        : "All findings"
                      : isAr
                        ? KIND_META[activeKind].ar
                        : KIND_META[activeKind].en}
                    <span className="text-slate-400 ms-2">{visibleFindings.length}</span>
                  </h2>
                  {activeKind !== "all" && (
                    <button
                      onClick={() => setActiveKind("all")}
                      className="text-[11px] font-bold text-violet-600 hover:text-violet-800"
                    >
                      {isAr ? "عرض الكل" : "Show all"}
                    </button>
                  )}
                </div>

                {visibleFindings.length === 0 ? (
                  <div className="p-12 text-center">
                    <p className="text-base font-black text-slate-900">
                      {isAr ? "لا شيء هنا — وهذا خبر جيد" : "Nothing here — that's good news"}
                    </p>
                    <p className="text-sm font-medium text-slate-500 mt-1">
                      {isAr ? "لم يعثر الفحص على أي مشكلة في هذه الفئة." : "The scan found no issues in this category."}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {visibleFindings.map((f, i) => {
                      const meta = KIND_META[f.kind];
                      const Icon = meta.icon;
                      return (
                        <div key={`${f.kind}-${i}`} className="p-4 md:p-5 hover:bg-slate-50/70 transition-colors">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <span className={`shrink-0 w-9 h-9 rounded-xl border flex items-center justify-center ${meta.tone}`}>
                                <Icon size={16} />
                              </span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Link
                                    href={patientHref(f)}
                                    className="text-sm font-black text-slate-900 hover:text-violet-700 transition-colors inline-flex items-center gap-1"
                                  >
                                    {f.patientName}
                                    <ArrowUpRight size={13} className="text-slate-400" />
                                  </Link>
                                  <span
                                    className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.tone}`}
                                  >
                                    {isAr ? meta.ar : meta.en}
                                  </span>
                                  {f.ageDays !== undefined && (
                                    <span className="text-[10px] font-bold text-slate-400">
                                      {isAr ? `منذ ${f.ageDays} يومًا` : `${f.ageDays}d ago`}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs font-medium text-slate-600 mt-1 leading-relaxed">{f.detail}</p>
                                <p className="text-[10px] font-mono text-slate-400 mt-1.5 break-all">
                                  {f.evidence.map((e) => `${e.collection}/${e.docId}`).join("  ·  ")}
                                </p>
                              </div>
                            </div>

                            <p className="text-lg font-black text-slate-900 shrink-0 tabular-nums">{money(f.amount)}</p>
                          </div>
                        </div>
                      );
                    })}
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
