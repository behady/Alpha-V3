"use client";

import { useMemo } from "react";
import { Bars, ChartFrame, Figure, INK, MARK } from "@/components/reports/chartKit";
import { DataTable, Note, Num, SectionTitle, fmt } from "@/components/reports/reportKit";
import type { ReportProps } from "@/components/reports/types";
import { paymentMethods, type MethodDay, type PaymentMethod } from "@/lib/reports/ledgerStats";
import { dayText } from "@/lib/reportHelpers";

/**
 * How the money arrived: the drawer against the bank.
 *
 * One row per day, one column per method, so the desk can reconcile the cash box and the card
 * terminal against what the system says came in. The stored method is free text and three screens
 * spell it three ways; it is folded into five here (lib/reports/ledgerStats.normalizeMethod).
 */
export default function PaymentMethodsReport({ payments, isAr }: ReportProps) {
  const report = useMemo(() => paymentMethods(payments), [payments]);
  const egp = isAr ? "ج.م" : "EGP";
  const label = (m: PaymentMethod) => (isAr ? { Cash: "كاش", Card: "فيزا / كارت", InstaPay: "إنستاباي", Insurance: "تأمين", Other: "أخرى" }[m] : m);
  const grand = report.totals.reduce((s, t) => s + t.total, 0);
  const cash = report.totals.find((t) => t.method === "Cash");
  const methods: PaymentMethod[] = ["Cash", "Card", "InstaPay", "Insurance", "Other"];
  const used = methods.filter((m) => report.totals.some((t) => t.method === m && t.total > 0));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(grand)} ${egp}`} label={isAr ? "إجمالي المحصّل" : "Total collected"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(cash?.total || 0)} ${egp}`} label={isAr ? `كاش · ${cash?.share ?? 0}%` : `Cash · ${cash?.share ?? 0}%`} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(grand - (cash?.total || 0))} ${egp}`} label={isAr ? "غير كاش" : "Non-cash"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={String(report.totals.reduce((s, t) => s + t.count, 0))} label={isAr ? "عدد الدفعات" : "Payments"} tone="muted" /></div>
      </div>

      <ChartFrame title={isAr ? "حسب طريقة الدفع" : "By method"}>
        <Bars rows={report.totals.map((t, i) => ({ label: `${label(t.method)} · ${t.count}`, value: t.total, text: `${fmt(t.total)} ${egp} · ${t.share}%`, color: i === 0 ? MARK : INK }))} />
      </ChartFrame>

      <section>
        <SectionTitle>{isAr ? "يوم بيوم" : "Day by day"}</SectionTitle>
        <DataTable<MethodDay>
          isAr={isAr}
          rows={report.byDay}
          rowKey={(d) => d.date}
          exportName="Payment_Methods_Daily"
          dense
          columns={[
            { key: "date", label: isAr ? "اليوم" : "Day", render: (d) => <span className="whitespace-nowrap text-[13px] font-bold text-ink">{dayText(d.date, isAr)}</span>, exportValue: (d) => d.date },
            ...used.map((m) => ({
              key: m,
              label: label(m),
              align: "end" as const,
              render: (d: MethodDay) => <Num v={d.byMethod[m]} muted={d.byMethod[m] === 0} format={(n) => (n === 0 ? "—" : fmt(n))} />,
              exportValue: (d: MethodDay) => d.byMethod[m],
              total: <Num v={report.totals.find((t) => t.method === m)?.total || 0} bold />,
            })),
            { key: "total", label: isAr ? "الإجمالي" : "Total", align: "end", render: (d) => <Num v={d.total} bold />, total: <Num v={grand} bold /> },
          ]}
        />
        <Note>
          {isAr
            ? "«فيزا» و«كارت» طريقة واحدة، و«إنستاباي» بكل كتاباتها واحدة. الدفعات اللي مكتوب عليهاش طريقة بتتحسب كاش، لأن ده اللي الشاشة بتفترضه."
            : "\"Visa\" and \"Card\" are one method, and every spelling of InstaPay is one. A payment with no method recorded counts as cash, because that is what the payment screen assumes."}
        </Note>
      </section>
    </div>
  );
}
