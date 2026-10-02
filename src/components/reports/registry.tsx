"use client";

/**
 * Every report the Reports page can show, in one list.
 *
 * Twenty-seven tabs in one pill rail is a wall. They are grouped by the QUESTION being asked —
 * how is it going, where is the money, who are the patients, is the place running, is the
 * marketing working — and each entry says what data it needs, so the page fetches only that
 * (see useReportData) and can name the add-on a locked report belongs to.
 *
 * Order within a group is the order a person would ask the questions.
 */

import type { ComponentType, ReactNode } from "react";
import {
  Activity, BarChart3, Building2, CalendarDays, CalendarRange, Clock, FileSpreadsheet, FlaskConical, Grid3x3, Heart, Landmark, MessageCircle, Network, Package, Percent, PieChart, Receipt, Repeat, Stethoscope, TableProperties, TrendingUp, UserCheck, UserPlus, Users, Wallet, Megaphone, ClipboardCheck, BellRing, Cake, ArrowLeftRight, Coins, Layers,
} from "lucide-react";
import { REPORT_CATALOG, REPORT_GROUP_META, type ReportGroupId, type ReportMeta } from "@/lib/reports/catalog";
import type { ReportProps } from "@/components/reports/types";

import ServiceReport from "@/components/reports/ServiceReport";
import DentistReport from "@/components/reports/DentistReport";
import SourceReport from "@/components/reports/SourceReport";
import ClinicReport from "@/components/reports/ClinicReport";
import LeadFunnelReport from "@/components/reports/LeadFunnelReport";
import PayerReport from "@/components/reports/PayerReport";
import InsuranceStatementReport from "@/components/reports/InsuranceStatementReport";
import CaseSheetReport from "@/components/reports/CaseSheetReport";
import CompareReport from "@/components/reports/CompareReport";
import YearReviewReport from "@/components/reports/YearReviewReport";
import HeatmapReport from "@/components/reports/HeatmapReport";
import DentistTrendReport from "@/components/reports/DentistTrendReport";
import PnlReport from "@/components/reports/PnlReport";
import ExpensesReport from "@/components/reports/ExpensesReport";
import IncomeSourcesReport from "@/components/reports/IncomeSourcesReport";
import ExpenseTrendReport from "@/components/reports/ExpenseTrendReport";
import CashflowReport from "@/components/reports/CashflowReport";
import ReceivablesReport from "@/components/reports/ReceivablesReport";
import DiscountsReport from "@/components/reports/DiscountsReport";
import PaymentMethodsReport from "@/components/reports/PaymentMethodsReport";
import RetentionReport from "@/components/reports/RetentionReport";
import RecallReport from "@/components/reports/RecallReport";
import LtvReport from "@/components/reports/LtvReport";
import DemographicsReport from "@/components/reports/DemographicsReport";
import PlanConversionReport from "@/components/reports/PlanConversionReport";
import AppointmentsReport from "@/components/reports/AppointmentsReport";
import LabReport from "@/components/reports/LabReport";
import AttendanceReport from "@/components/reports/AttendanceReport";
import InventoryReport from "@/components/reports/InventoryReport";
import WhatsappReport from "@/components/reports/WhatsappReport";
import AdsReport from "@/components/reports/AdsReport";
import type { Payer } from "@/lib/payers";
import type { LedgerRowLite } from "@/lib/payerReport";

export type { ReportGroupId };

export const REPORT_GROUPS: { id: ReportGroupId; en: string; ar: string; icon: ComponentType<{ size?: number; className?: string }> }[] = REPORT_GROUP_META.map((g) => ({
  ...g,
  icon: { overview: Building2, money: Wallet, patients: Users, operations: Activity, marketing: Megaphone }[g.id],
}));

export type ReportDef = ReportMeta & {
  icon: ComponentType<{ size?: number; className?: string }>;
  render: (p: ReportProps & { payers: Payer[] }) => ReactNode;
};

/** The website's half of each report: an icon and how to draw it. The rest comes from the catalog. */
const RENDERERS: Record<string, { icon: ComponentType<{ size?: number; className?: string }>; render: ReportDef["render"] }> = {
  clinic: { icon: Building2, render: (p) => <ClinicReport procedures={p.procedures} payments={p.payments} allPatients={p.allPatients} startDate={p.range.start} endDate={p.range.end} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  compare: { icon: CalendarRange, render: (p) => <CompareReport {...p} mode="previous" /> },
  lastYear: { icon: Repeat, render: (p) => <CompareReport {...p} mode="lastYear" /> },
  year: { icon: BarChart3, render: (p) => <YearReviewReport {...p} /> },
  heatmap: { icon: Grid3x3, render: (p) => <HeatmapReport {...p} /> },
  pnl: { icon: Landmark, render: (p) => <PnlReport {...p} /> },
  incomeSources: { icon: Coins, render: (p) => <IncomeSourcesReport {...p} /> },
  expenseTrend: { icon: Layers, render: (p) => <ExpenseTrendReport {...p} /> },
  cashflow: { icon: ArrowLeftRight, render: (p) => <CashflowReport {...p} /> },
  service: { icon: Stethoscope, render: (p) => <ServiceReport procedures={p.procedures} payments={p.payments} allPatients={p.allPatients} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  dentist: { icon: UserCheck, render: (p) => <DentistReport procedures={p.procedures} payments={p.payments} allPatients={p.allPatients} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  dentistTrend: { icon: TrendingUp, render: (p) => <DentistTrendReport {...p} /> },
  payers: { icon: Wallet, render: (p) => <PayerReport procedures={p.procedures as LedgerRowLite[]} payments={p.payments as LedgerRowLite[]} payers={p.payers} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  insurance: { icon: FileSpreadsheet, render: (p) => <InsuranceStatementReport {...p} /> },
  receivables: { icon: Receipt, render: (p) => <ReceivablesReport {...p} /> },
  expenses: { icon: PieChart, render: (p) => <ExpensesReport {...p} /> },
  discounts: { icon: Percent, render: (p) => <DiscountsReport {...p} /> },
  methods: { icon: Landmark, render: (p) => <PaymentMethodsReport {...p} /> },
  cases: { icon: TableProperties, render: (p) => <CaseSheetReport procedures={p.procedures} payments={p.payments} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  source: { icon: Network, render: (p) => <SourceReport procedures={p.procedures} payments={p.payments} allPatients={p.allPatients} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  retention: { icon: Heart, render: (p) => <RetentionReport {...p} /> },
  recall: { icon: BellRing, render: (p) => <RecallReport {...p} /> },
  ltv: { icon: UserPlus, render: (p) => <LtvReport {...p} /> },
  demographics: { icon: Cake, render: (p) => <DemographicsReport {...p} /> },
  plans: { icon: ClipboardCheck, render: (p) => <PlanConversionReport {...p} /> },
  appointments: { icon: CalendarDays, render: (p) => <AppointmentsReport {...p} /> },
  lab: { icon: FlaskConical, render: (p) => <LabReport {...p} /> },
  attendance: { icon: Clock, render: (p) => <AttendanceReport {...p} /> },
  inventory: { icon: Package, render: (p) => <InventoryReport {...p} /> },
  leads: { icon: Megaphone, render: (p) => <LeadFunnelReport leads={p.leads} payments={p.payments} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  whatsapp: { icon: MessageCircle, render: (p) => <WhatsappReport {...p} /> },
  ads: { icon: Megaphone, render: (p) => <AdsReport {...p} /> },
};

export const REPORTS: ReportDef[] = REPORT_CATALOG.map((meta) => ({ ...meta, ...(RENDERERS[meta.id] || RENDERERS.clinic) }));

export function reportById(id: string | null | undefined): ReportDef {
  return REPORTS.find((r) => r.id === id) || REPORTS[0];
}
