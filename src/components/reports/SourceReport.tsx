"use client";

import { useMemo, useRef, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Network, ChevronDown, ChevronRight, FileBarChart, FileSpreadsheet, Download } from "lucide-react";
import { exportToExcel, CHART_COLORS, parseMoney } from "./reportExcelUtils";
import { htmlToPdfBlob, buildReportHtmlBase } from "./reportPdfHtmlUtils";
import { useUI } from "@/context/UIContext";
import { attributeService, buildProcedureIndex } from "@/lib/serviceAttribution";

interface SourceStat {
  name: string;
  patientCount: number;
  totalIncome: number;
  commission: number;
  netIncome: number;
  services: { name: string; count: number; income: number }[];
  patients: { name: string; phone?: string; paid: number }[];
}

interface PatientData {
  id: string;
  name?: string;
  phone?: string;
  referral?: string;
}

interface Props {
  procedures: Record<string, unknown>[];
  payments?: Record<string, unknown>[];
  allPatients: PatientData[];
  rangeLabel: string;
  isAr: boolean;
}

export default function SourceReport({ procedures, payments, allPatients, rangeLabel, isAr }: Props) {
  const { showToast } = useUI();
  const chartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const patientMap = useMemo(() => {
    const m: Record<string, PatientData> = {};
    allPatients.forEach((p) => { if (p.id) m[p.id] = p; });
    return m;
  }, [allPatients]);

  const stats: SourceStat[] = useMemo(() => {
    const map: Record<string, {
      patientIds: Set<string>;
      services: Record<string, { name: string; count: number; income: number }>;
      commission: number;
      income: number;
      patientPaid: Record<string, number>;
    }> = {};

    const procedureIndex = buildProcedureIndex(procedures);

    // 1. Procedures for counts
    procedures.forEach((proc) => {
      const pid = String(proc.patientId || "");
      const patient = pid ? patientMap[pid] : null;
      const source = String(patient?.referral || proc.patientReferral || "Unknown / Walk-in").trim() || "Unknown / Walk-in";

      if (!map[source]) {
        map[source] = { patientIds: new Set(), services: {}, commission: 0, income: 0, patientPaid: {} };
      }
      // Keyed on the catalogue id when the row has one — see lib/serviceAttribution.
      const svc = attributeService(proc, procedureIndex);

      if (pid) map[source].patientIds.add(pid);
      if (!map[source].services[svc.key]) map[source].services[svc.key] = { name: svc.name, count: 0, income: 0 };
      map[source].services[svc.key].count += 1;
    });

    // 2. Payments for cash income
    payments?.forEach((pay) => {
      if (pay.type === "expense") return;
      const pid = String(pay.patientId || "");
      const patient = pid ? patientMap[pid] : null;
      const source = String(patient?.referral || pay.patientReferral || "Unknown / Walk-in").trim() || "Unknown / Walk-in";

      if (!map[source]) {
        map[source] = { patientIds: new Set(), services: {}, commission: 0, income: 0, patientPaid: {} };
      }

      // A payment is attributed through the procedure it settles, not by re-reading its own
      // "Payment for …" prose.
      const svc = attributeService(pay, procedureIndex);

      if (!map[source].services[svc.key]) map[source].services[svc.key] = { name: svc.name, count: 0, income: 0 };

      const inc = parseMoney(pay.val ?? pay.amount ?? pay.paid);

      map[source].services[svc.key].income += inc;
      map[source].income += inc;
      map[source].commission += parseMoney(pay.doctorCommissionAmount);
      if (pid) {
          map[source].patientIds.add(pid);
          map[source].patientPaid[pid] = (map[source].patientPaid[pid] || 0) + inc;
      }
    });

    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        patientCount: d.patientIds.size,
        totalIncome: d.income,
        commission: d.commission,
        netIncome: d.income - d.commission,
        services: Object.values(d.services)
          .map((s) => ({ name: s.name, count: s.count, income: s.income }))
          .sort((a, b) => b.income - a.income),
        patients: Object.entries(d.patientPaid)
          .map(([pId, paid]) => ({
            name: patientMap[pId]?.name || "Unknown",
            phone: patientMap[pId]?.phone,
            paid,
          }))
          .sort((a, b) => b.paid - a.paid),
      }))
      .sort((a, b) => b.totalIncome - a.totalIncome);
  }, [procedures, payments, patientMap]);

  const totalPatients = stats.reduce((a, s) => a + s.patientCount, 0);
  const totalIncome = stats.reduce((a, s) => a + s.totalIncome, 0);
  const pieData = stats.map((s) => ({ name: s.name, value: s.totalIncome }));

  const handleExcelExport = () => {
    setExporting(true);
    try {
      const exportData = stats.map(s => ({
        [isAr ? "المصدر" : "Source"]: s.name,
        [isAr ? "عدد المرضى" : "Patients"]: s.patientCount,
        [isAr ? "الدخل (ج.م)" : "Income (EGP)"]: s.totalIncome,
        [isAr ? "العمولة" : "Commission"]: s.commission,
        [isAr ? "الصافي" : "Net"]: s.netIncome,
      }));

      const totalCommission = stats.reduce((sum, s) => sum + s.commission, 0);
      const totalNet = stats.reduce((sum, s) => sum + s.netIncome, 0);

      // Add totals
      exportData.push({
        [isAr ? "المصدر" : "Source"]: isAr ? "الإجمالي" : "TOTAL",
        [isAr ? "عدد المرضى" : "Patients"]: totalPatients,
        [isAr ? "الدخل (ج.م)" : "Income (EGP)"]: totalIncome,
        [isAr ? "العمولة" : "Commission"]: totalCommission,
        [isAr ? "الصافي" : "Net"]: totalNet,
      });

      exportToExcel(
        exportData, 
        `Source_Report_${new Date().toISOString().slice(0, 10)}`,
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
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'};">${s.patientCount}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700; color: #059669;">${s.totalIncome.toLocaleString()}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; color: #ea580c;">${s.commission.toLocaleString()}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${isAr ? 'right' : 'left'}; font-weight: 700; color: #2563eb;">${s.netIncome.toLocaleString()}</td>
        </tr>
      `).join("");

      const totalIncome = stats.reduce((acc, s) => acc + s.totalIncome, 0);
      const totalCommission = stats.reduce((acc, s) => acc + s.commission, 0);
      const totalNet = stats.reduce((acc, s) => acc + s.netIncome, 0);
      const totalPatients = stats.reduce((acc, s) => acc + s.patientCount, 0);

      const totalsHtml = `
        <tr style="background: #f1f5f9; font-weight: 800;">
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "الإجمالي" : "TOTAL"}</td>
          <td style="padding: 10px 12px; text-align: ${isAr ? 'right' : 'left'};">${totalPatients}</td>
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
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "المصدر" : "Source"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "المرضى" : "Patients"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "إجمالي الدخل" : "Income"}</th>
                <th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${isAr ? 'right' : 'left'};">${isAr ? "العمولات" : "Commissions"}</th>
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
            <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${isAr ? "المرضى" : "Patients"}</div>
            <div style="font-size: 18px; font-weight: 800; color: #8b5cf6;">${totalPatients}</div>
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

      const title = isAr ? "تقرير المصادر التسويقية" : "Marketing Source Report";
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
      a.download = `Source_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
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
        <Network size={40} className="mb-3 opacity-30" />
        <p className="font-bold text-slate-500">{isAr ? "لا توجد بيانات مصادر في هذه الفترة" : "No source data in this period"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { l: isAr ? "المصادر" : "Sources", v: stats.length.toString(), c: "text-blue-600" },
          { l: isAr ? "عدد المرضى" : "Patients (active)", v: totalPatients.toString(), c: "text-emerald-600" },
          { l: isAr ? "إجمالي الدخل" : "Total Income", v: `${totalIncome.toLocaleString()} EGP`, c: "text-slate-900" },
        ].map((k) => (
          <div key={k.l} className="bg-white border border-slate-200 shadow-sm rounded-2xl p-4">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">{k.l}</p>
            <p className={`text-xl font-black tabular-nums mt-1 ${k.c}`}>{k.v}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Pie */}
        <div className="xl:col-span-4 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-black text-slate-900 mb-4">{isAr ? "توزيع الدخل" : "Income Distribution"}</h3>
          <div ref={chartRef}>
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} innerRadius={60} paddingAngle={4} cornerRadius={8} stroke="none" dataKey="value">
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`${Number(v || 0).toLocaleString()} EGP`, isAr ? "الدخل" : "Income"]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Legend */}
          <div className="space-y-1.5 mt-2">
            {stats.slice(0, 6).map((s, i) => (
              <div key={s.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="text-xs font-semibold text-slate-700">{s.name}</span>
                </div>
                <span className="text-xs font-black tabular-nums text-emerald-600">{s.totalIncome.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sources table with expandable rows */}
        <div className="xl:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
            <h3 className="text-sm font-black text-slate-900">{isAr ? "تفاصيل المصادر" : "Source Details"}</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePdfExport}
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
          <div className="divide-y divide-slate-100">
            {stats.map((s, i) => (
              <div key={s.name}>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === s.name ? null : s.name)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-start"
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="flex-1 font-bold text-sm text-slate-800">{s.name}</span>
                  <span className="text-xs text-slate-500 font-semibold">{s.patientCount} {isAr ? "مريض" : "patients"}</span>
                  <span className="text-xs font-black text-emerald-600 tabular-nums w-24 text-end">{s.totalIncome.toLocaleString()} EGP</span>
                  {expanded === s.name ? <ChevronDown size={15} className="text-slate-400 shrink-0" /> : <ChevronRight size={15} className="text-slate-400 shrink-0" />}
                </button>

                {expanded === s.name && (
                  <div className="px-5 pb-5 bg-slate-50/60 space-y-4">
                    {/* Services */}
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">{isAr ? "الخدمات" : "Services"}</p>
                      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase">
                              <th className="text-start py-2 px-3">{isAr ? "الخدمة" : "Service"}</th>
                              <th className="text-center py-2 px-3">{isAr ? "العدد" : "Count"}</th>
                              <th className="text-end py-2 px-3">{isAr ? "الدخل" : "Income"}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {s.services.map((svc, j) => (
                              <tr key={j}>
                                <td className="py-2 px-3 font-semibold text-slate-700">{svc.name}</td>
                                <td className="py-2 px-3 text-center font-bold text-blue-600">{svc.count}</td>
                                <td className="py-2 px-3 text-end font-bold text-emerald-600 tabular-nums">{svc.income.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Patients */}
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">{isAr ? "المرضى" : "Patients"}</p>
                      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase">
                              <th className="text-start py-2 px-3">{isAr ? "الاسم" : "Name"}</th>
                              <th className="text-start py-2 px-3">{isAr ? "الهاتف" : "Phone"}</th>
                              <th className="text-end py-2 px-3">{isAr ? "المدفوع" : "Paid (EGP)"}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {s.patients.slice(0, 10).map((p, j) => (
                              <tr key={j}>
                                <td className="py-2 px-3 font-semibold text-slate-700">{p.name}</td>
                                <td className="py-2 px-3 text-slate-500">{p.phone || "—"}</td>
                                <td className="py-2 px-3 text-end font-bold text-emerald-600 tabular-nums">{p.paid.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
