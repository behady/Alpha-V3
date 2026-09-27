"use client";

import { useMemo } from "react";
import { ChartFrame, Figure } from "@/components/reports/chartKit";
import { DataTable, MonthBars, Note, Num, SectionTitle, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { totalsByMonth, type MonthTotals } from "@/lib/reports/ledgerStats";
import { monthLabel, monthLongLabel, monthKeyOf, trailingMonths } from "@/lib/reports/periods";
import { toYmd } from "@/lib/reports/patientStats";

const EMPTY: never[] = [];

/**
 * The last twelve months, month by month.
 *
 * Runs over the twelve months ending with the period on screen, whatever the period is — a week
 * gives a twelve-month chart nothing to draw, and an owner looking at "this month" still wants it
 * against the eleven before. The best month is marked; the worst is named in words underneath,
 * because a low bar is easy to miss and a sentence is not.
 */
export default function YearReviewReport({ range, isAr, data, allPatients }: ReportProps) {
  const rows = data.ledgerMonths12 || EMPTY;
  const { months } = useMemo(() => trailingMonths(range.end, 12), [range.end]);
  const perMonth = useMemo(() => totalsByMonth(rows, months), [rows, months]);

  const newByMonth = useMemo(() => {
    const idx = new Map(months.map((m, i) => [m, i]));
    const out = months.map(() => 0);
    for (const p of allPatients) {
      const i = idx.get(monthKeyOf(toYmd(p.createdAt)));
      if (i !== undefined) out[i] += 1;
    }
    return out;
  }, [allPatients, months]);

  const year = useMemo(() => {
    const t = perMonth.reduce(
      (s, m) => ({ income: s.income + m.income, net: s.net + m.net, expenses: s.expenses + m.expenses, procedures: s.procedures + m.procedures }),
      { income: 0, net: 0, expenses: 0, procedures: 0 },
    );
    const withData = perMonth.filter((m) => m.income > 0 || m.procedures > 0);
    const best = withData.length ? withData.reduce((a, b) => (b.income > a.income ? b : a)) : null;
    const worst = withData.length > 1 ? withData.reduce((a, b) => (b.income < a.income ? b : a)) : null;
    const average = withData.length ? t.income / withData.length : 0;
    return { ...t, best, worst, average, active: withData.length };
  }, [perMonth]);

  const egp = isAr ? "ج.م" : "EGP";
  const withYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  const label = (m: string) => monthLabel(m, isAr, withYear);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(year.income)} ${egp}`} label={isAr ? "دخل ١٢ شهر" : "Income, 12 months"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(year.net)} ${egp}`} label={isAr ? "الصافي" : "Net"} tone={year.net < 0 ? "bad" : "ink"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(year.average)} ${egp}`} label={isAr ? "متوسط الشهر" : "Average month"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(newByMonth.reduce((a, b) => a + b, 0))} label={isAr ? "ملفات جديدة" : "New patients"} /></div>
      </div>

      <ChartFrame
        title={isAr ? "الدخل شهر بشهر" : "Income, month by month"}
        note={
          year.best
            ? isAr
              ? `أحسن شهر ${monthLongLabel(year.best.month, true)} بـ ${fmt(year.best.income)} ج.م${year.worst ? `، وأضعف شهر ${monthLongLabel(year.worst.month, true)} بـ ${fmt(year.worst.income)} ج.م` : ""}.`
              : `Best month ${monthLongLabel(year.best.month, false)} at ${fmt(year.best.income)} EGP${year.worst ? `; weakest ${monthLongLabel(year.worst.month, false)} at ${fmt(year.worst.income)} EGP` : ""}.`
            : undefined
        }
      >
        <MonthBars isAr={isAr} data={perMonth.map((m) => ({ label: label(m.month), value: m.income }))} name={isAr ? "الدخل" : "Income"} />
      </ChartFrame>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "الصافي بعد النِسَب والمعمل والمصروفات" : "Net, after commissions, lab and expenses"}>
          <MonthBars isAr={isAr} data={perMonth.map((m) => ({ label: label(m.month), value: m.net }))} name={isAr ? "الصافي" : "Net"} height={200} />
        </ChartFrame>
        <ChartFrame title={isAr ? "ملفات جديدة كل شهر" : "New patient files each month"}>
          <MonthBars isAr={isAr} data={months.map((m, i) => ({ label: label(m), value: newByMonth[i] }))} fmtValue={(n) => String(n)} name={isAr ? "مرضى جدد" : "New patients"} height={200} />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? "الجدول" : "The table"}</SectionTitle>
        <DataTable<MonthTotals & { newPatients: number }>
          isAr={isAr}
          rows={perMonth.map((m, i) => ({ ...m, newPatients: newByMonth[i] }))}
          rowKey={(m) => m.month}
          exportName="Year_Review"
          dense
          columns={[
            { key: "month", label: isAr ? "الشهر" : "Month", render: (m) => <span className="text-[13px] font-bold text-ink">{monthLongLabel(m.month, isAr)}</span>, exportValue: (m) => m.month },
            { key: "procedures", label: isAr ? "علاجات" : "Treatments", align: "end", render: (m) => <Num v={m.procedures} />, total: <Num v={year.procedures} bold /> },
            { key: "patients", label: isAr ? "مرضى" : "Patients", align: "end", render: (m) => <Num v={m.patients} /> },
            { key: "newPatients", label: isAr ? "جديد" : "New", align: "end", render: (m) => <Num v={m.newPatients} /> },
            { key: "income", label: isAr ? "الدخل" : "Income", align: "end", render: (m) => <Num v={m.income} bold />, total: <Num v={year.income} bold /> },
            { key: "commissions", label: isAr ? "النِسَب" : "Commissions", align: "end", render: (m) => <Num v={m.commissions} muted /> },
            { key: "labFees", label: isAr ? "المعمل" : "Lab", align: "end", render: (m) => <Num v={m.labFees} muted /> },
            { key: "expenses", label: isAr ? "المصروفات" : "Expenses", align: "end", render: (m) => <Num v={m.expenses} muted />, total: <Num v={year.expenses} muted /> },
            { key: "net", label: isAr ? "الصافي" : "Net", align: "end", render: (m) => <Num v={m.net} bold bad={m.net < 0} />, total: <Num v={year.net} bold bad={year.net < 0} /> },
          ]}
        />
        <Note>
          {isAr
            ? "الشهور اللي مفيهاش حركة بتظهر بصفر مش بتختفي — الرسم اللي بيسيب فراغات بيكذب في شكل السنة."
            : "Months with nothing in them are shown as zero rather than skipped. A chart with gaps lies about the shape of the year."}
        </Note>
      </section>
    </div>
  );
}
