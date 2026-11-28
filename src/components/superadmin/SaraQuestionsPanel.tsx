"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import { Loader2, RefreshCcw } from "lucide-react";
import { useSuperAdminText } from "./i18n";

/**
 * What people ask the assistant, and how each question was answered.
 *
 * The list exists to be acted on: a question that keeps ending in "Slow" (she read raw records)
 * or "No answer" is the next ready-made answer to build. The cost column is the platform's own
 * estimate of the supplier fee and is never shown to a clinic.
 */

type Row = {
  id: string;
  at: number;
  day: string;
  clinicId: string;
  userName: string;
  role: string;
  client: string;
  question: string;
  outcome: string;
  tools: string[];
  ceilingHit: boolean;
  deepOffered: boolean;
  credits: number;
  apiCalls: number;
  inputTokens: number;
  usd: number;
};

type Report = { period: { from: string; days: number }; clinics: Record<string, string>; byOutcome: Record<string, { count: number; usd: number }>; rows: Row[] };

const OUTCOMES: { id: string; en: string; ar: string }[] = [
  { id: "ready", en: "Ready answer", ar: "إجابة جاهزة" },
  { id: "read", en: "Slow (read records)", ar: "بطيء (قراءة سجلات)" },
  { id: "deep", en: "Deeper search", ar: "بحث أعمق" },
  { id: "none", en: "No answer", ar: "بدون إجابة" },
  { id: "action", en: "Action", ar: "إجراء" },
  { id: "talk", en: "Conversation", ar: "كلام" },
];

const cell = "px-3 py-2.5 text-sm align-top";
const head = "px-3 py-2 text-[11px] font-black uppercase tracking-wider text-slate-400 text-start";

export function SaraQuestionsPanel() {
  const { isAr: ar } = useSuperAdminText();
  const L = (en: string, arText: string) => (ar ? arText : en);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [outcome, setOutcome] = useState("all");
  const [clinic, setClinic] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/admin/sara-questions?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error("load");
      setReport(data as Report);
    } catch {
      setError(ar ? "تعذّر تحميل الأسئلة." : "Could not load the questions.");
    } finally {
      setLoading(false);
    }
  }, [days, ar]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (report?.rows ?? []).filter((r) => (outcome === "all" || r.outcome === outcome) && (clinic === "all" || r.clinicId === clinic)),
    [report, outcome, clinic]
  );
  const label = (id: string) => {
    const o = OUTCOMES.find((x) => x.id === id);
    return o ? (ar ? o.ar : o.en) : id;
  };
  const select = "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-white";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">{L("Questions to the assistant", "الأسئلة اللي اتسألت للمساعد")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            {L(
              "Questions answered the slow way, or not at all, are the next ready-made answers to build. Cost is our estimated supplier fee.",
              "الأسئلة اللي اتجاوبت بالطريقة البطيئة أو ماتجاوبتش هي الإجابات الجاهزة اللي المفروض تتبني بعد كده. التكلفة تقدير لرسوم المورّد."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select id="sara-q-days" aria-label={L("Period", "الفترة")} className={select} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>{L("Last 7 days", "آخر ٧ أيام")}</option>
            <option value={30}>{L("Last 30 days", "آخر ٣٠ يوم")}</option>
            <option value={90}>{L("Last 90 days", "آخر ٩٠ يوم")}</option>
          </select>
          <select id="sara-q-clinic" aria-label={L("Clinic", "العيادة")} className={select} value={clinic} onChange={(e) => setClinic(e.target.value)}>
            <option value="all">{L("All clinics", "كل العيادات")}</option>
            {Object.entries(report?.clinics ?? {}).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <button type="button" onClick={() => void load()} aria-label={L("Refresh", "تحديث")} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:text-white">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setOutcome("all")} className={`rounded-full px-3 py-1.5 text-xs font-bold ${outcome === "all" ? "bg-[#FACC15] text-slate-950" : "bg-slate-800 text-slate-300"}`}>
          {L("All", "الكل")} · {report?.rows.length ?? 0}
        </button>
        {OUTCOMES.filter((o) => report?.byOutcome[o.id]).map((o) => (
          <button key={o.id} type="button" onClick={() => setOutcome(o.id)} className={`rounded-full px-3 py-1.5 text-xs font-bold ${outcome === o.id ? "bg-[#FACC15] text-slate-950" : "bg-slate-800 text-slate-300"}`}>
            {ar ? o.ar : o.en} · {report!.byOutcome[o.id].count} · ${report!.byOutcome[o.id].usd.toFixed(2)}
          </button>
        ))}
      </div>

      {error && <p className="text-sm font-semibold text-rose-400">{error}</p>}
      {!error && !loading && rows.length === 0 && (
        <p className="rounded-xl bg-slate-950/60 p-6 text-sm text-slate-400">
          {L("No questions recorded yet for this view. They appear here as people ask.", "مفيش أسئلة متسجلة للعرض ده لسه. هتظهر هنا أول ما الناس تسأل.")}
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl bg-slate-950/60">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-800">
                <th className={head}>{L("When", "إمتى")}</th>
                <th className={head}>{L("Who", "مين")}</th>
                <th className={head}>{L("Question", "السؤال")}</th>
                <th className={head}>{L("Answered by", "اتجاوب إزاي")}</th>
                <th className={`${head} text-end`}>{L("Cost", "التكلفة")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map((r) => (
                <tr key={r.id} className="border-b border-slate-900 last:border-0">
                  <td className={`${cell} whitespace-nowrap text-slate-400`}>{r.at ? new Date(r.at).toLocaleString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : r.day}</td>
                  <td className={cell}>
                    <div className="font-bold text-white">{r.userName || "—"}</div>
                    <div className="text-xs text-slate-400">{[r.role, report?.clinics[r.clinicId] || r.clinicId].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className={`${cell} max-w-md text-slate-200`} dir="auto">{r.question}</td>
                  <td className={cell}>
                    <div className={`font-bold ${r.outcome === "none" ? "text-rose-400" : r.outcome === "read" || r.outcome === "deep" ? "text-amber-300" : "text-white"}`}>{label(r.outcome)}</div>
                    <div className="text-xs text-slate-400">{[...new Set(r.tools)].join(", ") || "—"}</div>
                  </td>
                  <td className={`${cell} whitespace-nowrap text-end tabular-nums text-slate-200`}>
                    ${r.usd.toFixed(3)}
                    <div className="text-xs text-slate-400">{r.apiCalls} {L("calls", "طلب")} · {r.credits} {L("cr", "رصيد")}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
