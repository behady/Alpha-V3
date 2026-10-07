"use client";

import { useMemo, useState } from "react";
import { ChartFrame, Figure } from "@/components/reports/chartKit";
import { DataTable, DeltaCell, DeltaFigure, MonthBars, Note, Num, SectionTitle, fmt, fmtPct } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { rangeText } from "@/lib/reportHelpers";
import { categoryLabel } from "@/lib/expenseCategories";
import { compareExpenseCategories, expenseMatrix, type ExpenseCategoryCompare, type ExpenseCategoryTrend } from "@/lib/reports/financeStats";
import { delta, summarizeLedger } from "@/lib/reports/ledgerStats";
import { lastYearRange, monthLabel, previousRange, trailingMonths } from "@/lib/reports/periods";

const EMPTY: never[] = [];

/**
 * Where the clinic's own money goes, and whether that is more or less than it used to be.
 *
 * The Expenses tab is one period opened up. This is the same categories laid across twelve
 * months — rent beside rent, supplies beside supplies — so "supplies doubled in August" is a row
 * to read, not a number to remember. Two more tables put the period on screen against the one
 * before it and against the same dates last year, by category, largest move first.
 *
 * Red marks a category that GREW. Falling expenses are not green; they are simply not red.
 */
export default function ExpenseTrendReport({ ledger, range, isAr, data }: ReportProps) {
  const { months } = useMemo(() => trailingMonths(range.end, 12), [range.end]);
  const mx = useMemo(() => expenseMatrix(data.ledgerMonths12 || EMPTY, months), [data.ledgerMonths12, months]);
  const now = useMemo(() => summarizeLedger(ledger), [ledger]);
  const prevRange = useMemo(() => previousRange(range), [range]);
  const yearRange = useMemo(() => lastYearRange(range), [range]);
  const vsPrev = useMemo(() => compareExpenseCategories(ledger, data.ledgerPrev || EMPTY), [ledger, data.ledgerPrev]);
  const vsYear = useMemo(() => compareExpenseCategories(ledger, data.ledgerLastYear || EMPTY), [ledger, data.ledgerLastYear]);
  const thenPrev = useMemo(() => summarizeLedger(data.ledgerPrev || EMPTY).expenses, [data.ledgerPrev]);
  const thenYear = useMemo(() => summarizeLedger(data.ledgerLastYear || EMPTY).expenses, [data.ledgerLastYear]);
  const [against, setAgainst] = useState<"previous" | "lastYear">("previous");
  const withYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  const egp = isAr ? "ج.م" : "EGP";
  const money = (n: number) => `${fmt(n)} ${egp}`;
  const mover = [...vsPrev].filter((c) => c.then > 0 && c.now > 0).sort((a, b) => Math.abs(b.delta.pct || 0) - Math.abs(a.delta.pct || 0))[0];
  const cmp = against === "previous" ? vsPrev : vsYear;
  const cmpThen = against === "previous" ? thenPrev : thenYear;
  const cmpLabel = against === "previous" ? rangeText(prevRange, isAr) : rangeText(yearRange, isAr);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <DeltaFigure label={isAr ? "مصروفات الفترة" : "This period"} value={now.expenses} delta={delta(thenPrev, now.expenses)} goodWhen="down" isAr={isAr} format={money} against={rangeText(prevRange, isAr)} />
        <DeltaFigure label={isAr ? "نفس الفترة السنة اللي فاتت" : "Same period last year"} value={thenYear} delta={delta(thenYear, now.expenses)} goodWhen="down" isAr={isAr} format={money} against={isAr ? "دلوقتي" : "now"} />
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={money(mx.average)} label={isAr ? "متوسط الشهر" : "Monthly average"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={mx.peak ? `${monthLabel(mx.peak.month, isAr, true)} · ${money(mx.peak.value)}` : "—"} label={isAr ? "أعلى شهر" : "Heaviest month"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={mover ? `${categoryLabel(mover.category, isAr)} ${mover.delta.abs > 0 ? "▲" : "▼"} ${Math.abs(mover.delta.pct || 0)}%` : "—"} label={isAr ? "أكبر تغيّر عن الفترة اللي قبلها" : "Biggest mover vs the period before"} tone={mover && mover.delta.abs > 0 ? "bad" : "muted"} /></div>
      </div>

      <section>
        <SectionTitle>{isAr ? "كل تصنيف، شهر بشهر" : "Every category, month by month"}</SectionTitle>
        <DataTable<ExpenseCategoryTrend>
          isAr={isAr}
          rows={mx.categories}
          rowKey={(c) => c.category}
          exportName="Expense_comparison"
          dense
          columns={[
            { key: "category", label: isAr ? "التصنيف" : "Category", render: (c) => <span className="text-[12.5px] font-bold text-ink">{categoryLabel(c.category, isAr)}</span>, total: <span className="font-black">{isAr ? "الإجمالي" : "Total"}</span> },
            ...months.map((m, i) => ({
              key: `m${i}`,
              label: monthLabel(m, isAr, withYear),
              align: "end" as const,
              render: (c: ExpenseCategoryTrend) => (c.byMonth[i] ? <Num v={c.byMonth[i]} bad={i === months.length - 1 && c.before > 0 && (c.delta.pct || 0) >= 25} /> : <span className="text-ink-faint">—</span>),
              exportValue: (c: ExpenseCategoryTrend) => c.byMonth[i],
              total: <Num v={mx.totals[i]} bold />,
            })),
            { key: "total", label: isAr ? "الإجمالي" : "Total", align: "end", render: (c) => <Num v={c.total} bold />, exportValue: (c) => c.total, total: <Num v={mx.total} bold /> },
            { key: "average", label: isAr ? "المتوسط" : "Average", align: "end", render: (c) => <Num v={c.average} muted />, exportValue: (c) => c.average, total: <Num v={mx.average} bold /> },
            { key: "share", label: isAr ? "الحصة" : "Share", align: "end", render: (c) => <span className="font-figure text-ink-muted">{fmtPct(c.share, 1)}</span>, exportValue: (c) => c.share },
          ]}
        />
        <Note>{isAr ? "المتوسط على الشهور اللي فيها حركة بس. الأحمر في آخر شهر = التصنيف زاد ربع أو أكتر عن الشهر اللي قبله." : "The average is over months that had any activity. Red in the last month marks a category up a quarter or more on the month before."}</Note>
      </section>

      <ChartFrame title={isAr ? "المصروفات من الدخل" : "Expenses as a share of income"} note={isAr ? "فوق ١٠٠٪ يعني الشهر صرف أكتر ما دخّل." : "Above 100% means the month spent more than it took in."}>
        <MonthBars isAr={isAr} data={mx.incomeShare.map((v, i) => ({ label: monthLabel(months[i], isAr, withYear), value: v ?? 0 }))} fmtValue={(n) => `${n.toFixed(1)}%`} name={isAr ? "من الدخل" : "of income"} markMax={false} />
      </ChartFrame>

      <section>
        <SectionTitle
          aside={
            <div className="flex gap-1">
              {(["previous", "lastYear"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setAgainst(m)} className={`rounded-full px-3 py-1 text-[11.5px] font-black transition-colors ${against === m ? "bg-ink text-white" : "bg-surface-subtle text-ink-muted hover:text-ink"}`}>
                  {m === "previous" ? (isAr ? "الفترة اللي قبلها" : "Period before") : isAr ? "السنة اللي فاتت" : "Last year"}
                </button>
              ))}
            </div>
          }
        >
          {isAr ? `مقابل ${cmpLabel}` : `Against ${cmpLabel}`}
        </SectionTitle>
        <DataTable<ExpenseCategoryCompare>
          isAr={isAr}
          rows={cmp}
          rowKey={(c) => c.category}
          exportName={`Expenses_vs_${against}`}
          dense
          columns={[
            { key: "category", label: isAr ? "التصنيف" : "Category", render: (c) => <span className="text-[12.5px] font-bold text-ink">{categoryLabel(c.category, isAr)}</span>, total: <span className="font-black">{isAr ? "الإجمالي" : "Total"}</span> },
            { key: "then", label: isAr ? "قبل" : "Before", align: "end", render: (c) => <Num v={c.then} muted />, exportValue: (c) => c.then, total: <Num v={cmpThen} bold /> },
            { key: "now", label: isAr ? "دلوقتي" : "Now", align: "end", render: (c) => <Num v={c.now} bold />, exportValue: (c) => c.now, total: <Num v={now.expenses} bold /> },
            { key: "change", label: isAr ? "التغيّر" : "Change", align: "end", render: (c) => <DeltaCell d={c.delta} goodWhen="down" isAr={isAr} />, exportValue: (c) => c.delta.pct ?? "", total: <DeltaCell d={delta(cmpThen, now.expenses)} goodWhen="down" isAr={isAr} /> },
            { key: "share", label: isAr ? "الحصة" : "Share", align: "end", render: (c) => <span className="font-figure text-ink-muted">{fmtPct(c.share, 1)}</span>, exportValue: (c) => c.share },
          ]}
        />
        <Note>{isAr ? "مرتّبة حسب حجم التغيّر. التصنيف اللي اختفى بيفضل في القائمة بصفر." : "Sorted by the size of the change. A category that vanished stays on the list at zero."}</Note>
      </section>

      <Note>{isAr ? "المصروفات هي اللي اتسجلت في صفحة المالية. نِسَب الأطباء ومصاريف المعمل ليهم تقاريرهم." : "Expenses are what was entered on the Finance page. Dentist commissions and lab fees have their own tabs."}</Note>
    </div>
  );
}
