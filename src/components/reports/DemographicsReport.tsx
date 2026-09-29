"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, SectionTitle, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { demographics, type PatientDoc } from "@/lib/reports/patientStats";

/**
 * Who the patients are: age and gender, and what each group comes in for.
 *
 * Built from the patient file's date of birth and gender. The "?" band is patients with neither
 * recorded, and it is shown rather than hidden, because a clinic where half the files have no
 * birthday has a data-entry problem before it has a marketing one.
 */
export default function DemographicsReport({ allPatients, ledger, range, isAr, today }: ReportProps) {
  const d = useMemo(() => demographics(allPatients as PatientDoc[], ledger, range, today), [allPatients, ledger, range, today]);
  const egp = isAr ? "ج.م" : "EGP";
  const bandLabel = (b: string) => (b === "?" ? (isAr ? "غير معروف" : "Unknown") : b === "60+" ? (isAr ? "٦٠+" : "60+") : b);
  const genderLabel = (g: string) => (isAr ? { Male: "ذكور", Female: "إناث", "?": "غير محدد" }[g] || g : g === "?" ? "Unknown" : g);
  const known = d.bands.filter((b) => b.band !== "?");
  const biggest = known.reduce((a, b) => (b.count > a.count ? b : a), known[0]);
  const unknownPct = d.total ? Math.round(((d.total - d.known) / d.total) * 100) : 0;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(d.total)} label={isAr ? "إجمالي المرضى" : "Patients on file"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={d.averageAge === null ? "—" : String(d.averageAge)} label={isAr ? "متوسط العمر" : "Average age"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={biggest ? bandLabel(biggest.band) : "—"} label={isAr ? "أكبر شريحة عمرية" : "Largest age band"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${unknownPct}%`} label={isAr ? "من غير تاريخ ميلاد" : "without a birthday"} tone={unknownPct > 40 ? "bad" : "muted"} /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "حسب العمر" : "By age"} note={isAr ? `${d.newInPeriod} ملف جديد في الفترة دي.` : `${d.newInPeriod} new files in this period.`}>
          <Bars rows={d.bands.map((b) => ({ label: bandLabel(b.band), value: b.count, text: `${b.count}${b.newCount ? ` · +${b.newCount}` : ""}`, color: biggest && b.band === biggest.band ? MARK : b.band === "?" ? "#CBD5E1" : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "حسب النوع" : "By gender"} note={isAr ? "العدد، وفلوسهم في الفترة." : "How many, and what they paid in the period."}>
          <Bars rows={d.gender.map((g, i) => ({ label: genderLabel(g.gender), value: g.count, text: `${g.count} · ${fmt(g.paid)} ${egp}`, color: i === 0 ? MARK : g.gender === "?" ? "#CBD5E1" : INK }))} />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? "كل شريحة، وبتيجي ليه" : "Each band, and what it comes in for"}</SectionTitle>
        <DataTable
          isAr={isAr}
          rows={d.bands}
          rowKey={(b) => b.band}
          exportName="Demographics"
          dense
          columns={[
            { key: "band", label: isAr ? "العمر" : "Age", render: (b) => <span className="text-[13px] font-bold text-ink">{bandLabel(b.band)}</span>, exportValue: (b) => bandLabel(b.band) },
            { key: "count", label: isAr ? "المرضى" : "Patients", align: "end", render: (b) => <Num v={b.count} bold />, total: <Num v={d.total} bold /> },
            { key: "newCount", label: isAr ? "جديد في الفترة" : "New this period", align: "end", render: (b) => <Num v={b.newCount} />, total: <Num v={d.newInPeriod} /> },
            { key: "female", label: isAr ? "إناث" : "Female", align: "end", render: (b) => <Num v={b.female} muted /> },
            { key: "male", label: isAr ? "ذكور" : "Male", align: "end", render: (b) => <Num v={b.male} muted /> },
            { key: "paid", label: isAr ? "دفعوا في الفترة" : "Paid this period", align: "end", render: (b) => <Num v={b.paid} bold /> },
            { key: "topServices", label: isAr ? "أكتر العلاجات" : "Top treatments", render: (b) => <span className="text-[12px] text-ink-body">{b.topServices.map((s) => `${s.name} (${s.count})`).join(", ") || "—"}</span>, exportValue: (b) => b.topServices.map((s) => `${s.name} (${s.count})`).join(", ") },
          ]}
        />
        <Note>
          {isAr
            ? "العمر من تاريخ الميلاد في ملف المريض. الملف اللي مفيهوش تاريخ ميلاد ولا نوع بيظهر في «غير معروف»؛ ضيف البيانات دي من صفحة المريض."
            : "Age is from the date of birth on the patient file. Files with no birthday or gender show under Unknown; add them from the patient page."}
        </Note>
      </section>
    </div>
  );
}
