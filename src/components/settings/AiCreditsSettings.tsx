"use client";

import { useEffect, useMemo, useState } from "react";
import { useSettingsText } from "@/lib/useSettingsText";
import { Sparkles, MessageCircle, Stethoscope, ClipboardList, Languages, Megaphone, HelpCircle, User } from "lucide-react";
import { onSnapshot, query, orderBy, limit, where, Timestamp } from "firebase/firestore";
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
  createdMs: number;
};

const LOG_FETCH_LIMIT = 300;

/** The first instant of a "YYYY-MM" key, and of the month after it. Local time, like the log. */
function monthBounds(key: string): { start: Date; end: Date } | null {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

/**
 * Where the month's AI credits actually went.
 *
 * The headline comes from the monthly `ai_usage` doc (the same counter every AI route charges),
 * the split from its `byFeature` counters, and the table from the append-only `ai_usage_log`.
 * Charges made before the log existed have no rows and no feature counter — they surface honestly
 * as "not itemized" rather than quietly vanishing.
 */
export default function AiCreditsSettings() {
  const { language, isRTL } = useLanguage();
  const { clinic } = useClinic();
  const ar = language === "ar";

  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const [months, setMonths] = useState<UsageMonth[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [logRows, setLogRows] = useState<LogRow[]>([]);

  const txt = {
    ...useSettingsText("aiCredits"),

    logNote: ar
      ? `أحدث ${LOG_FETCH_LIMIT} عملية في الشهر ده. العمليات الأقدم من تفعيل السجل مش هتظهر هنا لكنها محسوبة في الإجمالي.`
      : `The latest ${LOG_FETCH_LIMIT} events in this month. Actions from before logging started are counted in the total but have no rows here.`,
  };

  const FEATURE_META: Record<string, { label: string; icon: typeof Sparkles }> = {
    chat: { label: ar ? "المساعد الذكي (شات)" : "AI Assistant chat", icon: MessageCircle },
    reception: { label: ar ? "مساعد الاستقبال" : "Reception assistant", icon: User },
    treatment_plan: { label: ar ? "اقتراح خطط العلاج" : "Treatment plan suggestions", icon: ClipboardList },
    plan_translation: { label: ar ? "ترجمة خطط العلاج" : "Plan translation", icon: Languages },
    diagnosis_chat: { label: ar ? "مناقشة التشخيص" : "Diagnosis discussion", icon: Stethoscope },
    marketing: { label: ar ? "المحتوى التسويقي" : "Marketing content", icon: Megaphone },
  };
  const featureMeta = (key: string) =>
    FEATURE_META[key] || { label: key || (ar ? "أخرى" : "Other"), icon: HelpCircle };

  // Every month that ever recorded usage — feeds the month picker and the exact totals.
  useEffect(() => {
    const unsub = onSnapshot(getClinicCollection("ai_usage"), (snap) => {
      const rows = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          const byFeature: Record<string, number> = {};
          const raw = data.byFeature;
          if (raw && typeof raw === "object") {
            for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
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

  /**
   * The month's own events, newest first.
   *
   * This used to fetch the newest 300 events across all time and then filter them to the chosen
   * month in the browser, which is only correct while the clinic has fewer than 300 events in
   * total. Past that, picking last month showed a table with nothing in it — or a handful of rows
   * — while the breakdown above it reported hundreds of credits, and nothing on screen explained
   * the contradiction.
   *
   * A range on `createdAt` with `orderBy` on the same field needs no composite index, so the fix
   * costs nothing to deploy; filtering on `monthKey` would have.
   */
  useEffect(() => {
    const bounds = monthBounds(selectedMonth);
    if (!bounds) return;
    const q = query(
      getClinicCollection("ai_usage_log"),
      where("createdAt", ">=", Timestamp.fromDate(bounds.start)),
      where("createdAt", "<", Timestamp.fromDate(bounds.end)),
      orderBy("createdAt", "desc"),
      limit(LOG_FETCH_LIMIT)
    );
    const unsub = onSnapshot(q, (snap) => {
      setLogRows(
        snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
          return {
            id: d.id,
            feature: String(data.feature || ""),
            credits: Number(data.credits) || 0,
            userName: String(data.userName || ""),
            patientName: String(data.patientName || ""),
            detail: String(data.detail || ""),
            createdMs: createdAt?.toMillis?.() || 0,
          };
        })
      );
    });
    return () => unsub();
  }, [selectedMonth]);

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
  const remaining = Math.max(0, creditLimit - selected.creditsUsed);
  const runningLow = creditLimit > 0 && pct >= 90;

  const breakdown = useMemo(() => {
    const entries = Object.entries(selected.byFeature).sort((a, b) => b[1] - a[1]);
    if (unitemized > 0) entries.push(["__unitemized", unitemized]);
    return entries;
  }, [selected, unitemized]);

  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    if (!y || !m) return key;
    return new Date(y, m - 1, 1).toLocaleDateString(ar ? "ar-EG" : "en-GB", { month: "long", year: "numeric" });
  };

  const n = (v: number) => v.toLocaleString("en-US");

  const headline = creditLimit > 0
    ? ar
      ? `استخدمت ${n(selected.creditsUsed)} من ${n(creditLimit)} رصيد في ${monthLabel(selectedMonth)}.`
      : `${n(selected.creditsUsed)} of ${n(creditLimit)} credits used in ${monthLabel(selectedMonth)}.`
    : ar
      ? `استخدمت ${n(selected.creditsUsed)} رصيد في ${monthLabel(selectedMonth)}. الباقة دي مالهاش حد شهري.`
      : `${n(selected.creditsUsed)} credits used in ${monthLabel(selectedMonth)}. This plan has no monthly limit.`;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* The three headline cards this replaces stated used, limit and remaining as three separate
          numbers and left the reader to do the subtraction that matters. One sentence, one bar. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <Sparkles size={12} />
              {txt.title}
            </p>
            <p className="text-lg font-bold leading-snug text-white sm:text-xl">{headline}</p>

            {creditLimit > 0 && (
              <div className="max-w-md space-y-1.5 pt-1">
                <div className="h-2 overflow-hidden rounded-full bg-white/15">
                  <div
                    className={`h-full rounded-full transition-all ${runningLow ? "bg-amber-400" : "bg-emerald-400"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="font-figure text-[13px] tracking-tight text-white/70">
                  {n(remaining)} {txt.leftThisMonth} · {txt.resetNote}
                </p>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label={txt.title}
              className="cursor-pointer rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-bold text-white outline-none transition-colors hover:bg-white/15"
            >
              {monthOptions.map((k) => (
                <option key={k} value={k} className="text-ink">
                  {monthLabel(k)}
                </option>
              ))}
            </select>

            {creditLimit > 0 && (
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${
                  runningLow ? "bg-amber-400/20 text-amber-200" : "bg-white/12 text-white"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${runningLow ? "bg-amber-400" : "bg-emerald-400"}`} />
                {runningLow ? txt.runningLow : `${pct}% ${txt.usedShort}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Where it went. Six arbitrary hues used to distinguish six features; the bars are already
          sorted by size, so one colour fading with rank says the same thing without inventing a
          palette that no theme can restyle. */}
      <section>
        <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">
          {txt.breakdown}
        </h3>
        {breakdown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-surface-subtle px-5 py-10 text-center text-sm font-semibold text-ink-muted">
            {txt.empty}
          </p>
        ) : (
          <div className="space-y-3.5 rounded-2xl border border-line bg-surface p-5">
            {breakdown.map(([key, value], index) => {
              const meta = key === "__unitemized"
                ? { label: txt.unitemized, icon: HelpCircle }
                : featureMeta(key);
              const Icon = meta.icon;
              const share = selected.creditsUsed > 0 ? Math.round((value / selected.creditsUsed) * 100) : 0;
              // Biggest slice at full strength, fading with rank. The unattributed remainder is
              // not a feature, so it stays a neutral grey rather than joining the ramp.
              const rank = breakdown.length > 1 ? index / (breakdown.length - 1) : 0;
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink-body">
                      <Icon size={15} className="shrink-0 text-ink-muted" />
                      <span className="truncate">{meta.label}</span>
                    </span>
                    <span className="whitespace-nowrap font-figure text-sm font-bold text-ink">
                      {n(value)} <span className="text-[10px] font-bold text-ink-muted">({share}%)</span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className={`h-full rounded-full ${key === "__unitemized" ? "bg-line-strong" : "bg-accent"}`}
                      style={{
                        width: `${share}%`,
                        opacity: key === "__unitemized" ? 1 : 1 - rank * 0.6,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Every charge */}
      <section>
        <h3 className="mb-1 text-[11px] font-black uppercase tracking-[0.18em] text-ink-muted">{txt.log}</h3>
        <p className="mb-3 text-xs font-medium text-ink-muted">{txt.logNote}</p>
        {logRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line bg-surface-subtle px-5 py-10 text-center text-sm font-semibold text-ink-muted">
            {txt.empty}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="bg-surface-subtle text-[10px] font-bold uppercase tracking-widest text-ink-muted">
                  <th className="px-3 py-2.5 text-start">{txt.when}</th>
                  <th className="px-3 py-2.5 text-start">{txt.feature}</th>
                  <th className="px-3 py-2.5 text-start">{txt.patient}</th>
                  <th className="px-3 py-2.5 text-start">{txt.byWho}</th>
                  <th className="px-3 py-2.5 text-end">{txt.cost}</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((r) => {
                  const meta = featureMeta(r.feature);
                  const Icon = meta.icon;
                  return (
                    <tr key={r.id} className="border-t border-line bg-surface">
                      <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-ink-muted">
                        {r.createdMs
                          ? new Date(r.createdMs).toLocaleString(ar ? "ar-EG" : "en-GB", {
                              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5 font-bold text-ink-body">
                          <Icon size={14} className="shrink-0 text-ink-muted" /> {meta.label}
                        </span>
                        {r.detail && (
                          <span className="block ps-5 text-[11px] font-semibold text-ink-muted">{r.detail}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-ink-body">{r.patientName || "—"}</td>
                      <td className="px-3 py-2.5 font-semibold text-ink-body">{r.userName || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-end font-figure font-bold text-ink">
                        {r.credits} {r.credits === 1 ? txt.credit : txt.credits}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
