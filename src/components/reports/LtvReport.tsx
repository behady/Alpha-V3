"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, PatientLink, Phone, SectionTitle, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { lifetimeValue, type LifetimeLine, type PatientDoc } from "@/lib/reports/patientStats";
import { dayText } from "@/lib/reportHelpers";

/**
 * What a patient is worth over their whole time with the clinic.
 *
 * Whole ledger, not the period: lifetime means lifetime. Per source it answers the question the
 * marketing budget is actually asking — not "which channel brings the most people" (that is the
 * Sources tab) but "which channel brings the people who stay and spend".
 */
export default function LtvReport({ allPatients, isAr, data }: ReportProps) {
  const r = useMemo(() => lifetimeValue(data.ledgerAll || [], allPatients as PatientDoc[], isAr ? "غير معروف / ووك إن" : "Unknown / Walk-in"), [data.ledgerAll, allPatients, isAr]);
  const egp = isAr ? "ج.م" : "EGP";
  const top = r.lines[0];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(r.average)} ${egp}`} label={isAr ? "متوسط قيمة المريض" : "Average lifetime value"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(r.median)} ${egp}`} label={isAr ? "الوسيط" : "Median"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(r.lines.length)} label={isAr ? "مريض ليه حركة مالية" : "Patients with money history"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={top ? `${fmt(top.paid)} ${egp}` : "—"} label={top ? (isAr ? `الأعلى: ${top.name}` : `Top: ${top.name}`) : isAr ? "الأعلى" : "Top patient"} /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "متوسط القيمة حسب المصدر" : "Average value by source"} note={isAr ? "القناة اللي بتجيب ناس بتكمّل، مش بس ناس كتير." : "The channel that brings people who stay, not just people."}>
          <Bars rows={r.bySource.slice(0, 8).map((s, i) => ({ label: `${s.source} · ${s.patients}`, value: s.average, text: `${fmt(s.average)} ${egp}`, color: i === 0 ? MARK : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "توزيع المرضى حسب الإنفاق" : "Patients by lifetime spend"} note={isAr ? "كام مريض في كل شريحة." : "How many patients in each band."}>
          <Bars rows={r.distribution.map((d) => ({ label: `${d.label} ${egp}`, value: d.count, text: String(d.count), color: INK }))} />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? "الأعلى قيمة" : "Highest value"}</SectionTitle>
        <DataTable<LifetimeLine>
          isAr={isAr}
          rows={r.lines}
          rowKey={(l) => l.patientId}
          exportName="Lifetime_Value"
          maxRows={50}
          columns={[
            { key: "name", label: isAr ? "المريض" : "Patient", render: (l) => <PatientLink id={l.patientId} name={l.name} isAr={isAr} /> },
            { key: "phone", label: isAr ? "الهاتف" : "Phone", render: (l) => <Phone value={l.phone} /> },
            { key: "source", label: isAr ? "المصدر" : "Source", render: (l) => <span className="text-[12px] text-ink-muted">{l.source}</span> },
            { key: "firstVisit", label: isAr ? "أول زيارة" : "First visit", render: (l) => <span className="whitespace-nowrap font-figure text-ink-faint">{l.firstVisit ? dayText(l.firstVisit, isAr) : "—"}</span> },
            { key: "visits", label: isAr ? "زيارات" : "Visits", align: "end", render: (l) => <Num v={l.visits} /> },
            { key: "procedures", label: isAr ? "علاجات" : "Treatments", align: "end", render: (l) => <Num v={l.procedures} /> },
            { key: "perVisit", label: isAr ? "للزيارة" : "Per visit", align: "end", render: (l) => <Num v={l.perVisit} muted /> },
            { key: "paid", label: isAr ? "إجمالي المدفوع" : "Lifetime paid", align: "end", render: (l) => <Num v={l.paid} bold /> },
          ]}
        />
        <Note>
          {isAr
            ? "القيمة = كل الفلوس اللي دفعها المريض من أول يوم. المصدر من ملف المريض («عرفتنا منين»)."
            : "Value is every payment the patient has ever made. Source is from the patient file (\"how did you hear about us\")."}
        </Note>
      </section>
    </div>
  );
}
