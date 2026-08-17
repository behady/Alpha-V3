"use client";

import { useMemo, useState } from "react";
import { Megaphone, FileSpreadsheet, Download } from "lucide-react";
import { exportToExcel, CHART_COLORS } from "./reportExcelUtils";
import { htmlToPdfBlob, buildReportHtmlBase } from "./reportPdfHtmlUtils";
import { useUI } from "@/context/UIContext";
import { leadStageLabel } from "@/lib/leads";

/**
 * The marketing funnel — what the Leads inbox was collecting data for.
 *
 * Per channel: leads in, still being worked, lost, won ("in the chair"), conversion rate,
 * and the cash actually paid (in the selected range) by the patients those leads became.
 * Revenue deliberately counts only payments linked via a won lead's patientId — a channel
 * only gets credit for money that traces back to a recorded lead.
 */

interface LeadRow {
  id?: string;
  source?: string;
  stage?: string;
  patientId?: string | null;
  normDate?: string;
}

interface FunnelStat {
  name: string;
  total: number;
  open: number;
  lost: number;
  won: number;
  conversion: number;
  revenue: number;
}

interface Props {
  leads: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  rangeLabel: string;
  isAr: boolean;
}

/** Payment-row cash: first NON-ZERO candidate — several write paths store placeholder 0s. */
function paymentCash(d: Record<string, unknown>): number {
  return Number(d.paid) || Number(d.amount) || 0;
}

export default function LeadFunnelReport({ leads, payments, rangeLabel, isAr }: Props) {
  const { showToast } = useUI();
  const [exporting, setExporting] = useState(false);

  const stats: FunnelStat[] = useMemo(() => {
    const bySource: Record<string, { rows: LeadRow[]; patientIds: Set<string> }> = {};

    (leads as LeadRow[]).forEach((lead) => {
      const source = String(lead.source || "").trim() || (isAr ? "غير محدد" : "Unspecified");
      if (!bySource[source]) bySource[source] = { rows: [], patientIds: new Set() };
      bySource[source].rows.push(lead);
      if (lead.stage === "won" && lead.patientId) bySource[source].patientIds.add(String(lead.patientId));
    });

    // Cash paid in range by patients converted from this channel's leads.
    const paidByPatient: Record<string, number> = {};
    payments.forEach((pay) => {
      if (pay.type === "expense") return;
      const pid = String(pay.patientId || "");
      if (!pid) return;
      paidByPatient[pid] = (paidByPatient[pid] || 0) + paymentCash(pay);
    });

    return Object.entries(bySource)
      .map(([name, d]) => {
        const won = d.rows.filter((l) => l.stage === "won").length;
        const lost = d.rows.filter((l) => l.stage === "lost").length;
        let revenue = 0;
        d.patientIds.forEach((pid) => { revenue += paidByPatient[pid] || 0; });
        return {
          name,
          total: d.rows.length,
          open: d.rows.length - won - lost,
          lost,
          won,
          conversion: d.rows.length > 0 ? Math.round((won / d.rows.length) * 100) : 0,
          revenue,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [leads, payments, isAr]);

  const totals = useMemo(() => ({
    total: stats.reduce((a, s) => a + s.total, 0),
    open: stats.reduce((a, s) => a + s.open, 0),
    lost: stats.reduce((a, s) => a + s.lost, 0),
    won: stats.reduce((a, s) => a + s.won, 0),
    revenue: stats.reduce((a, s) => a + s.revenue, 0),
  }), [stats]);
  const totalConversion = totals.total > 0 ? Math.round((totals.won / totals.total) * 100) : 0;
  const maxTotal = stats.length > 0 ? stats[0].total : 1;

  const headers = {
    source: isAr ? "المصدر" : "Channel",
    leadsIn: isAr ? "عملاء محتملين" : "Leads",
    open: isAr ? "قيد المتابعة" : "In progress",
    lost: isAr ? "مفقود" : "Lost",
    won: isAr ? "وصلوا للكرسي" : "In the chair",
    conversion: isAr ? "نسبة التحويل" : "Conversion",
    revenue: isAr ? "الدخل (ج.م)" : "Revenue (EGP)",
  };

  const handleExcelExport = () => {
    setExporting(true);
    try {
      const exportData = stats.map((s) => ({
        [headers.source]: s.name,
        [headers.leadsIn]: s.total,
        [headers.open]: s.open,
        [headers.lost]: s.lost,
        [headers.won]: s.won,
        [headers.conversion]: `${s.conversion}%`,
        [headers.revenue]: s.revenue,
      }));
      exportData.push({
        [headers.source]: isAr ? "الإجمالي" : "TOTAL",
        [headers.leadsIn]: totals.total,
        [headers.open]: totals.open,
        [headers.lost]: totals.lost,
        [headers.won]: totals.won,
        [headers.conversion]: `${totalConversion}%`,
        [headers.revenue]: totals.revenue,
      });
      exportToExcel(exportData, `Marketing_Funnel_${new Date().toISOString().slice(0, 10)}`, isAr);
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  };

  const handlePdfExport = async () => {
    setExporting(true);
    try {
      const align = isAr ? "right" : "left";
      const th = (label: string) =>
        `<th style="padding: 10px 12px; background: #f8fafc; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 10px; border-bottom: 1px solid #e2e8f0; text-align: ${align};">${label}</th>`;
      const td = (val: string, extra = "") =>
        `<td style="padding: 10px 12px; border-bottom: 1px solid #f1f5f9; text-align: ${align}; ${extra}">${val}</td>`;

      const rowsHtml = stats.map((s) => `
        <tr>
          ${td(s.name, "font-weight: 700;")}
          ${td(String(s.total))}
          ${td(String(s.open))}
          ${td(String(s.lost), "color: #e11d48;")}
          ${td(String(s.won), "font-weight: 700; color: #059669;")}
          ${td(`${s.conversion}%`, "font-weight: 700;")}
          ${td(s.revenue.toLocaleString(), "font-weight: 700; color: #2563eb;")}
        </tr>
      `).join("");

      const totalsHtml = `
        <tr style="background: #f1f5f9; font-weight: 800;">
          ${td(isAr ? "الإجمالي" : "TOTAL")}
          ${td(String(totals.total))}
          ${td(String(totals.open))}
          ${td(String(totals.lost), "color: #e11d48;")}
          ${td(String(totals.won), "color: #059669;")}
          ${td(`${totalConversion}%`)}
          ${td(totals.revenue.toLocaleString(), "color: #2563eb;")}
        </tr>
      `;

      const tableHtml = `
        <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead><tr>
              ${th(headers.source)}${th(headers.leadsIn)}${th(headers.open)}${th(headers.lost)}${th(headers.won)}${th(headers.conversion)}${th(headers.revenue)}
            </tr></thead>
            <tbody>${rowsHtml}${totalsHtml}</tbody>
          </table>
        </div>
      `;

      const kpi = (label: string, value: string, color: string) => `
        <div style="flex: 1; min-width: 120px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px;">
          <div style="font-size: 11px; color: #64748b; font-weight: 700; margin-bottom: 4px;">${label}</div>
          <div style="font-size: 18px; font-weight: 800; color: ${color};">${value}</div>
        </div>
      `;
      const kpiHtml = `
        <div style="display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 24px;">
          ${kpi(headers.leadsIn, String(totals.total), "#0f172a")}
          ${kpi(headers.won, String(totals.won), "#059669")}
          ${kpi(headers.conversion, `${totalConversion}%`, "#8b5cf6")}
          ${kpi(headers.revenue, `${totals.revenue.toLocaleString()} EGP`, "#2563eb")}
        </div>
      `;

      const title = isAr ? "تقرير قمع التسويق" : "Marketing Funnel Report";
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
      a.download = `Marketing_Funnel_${new Date().toISOString().slice(0, 10)}.pdf`;
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
        <Megaphone size={40} className="mb-3 opacity-30" />
        <p className="font-bold text-slate-500">
          {isAr ? "لا يوجد عملاء محتملين في هذه الفترة" : "No leads recorded in this period"}
        </p>
        <p className="text-xs font-semibold mt-1">
          {isAr ? "سجّل العملاء من صفحة العملاء المحتملين" : "Add them from the Leads page as people ask"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: headers.leadsIn, v: totals.total.toString(), c: "text-slate-900" },
          { l: headers.won, v: totals.won.toString(), c: "text-emerald-600" },
          { l: headers.conversion, v: `${totalConversion}%`, c: "text-violet-600" },
          { l: headers.revenue, v: `${totals.revenue.toLocaleString()} EGP`, c: "text-blue-600" },
        ].map((k) => (
          <div key={k.l} className="bg-white border border-slate-200 shadow-sm rounded-2xl p-4">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">{k.l}</p>
            <p className={`text-xl font-black tabular-nums mt-1 ${k.c}`}>{k.v}</p>
          </div>
        ))}
      </div>

      {/* Channels table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center gap-2 flex-wrap">
          <h3 className="text-sm font-black text-slate-900">{isAr ? "القنوات التسويقية" : "Channels"}</h3>
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

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="bg-slate-50 text-[9px] font-black text-slate-500 uppercase">
                <th className="text-start py-2.5 px-4">{headers.source}</th>
                <th className="text-center py-2.5 px-3">{headers.leadsIn}</th>
                <th className="text-center py-2.5 px-3">{headers.open}</th>
                <th className="text-center py-2.5 px-3">{headers.lost}</th>
                <th className="text-center py-2.5 px-3">{headers.won}</th>
                <th className="text-center py-2.5 px-3">{headers.conversion}</th>
                <th className="text-end py-2.5 px-4">{headers.revenue}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {stats.map((s, i) => (
                <tr key={s.name} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="font-bold text-slate-800">{s.name}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden max-w-[160px]">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(6, Math.round((s.total / maxTotal) * 100))}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center font-black text-slate-800 tabular-nums">{s.total}</td>
                  <td className="py-3 px-3 text-center font-bold text-sky-600 tabular-nums">{s.open}</td>
                  <td className="py-3 px-3 text-center font-bold text-rose-500 tabular-nums">{s.lost}</td>
                  <td className="py-3 px-3 text-center font-black text-emerald-600 tabular-nums">{s.won}</td>
                  <td className="py-3 px-3 text-center font-black text-violet-600 tabular-nums">{s.conversion}%</td>
                  <td className="py-3 px-4 text-end font-black text-blue-600 tabular-nums">{s.revenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-black text-slate-800">
                <td className="py-3 px-4">{isAr ? "الإجمالي" : "TOTAL"}</td>
                <td className="py-3 px-3 text-center tabular-nums">{totals.total}</td>
                <td className="py-3 px-3 text-center tabular-nums text-sky-600">{totals.open}</td>
                <td className="py-3 px-3 text-center tabular-nums text-rose-500">{totals.lost}</td>
                <td className="py-3 px-3 text-center tabular-nums text-emerald-600">{totals.won}</td>
                <td className="py-3 px-3 text-center tabular-nums text-violet-600">{totalConversion}%</td>
                <td className="py-3 px-4 text-end tabular-nums text-blue-600">{totals.revenue.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="px-5 py-3 text-[11px] font-semibold text-slate-400 border-t border-slate-50">
          {isAr
            ? `الدخل = المدفوعات خلال الفترة من المرضى اللي اتسجلوا كعملاء محتملين ووصلوا لمرحلة "${leadStageLabel("won", "ar")}".`
            : `Revenue = payments in this period from patients whose lead reached "${leadStageLabel("won", "en")}". Channels only get credit for money traceable to a recorded lead.`}
        </p>
      </div>
    </div>
  );
}
