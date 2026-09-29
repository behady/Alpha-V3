"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, PatientLink, SectionTitle, fmt, fmtPct } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { discountLines, groupTotals, summarizeLedger, type DiscountLine } from "@/lib/reports/ledgerStats";
import { dayText } from "@/lib/reportHelpers";

/**
 * What was given away, by whom, on what, and why.
 *
 * A discount is a decision somebody made at the desk. Per dentist it shows who is generous; per
 * service it shows which price list is wrong; the reasons column shows whether anybody wrote one.
 * Every line names the patient, because "10% for a friend" is a policy only if the owner knows
 * about it.
 */
export default function DiscountsReport({ ledger, isAr }: ReportProps) {
  const lines = useMemo(() => discountLines(ledger, isAr ? "غير محدد" : "Unassigned"), [ledger, isAr]);
  const period = useMemo(() => summarizeLedger(ledger), [ledger]);
  const byDoctor = useMemo(() => groupTotals(lines, (l) => l.doctor, (l) => l.discount), [lines]);
  const byService = useMemo(() => groupTotals(lines, (l) => l.service, (l) => l.discount), [lines]);
  const byReason = useMemo(() => groupTotals(lines, (l) => l.reason || (isAr ? "بدون سبب" : "No reason given"), (l) => l.discount), [lines, isAr]);
  const egp = isAr ? "ج.م" : "EGP";
  const total = lines.reduce((s, l) => s + l.discount, 0);
  const listTotal = period.charged + total;
  const share = listTotal > 0 ? (total / listTotal) * 100 : null;
  const noReason = lines.filter((l) => !l.reason).length;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(total)} ${egp}`} label={isAr ? "إجمالي الخصومات" : "Total discounted"} tone={total > 0 ? "bad" : "ink"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={fmtPct(share, 1)} label={isAr ? "من سعر القائمة" : "of list price"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${lines.length} / ${period.procedures}`} label={isAr ? "علاجات فيها خصم" : "Treatments discounted"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(noReason)} label={isAr ? "خصم من غير سبب" : "Without a reason"} tone={noReason > 0 ? "bad" : "muted"} /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <ChartFrame title={isAr ? "حسب الدكتور" : "By dentist"}>
          <Bars rows={byDoctor.map((g, i) => ({ label: `${g.name} · ${g.count}`, value: g.total, text: `${fmt(g.total)} ${egp}`, color: i === 0 ? MARK : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "حسب الخدمة" : "By service"}>
          <Bars rows={byService.slice(0, 8).map((g, i) => ({ label: `${g.name} · ${g.count}`, value: g.total, text: `${fmt(g.total)} ${egp}`, color: i === 0 ? MARK : INK }))} />
        </ChartFrame>
        <ChartFrame title={isAr ? "حسب السبب" : "By reason"}>
          <Bars rows={byReason.slice(0, 8).map((g, i) => ({ label: `${g.name} · ${g.count}`, value: g.total, text: `${fmt(g.total)} ${egp}`, color: i === 0 ? MARK : INK }))} />
        </ChartFrame>
      </div>

      <section>
        <SectionTitle>{isAr ? "كل خصم" : "Every discount"}</SectionTitle>
        <DataTable<DiscountLine>
          isAr={isAr}
          rows={lines}
          rowKey={(l) => l.id}
          exportName="Discounts"
          maxRows={25}
          columns={[
            { key: "date", label: isAr ? "التاريخ" : "Date", render: (l) => <span className="whitespace-nowrap font-figure text-ink-faint">{l.date ? dayText(l.date, isAr) : "—"}</span>, exportValue: (l) => l.date },
            { key: "patientName", label: isAr ? "المريض" : "Patient", render: (l) => <PatientLink id={l.patientId} name={l.patientName} isAr={isAr} /> },
            { key: "service", label: isAr ? "الخدمة" : "Service" },
            { key: "doctor", label: isAr ? "الدكتور" : "Dentist" },
            { key: "listPrice", label: isAr ? "السعر" : "List", align: "end", render: (l) => <Num v={l.listPrice} muted /> },
            { key: "discount", label: isAr ? "الخصم" : "Discount", align: "end", render: (l) => <Num v={l.discount} bold bad />, total: <Num v={total} bold bad /> },
            { key: "pct", label: "%", align: "end", render: (l) => <span className="font-figure text-[12px] text-ink-muted">{l.pct}%</span> },
            { key: "price", label: isAr ? "بعد الخصم" : "Charged", align: "end", render: (l) => <Num v={l.price} /> },
            { key: "reason", label: isAr ? "السبب" : "Reason", render: (l) => (l.reason ? <span className="line-clamp-1 text-[12px]">{l.reason}</span> : <span className="text-[11px] font-bold text-danger">{isAr ? "—" : "—"}</span>) },
          ]}
        />
        <Note>
          {isAr
            ? "الخصم هو الفرق بين سعر القائمة وسعر العلاج المسجّل. العلاجات اللي اتسجلت قبل ما الخصومات تبقى حقل مستقل مش هتظهر هنا."
            : "A discount is the gap between the list price and what the treatment was recorded at. Treatments recorded before discounts became their own field cannot appear here."}
        </Note>
      </section>
    </div>
  );
}
