"use client";

import { useMemo, useState } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, MonthBars, Note, Num, PatientLink, SectionTitle, fmt, fmtPct } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { planStats, type PlanLine, type PlanStatus } from "@/lib/reports/plansStats";
import { monthLabel, trailingMonths } from "@/lib/reports/periods";
import { dayText } from "@/lib/reportHelpers";

/**
 * Treatment plans: shown, accepted, done.
 *
 * The leak most clinics never measure. A plan is presented, the patient says yes, and a third of
 * it happens. This report separates the three questions — how many plans are being shown, how
 * many are accepted, how much of the accepted money has actually been treated — and lists the
 * accepted plans with the most money still sitting in them, which is the desk's call list.
 */
export default function PlanConversionReport({ range, isAr, data }: ReportProps) {
  const { months } = useMemo(() => trailingMonths(range.end, 12), [range.end]);
  const r = useMemo(() => planStats(data.treatmentPlans || [], data.ledgerAll || [], months, isAr ? "غير محدد" : "—"), [data.treatmentPlans, data.ledgerAll, months, isAr]);
  const [status, setStatus] = useState<PlanStatus | "">("accepted");
  const shown = status ? r.lines.filter((l) => l.status === status) : r.lines;
  const egp = isAr ? "ج.م" : "EGP";
  const label = (s: PlanStatus) => (isAr ? { draft: "مسودة", presented: "معروضة", accepted: "مقبولة", declined: "مرفوضة" }[s] : { draft: "Draft", presented: "Presented", accepted: "Accepted", declined: "Declined" }[s]);
  const withYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(r.total)} label={isAr ? "خطط" : "Plans"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={fmtPct(r.acceptancePct, 0)} label={isAr ? "نسبة القبول" : "Acceptance"} tone={r.acceptancePct !== null && r.acceptancePct < 40 ? "bad" : "ink"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(r.acceptedValue)} ${egp}`} label={isAr ? "قيمة المقبول" : "Accepted value"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(r.realizedValue)} ${egp}`} label={`${isAr ? "اتعمل منه" : "Treated so far"} · ${fmtPct(r.realizedPct, 0)}`} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(r.remainingValue)} ${egp}`} label={isAr ? "لسه في الخطط" : "Still in the plans"} tone={r.remainingValue > 0 ? "bad" : "muted"} /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "حسب الحالة" : "By status"} note={isAr ? "العدد والقيمة. اضغط حالة لفلترة القائمة." : "Count and value. Click a status to filter the list."}>
          <div className="flex flex-col gap-2.5">
            {r.byStatus.map((s) => (
              <button key={s.status} type="button" onClick={() => setStatus(status === s.status ? "" : s.status)} className={`rounded-lg px-1 text-start transition-colors ${status === s.status ? "bg-surface-subtle" : "hover:bg-surface-subtle"}`}>
                <Bars rows={[{ label: `${label(s.status)} · ${s.count}`, value: s.value, text: `${fmt(s.value)} ${egp}`, color: s.status === "accepted" ? MARK : s.status === "declined" ? "#CBD5E1" : INK }]} max={Math.max(1, ...r.byStatus.map((x) => x.value))} />
              </button>
            ))}
          </div>
        </ChartFrame>
        <ChartFrame title={isAr ? "خطط معروضة كل شهر" : "Plans presented each month"} note={isAr ? "آخر ١٢ شهر، بتاريخ إنشاء الخطة." : "The last twelve months, by the date the plan was written."}>
          <MonthBars isAr={isAr} data={r.byMonth.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.presented }))} fmtValue={(n) => String(n)} name={isAr ? "معروضة" : "Presented"} height={200} />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? "حسب الدكتور" : "By dentist"}</SectionTitle>
        <DataTable
          isAr={isAr}
          rows={r.byDoctor}
          rowKey={(d) => d.doctor}
          exportName="Plans_By_Dentist"
          dense
          columns={[
            { key: "doctor", label: isAr ? "الدكتور" : "Dentist", render: (d) => <span className="text-[13px] font-bold text-ink">{d.doctor}</span> },
            { key: "plans", label: isAr ? "خطط" : "Plans", align: "end", render: (d) => <Num v={d.plans} /> },
            { key: "accepted", label: isAr ? "مقبولة" : "Accepted", align: "end", render: (d) => <Num v={d.accepted} bold /> },
            { key: "acceptancePct", label: isAr ? "القبول" : "Acceptance", align: "end", render: (d) => <span className="font-figure text-[12.5px] text-ink-body">{fmtPct(d.acceptancePct, 0)}</span>, exportValue: (d) => d.acceptancePct ?? "" },
            { key: "value", label: isAr ? "قيمة المقبول" : "Accepted value", align: "end", render: (d) => <Num v={d.value} bold /> },
            { key: "realized", label: isAr ? "اتعمل" : "Treated", align: "end", render: (d) => <Num v={d.realized} /> },
          ]}
        />
      </section>

      <section>
        <SectionTitle aside={status && <button type="button" onClick={() => setStatus("")} className="text-[11.5px] font-black text-ink-faint hover:text-ink">{isAr ? "كل الخطط" : "All plans"}</button>}>
          {status ? `${label(status)} (${shown.length})` : isAr ? `كل الخطط (${r.lines.length})` : `All plans (${r.lines.length})`}
        </SectionTitle>
        <DataTable<PlanLine>
          isAr={isAr}
          rows={shown}
          rowKey={(l) => l.id}
          exportName={`Plans${status ? `_${status}` : ""}`}
          maxRows={100}
          columns={[
            { key: "created", label: isAr ? "التاريخ" : "Date", render: (l) => <span className="whitespace-nowrap font-figure text-ink-faint">{l.created ? dayText(l.created, isAr) : "—"}</span> },
            { key: "patientName", label: isAr ? "المريض" : "Patient", render: (l) => <PatientLink id={l.patientId} name={l.patientName} isAr={isAr} /> },
            { key: "title", label: isAr ? "الخطة" : "Plan", render: (l) => <span className="line-clamp-1 text-[12.5px]">{l.title || "—"}<span className="ms-1 font-figure text-[11px] text-ink-faint">· {l.steps}</span></span> },
            { key: "doctorName", label: isAr ? "كتبها" : "Written by" },
            { key: "status", label: isAr ? "الحالة" : "Status", render: (l) => <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-black ${l.status === "accepted" ? "bg-accent text-ink" : l.status === "declined" ? "bg-danger-tint text-danger" : "bg-surface-muted text-ink-body"}`}>{label(l.status)}</span>, exportValue: (l) => label(l.status) },
            { key: "total", label: isAr ? "القيمة" : "Value", align: "end", render: (l) => <Num v={l.total} bold />, total: <Num v={shown.reduce((s, l) => s + l.total, 0)} bold /> },
            { key: "realized", label: isAr ? "اتعمل" : "Treated", align: "end", render: (l) => (l.status === "accepted" ? <Num v={l.realized} /> : <span className="text-ink-faint">—</span>), total: <Num v={shown.reduce((s, l) => s + l.realized, 0)} /> },
            { key: "remaining", label: isAr ? "الباقي" : "Remaining", align: "end", render: (l) => (l.status === "accepted" ? <Num v={l.remaining} bold bad={l.remaining > 0} /> : <span className="text-ink-faint">—</span>), total: <Num v={shown.reduce((s, l) => s + l.remaining, 0)} bold bad /> },
          ]}
        />
        <Note>
          {isAr
            ? "«اتعمل» = علاجات مسجّلة لنفس المريض، لنفس الخدمات اللي في الخطة، بعد تاريخ الخطة — الخطط والعلاجات مش مربوطين مباشرة، فده أقرب قراءة صادقة. «كتبها» هو اللي عمل الخطة على النظام."
            : "\"Treated\" means treatments recorded for the same patient, for a service the plan named, on or after the plan's date — plans and treatments are not linked directly, so this is the closest honest reading. \"Written by\" is whoever created the plan in the system."}
        </Note>
      </section>
    </div>
  );
}
