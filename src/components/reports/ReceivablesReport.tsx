"use client";

import { useMemo, useState } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, PatientLink, Phone, SectionTitle, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { receivables, type AgeBucket, type ReceivableLine, type PayerReceivable } from "@/lib/reports/receivables";
import { dayText } from "@/lib/reportHelpers";
import InsurerBadge from "@/components/shared/InsurerBadge";

/**
 * Outstanding balances, aged.
 *
 * Built off the whole ledger, not the period — a debt from March is still a debt in September.
 * The buckets are the ones a desk actually works: this month's, last month's, the one before,
 * and the ones that have become a phone call nobody wants to make. Click a bucket to see who is
 * in it. The insurance table underneath is the same money seen from the payer's side.
 */
export default function ReceivablesReport({ allPatients, isAr, data, today }: ReportProps) {
  const report = useMemo(() => receivables(data.ledgerAll || [], allPatients as { id: string; name?: string; phone?: string; whatsappOptOut?: unknown }[], today), [data.ledgerAll, allPatients, today]);
  const [bucket, setBucket] = useState<AgeBucket | "">("");
  const shown = bucket ? report.lines.filter((l) => l.bucket === bucket) : report.lines;
  const egp = isAr ? "ج.م" : "EGP";
  const bucketLabel = (b: AgeBucket) => (isAr ? { "0-30": "٠–٣٠ يوم", "31-60": "٣١–٦٠ يوم", "61-90": "٦١–٩٠ يوم", "90+": "أكتر من ٩٠ يوم" }[b] : `${b} days`);
  const worst = report.aging.reduce((a, b) => (b.total > a.total ? b : a), report.aging[0]);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(report.totals.balance)} ${egp}`} label={isAr ? "إجمالي المستحق" : "Outstanding"} tone={report.totals.balance > 0 ? "bad" : "ink"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(report.totals.patients)} label={isAr ? "مريض عليهم فلوس" : "Patients owing"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(report.aging[3].total)} ${egp}`} label={isAr ? "أكتر من ٩٠ يوم" : "Over 90 days"} tone={report.aging[3].total > 0 ? "bad" : "muted"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(report.totals.credits)} ${egp}`} label={isAr ? `رصيد دائن (${report.totals.creditPatients})` : `Credit balances (${report.totals.creditPatients})`} tone="muted" /></div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ChartFrame title={isAr ? "حسب العمر" : "By age"} note={isAr ? "اضغط شريحة لعرض أصحابها." : "Click a bucket to see who is in it."}>
          <div className="flex flex-col gap-2.5">
            {report.aging.map((a) => (
              <button key={a.bucket} type="button" onClick={() => setBucket(bucket === a.bucket ? "" : a.bucket)} className={`rounded-lg px-1 text-start transition-colors ${bucket === a.bucket ? "bg-surface-subtle" : "hover:bg-surface-subtle"}`}>
                <Bars rows={[{ label: `${bucketLabel(a.bucket)} · ${a.count}`, value: a.total, text: `${fmt(a.total)} ${egp}`, color: a.bucket === "90+" && a.total > 0 ? "#C51F1F" : a.bucket === worst.bucket ? MARK : INK }]} max={Math.max(1, ...report.aging.map((x) => x.total))} />
              </button>
            ))}
          </div>
        </ChartFrame>
        <section>
          <SectionTitle>{isAr ? "حسب جهة الدفع" : "By payer"}</SectionTitle>
          <DataTable<PayerReceivable>
            isAr={isAr}
            rows={report.byPayer.filter((p) => p.charged > 0)}
            rowKey={(p) => p.payerId}
            dense
            columns={[
              { key: "payerName", label: isAr ? "الجهة" : "Payer", render: (p) => <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink"><InsurerBadge name={p.payerName} isPrivate={p.isPrivate} size={18} />{p.payerName}</span> },
              { key: "charged", label: isAr ? "المطلوب" : "Charged", align: "end", render: (p) => <Num v={p.charged} muted /> },
              { key: "collected", label: isAr ? "المحصّل" : "Collected", align: "end", render: (p) => <Num v={p.collected} /> },
              { key: "balance", label: isAr ? "الباقي" : "Owed", align: "end", render: (p) => <Num v={p.balance} bold bad={p.balance > 0} /> },
            ]}
          />
          <Note>{isAr ? "الشغل اللي على التأمين بيتحصّل بعدين؛ الفرق هنا هو اللي لسه مجاش من الشركة." : "Insurance work is paid later; the gap here is what the insurer has not yet sent."}</Note>
        </section>
      </div>

      <section>
        <SectionTitle aside={bucket && <button type="button" onClick={() => setBucket("")} className="text-[11.5px] font-black text-ink-faint hover:text-ink">{isAr ? "الكل" : "Show all"}</button>}>
          {bucket ? `${bucketLabel(bucket)} (${shown.length})` : isAr ? `كل المستحقات (${report.lines.length})` : `Everyone who owes (${report.lines.length})`}
        </SectionTitle>
        <DataTable<ReceivableLine>
          isAr={isAr}
          rows={shown}
          rowKey={(l) => l.patientId}
          exportName={`Receivables${bucket ? `_${bucket}` : ""}`}
          maxRows={25}
          columns={[
            { key: "patientName", label: isAr ? "المريض" : "Patient", render: (l) => (<div><PatientLink id={l.patientId} name={l.patientName} isAr={isAr} />{l.whatsappOptOut && <span className="ms-2 rounded-full bg-surface-muted px-1.5 py-0.5 text-[9.5px] font-black text-ink-body">{isAr ? "اتصل" : "call only"}</span>}</div>) },
            { key: "phone", label: isAr ? "الهاتف" : "Phone", render: (l) => <Phone value={l.phone} /> },
            { key: "oldestUnpaid", label: isAr ? "من تاريخ" : "Since", render: (l) => <span className="whitespace-nowrap font-figure text-ink-faint">{l.oldestUnpaid ? dayText(l.oldestUnpaid, isAr) : "—"}</span> },
            { key: "ageDays", label: isAr ? "الأيام" : "Days", align: "end", render: (l) => <Num v={l.ageDays} bad={l.ageDays > 90} /> },
            { key: "payers", label: isAr ? "الجهة" : "Payer", render: (l) => <span className="text-[12px] text-ink-muted">{l.payers.join(", ") || "—"}</span>, exportValue: (l) => l.payers.join(", ") },
            { key: "charged", label: isAr ? "المطلوب" : "Charged", align: "end", render: (l) => <Num v={l.charged} muted /> },
            { key: "paid", label: isAr ? "المدفوع" : "Paid", align: "end", render: (l) => <Num v={l.paid} /> },
            { key: "balance", label: isAr ? "الباقي" : "Owed", align: "end", render: (l) => <Num v={l.balance} bold bad />, total: <Num v={shown.reduce((s, l) => s + l.balance, 0)} bold bad /> },
          ]}
        />
        <Note>
          {isAr
            ? "الرصيد = كل اللي اتحسب على المريض ناقص كل اللي دفعه، بما فيه الدفعات المقدّمة — نفس حساب شاشة تحصيل المستحقات. العمر من أقدم علاج مغطّاش. حسابات دائنة (المريض دافع زيادة) مستثناة من القائمة ومذكورة فوق."
            : "Balance = everything charged to the patient minus everything they paid, advances included — the same arithmetic as the Collect Dues screen. Age counts from the oldest treatment the payments did not cover. Credit balances (the patient paid ahead) are left out of the list and shown above."}
        </Note>
      </section>
    </div>
  );
}
