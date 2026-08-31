"use client";

import React, { useMemo, useState } from "react";
import { Megaphone, FileSpreadsheet, Download, ChevronDown, ChevronRight } from "lucide-react";
import { SourceIcon } from "@/components/SourceIcon";
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
  /** Stamped by the Meta webhook — what makes the per-campaign drill-down possible. */
  meta?: { campaignName?: string | null; adName?: string | null } | null;
  /** Converted onto a patient file that already existed — money the channel did not create. */
  isReturningPatient?: boolean;
  createdAt?: { seconds?: number } | null;
  firstContactedAt?: { seconds?: number } | null;
  stageChangedAt?: { seconds?: number } | null;
  updatedAt?: { seconds?: number } | null;
}

const STALE_LABEL_DAYS = 30;
const STALE_AFTER_SECONDS = STALE_LABEL_DAYS * 24 * 60 * 60;

function isStale(l: LeadRow, nowSeconds: number): boolean {
  if (l.stage === "won" || l.stage === "lost") return false;
  const last = l.stageChangedAt?.seconds || l.updatedAt?.seconds || l.createdAt?.seconds || 0;
  return last > 0 && nowSeconds - last > STALE_AFTER_SECONDS;
}

/** "1h 40m" / "3d" — a duration a receptionist reads without doing arithmetic. */
function humanMinutes(mins: number | null): string {
  if (mins === null) return "—";
  if (mins < 60) return `${Math.round(mins)}m`;
  if (mins < 60 * 24) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${(mins / (60 * 24)).toFixed(1)}d`;
}

interface CampaignStat {
  name: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  stale: number;
  conversion: number;
  revenue: number;
  /** Money from patients the clinic already had — shown apart, never inside `revenue`. */
  returningRevenue: number;
}

interface FunnelStat {
  name: string;
  total: number;
  open: number;
  lost: number;
  won: number;
  stale: number;
  conversion: number;
  revenue: number;
  returningRevenue: number;
  /** Present only when the channel's leads carry campaign fingerprints (Meta ads). */
  campaigns: CampaignStat[];
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
  const [expanded, setExpanded] = useState<string | null>(null);

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

    const nowSeconds = Date.now() / 1000;

    const summarize = (rows: LeadRow[], name: string) => {
      const won = rows.filter((l) => l.stage === "won").length;
      const lost = rows.filter((l) => l.stage === "lost").length;

      // New-business revenue and returning-patient revenue are counted apart: a channel may
      // claim the patients it brought, not the treatment an existing patient was having anyway.
      // Deduped per patient so one person converted twice cannot pay the channel twice.
      const newPatients = new Set<string>();
      const returningPatients = new Set<string>();
      rows.forEach((l) => {
        if (l.stage !== "won" || !l.patientId) return;
        (l.isReturningPatient ? returningPatients : newPatients).add(String(l.patientId));
      });
      let revenue = 0;
      let returningRevenue = 0;
      newPatients.forEach((pid) => { revenue += paidByPatient[pid] || 0; });
      returningPatients.forEach((pid) => {
        if (!newPatients.has(pid)) returningRevenue += paidByPatient[pid] || 0;
      });

      return {
        name,
        total: rows.length,
        open: rows.length - won - lost,
        lost,
        won,
        stale: rows.filter((l) => isStale(l, nowSeconds)).length,
        conversion: rows.length > 0 ? Math.round((won / rows.length) * 100) : 0,
        revenue,
        returningRevenue,
      };
    };

    return Object.entries(bySource)
      .map(([name, d]) => {
        // Campaign drill-down only where leads carry the webhook's fingerprint.
        const tagged = d.rows.filter((l) => l.meta);
        let campaigns: CampaignStat[] = [];
        if (tagged.length > 0) {
          const byCampaign = new Map<string, LeadRow[]>();
          tagged.forEach((l) => {
            const key = String(l.meta?.campaignName || "").trim() || (isAr ? "بدون حملة / طبيعي" : "Organic / no campaign");
            byCampaign.set(key, [...(byCampaign.get(key) || []), l]);
          });
          campaigns = Array.from(byCampaign.entries())
            .map(([cname, rows]) => summarize(rows, cname))
            .sort((a, b) => b.total - a.total);
        }
        return { ...summarize(d.rows, name), campaigns };
      })
      .sort((a, b) => b.total - a.total);
  }, [leads, payments, isAr]);

  const totals = useMemo(() => ({
    total: stats.reduce((a, s) => a + s.total, 0),
    open: stats.reduce((a, s) => a + s.open, 0),
    lost: stats.reduce((a, s) => a + s.lost, 0),
    won: stats.reduce((a, s) => a + s.won, 0),
    stale: stats.reduce((a, s) => a + s.stale, 0),
    revenue: stats.reduce((a, s) => a + s.revenue, 0),
    returningRevenue: stats.reduce((a, s) => a + s.returningRevenue, 0),
  }), [stats]);

  /**
   * How long the clinic takes to answer, in minutes, across leads that were answered at all.
   * The one number on this page that changes what staff do tomorrow morning.
   */
  const avgMinutesToContact = useMemo(() => {
    const gaps = (leads as LeadRow[])
      .map((l) => {
        const born = l.createdAt?.seconds || 0;
        const touched = l.firstContactedAt?.seconds || 0;
        return born && touched && touched >= born ? (touched - born) / 60 : null;
      })
      .filter((v): v is number => v !== null);
    if (gaps.length === 0) return null;
    return gaps.reduce((a, b) => a + b, 0) / gaps.length;
  }, [leads]);
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
    returning: isAr ? "دخل مرضى قدامى" : "Returning-patient revenue",
    stale: isAr ? "ساكن" : "Stale",
    level: isAr ? "المستوى" : "Level",
    levelChannel: isAr ? "قناة" : "Channel",
    levelCampaign: isAr ? "حملة" : "Campaign",
  };

  const handleExcelExport = () => {
    setExporting(true);
    try {
      const row = (name: string, r: FunnelStat | CampaignStat, level: "channel" | "campaign") => ({
        [headers.source]: name,
        [headers.level]: level === "channel" ? headers.levelChannel : headers.levelCampaign,
        [headers.leadsIn]: r.total,
        [headers.open]: r.open,
        [headers.stale]: r.stale,
        [headers.lost]: r.lost,
        [headers.won]: r.won,
        [headers.conversion]: `${r.conversion}%`,
        [headers.revenue]: r.revenue,
        [headers.returning]: r.returningRevenue,
      });

      const exportData = stats.flatMap((s) => [
        row(s.name, s, "channel"),
        ...s.campaigns.map((c) => row(`    ↳ ${c.name}`, c, "campaign")),
      ]);
      exportData.push({
        [headers.source]: isAr ? "الإجمالي" : "TOTAL",
        [headers.level]: headers.levelChannel,
        [headers.leadsIn]: totals.total,
        [headers.open]: totals.open,
        [headers.stale]: totals.stale,
        [headers.lost]: totals.lost,
        [headers.won]: totals.won,
        [headers.conversion]: `${totalConversion}%`,
        [headers.revenue]: totals.revenue,
        [headers.returning]: totals.returningRevenue,
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

      const campaignRows = (s: FunnelStat) =>
        s.campaigns
          .map(
            (c) => `
        <tr style="background: #f8fafc;">
          ${td(`&nbsp;&nbsp;&nbsp;&nbsp;↳ ${c.name}`, "color: #475569;")}
          ${td(String(c.total), "color: #475569;")}
          ${td(c.stale > 0 ? `${c.open} (${c.stale} ${isAr ? "ساكن" : "stale"})` : String(c.open), "color: #475569;")}
          ${td(String(c.lost), "color: #9f1239;")}
          ${td(String(c.won), "color: #047857;")}
          ${td(`${c.conversion}%`, "color: #475569;")}
          ${td(c.revenue.toLocaleString(), "color: #1d4ed8;")}
          ${td(c.returningRevenue.toLocaleString(), "color: #94a3b8;")}
        </tr>
      `
          )
          .join("");

      const rowsHtml = stats.map((s) => `
        <tr>
          ${td(s.name, "font-weight: 700;")}
          ${td(String(s.total))}
          ${td(s.stale > 0 ? `${s.open} (${s.stale} ${isAr ? "ساكن" : "stale"})` : String(s.open))}
          ${td(String(s.lost), "color: #e11d48;")}
          ${td(String(s.won), "font-weight: 700; color: #059669;")}
          ${td(`${s.conversion}%`, "font-weight: 700;")}
          ${td(s.revenue.toLocaleString(), "font-weight: 700; color: #2563eb;")}
          ${td(s.returningRevenue.toLocaleString(), "color: #64748b;")}
        </tr>
        ${campaignRows(s)}
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
          ${td(totals.returningRevenue.toLocaleString(), "color: #64748b;")}
        </tr>
      `;

      const tableHtml = `
        <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
            <thead><tr>
              ${th(headers.source)}${th(headers.leadsIn)}${th(headers.open)}${th(headers.lost)}${th(headers.won)}${th(headers.conversion)}${th(headers.revenue)}${th(headers.returning)}
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
        <p className="font-bold text-ink-muted">
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { l: headers.leadsIn, v: totals.total.toString(), c: "text-ink", note: "" },
          { l: headers.won, v: totals.won.toString(), c: "text-emerald-600", note: "" },
          { l: headers.conversion, v: `${totalConversion}%`, c: "text-violet-600", note: "" },
          {
            l: isAr ? "متوسط زمن أول رد" : "Avg. time to reply",
            v: humanMinutes(avgMinutesToContact),
            c: avgMinutesToContact !== null && avgMinutesToContact <= 60 ? "text-emerald-600" : "text-amber-600",
            note: isAr ? "من وصول العميل لأول تحرك" : "from arrival to first move",
          },
          {
            l: headers.revenue,
            v: `${totals.revenue.toLocaleString()} EGP`,
            c: "text-blue-600",
            note: totals.returningRevenue > 0
              ? (isAr ? `+${totals.returningRevenue.toLocaleString()} من مرضى قدامى` : `+${totals.returningRevenue.toLocaleString()} from returning patients`)
              : "",
          },
        ].map((k) => (
          <div key={k.l} className="bg-surface border border-line shadow-sm rounded-2xl p-4">
            <p className="text-[10px] font-black text-ink-muted uppercase tracking-wider">{k.l}</p>
            <p className={`text-xl font-black tabular-nums mt-1 ${k.c}`}>{k.v}</p>
            {k.note && <p className="text-[10px] font-bold text-slate-400 mt-0.5">{k.note}</p>}
          </div>
        ))}
      </div>

      {/* Channels table */}
      <div className="bg-surface rounded-2xl border border-line shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center gap-2 flex-wrap">
          <h3 className="text-sm font-black text-ink">{isAr ? "القنوات التسويقية" : "Channels"}</h3>
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
              <tr className="bg-surface-subtle text-[9px] font-black text-ink-muted uppercase">
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
                <React.Fragment key={s.name}>
                  <tr
                    className={`transition-colors ${s.campaigns.length > 0 ? "cursor-pointer hover:bg-indigo-50/40" : "hover:bg-slate-50/60"}`}
                    onClick={() => s.campaigns.length > 0 && setExpanded(expanded === s.name ? null : s.name)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <SourceIcon source={s.name} size={18} />
                        <span className="font-bold text-slate-800">{s.name}</span>
                        {s.campaigns.length > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] font-black text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded-full">
                            {s.campaigns.length} {isAr ? "حملة" : s.campaigns.length === 1 ? "campaign" : "campaigns"}
                            {expanded === s.name ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-surface-muted overflow-hidden max-w-[160px]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(6, Math.round((s.total / maxTotal) * 100))}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center font-black text-slate-800 tabular-nums">{s.total}</td>
                    <td className="py-3 px-3 text-center font-bold text-sky-600 tabular-nums">
                      {s.open}
                      {s.stale > 0 && (
                        <span className="block text-[10px] font-black text-slate-400">
                          {s.stale} {isAr ? "ساكن" : "stale"}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center font-bold text-rose-500 tabular-nums">{s.lost}</td>
                    <td className="py-3 px-3 text-center font-black text-emerald-600 tabular-nums">{s.won}</td>
                    <td className="py-3 px-3 text-center font-black text-violet-600 tabular-nums">{s.conversion}%</td>
                    <td className="py-3 px-4 text-end font-black text-blue-600 tabular-nums">
                      {s.revenue.toLocaleString()}
                      {s.returningRevenue > 0 && (
                        <span className="block text-[10px] font-black text-slate-400">
                          +{s.returningRevenue.toLocaleString()} {isAr ? "عائد" : "returning"}
                        </span>
                      )}
                    </td>
                  </tr>
                  {expanded === s.name &&
                    s.campaigns.map((c) => (
                      <tr key={`${s.name}::${c.name}`} className="bg-indigo-50/30">
                        <td className="py-2 px-4">
                          <span className="flex items-center gap-1.5 ps-6 text-xs font-bold text-ink-body">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 shrink-0" />
                            {c.name}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center text-xs font-bold text-slate-700 tabular-nums">{c.total}</td>
                        <td className="py-2 px-3 text-center text-xs font-bold text-sky-600 tabular-nums">{c.open}</td>
                        <td className="py-2 px-3 text-center text-xs font-bold text-rose-500 tabular-nums">{c.lost}</td>
                        <td className="py-2 px-3 text-center text-xs font-bold text-emerald-600 tabular-nums">{c.won}</td>
                        <td className="py-2 px-3 text-center text-xs font-bold text-violet-600 tabular-nums">{c.conversion}%</td>
                        <td className="py-2 px-4 text-end text-xs font-bold text-blue-600 tabular-nums">{c.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-subtle font-black text-slate-800">
                <td className="py-3 px-4">{isAr ? "الإجمالي" : "TOTAL"}</td>
                <td className="py-3 px-3 text-center tabular-nums">{totals.total}</td>
                <td className="py-3 px-3 text-center tabular-nums text-sky-600">
                  {totals.open}
                  {totals.stale > 0 && (
                    <span className="block text-[10px] font-black text-slate-400">
                      {totals.stale} {isAr ? "ساكن" : "stale"}
                    </span>
                  )}
                </td>
                <td className="py-3 px-3 text-center tabular-nums text-rose-500">{totals.lost}</td>
                <td className="py-3 px-3 text-center tabular-nums text-emerald-600">{totals.won}</td>
                <td className="py-3 px-3 text-center tabular-nums text-violet-600">{totalConversion}%</td>
                <td className="py-3 px-4 text-end tabular-nums text-blue-600">
                  {totals.revenue.toLocaleString()}
                  {totals.returningRevenue > 0 && (
                    <span className="block text-[10px] font-black text-slate-400">
                      +{totals.returningRevenue.toLocaleString()} {isAr ? "عائد" : "returning"}
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="px-5 py-3 text-[11px] font-semibold text-slate-400 border-t border-slate-50">
          {isAr
            ? `الدخل = المدفوعات خلال الفترة من المرضى اللي اتسجلوا كعملاء محتملين ووصلوا لمرحلة "${leadStageLabel("won", "ar")}". فلوس المرضى القدامى بتتحسب لوحدها ("عائد") — القناة تاخد فضل المرضى اللي جابتهم، مش علاج كان هيحصل أصلاً. و"ساكن" يعني مفيش أي حركة على العميل من ${STALE_LABEL_DAYS} يوم.`
            : `Revenue = payments in this period from patients whose lead reached "${leadStageLabel("won", "en")}". Money from patients the clinic already had is counted separately ("returning") — a channel gets credit for the patients it brought, not treatment that was happening anyway. "Stale" means nobody has touched the lead in ${STALE_LABEL_DAYS} days.`}
        </p>
      </div>
    </div>
  );
}
