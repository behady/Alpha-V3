"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, DeltaCell, DeltaFigure, FigureRow, Note, Num, SectionTitle, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { rangeText } from "@/lib/reportHelpers";
import { compareServices, delta, dentistTrend, summarizeLedger, type ServiceCompare } from "@/lib/reports/ledgerStats";
import { lastYearRange, previousRange } from "@/lib/reports/periods";
import { rollupPatients } from "@/lib/reportPatients";
import { toYmd } from "@/lib/reports/patientStats";

const EMPTY: never[] = [];

/**
 * This period against another one.
 *
 * Two modes, one screen: against the period immediately before ("this month vs last month"), or
 * against the same dates a year ago, which is the only fair comparison for a clinic with a
 * Ramadan, a summer and an exam season. Every figure is added up by one rule (lib/reports/
 * ledgerStats) on both sides, which is the whole point — "up 12%" is only true if both months
 * were counted the same way.
 *
 * Colour appears only when a number moved the wrong way. Income falling is red; expenses falling
 * is not green, it is simply not red.
 */
export default function CompareReport(props: ReportProps & { mode: "previous" | "lastYear" }) {
  const { ledger, allPatients, range, isAr, data, mode } = props;
  const otherRows = (mode === "previous" ? data.ledgerPrev : data.ledgerLastYear) || EMPTY;
  const otherRange = mode === "previous" ? previousRange(range) : lastYearRange(range);
  const against = mode === "previous" ? (isAr ? "الفترة السابقة" : "the period before") : isAr ? "نفس الفترة السنة اللي فاتت" : "the same period last year";

  const now = useMemo(() => summarizeLedger(ledger), [ledger]);
  const then = useMemo(() => summarizeLedger(otherRows), [otherRows]);
  const services = useMemo(() => compareServices(ledger, otherRows), [ledger, otherRows]);

  const patientMap = useMemo(() => new Map(allPatients.map((p) => [p.id, { id: p.id, name: String(p.name || ""), phone: String(p.phone || "") }])), [allPatients]);
  const newPatients = useMemo(() => {
    const count = (start: string, end: string) =>
      allPatients.filter((p) => {
        const c = toYmd(p.createdAt);
        return c >= start && c <= end;
      }).length;
    return { now: count(range.start, range.end), then: count(otherRange.start, otherRange.end) };
  }, [allPatients, range, otherRange]);

  const dentists = useMemo(() => {
    const cur = new Map(dentistTrend(ledger, ["x"]).map((d) => [d.doctor, d.total]));
    const prev = new Map(dentistTrend(otherRows, ["x"]).map((d) => [d.doctor, d.total]));
    const names = new Set([...cur.keys(), ...prev.keys()]);
    return [...names]
      .map((doctor) => ({ doctor, now: cur.get(doctor) || 0, then: prev.get(doctor) || 0, d: delta(prev.get(doctor) || 0, cur.get(doctor) || 0) }))
      .sort((a, b) => b.now - a.now);
  }, [ledger, otherRows]);

  // Patients seen in the period but not in the other one, and the reverse — the churn, by name.
  const movement = useMemo(() => {
    const ids = (rows: typeof ledger) => new Set(rows.map((r) => String(r.patientId || "")).filter(Boolean));
    const a = ids(ledger);
    const b = ids(otherRows);
    const onlyNow = [...a].filter((id) => !b.has(id));
    const onlyThen = [...b].filter((id) => !a.has(id));
    const roll = (idsWanted: string[], rowsFrom: typeof ledger) => {
      const want = new Set(idsWanted);
      const rows = rowsFrom.filter((r) => want.has(String(r.patientId || "")));
      return rollupPatients(rows.filter((r) => r.type === "procedure"), rows.filter((r) => r.type !== "procedure"), patientMap);
    };
    return { gained: roll(onlyNow, ledger), missing: roll(onlyThen, otherRows) };
  }, [ledger, otherRows, patientMap]);

  const egp = isAr ? "ج.م" : "EGP";
  const thenLabel = rangeText(otherRange, isAr);

  return (
    <div className="space-y-8">
      <Note>
        {isAr ? `المقارنة: ${props.rangeLabel} مقابل ${thenLabel}.` : `${props.rangeLabel}, against ${thenLabel}.`}
        {otherRows.length === 0 && (isAr ? " مفيش أي حركة مسجلة في الفترة التانية." : " Nothing was recorded in the other period.")}
      </Note>

      <FigureRow>
        <DeltaFigure isAr={isAr} label={isAr ? "الدخل" : "Income"} value={now.income} delta={delta(then.income, now.income)} against={against} />
        <DeltaFigure isAr={isAr} label={isAr ? "الصافي" : "Net"} value={now.net} delta={delta(then.net, now.net)} against={against} />
        <DeltaFigure isAr={isAr} label={isAr ? "العلاجات" : "Treatments"} value={now.procedures} delta={delta(then.procedures, now.procedures)} against={against} />
        <DeltaFigure isAr={isAr} label={isAr ? "مرضى نشطين" : "Active patients"} value={now.patients} delta={delta(then.patients, now.patients)} against={against} />
        <DeltaFigure isAr={isAr} label={isAr ? "ملفات جديدة" : "New patients"} value={newPatients.now} delta={delta(newPatients.then, newPatients.now)} against={against} />
        <DeltaFigure isAr={isAr} label={isAr ? "المصروفات" : "Expenses"} value={now.expenses} delta={delta(then.expenses, now.expenses)} goodWhen="down" against={against} />
        <DeltaFigure isAr={isAr} label={isAr ? "نسب الأطباء" : "Commissions"} value={now.commissions} delta={delta(then.commissions, now.commissions)} goodWhen="none" against={against} />
        <DeltaFigure isAr={isAr} label={isAr ? "المعمل" : "Lab fees"} value={now.labFees} delta={delta(then.labFees, now.labFees)} goodWhen="down" against={against} />
        <DeltaFigure isAr={isAr} label={isAr ? "الخصومات" : "Discounts"} value={now.discounts} delta={delta(then.discounts, now.discounts)} goodWhen="down" against={against} />
        <DeltaFigure
          isAr={isAr}
          label={isAr ? "متوسط الدخل للمريض" : "Income per patient"}
          value={now.patients ? now.income / now.patients : 0}
          delta={delta(then.patients ? then.income / then.patients : 0, now.patients ? now.income / now.patients : 0)}
          against={against}
        />
      </FigureRow>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "الدخل، الفترتين" : "Income, both periods"}>
          <Bars
            rows={[
              { label: props.rangeLabel, value: now.income, text: `${fmt(now.income)} ${egp}`, color: MARK },
              { label: thenLabel, value: then.income, text: `${fmt(then.income)} ${egp}`, color: INK },
            ]}
          />
        </ChartFrame>
        <ChartFrame title={isAr ? "الأطباء" : "By dentist"} note={isAr ? "الدخل في الفترة دي، والتغيّر." : "Income in this period, and how it moved."}>
          {dentists.length === 0 ? (
            <p className="text-sm font-semibold text-ink-faint">—</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {dentists.slice(0, 8).map((d, i) => (
                <div key={d.doctor} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">{d.doctor}</span>
                  <span className="font-figure text-xs text-ink-muted">{fmt(d.then)} →</span>
                  <span className={`w-20 text-end font-figure text-[13px] font-bold ${i === 0 ? "text-ink" : "text-ink-body"}`}>{fmt(d.now)}</span>
                  <span className="w-16 text-end">
                    <DeltaCell d={d.d} isAr={isAr} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? "الخدمات، خدمة بخدمة" : "Service by service"}</SectionTitle>
        <DataTable<ServiceCompare>
          isAr={isAr}
          rows={services}
          rowKey={(s) => s.key}
          exportName="Compare_Services"
          columns={[
            { key: "name", label: isAr ? "الخدمة" : "Service", render: (s) => <span className="text-[13px] font-bold text-ink">{s.name}</span> },
            { key: "prevCount", label: isAr ? "العدد قبل" : "Count before", align: "end", render: (s) => <Num v={s.prevCount} muted /> },
            { key: "count", label: isAr ? "العدد" : "Count", align: "end", render: (s) => <Num v={s.count} bold /> },
            { key: "countDelta", label: "", align: "end", render: (s) => <DeltaCell d={s.countDelta} isAr={isAr} />, exportValue: (s) => s.countDelta.pct ?? "" },
            { key: "prevIncome", label: isAr ? "الدخل قبل" : "Income before", align: "end", render: (s) => <Num v={s.prevIncome} muted />, total: <Num v={then.income} muted /> },
            { key: "income", label: isAr ? "الدخل" : "Income", align: "end", render: (s) => <Num v={s.income} bold />, total: <Num v={now.income} bold /> },
            { key: "incomeDelta", label: isAr ? "التغيّر" : "Change", align: "end", render: (s) => <DeltaCell d={s.incomeDelta} isAr={isAr} />, exportValue: (s) => s.incomeDelta.pct ?? "", total: <DeltaCell d={delta(then.income, now.income)} isAr={isAr} /> },
          ]}
        />
        <Note>{isAr ? "مرتّبة حسب حجم التغيّر في الدخل، الأكبر أولاً — سواء لفوق أو لتحت." : "Sorted by the size of the change in income, largest first, whichever way it went."}</Note>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section>
          <SectionTitle>{isAr ? `جُم في ${props.rangeLabel} ومكانوش في الفترة التانية (${movement.gained.length})` : `Seen now, not then (${movement.gained.length})`}</SectionTitle>
          <DataTable
            isAr={isAr}
            rows={movement.gained}
            rowKey={(r) => r.patientId || r.name}
            exportName="Compare_Gained"
            maxRows={15}
            dense
            columns={[
              { key: "name", label: isAr ? "المريض" : "Patient", render: (r) => (r.patientId ? <a href={`/patients/${r.patientId}`} className="text-[13px] font-bold text-ink hover:underline">{r.name}</a> : r.name) },
              { key: "services", label: isAr ? "العلاج" : "Treatment", render: (r) => <span className="line-clamp-1">{r.services.join(" + ") || "—"}</span>, exportValue: (r) => r.services.join(" + ") },
              { key: "paid", label: isAr ? "دفع" : "Paid", align: "end", render: (r) => <Num v={r.paid} bold /> },
            ]}
          />
        </section>
        <section>
          <SectionTitle>{isAr ? `كانوا في الفترة التانية ومجوش (${movement.missing.length})` : `Seen then, not now (${movement.missing.length})`}</SectionTitle>
          <DataTable
            isAr={isAr}
            rows={movement.missing}
            rowKey={(r) => r.patientId || r.name}
            exportName="Compare_Missing"
            maxRows={15}
            dense
            columns={[
              { key: "name", label: isAr ? "المريض" : "Patient", render: (r) => (r.patientId ? <a href={`/patients/${r.patientId}`} className="text-[13px] font-bold text-ink hover:underline">{r.name}</a> : r.name) },
              { key: "phone", label: isAr ? "الهاتف" : "Phone", render: (r) => <span className="font-figure text-ink-muted" dir="ltr">{r.phone || "—"}</span> },
              { key: "paid", label: isAr ? "كان دفع" : "Paid then", align: "end", render: (r) => <Num v={r.paid} muted /> },
            ]}
          />
          <Note>{isAr ? "الناس اللي جابوا فلوس المرة اللي فاتت ومجوش المرة دي — أول قائمة تتصل بها." : "The people who brought money last time and did not come this time. The first list to call."}</Note>
        </section>
      </div>
    </div>
  );
}
