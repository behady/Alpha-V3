"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Figure } from "@/components/reports/chartKit";
import { DataTable, MonthBars, Note, Num, SectionTitle, fmt, fmtPct } from "@/components/reports/reportKit";
import { ChartFrame } from "@/components/reports/chartKit";
import type { ReportProps } from "@/components/reports/types";
import { pnlByMonth, summarizeLedger, EXPENSE_CATEGORIES, type PnlMonth } from "@/lib/reports/ledgerStats";
import { categoryLabel } from "@/lib/expenseCategories";
import { monthLabel, monthLongLabel, trailingMonths } from "@/lib/reports/periods";
import { buildReportHtmlBase, htmlToPdfBlob } from "./reportPdfHtmlUtils";
import { useUI } from "@/context/UIContext";

/**
 * A profit and loss statement, the way an accountant would lay it out.
 *
 * Gross income, then what came off it in the order it comes off — lab, dentists' shares, the
 * clinic's own spending by category — then what was left and what share of the income that is.
 * The selected period is the statement; the twelve months underneath are the trend, because a
 * margin is only meaningful against the margins before it.
 */
export default function PnlReport({ ledger, range, rangeLabel, isAr, data }: ReportProps) {
  const { showToast } = useUI();
  const [exporting, setExporting] = useState(false);
  const period = useMemo(() => summarizeLedger(ledger), [ledger]);
  const periodExpenses = useMemo(() => pnlByMonth(ledger, [range.start.slice(0, 7), range.end.slice(0, 7)].filter((v, i, a) => a.indexOf(v) === i)), [ledger, range]);
  const periodByCategory = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of periodExpenses) for (const [k, v] of Object.entries(m.expensesByCategory)) out[k] = (out[k] || 0) + v;
    return out;
  }, [periodExpenses]);

  const { months } = useMemo(() => trailingMonths(range.end, 12), [range.end]);
  const trend = useMemo(() => pnlByMonth(data.ledgerMonths12 || [], months), [data.ledgerMonths12, months]);
  const withYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  const egp = isAr ? "ج.م" : "EGP";
  const margin = period.income > 0 ? (period.net / period.income) * 100 : null;
  const categories = useMemo(() => {
    const seen = new Set<string>(EXPENSE_CATEGORIES);
    trend.forEach((m) => Object.keys(m.expensesByCategory).forEach((k) => seen.add(k)));
    Object.keys(periodByCategory).forEach((k) => seen.add(k));
    return [...seen];
  }, [trend, periodByCategory]);

  const statement: { label: string; value: number; kind: "plus" | "minus" | "result" | "sub" }[] = [
    { label: isAr ? "إجمالي الدخل" : "Gross income", value: period.income, kind: "plus" },
    { label: isAr ? "مصاريف المعمل" : "Lab fees", value: -period.labFees, kind: "minus" },
    { label: isAr ? "هامش العلاج" : "Treatment margin", value: period.income - period.labFees, kind: "result" },
    // Owed to the dentists, not yet paid: it comes off when the owner pays them (a Salary expense).
    { label: isAr ? "منها نِسَب الأطباء المستحقة (تتخصم لما تتدفع)" : "of which dentists' commissions owed (come off when paid)", value: period.commissions, kind: "sub" },
    ...categories
      .filter((c) => (periodByCategory[c] || 0) > 0)
      .map((c) => ({ label: `${isAr ? "مصروفات" : "Expenses"} · ${categoryLabel(c, isAr)}`, value: -(periodByCategory[c] || 0), kind: "sub" as const })),
    { label: isAr ? "إجمالي المصروفات" : "Total expenses", value: -period.expenses, kind: "minus" },
    { label: isAr ? "صافي الربح" : "Net profit", value: period.net, kind: "result" },
  ];

  const exportPdf = async () => {
    setExporting(true);
    try {
      const align = isAr ? "right" : "left";
      const rows = statement
        .map(
          (s) => `<tr style="${s.kind === "result" ? "background:#f1f5f9;font-weight:800;" : ""}">
            <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;text-align:${align};${s.kind === "sub" ? "padding-inline-start:28px;color:#64748b;" : ""}">${s.label}</td>
            <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;${s.value < 0 && s.kind !== "result" ? "color:#64748b;" : ""}${s.kind === "result" && s.value < 0 ? "color:#C51F1F;" : ""}">${s.value < 0 ? `(${fmt(-s.value)})` : fmt(s.value)}</td>
          </tr>`,
        )
        .join("");
      const title = isAr ? "قائمة الأرباح والخسائر" : "Profit & Loss Statement";
      const html = buildReportHtmlBase(
        title,
        isAr ? "ar" : "en",
        `<div style="margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #e2e8f0;"><h1 style="margin:0 0 4px;font-size:22px;font-weight:800;color:#0f172a;">${title}</h1><p style="margin:0;font-size:13px;color:#64748b;">${rangeLabel}</p></div>
         <table style="width:100%;border-collapse:collapse;font-size:13px;"><tbody>${rows}</tbody></table>
         <p style="margin-top:14px;font-size:12px;color:#64748b;">${isAr ? "هامش الربح" : "Net margin"}: ${fmtPct(margin, 1)}</p>`,
      );
      const blob = await htmlToPdfBlob(html);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `PnL_${range.start}_${range.end}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      showToast(isAr ? "فشل إنشاء ملف PDF" : "Failed to generate PDF", "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(period.income)} ${egp}`} label={isAr ? "إجمالي الدخل" : "Gross income"} /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`(${fmt(period.labFees)}) ${egp}`} label={isAr ? "مصاريف المعمل" : "Lab fees"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`(${fmt(period.expenses)}) ${egp}`} label={isAr ? "المصروفات" : "Expenses"} tone="muted" /></div>
        <div className="rounded-2xl border border-line bg-surface p-4"><Figure value={`${fmt(period.net)} ${egp}`} label={`${isAr ? "صافي الربح" : "Net profit"} · ${fmtPct(margin, 1)}`} tone={period.net < 0 ? "bad" : "ink"} /></div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="text-sm font-black tracking-tight text-ink">{isAr ? "القائمة" : "The statement"}</h3>
            <p className="text-[11px] font-semibold text-ink-muted">{rangeLabel}</p>
          </div>
          <button type="button" onClick={exportPdf} disabled={exporting} className="inline-flex items-center gap-2 rounded-xl bg-ink-slab px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-ink-strong disabled:opacity-50">
            <Download size={15} />
            PDF
          </button>
        </div>
        <table className="w-full border-collapse">
          <tbody>
            {statement.map((s, i) => (
              <tr key={i} className={`border-t border-line ${s.kind === "result" ? "bg-surface-subtle" : ""}`}>
                <td className={`px-5 py-2.5 text-[13px] ${s.kind === "result" ? "font-black text-ink" : s.kind === "sub" ? "ps-10 font-medium text-ink-muted" : "font-semibold text-ink-body"}`}>{s.label}</td>
                <td className={`px-5 py-2.5 text-end font-figure text-[13.5px] ${s.kind === "result" ? `font-extrabold ${s.value < 0 ? "text-danger" : "text-ink"}` : s.value < 0 ? "text-ink-muted" : "font-bold text-ink"}`}>
                  {s.value < 0 && s.kind !== "result" ? `(${fmt(-s.value)})` : fmt(s.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <ChartFrame title={isAr ? "هامش الربح شهر بشهر" : "Net margin, month by month"} note={isAr ? "الصافي كنسبة من الدخل." : "Net as a share of income."}>
        <MonthBars isAr={isAr} data={trend.map((m) => ({ label: monthLabel(m.month, isAr, withYear), value: m.marginPct ?? 0 }))} fmtValue={(n) => `${n.toFixed(1)}%`} name={isAr ? "الهامش" : "Margin"} height={200} />
      </ChartFrame>

      <section>
        <SectionTitle>{isAr ? "١٢ شهر" : "Twelve months"}</SectionTitle>
        <DataTable<PnlMonth>
          isAr={isAr}
          rows={trend}
          rowKey={(m) => m.month}
          exportName="PnL_Monthly"
          dense
          columns={[
            { key: "month", label: isAr ? "الشهر" : "Month", render: (m) => <span className="whitespace-nowrap text-[13px] font-bold text-ink">{monthLongLabel(m.month, isAr)}</span>, exportValue: (m) => m.month },
            { key: "income", label: isAr ? "الدخل" : "Income", align: "end", render: (m) => <Num v={m.income} bold /> },
            { key: "labFees", label: isAr ? "المعمل" : "Lab", align: "end", render: (m) => <Num v={m.labFees} muted /> },
            { key: "commissions", label: isAr ? "النِسَب" : "Commissions", align: "end", render: (m) => <Num v={m.commissions} muted /> },
            ...categories.map((c) => ({ key: `cat:${c}`, label: categoryLabel(c, isAr), align: "end" as const, render: (m: PnlMonth) => <Num v={m.expensesByCategory[c] || 0} muted format={(n) => (n === 0 ? "—" : fmt(n))} />, exportValue: (m: PnlMonth) => m.expensesByCategory[c] || 0 })),
            { key: "net", label: isAr ? "الصافي" : "Net", align: "end", render: (m) => <Num v={m.net} bold bad={m.net < 0} /> },
            { key: "marginPct", label: isAr ? "الهامش" : "Margin", align: "end", render: (m) => <span className={`font-figure text-[12.5px] ${m.marginPct !== null && m.marginPct < 0 ? "text-danger" : "text-ink-body"}`}>{fmtPct(m.marginPct, 1)}</span>, exportValue: (m) => m.marginPct ?? "" },
          ]}
        />
        <Note>
          {isAr
            ? "الدخل = الفلوس اللي دخلت فعلاً. النِسَب من الدفعات، المعمل من العلاجات، المصروفات من صفحة المالية بتصنيفها. مرتبات الموظفين تظهر هنا لو اتسجلت كمصروف «Salary»."
            : "Income is cash actually received. Commissions come off payments, lab fees off treatments, expenses off the Finance page by their category. Staff salaries appear here only if they were recorded as a \"Salary\" expense."}
        </Note>
      </section>
    </div>
  );
}
