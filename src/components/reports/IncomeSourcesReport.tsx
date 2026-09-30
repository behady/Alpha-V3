"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK, BAD } from "@/components/reports/chartKit";
import { DeltaFigure, MonthBars, Note, fmt, fmtPct } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { rangeText } from "@/lib/reportHelpers";
import { incomeSources, INCOME_LABELS_AR, INCOME_LABELS_EN, type SourceGroup } from "@/lib/reports/financeStats";
import { totalsByMonth } from "@/lib/reports/ledgerStats";
import { monthLabel, previousRange, trailingMonths } from "@/lib/reports/periods";

const EMPTY: never[] = [];

/**
 * Where the money came from.
 *
 * The Service, Dentist, Payers, Methods and Sources tabs each answer one slice of this question
 * on their own screen. This one puts the six slices side by side for the same period, each with
 * its share of the total and how it moved against the period before — so "income is up 8%" comes
 * with "because Instagram patients doubled and the insurer paid on time".
 *
 * A slice that earned last period and nothing this period is kept on the list at zero, in red:
 * a source that quietly disappeared is exactly what an owner opens this for.
 */
export default function IncomeSourcesReport({ ledger, allPatients, range, isAr, data }: ReportProps) {
  const labels = isAr ? INCOME_LABELS_AR : INCOME_LABELS_EN;
  const prevRange = useMemo(() => previousRange(range), [range]);
  const src = useMemo(() => incomeSources(ledger, data.ledgerPrev || EMPTY, allPatients, range, prevRange, labels), [ledger, data.ledgerPrev, allPatients, range, prevRange, labels]);
  const { months } = useMemo(() => trailingMonths(range.end, 12), [range.end]);
  const trend = useMemo(() => totalsByMonth(data.ledgerMonths12 || EMPTY, months), [data.ledgerMonths12, months]);
  const withYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  const egp = isAr ? "ج.م" : "EGP";
  const against = rangeText(prevRange, isAr);
  const top = (g: SourceGroup[]) => (g[0] && g[0].total > 0 ? `${g[0].name} · ${g[0].share}%` : "—");
  const newShare = src.newness.find((g) => g.name === labels.newPatient)?.share ?? 0;

  const moved = (g: SourceGroup) => (g.delta.pct === null ? (isAr ? "جديد" : "new") : `${g.delta.abs > 0 ? "▲" : g.delta.abs < 0 ? "▼" : "•"} ${Math.abs(g.delta.pct)}%`);
  const slice = (title: string, rows: SourceGroup[], note?: string) => (
    <ChartFrame title={title} note={note}>
      {rows.length === 0 ? (
        <p className="text-sm font-semibold text-ink-faint">—</p>
      ) : (
        <Bars
          max={Math.max(...rows.map((r) => r.total), 1)}
          rows={rows.map((r, i) => ({
            label: r.count ? `${r.name} · ${r.count}` : r.name,
            value: r.total,
            text: `${fmt(r.total)} ${egp} · ${r.share}% · ${moved(r)}`,
            color: r.total === 0 && r.prev > 0 ? BAD : i === 0 ? MARK : INK,
            warn: r.total === 0 && r.prev > 0,
          }))}
        />
      )}
    </ChartFrame>
  );

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <DeltaFigure label={isAr ? "الدخل" : "Income"} value={src.total} delta={src.total || src.prevTotal ? { from: src.prevTotal, to: src.total, abs: src.total - src.prevTotal, pct: src.prevTotal > 0 ? Number((((src.total - src.prevTotal) / src.prevTotal) * 100).toFixed(1)) : null } : null} isAr={isAr} format={(n) => `${fmt(n)} ${egp}`} against={against} />
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={fmtPct(newShare, 0)} label={isAr ? "من مرضى جدد" : "From new patients"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={top(src.services)} label={isAr ? "أكبر علاج" : "Top treatment"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={top(src.dentists)} label={isAr ? "أكبر دكتور" : "Top dentist"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={top(src.channels)} label={isAr ? "أكبر قناة" : "Top channel"} tone="muted" /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {slice(isAr ? "حسب العلاج" : "By treatment", src.services)}
        {slice(isAr ? "حسب الدكتور" : "By dentist", src.dentists, isAr ? "الدفعة اللي من غير دكتور بتاخد دكتور العلاج." : "A payment with no dentist borrows the treatment's.")}
        {slice(isAr ? "جديد ولا راجع" : "New or returning", src.newness, isAr ? "جديد = الملف اتفتح جوه الفترة." : "New = the file was opened inside the period.")}
        {slice(isAr ? "حسب القناة" : "By channel", src.channels, isAr ? "من خانة المصدر في ملف المريض." : "From the source on the patient's file.")}
        {slice(isAr ? "حسب جهة الدفع" : "By payer", src.payers)}
        {slice(isAr ? "حسب طريقة الدفع" : "By payment method", src.methods)}
      </div>

      <ChartFrame title={isAr ? "الدخل شهر بشهر" : "Income, month by month"} note={isAr ? "آخر ١٢ شهر." : "The last twelve months."}>
        <MonthBars isAr={isAr} data={trend.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.income }))} name={isAr ? "الدخل" : "Income"} />
      </ChartFrame>

      <Note>
        {isAr
          ? `الدخل = الفلوس اللي دخلت فعلاً. النسبة المئوية من إجمالي الفترة؛ السهم مقابل ${against}. المصدر اللي جاب فلوس المرة اللي فاتت ومجابش المرة دي بيفضل في القائمة بصفر، بالأحمر.`
          : `Income is cash actually received. Shares are of the period's total; arrows are against ${against}. A source that paid last time and nothing this time stays on the list at zero, in red.`}
      </Note>
    </div>
  );
}
