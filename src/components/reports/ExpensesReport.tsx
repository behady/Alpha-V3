"use client";

import { useMemo, useState } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, MonthBars, Note, Num, SectionTitle, fmt, fmtPct } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { expenseLines, expensesByCategory, pnlByMonth, summarizeLedger, type ExpenseLine } from "@/lib/reports/ledgerStats";
import { monthLabel, trailingMonths } from "@/lib/reports/periods";
import { dayText } from "@/lib/reportHelpers";

/**
 * Where the clinic's own money goes.
 *
 * The overview shows expenses as one number. This is that number opened: by category, as a share
 * of income, month by month, and line by line — with a filter on the category so "what was
 * 'General' this month" is one click rather than a scroll.
 */
export default function ExpensesReport({ ledger, range, isAr, data }: ReportProps) {
  const lines = useMemo(() => expenseLines(ledger), [ledger]);
  const cats = useMemo(() => expensesByCategory(lines), [lines]);
  const period = useMemo(() => summarizeLedger(ledger), [ledger]);
  const [category, setCategory] = useState<string>("");
  const shown = category ? lines.filter((l) => l.category === category) : lines;

  const { months } = useMemo(() => trailingMonths(range.end, 12), [range.end]);
  const trend = useMemo(() => pnlByMonth(data.ledgerMonths12 || [], months), [data.ledgerMonths12, months]);
  const withYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  const egp = isAr ? "ج.م" : "EGP";
  const share = period.income > 0 ? (period.expenses / period.income) * 100 : null;
  const recurring = lines.filter((l) => l.recurring).reduce((s, l) => s + l.amount, 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(period.expenses)} ${egp}`} label={isAr ? "إجمالي المصروفات" : "Total expenses"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={fmtPct(share, 1)} label={isAr ? "من الدخل" : "of income"} tone={share !== null && share > 60 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(recurring)} ${egp}`} label={isAr ? "مصروفات ثابتة" : "Recurring"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(lines.length)} label={isAr ? "عدد البنود" : "Entries"} tone="muted" /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "حسب التصنيف" : "By category"} note={isAr ? "اضغط تصنيف لفلترة القائمة تحت." : "Click a category to filter the list below."}>
          {cats.length === 0 ? (
            <p className="text-sm font-semibold text-ink-faint">—</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {cats.map((c, i) => (
                <button key={c.category} type="button" onClick={() => setCategory(category === c.category ? "" : c.category)} className={`rounded-lg px-1 text-start transition-colors ${category === c.category ? "bg-surface-subtle" : "hover:bg-surface-subtle"}`}>
                  <Bars rows={[{ label: `${c.category} · ${c.count}`, value: c.total, text: `${fmt(c.total)} ${egp} · ${c.share}%`, color: i === 0 ? MARK : INK }]} max={cats[0].total} />
                </button>
              ))}
            </div>
          )}
        </ChartFrame>
        <ChartFrame title={isAr ? "المصروفات شهر بشهر" : "Expenses, month by month"} note={isAr ? "آخر ١٢ شهر." : "The last twelve months."}>
          <MonthBars isAr={isAr} data={trend.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.expenses }))} name={isAr ? "المصروفات" : "Expenses"} markMax={false} />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle aside={category && <button type="button" onClick={() => setCategory("")} className="text-[11.5px] font-black text-ink-faint hover:text-ink">{isAr ? "امسح الفلتر" : "Clear filter"}</button>}>
          {category ? `${category} (${shown.length})` : isAr ? "كل البنود" : "Every entry"}
        </SectionTitle>
        <DataTable<ExpenseLine>
          isAr={isAr}
          rows={shown}
          rowKey={(l) => l.id}
          exportName={`Expenses${category ? `_${category}` : ""}`}
          dense
          columns={[
            { key: "date", label: isAr ? "التاريخ" : "Date", render: (l) => <span className="whitespace-nowrap font-figure text-ink-faint">{l.date ? dayText(l.date, isAr) : "—"}</span>, exportValue: (l) => l.date },
            { key: "category", label: isAr ? "التصنيف" : "Category", render: (l) => <span className="text-[12.5px] font-bold text-ink">{l.category}</span> },
            { key: "description", label: isAr ? "البيان" : "Description", render: (l) => <span className="line-clamp-1">{l.description || "—"}</span> },
            { key: "recurring", label: isAr ? "ثابت" : "Recurring", align: "center", render: (l) => (l.recurring ? <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10.5px] font-black text-ink-body">{isAr ? "شهري" : "yes"}</span> : <span className="text-ink-faint">—</span>), exportValue: (l) => (l.recurring ? "yes" : "") },
            { key: "amount", label: isAr ? "المبلغ" : "Amount", align: "end", render: (l) => <Num v={l.amount} bold />, total: <Num v={shown.reduce((s, l) => s + l.amount, 0)} bold /> },
          ]}
        />
        <Note>
          {isAr
            ? "المصروفات هي اللي اتسجلت في صفحة المالية. مصاريف المعمل ونِسَب الأطباء ليهم تقاريرهم؛ مش هنا."
            : "Expenses are what was entered on the Finance page. Lab fees and dentists' commissions have their own reports and are not counted here."}
        </Note>
      </section>
    </div>
  );
}
