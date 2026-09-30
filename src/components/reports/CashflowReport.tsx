"use client";

import { useMemo } from "react";
import { ChartFrame, Figure } from "@/components/reports/chartKit";
import { DataTable, MonthBars, Note, Num, SectionTitle, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { cashflow, type CashflowMonth } from "@/lib/reports/financeStats";
import { monthLabel, monthLongLabel, trailingMonths } from "@/lib/reports/periods";

const EMPTY: never[] = [];

/**
 * Does more come in than goes out, month by month.
 *
 * Profit & Loss lays a month out the way an accountant does. This is the owner's version of the
 * same twelve months: what came in, what went out (expenses, lab, commissions), what was left,
 * and the running total — so a bad month is visible as a red row and a bad quarter as a running
 * total that keeps falling.
 */
export default function CashflowReport({ range, isAr, data }: ReportProps) {
  const { months } = useMemo(() => trailingMonths(range.end, 12), [range.end]);
  const cf = useMemo(() => cashflow(data.ledgerMonths12 || EMPTY, months), [data.ledgerMonths12, months]);
  const withYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  const egp = isAr ? "ج.م" : "EGP";
  const money = (n: number) => `${fmt(n)} ${egp}`;
  const sum = (k: keyof CashflowMonth) => cf.months.reduce((s, m) => s + (m[k] as number), 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={money(cf.inflow)} label={isAr ? "دخل" : "Money in"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`(${fmt(cf.outflow)}) ${egp}`} label={isAr ? "خرج" : "Money out"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={money(cf.net)} label={isAr ? "الصافي" : "Net"} tone={cf.net < 0 ? "bad" : "ink"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={money(cf.averageNet)} label={isAr ? "متوسط الصافي في الشهر" : "Average net per month"} tone={cf.averageNet < 0 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(cf.monthsInRed)} label={isAr ? "شهور بالسالب" : "Months in the red"} tone={cf.monthsInRed > 0 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={cf.best ? `${monthLabel(cf.best.month, isAr, true)} · ${money(cf.best.net)}` : "—"} label={isAr ? "أحسن شهر" : "Best month"} tone="muted" /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "الداخل" : "Money in"} note={isAr ? "الفلوس اللي اتقبضت، آخر ١٢ شهر." : "Cash received, the last twelve months."}>
          <MonthBars isAr={isAr} data={cf.months.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.inflow }))} name={isAr ? "داخل" : "In"} />
        </ChartFrame>
        <ChartFrame title={isAr ? "الخارج" : "Money out"} note={isAr ? "مصروفات + معمل + نِسَب." : "Expenses + lab + commissions."}>
          <MonthBars isAr={isAr} data={cf.months.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.outflow }))} name={isAr ? "خارج" : "Out"} markMax={false} />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? "شهر بشهر" : "Month by month"}</SectionTitle>
        <DataTable<CashflowMonth>
          isAr={isAr}
          rows={cf.months}
          rowKey={(m) => m.month}
          exportName="Cash_flow"
          dense
          columns={[
            { key: "month", label: isAr ? "الشهر" : "Month", render: (m) => <span className={`text-[12.5px] font-bold ${m.net < 0 ? "text-danger" : "text-ink"}`}>{monthLongLabel(m.month, isAr)}</span>, exportValue: (m) => m.month, total: <span className="font-black">{isAr ? "الإجمالي" : "Total"}</span> },
            { key: "inflow", label: isAr ? "داخل" : "In", align: "end", render: (m) => <Num v={m.inflow} bold />, exportValue: (m) => m.inflow, total: <Num v={cf.inflow} bold /> },
            { key: "expenses", label: isAr ? "مصروفات" : "Expenses", align: "end", render: (m) => <Num v={m.expenses} muted />, exportValue: (m) => m.expenses, total: <Num v={sum("expenses")} /> },
            { key: "lab", label: isAr ? "المعمل" : "Lab", align: "end", render: (m) => <Num v={m.lab} muted />, exportValue: (m) => m.lab, total: <Num v={sum("lab")} /> },
            { key: "commissions", label: isAr ? "النِسَب" : "Commissions", align: "end", render: (m) => <Num v={m.commissions} muted />, exportValue: (m) => m.commissions, total: <Num v={sum("commissions")} /> },
            { key: "outflow", label: isAr ? "خارج" : "Out", align: "end", render: (m) => <Num v={m.outflow} bold />, exportValue: (m) => m.outflow, total: <Num v={cf.outflow} bold /> },
            { key: "net", label: isAr ? "الصافي" : "Net", align: "end", render: (m) => <Num v={m.net} bold bad={m.net < 0} />, exportValue: (m) => m.net, total: <Num v={cf.net} bold bad={cf.net < 0} /> },
            { key: "running", label: isAr ? "التراكمي" : "Running", align: "end", render: (m) => <Num v={m.running} bad={m.running < 0} muted={m.running >= 0} />, exportValue: (m) => m.running },
          ]}
        />
        <Note>
          {isAr
            ? "الداخل = الفلوس اللي اتقبضت. الخارج = المصروفات + مصاريف المعمل + نِسَب الأطباء، بشهر العلاج أو الدفعة مش بشهر ما اتدفعوا. الرصيد التراكمي بيبدأ من أول شهر في الشاشة."
            : "In is cash received. Out is expenses + lab fees + dentist commissions, counted in the month of the treatment or payment, not the month they were paid out. The running total starts at the first month on screen."}
        </Note>
      </section>
    </div>
  );
}
