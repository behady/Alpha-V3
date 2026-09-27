"use client";

import { useMemo, useState } from "react";
import { ChartFrame } from "@/components/reports/chartKit";
import { DataTable, DeltaCell, MonthBars, Note, Num, SectionTitle, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { delta, dentistTrend, type DentistTrend } from "@/lib/reports/ledgerStats";
import { monthLabel, monthLongLabel, trailingMonths } from "@/lib/reports/periods";

const EMPTY: never[] = [];

/**
 * Each dentist, month by month, over the last twelve.
 *
 * The Dentist Performance tab answers "how much this period"; this one answers "which way is it
 * going". One dentist is drawn at a time — a chart with five dentists' lines on it is a chart
 * about colour-matching — and the table underneath carries all of them, with the last month
 * against the one before so a slide shows before the year is over.
 */
export default function DentistTrendReport({ range, isAr, data }: ReportProps) {
  const rows = data.ledgerMonths12 || EMPTY;
  const { months } = useMemo(() => trailingMonths(range.end, 12), [range.end]);
  const trend = useMemo(() => dentistTrend(rows, months, isAr ? "غير محدد" : "Unassigned"), [rows, months, isAr]);
  const [selected, setSelected] = useState<string>("");
  const active = trend.find((t) => t.doctor === selected) || trend[0];
  const withYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  const egp = isAr ? "ج.م" : "EGP";

  if (trend.length === 0) {
    return <p className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-[13px] font-medium text-ink-faint">{isAr ? "مفيش شغل متسجل باسم دكتور في آخر ١٢ شهر." : "No work attributed to a dentist in the last twelve months."}</p>;
  }

  const last = months.length - 1;
  const lastDelta = (t: DentistTrend) => delta(t.byMonth[last - 1]?.income || 0, t.byMonth[last].income);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        {trend.map((t) => (
          <button
            key={t.doctor}
            type="button"
            onClick={() => setSelected(t.doctor)}
            className={`rounded-full px-4 py-2 text-[13px] font-bold transition-colors ${active?.doctor === t.doctor ? "bg-ink-slab text-white" : "border border-line bg-surface text-ink-body hover:bg-surface-muted"}`}
          >
            Dr. {t.doctor}
            <span className={`ms-2 font-figure text-[11.5px] ${active?.doctor === t.doctor ? "text-white/60" : "text-ink-faint"}`}>{fmt(t.total)}</span>
          </button>
        ))}
      </div>

      {active && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChartFrame title={isAr ? `دخل د. ${active.doctor}` : `Dr. ${active.doctor}: income`} note={isAr ? `${fmt(active.total)} ج.م في ١٢ شهر` : `${fmt(active.total)} EGP over twelve months`}>
            <MonthBars isAr={isAr} data={active.byMonth.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.income }))} name={isAr ? "الدخل" : "Income"} />
          </ChartFrame>
          <ChartFrame title={isAr ? `د. ${active.doctor}: عدد الحالات` : `Dr. ${active.doctor}: cases`} note={isAr ? `${active.cases} حالة` : `${active.cases} cases`}>
            <MonthBars isAr={isAr} data={active.byMonth.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.cases }))} fmtValue={(n) => String(n)} name={isAr ? "حالات" : "Cases"} />
          </ChartFrame>
        </div>
      )}

      <section>
        <SectionTitle>{isAr ? "كل الأطباء، شهر بشهر" : "Every dentist, month by month"}</SectionTitle>
        <DataTable<DentistTrend>
          isAr={isAr}
          rows={trend}
          rowKey={(t) => t.doctor}
          exportName="Dentist_Trend"
          dense
          columns={[
            { key: "doctor", label: isAr ? "الدكتور" : "Dentist", render: (t) => <span className="whitespace-nowrap text-[13px] font-bold text-ink">Dr. {t.doctor}</span> },
            ...months.map((m, i) => ({
              key: m,
              label: monthLabel(m, isAr, withYear),
              align: "end" as const,
              render: (t: DentistTrend) => <Num v={t.byMonth[i].income} muted={t.byMonth[i].income === 0} format={(n) => (n === 0 ? "—" : fmt(n))} />,
              exportValue: (t: DentistTrend) => t.byMonth[i].income,
            })),
            { key: "total", label: isAr ? "الإجمالي" : "Total", align: "end", render: (t) => <Num v={t.total} bold /> },
            { key: "last", label: isAr ? `${monthLabel(months[last], isAr)} عن ${monthLabel(months[last - 1], isAr)}` : `${monthLabel(months[last], isAr)} vs ${monthLabel(months[last - 1], isAr)}`, align: "end", render: (t) => <DeltaCell d={lastDelta(t)} isAr={isAr} />, exportValue: (t) => lastDelta(t).pct ?? "" },
          ]}
        />
        <Note>
          {isAr
            ? `الدخل هو الفلوس اللي اتحصّلت على اسم الدكتور في الشهر، من ${monthLongLabel(months[0], true)} إلى ${monthLongLabel(months[last], true)}. النِسَب في تقرير أداء الأطباء.`
            : `Income is cash collected against the dentist's name in each month, ${monthLongLabel(months[0], false)} to ${monthLongLabel(months[last], false)}. Commission is on the Dentist Performance tab.`}
          {" "}{egp}
        </Note>
      </section>
    </div>
  );
}
