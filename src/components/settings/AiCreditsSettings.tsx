"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, MessageCircle, Stethoscope, ClipboardList, Languages, Megaphone, HelpCircle, User } from "lucide-react";
import { onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useClinic } from "@/context/ClinicContext";
import { getAiCreditLimit } from "@/lib/subscriptions";

type UsageMonth = {
  id: string; // "2026-08"
  creditsUsed: number;
  byFeature: Record<string, number>;
};

type LogRow = {
  id: string;
  feature: string;
  credits: number;
  userName: string;
  patientName: string;
  detail: string;
  monthKey: string;
  createdMs: number;
};

const LOG_FETCH_LIMIT = 300;

/**
 * Where the month's AI credits actually went.
 *
 * The headline numbers come from the monthly `ai_usage` doc (the same counter every AI route
 * charges), the per-feature split from its `byFeature` counters, and the table from the
 * append-only `ai_usage_log`. Charges made before the log existed have no rows and no feature
 * counter — they surface honestly as "not itemized" instead of quietly vanishing.
 */
export default function AiCreditsSettings() {
  const { language } = useLanguage();
  const { clinic } = useClinic();
  const ar = language === "ar";

  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const [months, setMonths] = useState<UsageMonth[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [logRows, setLogRows] = useState<LogRow[]>([]);

  const txt = {
    title: ar ? "رصيد الذكاء الاصطناعي" : "AI Credits",
    subtitle: ar
      ? "كل استخدام للذكاء الاصطناعي بيتسجل هنا — مين استخدم إيه، ولمين، وكلّف كام."
      : "Every AI action is logged here — who used what, for which patient, and what it cost.",
    used: ar ? "المستخدم" : "Used",
    limit: ar ? "الحد الشهري" : "Monthly limit",
    remaining: ar ? "المتبقي" : "Remaining",
    unlimited: ar ? "غير محدود" : "Unlimited",
    credits: ar ? "رصيد" : "credits",
    credit: ar ? "رصيد" : "credit",
    breakdown: ar ? "التوزيع حسب الخدمة" : "Breakdown by feature",
    unitemized: ar ? "غير مفصّل (قبل تفعيل السجل)" : "Not itemized (before logging started)",
    log: ar ? "سجل الاستخدام" : "Usage log",
    logNote: ar
      ? `أحدث ${LOG_FETCH_LIMIT} عملية. العمليات الأقدم من تفعيل السجل مش هتظهر هنا لكنها محسوبة في الإجمالي.`
      : `Latest ${LOG_FETCH_LIMIT} events. Actions from before logging started are counted in the totals but have no rows here.`,
    empty: ar ? "لا يوجد استخدام مسجل في هذا الشهر بعد" : "No logged usage for this month yet",
    when: ar ? "الوقت" : "When",
    feature: ar ? "الخدمة" : "Feature",
    patient: ar ? "المريض" : "Patient",
    byWho: ar ? "بواسطة" : "By",
    cost: ar ? "التكلفة" : "Cost",
    resetNote: ar ? "الرصيد بيتجدد أول كل شهر." : "Credits reset on the 1st of every month.",
  };

  const FEATURE_META: Record<string, { label: string; icon: typeof Sparkles; color: string }> = {
    chat: { label: ar ? "المساعد الذكي (شات)" : "AI Assistant chat", icon: MessageCircle, color: "bg-blue-500" },
    reception: { label: ar ? "مساعد الاستقبال" : "Reception assistant", icon: User, color: "bg-cyan-500" },
    treatment_plan: { label: ar ? "اقتراح خطط العلاج" : "Treatment plan suggestions", icon: ClipboardList, color: "bg-violet-500" },
    plan_translation: { label: ar ? "ترجمة خطط العلاج" : "Plan translation", icon: Languages, color: "bg-emerald-500" },
    diagnosis_chat: { label: ar ? "مناقشة التشخيص" : "Diagnosis discussion", icon: Stethoscope, color: "bg-sky-500" },
    marketing: { label: ar ? "المحتوى التسويقي" : "Marketing content", icon: Megaphone, color: "bg-amber-500" },
  };
  const featureMeta = (key: string) =>
    FEATURE_META[key] || { label: key || (ar ? "أخرى" : "Other"), icon: HelpCircle, color: "bg-slate-400" };

  // Every month that ever recorded usage — feeds the month picker and the exact totals.
  useEffect(() => {
    const unsub = onSnapshot(getClinicCollection("ai_usage"), (snap) => {
      const rows = snap.docs
        .map((d) => {
          const data = d.data() as any;
          const byFeature: Record<string, number> = {};
          if (data.byFeature && typeof data.byFeature === "object") {
            for (const [k, v] of Object.entries(data.byFeature)) {
              const n = Number(v) || 0;
              if (n > 0) byFeature[k] = n;
            }
          }
          return { id: d.id, creditsUsed: Number(data.creditsUsed) || 0, byFeature };
        })
        .filter((m) => /^\d{4}-\d{2}$/.test(m.id) && (m.creditsUsed > 0 || Object.keys(m.byFeature).length > 0));
      rows.sort((a, b) => b.id.localeCompare(a.id));
      setMonths(rows);
    });
    return () => unsub();
  }, []);

  // The event log, newest first. One single-field orderBy — no composite index needed;
  // the month filter happens client-side.
  useEffect(() => {
    const q = query(getClinicCollection("ai_usage_log"), orderBy("createdAt", "desc"), limit(LOG_FETCH_LIMIT));
    const unsub = onSnapshot(q, (snap) => {
      setLogRows(
        snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            feature: String(data.feature || ""),
            credits: Number(data.credits) || 0,
            userName: String(data.userName || ""),
            patientName: String(data.patientName || ""),
            detail: String(data.detail || ""),
            monthKey: String(data.monthKey || ""),
            createdMs: data.createdAt?.toMillis?.() || 0,
          };
        })
      );
    });
    return () => unsub();
  }, []);

  const monthOptions = useMemo(() => {
    const keys = new Set(months.map((m) => m.id));
    keys.add(currentMonthKey);
    return Array.from(keys).sort((a, b) => b.localeCompare(a));
  }, [months, currentMonthKey]);

  const selected: UsageMonth = useMemo(
    () => months.find((m) => m.id === selectedMonth) || { id: selectedMonth, creditsUsed: 0, byFeature: {} },
    [months, selectedMonth]
  );

  const creditLimit = getAiCreditLimit(clinic);
  const itemized = Object.values(selected.byFeature).reduce((a, b) => a + b, 0);
  const unitemized = Math.max(0, selected.creditsUsed - itemized);
  const pct = creditLimit > 0 ? Math.min(100, Math.round((selected.creditsUsed / creditLimit) * 100)) : 0;

  const breakdown = useMemo(() => {
    const entries = Object.entries(selected.byFeature).sort((a, b) => b[1] - a[1]);
    if (unitemized > 0) entries.push(["__unitemized", unitemized]);
    return entries;
  }, [selected, unitemized]);

  const monthRows = useMemo(
    () => logRows.filter((r) => r.monthKey === selectedMonth),
    [logRows, selectedMonth]
  );

  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    if (!y || !m) return key;
    return new Date(y, m - 1, 1).toLocaleDateString(ar ? "ar-EG" : "en-GB", { month: "long", year: "numeric" });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <Sparkles size={20} className="text-violet-500" /> {txt.title}
          </h3>
          <p className="text-sm font-medium text-slate-500 mt-1">{txt.subtitle}</p>
        </div>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-violet-400 cursor-pointer shrink-0"
        >
          {monthOptions.map((k) => (
            <option key={k} value={k}>{monthLabel(k)}</option>
          ))}
        </select>
      </div>

      {/* Headline cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 text-white rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{txt.used}</p>
          <p className="text-3xl font-black">{selected.creditsUsed.toLocaleString("en-US")}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{txt.limit}</p>
          <p className="text-3xl font-black text-slate-800">
            {creditLimit > 0 ? creditLimit.toLocaleString("en-US") : txt.unlimited}
          </p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{txt.remaining}</p>
          <p className={`text-3xl font-black ${creditLimit > 0 && creditLimit - selected.creditsUsed <= creditLimit * 0.1 ? "text-rose-500" : "text-emerald-600"}`}>
            {creditLimit > 0 ? Math.max(0, creditLimit - selected.creditsUsed).toLocaleString("en-US") : "∞"}
          </p>
        </div>
      </div>

      {creditLimit > 0 && (
        <div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-400" : "bg-violet-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs font-semibold text-slate-400 mt-1.5">{pct}% · {txt.resetNote}</p>
        </div>
      )}

      {/* Per-feature breakdown */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5">
        <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-4">{txt.breakdown}</h4>
        {breakdown.length === 0 ? (
          <p className="text-sm font-semibold text-slate-400">{txt.empty}</p>
        ) : (
          <div className="space-y-3">
            {breakdown.map(([key, value]) => {
              const meta = key === "__unitemized"
                ? { label: txt.unitemized, icon: HelpCircle, color: "bg-slate-300" }
                : featureMeta(key);
              const Icon = meta.icon;
              const share = selected.creditsUsed > 0 ? Math.round((value / selected.creditsUsed) * 100) : 0;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <span className="flex items-center gap-2 text-sm font-bold text-slate-700 min-w-0">
                      <Icon size={15} className="text-slate-400 shrink-0" />
                      <span className="truncate">{meta.label}</span>
                    </span>
                    <span className="text-sm font-black text-slate-800 whitespace-nowrap">
                      {value.toLocaleString("en-US")} <span className="text-[10px] font-bold text-slate-400">({share}%)</span>
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${meta.color}`} style={{ width: `${share}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Event log */}
      <div className="bg-white border border-slate-100 rounded-2xl p-5">
        <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">{txt.log}</h4>
        <p className="text-xs font-medium text-slate-400 mb-4">{txt.logNote}</p>
        {monthRows.length === 0 ? (
          <p className="text-sm font-semibold text-slate-400 py-4 text-center">{txt.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  <th className="px-3 py-2.5 text-start">{txt.when}</th>
                  <th className="px-3 py-2.5 text-start">{txt.feature}</th>
                  <th className="px-3 py-2.5 text-start">{txt.patient}</th>
                  <th className="px-3 py-2.5 text-start">{txt.byWho}</th>
                  <th className="px-3 py-2.5 text-end">{txt.cost}</th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map((r) => {
                  const meta = featureMeta(r.feature);
                  const Icon = meta.icon;
                  return (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2.5 font-semibold text-slate-500 whitespace-nowrap">
                        {r.createdMs
                          ? new Date(r.createdMs).toLocaleString(ar ? "ar-EG" : "en-GB", {
                              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5 font-bold text-slate-700">
                          <Icon size={14} className="text-slate-400 shrink-0" /> {meta.label}
                        </span>
                        {r.detail && <span className="block text-[11px] font-semibold text-slate-400 ps-5">{r.detail}</span>}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-slate-600">{r.patientName || "—"}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-600">{r.userName || "—"}</td>
                      <td className="px-3 py-2.5 text-end font-black text-slate-800 whitespace-nowrap">
                        {r.credits} {r.credits === 1 ? txt.credit : txt.credits}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
