"use client";

import { useMemo, useRef, useState } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Download, FileBarChart, Stethoscope, FileSpreadsheet } from "lucide-react";
import { exportToExcel, CHART_COLORS, parseMoney } from "./reportExcelUtils";
import { htmlToPdfBlob, buildReportHtmlBase } from "./reportPdfHtmlUtils";
import { ledgerCashValue } from "@/lib/reportHelpers";
import { useUI } from "@/context/UIContext";
import { attributeService, buildProcedureIndex, type AttributableRow } from "@/lib/serviceAttribution";

interface ServiceStat {
  name: string;
  count: number;
  income: number;
  commission: number;
  labFee: number;
  netIncome: number;
}

interface Props {
  procedures: Record<string, unknown>[];
  payments?: Record<string, unknown>[];
  rangeLabel: string;
  isAr: boolean;
}

export default function ServiceReport({ procedures, payments, rangeLabel, isAr }: Props) {
  const { showToast } = useUI();
  const chartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const stats: ServiceStat[] = useMemo(() => {
    const map: Record<string, { name: string; count: number; income: number; commission: number; labFee: number }> = {};
    
    // Grouped on the catalogue id when the row carries one — see lib/serviceAttribution for why
    // reading the description was never a safe way to answer "how much did crowns earn".
    const procedureIndex = buildProcedureIndex(procedures);
    const bucket = (row: AttributableRow) => {
      const { key, name } = attributeService(row, procedureIndex);
      if (!map[key]) map[key] = { name, count: 0, income: 0, commission: 0, labFee: 0 };
      return map[key];
    };

    // 1. Procedures for Counts and Lab Fees
    procedures.forEach((proc) => {
      const row = bucket(proc);
      row.count += 1;
      row.labFee += parseMoney(proc.labFee);
    });

    // 2. Payments for Cash Income and Doctor Commissions
    payments?.forEach((pay) => {
      if (pay.type === "expense") return;
      const row = bucket(pay);
      row.income += ledgerCashValue(pay);
      row.commission += parseMoney(pay.doctorCommissionAmount);
    });

    return Object.values(map)
      .map((d) => ({
        name: d.name,
        count: d.count,
        income: d.income,
        commission: d.commission,
        labFee: d.labFee,
        netIncome: d.income - d.commission - d.labFee,
      }))
      .sort((a, b) => b.income - a.income);
  }, [procedures, payments]);

  const totalCount = stats.reduce((s, r) => s + r.count, 0);
  const totalIncome = stats.reduce((s, r) => s + r.income, 0);
  const totalNet = stats.reduce((s, r) => s + r.netIncome, 0);
  const totalCommission = stats.reduce((s, r) => s + r.commission, 0);

  const pieData = stats.slice(0, 8).map((s) => ({ name: s.name, value: s.income }));

  const handleExcelExport = () => {
    setExporting(true);
    try {
      const exportData = stats.map(s => ({
        [isAr ? "الخدمة" : "Service"]: s.name,
        [isAr ? "العدد" : "Count"]: s.count,
        [isAr ? "الدخل (ج.م)" : "Income (EGP)"]: s.income,
        [isAr ? "العمولة" : "Commission"]: s.commission,
        [isAr ? "صافي الدخل" : "Net Income"]: s.netIncome,
      }));

      // Add a totals row
      exportData.push({
        [isAr ? "الخدمة" : "Service"]: isAr ? "الإجمالي" : "TOTAL",
        [isAr ? "العدد" : "Count"]: totalCount,
        [isAr ? "الدخل (ج.م)" : "Income (EGP)"]: totalIncome,
        [isAr ? "العمولة" : "Commission"]: totalCommission,
        [isAr ? "صافي الدخل" : "Net Income"]: totalNet,
      });

      exportToExcel(
        exportData, 
        `Service_Report_${new Date().toISOString().slice(0, 10)}`,
        isAr
      );
    } catch (err) { 
      console.error(err);
    } finally {
      setExporting(false);
    }
  };

  const handlePdfExport = async () => {
    setExporting(true);
    try {
      const rowsHtml = stats.map(s => `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700;">${s.name}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'};">${s.count}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700; color: #059669;">${s.income.toLocaleString()}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; color: #ea580c;">${s.commission.toLocaleString()}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700; color: #2563eb;">${s.netIncome.toLocaleString()}</td>
        </tr>
      `).join("");

      const totalsHtml = `
        <tr style="background: #f1f5f9; font-weight: 800;">
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الإجمالي" : "TOTAL"}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'};">${totalCount}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'}; color: #059669;">${totalIncome.toLocaleString()}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'}; color: #ea580c;">${totalCommission.toLocaleString()}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'}; color: #2563eb;">${totalNet.toLocaleString()}</td>
        </tr>
      `;

      const tableHtml = `
        <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الخدمة" : "Service"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "العدد" : "Count"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الدخل (ج.م)" : "Income (EGP)"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "العمولة" : "Commission"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "صافي الدخل" : "Net Income"}</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
              ${totalsHtml}
            </tbody>
          </table>
        </div>
      `;

      const kpiHtml = `
        <div style="display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "إجمالي الدخل" : "Total Income"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #059669;">${totalIncome.toLocaleString()} EGP</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "عمولات الأطباء" : "Doctor Commissions"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #ea580c;">${totalCommission.toLocaleString()} EGP</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "صافي الدخل" : "Net Income"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #2563eb;">${totalNet.toLocaleString()} EGP</div>
          </div>
        </div>
      `;

      const title = isAr ? "تقرير الخدمات المالية" : "Service Financial Report";
      const headerHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e2e8f0;">
          <div>
            <h1 style="margin: 0 0 4px 0; font-size: 24px; font-weight: 800; color: #0f172a;">${title}</h1>
            <p style="margin: 0; font-size: 14px; color: #64748b;">${rangeLabel}</p>
          </div>
        </div>
      `;

      const fullHtml = buildReportHtmlBase(title, isAr ? "ar" : "en", headerHtml + kpiHtml + tableHtml);
      const blob = await htmlToPdfBlob(fullHtml);
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Service_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("PDF generation failed:", e);
      showToast(isAr ? "فشل إنشاء ملف PDF" : "Failed to generate PDF", "error");
    } finally {
      setExporting(false);
    }
  };

  if (procedures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Stethoscope size={40} className="mb-3 opacity-30" />
        <p className="font-bold text-slate-500">{isAr ? "لا توجد إجراءات في هذه الفترة" : "No procedures in this period"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: isAr ? "إجمالي الإجراءات" : "Total Services", value: totalCount.toString(), color: "text-blue-600" },
          { label: isAr ? "إجمالي الدخل" : "Total Income", value: `${totalIncome.toLocaleString()} EGP`, color: "text-emerald-600" },
          { label: isAr ? "العمولات" : "Commissions", value: `(${totalCommission.toLocaleString()}) EGP`, color: "text-amber-600" },
          { label: isAr ? "صافي الدخل" : "Net Income", value: `${totalNet.toLocaleString()} EGP`, color: "text-slate-900" },
        ].map((k) => (
          <div key={k.label} className="bg-white border border-slate-200 shadow-sm rounded-2xl p-4 flex flex-col gap-1">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">{k.label}</p>
            <p className={`text-xl font-black tabular-nums ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Chart + Table */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Pie Chart */}
        <div className="xl:col-span-5 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-black text-slate-900 mb-4">
            {isAr ? "توزيع الدخل حسب الخدمة" : "Income by Service"}
          </h3>
          <div ref={chartRef}>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={95}
                  paddingAngle={4}
                  cornerRadius={8}
                  stroke="none"
                  dataKey="value"
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`${Number(v || 0).toLocaleString()} EGP`, isAr ? "الدخل" : "Income"]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Table */}
        <div className="xl:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
            <h3 className="text-sm font-black text-slate-900">{isAr ? "تفاصيل الخدمات" : "Service Breakdown"}</h3>
            <div className="flex items-center gap-2">
            <button
              data-tour="reports-export-pdf" onClick={handlePdfExport}
              disabled={exporting}
              className="px-4 py-2 bg-slate-800 text-white text-sm font-bold rounded-xl hover:bg-slate-900 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Download size={16} />
              {exporting ? (isAr ? "جاري التصدير..." : "Exporting...") : "PDF"}
            </button>
            <button
              onClick={handleExcelExport}
              disabled={exporting}
              className="px-4 py-2 bg-emerald-600 text-white text-sm font-bold rounded-xl hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <FileSpreadsheet size={16} />
              Excel
            </button>
          </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-500">
                  <th className="text-start py-3 px-4">{isAr ? "الخدمة" : "Service"}</th>
                  <th className="text-center py-3 px-3">{isAr ? "العدد" : "Count"}</th>
                  <th className="text-end py-3 px-4">{isAr ? "الدخل" : "Income"}</th>
                  <th className="text-end py-3 px-4">{isAr ? "العمولة" : "Comm."}</th>
                  <th className="text-end py-3 px-4">{isAr ? "الصافي" : "Net"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {stats.map((s, i) => (
                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="font-semibold text-slate-800 text-xs">{s.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-black">{s.count}</span>
                    </td>
                    <td className="py-3 px-4 text-end font-bold text-emerald-600 tabular-nums text-xs">{s.income.toLocaleString()}</td>
                    <td className="py-3 px-4 text-end text-amber-600 tabular-nums text-xs">({s.commission.toLocaleString()})</td>
                    <td className="py-3 px-4 text-end font-black text-slate-900 tabular-nums text-xs">{s.netIncome.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-ink-strong text-white text-xs font-black">
                  <td className="py-3 px-4">{isAr ? "الإجمالي" : "TOTAL"}</td>
                  <td className="py-3 px-3 text-center">{totalCount}</td>
                  <td className="py-3 px-4 text-end tabular-nums">{totalIncome.toLocaleString()}</td>
                  <td className="py-3 px-4 text-end tabular-nums">({totalCommission.toLocaleString()})</td>
                  <td className="py-3 px-4 text-end tabular-nums">{totalNet.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* Export hint */}
      <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
        <FileBarChart size={14} />
        <span>{isAr ? "اضغط على زر Excel لتصدير هذا التقرير كجدول بيانات." : "Click the Excel button above to export this report as a spreadsheet."}</span>
      </div>
    </div>
  );
}
