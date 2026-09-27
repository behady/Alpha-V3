"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, SectionTitle, fmt, fmtPct } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { labStats, type LabLine } from "@/lib/reports/opsStats";
import { statusLabel, workTypeLabel } from "@/lib/labCases";
import { dayText } from "@/lib/reportHelpers";

/**
 * The lab, as the clinic experiences it: how long things take, how often they come back wrong,
 * and what it all costs — per lab, so the conversation with a slow or careless lab has numbers.
 * Cases are the ones OPENED in the period; a case sent in March and fitted in April belongs to
 * March here.
 */
export default function LabReport({ isAr, data, today }: ReportProps) {
  const s = useMemo(() => labStats(data.labCases || [], data.labPayments || [], today), [data.labCases, data.labPayments, today]);
  const egp = isAr ? "ج.م" : "EGP";
  const lang = isAr ? "ar" : "en";
  const faultLabel = (f: string) => (isAr ? { lab: "غلطة المعمل", clinic: "غلطة العيادة", patient: "المريض", unknown: "غير محدد" }[f] || f : { lab: "Lab's fault", clinic: "Clinic's fault", patient: "Patient", unknown: "Unknown" }[f] || f);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.total)} label={isAr ? "حالات" : "Cases"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.atLab)} label={isAr ? "في المعمل دلوقتي" : "At the lab now"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(s.overdue)} label={isAr ? "متأخرة" : "Overdue"} tone={s.overdue > 0 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={s.turnaroundDays === null ? "—" : `${s.turnaroundDays}`} label={isAr ? "يوم متوسط التنفيذ" : "days average turnaround"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={fmtPct(s.remakePct, 0)} label={`${isAr ? "إعادة" : "Remakes"} · ${s.remakes}`} tone={s.remakePct !== null && s.remakePct >= 10 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(s.cost)} ${egp}`} label={isAr ? "تكلفة المعمل" : "Lab cost"} /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <ChartFrame title={isAr ? "حسب الحالة" : "By status"}>
          <Bars rows={s.byStatus.map((b, i) => ({ label: statusLabel(b.status, lang), value: b.count, text: String(b.count), color: i === 0 ? MARK : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "حسب نوع الشغل" : "By work type"}>
          <Bars rows={s.byWorkType.slice(0, 8).map((w, i) => ({ label: `${workTypeLabel(w.workType, lang)} · ${w.count}`, value: w.cost, text: `${fmt(w.cost)} ${egp}`, color: i === 0 ? MARK : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "الإعادة: غلطة مين" : "Remakes: whose fault"}>
          <Bars rows={s.remakeFault.map((f) => ({ label: faultLabel(f.fault), value: f.count, text: String(f.count), color: INK, warn: f.fault === "lab" }))} />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? "معمل بمعمل" : "Lab by lab"}</SectionTitle>
        <DataTable<LabLine>
          isAr={isAr}
          rows={s.byLab}
          rowKey={(l) => l.labId || l.labName}
          exportName="Lab_By_Lab"
          dense
          columns={[
            { key: "labName", label: isAr ? "المعمل" : "Lab", render: (l) => <span className="text-[13px] font-bold text-ink">{l.labName}</span> },
            { key: "sent", label: isAr ? "اتبعت" : "Sent", align: "end", render: (l) => <Num v={l.sent} /> },
            { key: "back", label: isAr ? "رجع" : "Back", align: "end", render: (l) => <Num v={l.back} /> },
            { key: "fitted", label: isAr ? "اتركّب" : "Fitted", align: "end", render: (l) => <Num v={l.fitted} /> },
            { key: "overdue", label: isAr ? "متأخر" : "Overdue", align: "end", render: (l) => <Num v={l.overdue} bad={l.overdue > 0} /> },
            { key: "turnaroundDays", label: isAr ? "أيام التنفيذ" : "Turnaround", align: "end", render: (l) => <span className="font-figure text-[12.5px] text-ink-body">{l.turnaroundDays === null ? "—" : `${l.turnaroundDays}d`}</span>, exportValue: (l) => l.turnaroundDays ?? "" },
            { key: "remakePct", label: isAr ? "إعادة" : "Remakes", align: "end", render: (l) => <span className={`font-figure text-[12.5px] ${l.remakePct !== null && l.remakePct >= 10 ? "text-danger" : "text-ink-body"}`}>{l.remakes} · {fmtPct(l.remakePct, 0)}</span>, exportValue: (l) => l.remakePct ?? "" },
            { key: "cost", label: isAr ? "التكلفة" : "Cost", align: "end", render: (l) => <Num v={l.cost} bold />, total: <Num v={s.cost} bold /> },
            { key: "paid", label: isAr ? "المدفوع للمعمل" : "Paid to lab", align: "end", render: (l) => <Num v={l.paid} muted /> },
          ]}
        />
      </section>

      <section>
        <SectionTitle>{isAr ? `متأخر دلوقتي (${s.overdueCases.length})` : `Overdue right now (${s.overdueCases.length})`}</SectionTitle>
        <DataTable
          isAr={isAr}
          rows={s.overdueCases}
          rowKey={(c) => c.code}
          exportName="Lab_Overdue"
          dense
          emptyText={isAr ? "مفيش حالة متأخرة." : "Nothing is overdue."}
          columns={[
            { key: "code", label: isAr ? "الكود" : "Code", render: (c) => <span className="font-figure text-[13px] font-bold text-ink">{c.code}</span> },
            { key: "labName", label: isAr ? "المعمل" : "Lab" },
            { key: "patientName", label: isAr ? "المريض" : "Patient" },
            { key: "workType", label: isAr ? "الشغل" : "Work", render: (c) => workTypeLabel(c.workType, lang), exportValue: (c) => workTypeLabel(c.workType, lang) },
            { key: "dueDate", label: isAr ? "كان المفروض" : "Was due", render: (c) => <span className="whitespace-nowrap font-figure text-ink-faint">{dayText(c.dueDate, isAr)}</span> },
            { key: "daysLate", label: isAr ? "متأخر (يوم)" : "Days late", align: "end", render: (c) => <Num v={c.daysLate} bad bold /> },
          ]}
        />
        <Note>
          {isAr
            ? "التكلفة = السعر المتفق عليه للحالات اللي رجعت أو اتركّبت؛ الحالة اللي لسه في المعمل مش دين لحد دلوقتي. المدفوع من صفحة حسابات المعامل."
            : "Cost is the agreed price of cases that came back or were fitted; a case still at the lab is not owed yet. Paid comes from the lab accounts page."}
        </Note>
      </section>
    </div>
  );
}
