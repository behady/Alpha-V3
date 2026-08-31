"use client";

import { useMemo, useRef, useState } from "react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { Download, Building2, FileSpreadsheet, FileBarChart } from "lucide-react";
import { exportToExcel, CHART_COLORS, parseMoney } from "./reportExcelUtils";
import { htmlToPdfBlob, buildReportHtmlBase } from "./reportPdfHtmlUtils";
import { ledgerCashValue } from "@/lib/reportHelpers";
import { useUI } from "@/context/UIContext";
import { attributeService, buildProcedureIndex, type AttributableRow } from "@/lib/serviceAttribution";

interface Props {
  procedures: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  allPatients: { id: string; name?: string; createdAt?: unknown }[];
  startDate: string;
  endDate: string;
  rangeLabel: string;
  isAr: boolean;
}

function normalizeDate(val: unknown): string {
  if (!val) return "1970-01-01";
  if (typeof val === "object" && val !== null && "toDate" in val) {
    return (val as { toDate: () => Date }).toDate().toISOString().split("T")[0];
  }
  const raw = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return "1970-01-01";
}

export default function ClinicReport({ procedures, payments, allPatients, startDate, endDate, rangeLabel, isAr }: Props) {
  const { showToast } = useUI();
  const chartRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  // a) Procedure counts per service
  const serviceStats = useMemo(() => {
    // Grouped on the catalogue id where the row carries one, so renaming a service keeps its
    // history together instead of splitting it in two. See lib/serviceAttribution.
    const map: Record<string, { name: string; count: number; income: number }> = {};
    const procedureIndex = buildProcedureIndex(procedures);

    const bucket = (row: AttributableRow) => {
      const { key, name } = attributeService(row, procedureIndex);
      if (!map[key]) map[key] = { name, count: 0, income: 0 };
      return map[key];
    };

    // 1. Counts
    procedures.forEach((proc) => {
      bucket(proc).count += 1;
    });

    // 2. Cash Income — attributed through the procedure each payment settles.
    payments?.forEach((pay) => {
      if (pay.type === "expense") return;
      bucket(pay).income += ledgerCashValue(pay);
    });

    return Object.values(map)
      .map((d) => ({ name: d.name, count: d.count, income: d.income }))
      .sort((a, b) => b.income - a.income);
  }, [procedures, payments]);

  // b) New vs returning patients
  const { newPatientIds, returningPatientIds, newPatientIncome, returningPatientIncome } = useMemo(() => {
    const activePatientIds = new Set<string>();
    procedures.forEach(p => { if (p.patientId) activePatientIds.add(String(p.patientId)) });
    payments?.forEach(p => { if (p.type !== "expense" && p.patientId) activePatientIds.add(String(p.patientId)) });

    const newIds = new Set<string>();
    const returningIds = new Set<string>();
    
    // Create a quick lookup map for patients to optimize finding them
    const patientMap = new Map(allPatients.map(p => [p.id, p]));

    activePatientIds.forEach(pid => {
      const patient = patientMap.get(pid);
      if (patient) {
        const created = normalizeDate(patient.createdAt);
        if (created >= startDate && created <= endDate) {
          newIds.add(pid);
        } else {
          returningIds.add(pid);
        }
      } else {
        returningIds.add(pid);
      }
    });

    let newInc = 0, retInc = 0;
    payments?.forEach((pay) => {
      if (pay.type === "expense") return;
      const pid = String(pay.patientId || "");
      const inc = ledgerCashValue(pay);
      if (newIds.has(pid)) newInc += inc;
      else if (returningIds.has(pid)) retInc += inc;
    });

    return { 
      newPatientIds: newIds, 
      returningPatientIds: returningIds,
      newPatientIncome: newInc,
      returningPatientIncome: retInc
    };
  }, [allPatients, procedures, payments, startDate, endDate]);

  const totalIncome = serviceStats.reduce((s, r) => s + r.income, 0);
  const totalProcs = serviceStats.reduce((s, r) => s + r.count, 0);
  const totalCommissions = payments?.reduce((s, p) => s + parseMoney(p.doctorCommissionAmount), 0) || 0;
  const totalExpenses = payments?.filter(p => p.type === "expense").reduce((s, p) => s + parseMoney(p.cost || p.amount), 0) || 0;
  const netProfit = totalIncome - totalCommissions - totalExpenses;

  const patientPieData = [
    { name: isAr ? "مرضى جدد" : "New Patients", value: newPatientIds.size, income: newPatientIncome },
    { name: isAr ? "مرضى حاليون" : "Returning Patients", value: returningPatientIds.size, income: returningPatientIncome },
  ];

  const handleExcelExport = () => {
    setExporting(true);
    try {
      const exportData: any[] = [];
      
      const metricCol = isAr ? "البيان" : "Metric";
      const valCol = isAr ? "العدد / القيمة" : "Count / Value";
      const incCol = isAr ? "الدخل (ج.م)" : "Income (EGP)";

      // KPIs
      exportData.push({ [metricCol]: isAr ? "إجمالي الدخل" : "Gross Income", [valCol]: totalIncome });
      exportData.push({ [metricCol]: isAr ? "إجمالي المصروفات" : "Expenses", [valCol]: totalExpenses });
      exportData.push({ [metricCol]: isAr ? "عمولات الأطباء" : "Commissions", [valCol]: totalCommissions });
      exportData.push({ [metricCol]: isAr ? "صافي الربح" : "Net Profit", [valCol]: netProfit });
      exportData.push({});

      // Patient Analytics
      exportData.push({ [metricCol]: isAr ? "--- إحصاءات المرضى ---" : "--- Patient Analytics ---" });
      patientPieData.forEach(p => {
        exportData.push({
          [metricCol]: p.name,
          [valCol]: p.value,
          [incCol]: p.income,
        });
      });
      exportData.push({});

      // Procedures
      exportData.push({ [metricCol]: isAr ? "--- الإجراءات ---" : "--- Procedures ---" });
      serviceStats.forEach(s => {
        exportData.push({
          [metricCol]: s.name,
          [valCol]: s.count,
          [incCol]: s.income,
        });
      });

      exportToExcel(exportData, `Clinic_Report_${new Date().toISOString().slice(0, 10)}`, isAr);
    } catch (err) { 
      console.error(err); 
    } finally { 
      setExporting(false); 
    }
  };

  const handlePdfExport = async () => {
    setExporting(true);
    try {
      const rowsHtml = serviceStats.map(s => `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700;">${s.name}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'};">${s.count}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700; color: #059669;">${s.income.toLocaleString()}</td>
        </tr>
      `).join("");

      const totalsHtml = `
        <tr style="background: #f1f5f9; font-weight: 800;">
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الإجمالي" : "TOTAL"}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'};">${totalProcs}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'}; color: #059669;">${totalIncome.toLocaleString()}</td>
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
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "إجمالي الدخل" : "Total Revenue"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #059669;">${totalIncome.toLocaleString()} EGP</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "إجمالي المصروفات" : "Total Expenses"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #ef4444;">${totalExpenses.toLocaleString()} EGP</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "إجمالي الإجراءات" : "Total Procedures"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #2563eb;">${totalProcs}</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "مرضى جدد" : "New Patients"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #8b5cf6;">${newPatientIds.size}</div>
          </div>
          <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "مرضى سابقين" : "Returning Patients"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #f59e0b;">${returningPatientIds.size}</div>
          </div>
        </div>
      `;

      const title = isAr ? "تقرير العيادة الشامل" : "Clinic Overview Report";
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
      a.download = `Clinic_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
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

  if (procedures.length === 0 && payments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Building2 size={40} className="mb-3 opacity-30" />
        <p className="font-bold text-ink-muted">{isAr ? "لا توجد بيانات في هذه الفترة" : "No data in this period"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { l: isAr ? "إجمالي الدخل" : "Total Income", v: `${totalIncome.toLocaleString()} EGP`, c: "text-emerald-600" },
          { l: isAr ? "الاستقطاعات" : "Deductions", v: `(${totalCommissions.toLocaleString()}) EGP`, c: "text-amber-600" },
          { l: isAr ? "المصروفات" : "Expenses", v: `(${totalExpenses.toLocaleString()}) EGP`, c: "text-red-600" },
          { l: isAr ? "صافي الربح" : "Net Profit", v: `${netProfit.toLocaleString()} EGP`, c: netProfit >= 0 ? "text-ink" : "text-red-600" },
        ].map((k) => (
          <div key={k.l} className="bg-surface border border-line shadow-sm rounded-2xl p-4">
            <p className="text-[10px] font-black text-ink-muted uppercase tracking-wider">{k.l}</p>
            <p className={`text-xl font-black tabular-nums mt-1 ${k.c}`}>{k.v}</p>
          </div>
        ))}
      </div>

      {/* New vs Returning patients */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: isAr ? "مرضى جدد" : "New Patients", count: newPatientIds.size, income: newPatientIncome, color: "bg-violet-600", text: "text-ink" },
          { label: isAr ? "مرضى حاليون" : "Returning Patients", count: returningPatientIds.size, income: returningPatientIncome, color: "bg-blue-600", text: "text-ink" },
        ].map((p) => (
          <div key={p.label} className="bg-surface border border-line shadow-sm rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-3 h-3 rounded-full ${p.color}`} />
              <p className="text-xs font-black text-ink-body uppercase tracking-wide">{p.label}</p>
            </div>
            <p className={`text-3xl font-black tabular-nums ${p.text}`}>{p.count}</p>
            <p className="text-sm font-semibold text-ink-muted mt-1">
              {p.income.toLocaleString()} EGP {isAr ? "مدفوع" : "paid"}
            </p>
          </div>
        ))}
      </div>

      {/* Charts + Table */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Patient pie */}
        <div className="xl:col-span-4 bg-surface rounded-2xl border border-line p-5 shadow-sm">
          <h3 className="text-sm font-black text-ink mb-4">{isAr ? "توزيع المرضى" : "Patient Distribution"}</h3>
          <div ref={chartRef}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={patientPieData} cx="50%" cy="50%" outerRadius={85} innerRadius={55} paddingAngle={4} cornerRadius={8} stroke="none" dataKey="value">
                  <Cell fill="#7c3aed" />
                  <Cell fill="#2563eb" />
                </Pie>
                <Tooltip formatter={(v, name) => [Number(v || 0), String(name)]} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top procedures bar */}
        <div className="xl:col-span-8 bg-surface rounded-2xl border border-line p-5 shadow-sm">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-black text-ink">{isAr ? "أكثر الإجراءات" : "Top Procedures by Income"}</h3>
            <div className="flex gap-2 mb-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePdfExport}
                  disabled={exporting}
                  className="px-4 py-2 bg-slate-800 text-ink-on-accent text-sm font-bold rounded-xl hover:bg-accent transition-colors flex items-center gap-2 disabled:opacity-50"
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
          </div>
          <div ref={barRef}>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart
                data={serviceStats.slice(0, 8)}
                layout="vertical"
                margin={{ left: 90, right: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 10, fontWeight: "bold" }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 8.5, fontWeight: "bold", fill: "#64748b" }}
                  width={90}
                  tickFormatter={(v: string) => v.length > 15 ? v.slice(0, 15) + "…" : v}
                />
                <Tooltip formatter={(v) => [`${Number(v || 0).toLocaleString()} EGP`, isAr ? "الدخل" : "Income"]} />
                <Bar dataKey="income" fill="#2563eb" radius={[0, 4, 4, 0]}>
                  {serviceStats.slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Full procedure table */}
      <div className="bg-surface rounded-2xl border border-line shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-black text-ink">{isAr ? "جدول الإجراءات الكامل" : "Full Procedure Table"}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-subtle border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-ink-muted">
                <th className="text-start py-3 px-4">{isAr ? "الإجراء" : "Procedure"}</th>
                <th className="text-center py-3 px-4">{isAr ? "العدد" : "Count"}</th>
                <th className="text-end py-3 px-4">{isAr ? "الدخل" : "Income (EGP)"}</th>
                <th className="text-end py-3 px-4">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {serviceStats.map((s, i) => (
                <tr key={i} className="hover:bg-surface-subtle transition-colors">
                  <td className="py-3 px-4 font-semibold text-slate-800 text-xs flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    {s.name}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-black">{s.count}</span>
                  </td>
                  <td className="py-3 px-4 text-end font-bold text-emerald-600 tabular-nums text-xs">{s.income.toLocaleString()}</td>
                  <td className="py-3 px-4 text-end text-xs text-slate-400 font-semibold tabular-nums">
                    {totalIncome > 0 ? `${((s.income / totalIncome) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-ink-strong text-white text-xs font-black">
                <td className="py-3 px-4">{isAr ? "الإجمالي" : "TOTAL"}</td>
                <td className="py-3 px-4 text-center">{totalProcs}</td>
                <td className="py-3 px-4 text-end tabular-nums">{totalIncome.toLocaleString()}</td>
                <td className="py-3 px-4 text-end">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
