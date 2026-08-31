"use client";

import { useMemo, useRef, useState } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { Download, UserCheck, FileBarChart, FileSpreadsheet } from "lucide-react";
import { exportToExcel, CHART_COLORS, parseMoney } from "./reportExcelUtils";
import { ledgerCashValue } from "@/lib/reportHelpers";
import { htmlToPdfBlob, buildReportHtmlBase } from "./reportPdfHtmlUtils";
import { useUI } from "@/context/UIContext";
import Protect from "@/components/Protect";

interface ProcStat { name: string; count: number; income: number; }

interface DentistStat {
  name: string;
  procedures: ProcStat[];
  totalIncome: number;
  commission: number;
  labFee: number;
  netToClinic: number;
}

interface Props {
  procedures: Record<string, unknown>[];
  payments?: Record<string, unknown>[];
  rangeLabel: string;
  isAr: boolean;
}

export default function DentistReport({ procedures, payments, rangeLabel, isAr }: Props) {
  const { showToast } = useUI();
  const chartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedDentist, setSelectedDentist] = useState<string>("");

  const stats: DentistStat[] = useMemo(() => {
    const map: Record<string, { procedures: Record<string, { count: number; income: number }>; commission: number; labFee: number; income: number }> = {};
    
    // 1. Procedures for Counts and Lab Fees
    procedures.forEach((proc) => {
      const doc = String(proc.doctor || proc.doctorName || "Unassigned").replace(/^Dr\.?\s*/i, "").trim() || "Unassigned";
      if (!map[doc]) map[doc] = { procedures: {}, commission: 0, labFee: 0, income: 0 };
      const svc = String(proc.description || proc.procedure || "General").split("(")[0].trim() || "General";
      if (!map[doc].procedures[svc]) map[doc].procedures[svc] = { count: 0, income: 0 };
      
      map[doc].procedures[svc].count += 1;
      map[doc].labFee += parseMoney(proc.labFee);
    });

    // 2. Payments for Cash Income and Doctor Commissions
    payments?.forEach((pay) => {
      if (pay.type === "expense") return;
      const doc = String(pay.doctor || pay.doctorName || "Unassigned").replace(/^Dr\.?\s*/i, "").trim() || "Unassigned";
      if (!map[doc]) map[doc] = { procedures: {}, commission: 0, labFee: 0, income: 0 };

      let svc = "General";
      const desc = String(pay.description || "");
      if (desc.includes("Payment for ")) {
        svc = desc.replace("Payment for ", "").split("(")[0].trim();
      } else if (desc.includes("دفعة مقابل ")) {
        svc = desc.replace("دفعة مقابل ", "").split("(")[0].trim();
      } else if (pay.procedureName) {
        svc = String(pay.procedureName).split("(")[0].trim();
      } else if (pay.category === "Treatment" && desc) {
        svc = desc.split("(")[0].trim() || "General";
      }

      if (!map[doc].procedures[svc]) map[doc].procedures[svc] = { count: 0, income: 0 };

      const inc = ledgerCashValue(pay);
      map[doc].procedures[svc].income += inc;
      map[doc].income += inc;
      map[doc].commission += parseMoney(pay.doctorCommissionAmount);
    });

    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        procedures: Object.entries(d.procedures)
          .map(([svc, s]) => ({ name: svc, count: s.count, income: s.income }))
          .sort((a, b) => b.count - a.count),
        totalIncome: d.income,
        commission: d.commission,
        labFee: d.labFee,
        netToClinic: d.income - d.commission - d.labFee,
      }))
      .sort((a, b) => b.totalIncome - a.totalIncome);
  }, [procedures, payments]);

  const activeDentist = stats.find((s) => s.name === selectedDentist) || stats[0];
  const dentistNames = stats.map((s) => s.name);

  const handleExcelExport = () => {
    setExporting(true);
    try {
      const exportData = stats.map(s => ({
        [isAr ? "الطبيب" : "Dentist"]: `Dr. ${s.name}`,
        [isAr ? "عدد الإجراءات" : "Procedures"]: s.procedures.reduce((acc, p) => acc + p.count, 0),
        [isAr ? "إجمالي الدخل" : "Total Income (EGP)"]: s.totalIncome,
        [isAr ? "العمولة" : "Commission"]: s.commission,
        [isAr ? "مصاريف المعمل" : "Lab Fee"]: s.labFee,
        [isAr ? "صافي العيادة" : "Net to Clinic"]: s.netToClinic,
      }));

      // Add a totals row
      const totalProcs = stats.reduce((acc, s) => acc + s.procedures.reduce((acc2, p) => acc2 + p.count, 0), 0);
      const totalIncome = stats.reduce((acc, s) => acc + s.totalIncome, 0);
      const totalComm = stats.reduce((acc, s) => acc + s.commission, 0);
      const totalLab = stats.reduce((acc, s) => acc + s.labFee, 0);
      const totalNet = stats.reduce((acc, s) => acc + s.netToClinic, 0);

      exportData.push({
        [isAr ? "الطبيب" : "Dentist"]: isAr ? "الإجمالي" : "TOTAL",
        [isAr ? "عدد الإجراءات" : "Procedures"]: totalProcs,
        [isAr ? "إجمالي الدخل" : "Total Income (EGP)"]: totalIncome,
        [isAr ? "العمولة" : "Commission"]: totalComm,
        [isAr ? "مصاريف المعمل" : "Lab Fee"]: totalLab,
        [isAr ? "صافي العيادة" : "Net to Clinic"]: totalNet,
      });

      exportToExcel(exportData, `Dentist_Report_${new Date().toISOString().slice(0, 10)}`, isAr);
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
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700;">Dr. ${s.name}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'};">${s.procedures.reduce((acc, p) => acc + p.count, 0)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700; color: #059669;">${s.totalIncome.toLocaleString()}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; color: #ea580c;">${s.commission.toLocaleString()}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; color: #ef4444;">${s.labFee.toLocaleString()}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700; color: #2563eb;">${s.netToClinic.toLocaleString()}</td>
        </tr>
      `).join("");

      const totalProcs = stats.reduce((acc, s) => acc + s.procedures.reduce((acc2, p) => acc2 + p.count, 0), 0);
      const totalIncome = stats.reduce((acc, s) => acc + s.totalIncome, 0);
      const totalComm = stats.reduce((acc, s) => acc + s.commission, 0);
      const totalLab = stats.reduce((acc, s) => acc + s.labFee, 0);
      const totalNet = stats.reduce((acc, s) => acc + s.netToClinic, 0);

      const totalsHtml = `
        <tr style="background: #f1f5f9; font-weight: 800;">
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الإجمالي" : "TOTAL"}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'};">${totalProcs}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'}; color: #059669;">${totalIncome.toLocaleString()}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'}; color: #ea580c;">${totalComm.toLocaleString()}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'}; color: #ef4444;">${totalLab.toLocaleString()}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'}; color: #2563eb;">${totalNet.toLocaleString()}</td>
        </tr>
      `;

      const tableHtml = `
        <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الطبيب" : "Dentist"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الإجراءات" : "Procedures"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "إجمالي الدخل" : "Income"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "العمولة" : "Commission"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "المعمل" : "Lab Fee"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "صافي العيادة" : "Net to Clinic"}</th>
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
            <div style="font-size: 18px; font-weight: 800; color: #ea580c;">${totalComm.toLocaleString()} EGP</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "مصاريف المعمل" : "Lab Fees"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #ef4444;">${totalLab.toLocaleString()} EGP</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "صافي العيادة" : "Net to Clinic"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #2563eb;">${totalNet.toLocaleString()} EGP</div>
          </div>
        </div>
      `;

      const title = isAr ? "تقرير الأطباء" : "Dentist Performance Report";
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
      a.download = `Dentist_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
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

  const handleDentistPdfExport = async () => {
    if (!activeDentist) return;
    setExporting(true);
    try {
      const rowsHtml = activeDentist.procedures.map(p => `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700;">${p.name}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'};">${p.count}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700; color: #059669;">${p.income.toLocaleString()} EGP</td>
        </tr>
      `).join("");

      const totalsHtml = `
        <tr style="background: #f1f5f9; font-weight: 800;">
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الإجمالي" : "TOTAL"}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'};">${activeDentist.procedures.reduce((a, p) => a + p.count, 0)}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'}; color: #059669;">${activeDentist.procedures.reduce((a, p) => a + p.income, 0).toLocaleString()} EGP</td>
        </tr>
      `;

      const tableHtml = `
        <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead>
              <tr>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الإجراء" : "Procedure"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "العدد" : "Count"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الدخل" : "Income"}</th>
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
            <div style="font-size: 18px; font-weight: 800; color: #059669;">${activeDentist.totalIncome.toLocaleString()} EGP</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "العمولة المستحقة" : "Commission"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #ea580c;">${activeDentist.commission.toLocaleString()} EGP</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "مصاريف المعمل" : "Lab Fees"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #ef4444;">${activeDentist.labFee.toLocaleString()} EGP</div>
          </div>
        </div>
      `;

      const title = isAr ? `تفاصيل عمولة الطبيب: ${activeDentist.name}` : `Dentist Commission Details: ${activeDentist.name}`;
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
      a.download = `Dentist_Details_${activeDentist.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
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

  if (stats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <UserCheck size={40} className="mb-3 opacity-30" />
        <p className="font-bold text-ink-muted">{isAr ? "لا توجد بيانات أطباء في هذه الفترة" : "No dentist data in this period"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {stats.map((s, i) => (
          <button
            key={s.name}
            type="button"
            onClick={() => setSelectedDentist(s.name)}
            className={`text-start p-4 rounded-2xl border transition-all ${
              activeDentist?.name === s.name
                ? "bg-ink-strong border-ink-strong text-white shadow-xl"
                : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"
            }`}
          >
            <div className="flex items-center gap-2 mb-3">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              <p className={`text-xs font-black uppercase tracking-wide ${activeDentist?.name === s.name ? "text-slate-300" : "text-slate-500"}`}>
                Dr. {s.name}
              </p>
            </div>
            <p className={`text-xl font-black tabular-nums ${activeDentist?.name === s.name ? "text-white" : "text-emerald-600"}`}>
              {s.totalIncome.toLocaleString()} <span className="text-xs font-bold">EGP</span>
            </p>
            <div className={`flex justify-between mt-2 text-xs font-semibold ${activeDentist?.name === s.name ? "text-slate-400" : "text-slate-500"}`}>
              <span>{s.procedures.reduce((a, p) => a + p.count, 0)} {isAr ? "إجراء" : "procedures"}</span>
              <span className={activeDentist?.name === s.name ? "text-amber-300" : "text-amber-600"}>
                Comm: {s.commission.toLocaleString()}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Dentist drill-down */}
      {activeDentist && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Pie Chart */}
          <div className="xl:col-span-5 bg-surface rounded-2xl border border-line p-5 shadow-sm">
            <h3 className="text-sm font-black text-ink mb-1">Dr. {activeDentist.name}</h3>
            {/* Export hint */}
            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium pt-2">
              <FileBarChart size={14} />
              <span>{isAr ? "اضغط على زر Excel لتصدير ملخص أداء الأطباء كجدول بيانات." : "Click the Excel button above to export a summary of dentist performance as a spreadsheet."}</span>
            </div>
            <p className="text-xs text-slate-400 font-medium mb-4">
              {isAr ? "توزيع الإجراءات" : "Procedure distribution"}
            </p>
            <div ref={chartRef}>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={activeDentist.procedures.slice(0, 8).map((p) => ({ name: p.name, value: p.count }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={95}
                    paddingAngle={4}
                    cornerRadius={8}
                    stroke="none"
                    dataKey="value"
                  >
                    {activeDentist.procedures.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [Number(v || 0), isAr ? "العدد" : "Count"]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* KPI row */}
            <div className="grid grid-cols-3 gap-2 mt-4 border-t border-slate-100 pt-4">
              {[
                { l: isAr ? "الدخل" : "Income", v: `${activeDentist.totalIncome.toLocaleString()}`, c: "text-emerald-600" },
                { l: isAr ? "العمولة" : "Comm.", v: `${activeDentist.commission.toLocaleString()}`, c: "text-amber-600" },
                { l: isAr ? "الصافي" : "Net", v: `${activeDentist.netToClinic.toLocaleString()}`, c: "text-ink" },
              ].map((k) => (
                <div key={k.l} className="text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase">{k.l}</p>
                  <p className={`text-sm font-black tabular-nums ${k.c}`}>{k.v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Bar chart per procedure */}
          <div className="xl:col-span-7 bg-surface rounded-2xl border border-line p-5 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-black text-ink">
                {isAr ? "الإجراءات بالتفصيل" : "Procedure Detail"}
              </h3>
              <div className="flex items-center gap-2">
                <select
                  value={selectedDentist || dentistNames[0]}
                  onChange={(e) => setSelectedDentist(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-line text-xs font-bold bg-surface outline-none"
                >
                  {dentistNames.map((n) => <option key={n} value={n}>Dr. {n}</option>)}
                </select>
                <Protect permission="reports.export">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDentistPdfExport}
                      disabled={exporting}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      <Download size={16} />
                      {exporting ? (isAr ? "جاري التصدير..." : "Exporting...") : (isAr ? "تصدير تفاصيل الطبيب" : "Export Details")}
                    </button>
                    <button
                      onClick={handlePdfExport}
                      disabled={exporting}
                      className="px-4 py-2 bg-slate-800 text-ink-on-accent text-sm font-bold rounded-xl hover:bg-accent transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                      <Download size={16} />
                      {exporting ? (isAr ? "جاري التصدير..." : "Exporting...") : (isAr ? "الكل (PDF)" : "All (PDF)")}
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
                </Protect>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={activeDentist.procedures.slice(0, 10)}
                layout="vertical"
                margin={{ left: 80, right: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 10, fontWeight: "bold" }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 9, fontWeight: "bold", fill: "#64748b" }}
                  width={80}
                  tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + "…" : v}
                />
                <Tooltip
                  formatter={(v, name) => [
                    Number(v || 0),
                    String(name) === "count" ? (isAr ? "العدد" : "Count") : (isAr ? "الدخل" : "Income"),
                  ]}
                />
                <Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]} name="count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
