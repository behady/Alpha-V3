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
  Activity, BarChart3, Building2, CalendarDays, CalendarRange, Clock, FlaskConical, Grid3x3, Heart, Landmark, MessageCircle, Network, Package, Percent, PieChart, Receipt, Repeat, Stethoscope, TableProperties, TrendingUp, UserCheck, UserPlus, Users, Wallet, Megaphone, ClipboardCheck, BellRing, Cake,
} from "lucide-react";
import type { DatasetKey } from "@/components/reports/useReportData";
import type { FeatureKey } from "@/lib/featureCatalog";
import type { ReportProps } from "@/components/reports/types";

import ServiceReport from "@/components/reports/ServiceReport";
import DentistReport from "@/components/reports/DentistReport";
import SourceReport from "@/components/reports/SourceReport";
import ClinicReport from "@/components/reports/ClinicReport";
import LeadFunnelReport from "@/components/reports/LeadFunnelReport";
import PayerReport from "@/components/reports/PayerReport";
import CaseSheetReport from "@/components/reports/CaseSheetReport";
import CompareReport from "@/components/reports/CompareReport";
import YearReviewReport from "@/components/reports/YearReviewReport";
import HeatmapReport from "@/components/reports/HeatmapReport";
import DentistTrendReport from "@/components/reports/DentistTrendReport";
import PnlReport from "@/components/reports/PnlReport";
import ExpensesReport from "@/components/reports/ExpensesReport";
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

export type ReportGroupId = "overview" | "money" | "patients" | "operations" | "marketing";

export const REPORT_GROUPS: { id: ReportGroupId; en: string; ar: string; icon: ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "overview", en: "Overview", ar: "نظرة عامة", icon: Building2 },
  { id: "money", en: "Money", ar: "الفلوس", icon: Wallet },
  { id: "patients", en: "Patients", ar: "المرضى", icon: Users },
  { id: "operations", en: "Operations", ar: "التشغيل", icon: Activity },
  { id: "marketing", en: "Marketing", ar: "التسويق", icon: Megaphone },
];

export type ReportDef = {
  id: string;
  group: ReportGroupId;
  en: string;
  ar: string;
  /** One line under the title, saying what the report answers. */
  hintEn: string;
  hintAr: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  needs: DatasetKey[];
  /** The add-on this report belongs to; shown locked when the clinic does not have it. */
  feature?: FeatureKey;
  /** True when the report runs over the whole history rather than the range on screen. */
  allTime?: boolean;
  render: (p: ReportProps & { payers: Payer[] }) => ReactNode;
};

export const REPORTS: ReportDef[] = [
  // --- overview ----------------------------------------------------------------------------------
  { id: "clinic", group: "overview", en: "Clinic Overview", ar: "نظرة عامة", hintEn: "The period in one screen.", hintAr: "الفترة في شاشة واحدة.", icon: Building2, needs: [],
    render: (p) => <ClinicReport procedures={p.procedures} payments={p.payments} allPatients={p.allPatients} startDate={p.range.start} endDate={p.range.end} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  { id: "compare", group: "overview", en: "vs Previous Period", ar: "مقارنة بالفترة السابقة", hintEn: "This period against the one before it.", hintAr: "الفترة دي مقابل اللي قبلها.", icon: CalendarRange, needs: ["ledgerPrev"],
    render: (p) => <CompareReport {...p} mode="previous" /> },
  { id: "lastYear", group: "overview", en: "vs Last Year", ar: "مقارنة بالسنة اللي فاتت", hintEn: "The same dates a year earlier.", hintAr: "نفس التواريخ السنة اللي فاتت.", icon: Repeat, needs: ["ledgerLastYear"],
    render: (p) => <CompareReport {...p} mode="lastYear" /> },
  { id: "year", group: "overview", en: "Year in Review", ar: "السنة شهر بشهر", hintEn: "The last twelve months, month by month.", hintAr: "آخر ١٢ شهر، شهر بشهر.", icon: BarChart3, needs: ["ledgerMonths12"],
    render: (p) => <YearReviewReport {...p} /> },
  { id: "heatmap", group: "overview", en: "Days & Hours", ar: "الأيام والساعات", hintEn: "When patients and money actually happen.", hintAr: "المرضى والفلوس بييجوا إمتى بالظبط.", icon: Grid3x3, needs: ["appointments"],
    render: (p) => <HeatmapReport {...p} /> },

  // --- money ---------------------------------------------------------------------------------------
  { id: "pnl", group: "money", en: "Profit & Loss", ar: "الأرباح والخسائر", hintEn: "Gross to net, the way an accountant lays it out.", hintAr: "من الإجمالي للصافي زي ما المحاسب بيكتبها.", icon: Landmark, needs: ["ledgerMonths12"],
    render: (p) => <PnlReport {...p} /> },
  { id: "service", group: "money", en: "Service Analysis", ar: "تحليل الخدمات", hintEn: "What each treatment earned.", hintAr: "كل علاج جاب كام.", icon: Stethoscope, needs: [],
    render: (p) => <ServiceReport procedures={p.procedures} payments={p.payments} allPatients={p.allPatients} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  { id: "dentist", group: "money", en: "Dentist Performance", ar: "أداء الأطباء", hintEn: "Income, commission and cases per dentist.", hintAr: "دخل وعمولة وحالات كل دكتور.", icon: UserCheck, needs: [],
    render: (p) => <DentistReport procedures={p.procedures} payments={p.payments} allPatients={p.allPatients} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  { id: "dentistTrend", group: "money", en: "Dentist Trend", ar: "الأطباء شهر بشهر", hintEn: "Each dentist over the last twelve months.", hintAr: "كل دكتور على مدار ١٢ شهر.", icon: TrendingUp, needs: ["ledgerMonths12"],
    render: (p) => <DentistTrendReport {...p} /> },
  { id: "payers", group: "money", en: "Insurance & Payers", ar: "التأمين وجهات الدفع", hintEn: "Charged against collected, per payer.", hintAr: "المطلوب مقابل المحصّل لكل جهة.", icon: Wallet, needs: [],
    render: (p) => <PayerReport procedures={p.procedures as LedgerRowLite[]} payments={p.payments as LedgerRowLite[]} payers={p.payers} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  { id: "receivables", group: "money", en: "Outstanding Balances", ar: "المستحقات", hintEn: "Who owes what, and for how long.", hintAr: "مين عليه كام، ومن إمتى.", icon: Receipt, needs: ["ledgerAll"], allTime: true,
    render: (p) => <ReceivablesReport {...p} /> },
  { id: "expenses", group: "money", en: "Expenses", ar: "المصروفات", hintEn: "Where the clinic's own money goes.", hintAr: "فلوس العيادة بتروح فين.", icon: PieChart, needs: ["ledgerMonths12"],
    render: (p) => <ExpensesReport {...p} /> },
  { id: "discounts", group: "money", en: "Discounts", ar: "الخصومات", hintEn: "What was given away, by whom, and why.", hintAr: "اتخصم كام، من مين، وليه.", icon: Percent, needs: [],
    render: (p) => <DiscountsReport {...p} /> },
  { id: "methods", group: "money", en: "Payment Methods", ar: "طرق الدفع", hintEn: "Cash, card and transfer, day by day.", hintAr: "كاش وفيزا وتحويل، يوم بيوم.", icon: Landmark, needs: [],
    render: (p) => <PaymentMethodsReport {...p} /> },
  { id: "cases", group: "money", en: "Case Sheet", ar: "سجل الحالات", hintEn: "One line per case, filterable.", hintAr: "سطر لكل حالة، بفلاتر.", icon: TableProperties, needs: [],
    render: (p) => <CaseSheetReport procedures={p.procedures} payments={p.payments} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },

  // --- patients ------------------------------------------------------------------------------------
  { id: "source", group: "patients", en: "Patient Sources", ar: "مصادر المرضى", hintEn: "Where patients heard about the clinic.", hintAr: "المرضى عرفوا العيادة منين.", icon: Network, needs: [],
    render: (p) => <SourceReport procedures={p.procedures} payments={p.payments} allPatients={p.allPatients} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  { id: "retention", group: "patients", en: "Retention", ar: "الرجوع", hintEn: "Who comes back, and who stopped.", hintAr: "مين بيرجع، ومين بطّل.", icon: Heart, needs: ["ledgerAll", "appointmentsWide"], allTime: true,
    render: (p) => <RetentionReport {...p} /> },
  { id: "recall", group: "patients", en: "Recall Due", ar: "الاستدعاء", hintEn: "Due back and not booked.", hintAr: "ميعادهم جه ومحجزوش.", icon: BellRing, needs: ["ledgerAll", "appointmentsWide", "recallSettings"], allTime: true,
    render: (p) => <RecallReport {...p} /> },
  { id: "ltv", group: "patients", en: "Patient Value", ar: "قيمة المريض", hintEn: "What a patient is worth over their lifetime.", hintAr: "المريض بيساوي كام على طول.", icon: UserPlus, needs: ["ledgerAll"], allTime: true,
    render: (p) => <LtvReport {...p} /> },
  { id: "demographics", group: "patients", en: "Demographics", ar: "الأعمار والنوع", hintEn: "Age and gender, and what each group comes for.", hintAr: "الأعمار والنوع، وكل فئة بتيجي ليه.", icon: Cake, needs: [],
    render: (p) => <DemographicsReport {...p} /> },
  { id: "plans", group: "patients", en: "Treatment Plans", ar: "خطط العلاج", hintEn: "Presented, accepted, and actually done.", hintAr: "اتعرضت، اتقبلت، واتعملت فعلاً.", icon: ClipboardCheck, needs: ["treatmentPlans", "ledgerAll"], allTime: true,
    render: (p) => <PlanConversionReport {...p} /> },

  // --- operations ----------------------------------------------------------------------------------
  { id: "appointments", group: "operations", en: "Appointments", ar: "المواعيد", hintEn: "Seen, missed, cancelled; by day, dentist and source.", hintAr: "حضور وغياب وإلغاء؛ باليوم والدكتور والمصدر.", icon: CalendarDays, needs: ["appointments"],
    render: (p) => <AppointmentsReport {...p} /> },
  { id: "lab", group: "operations", en: "Lab", ar: "المعمل", hintEn: "Turnaround, remakes and cost, per lab.", hintAr: "المدة والإعادة والتكلفة، لكل معمل.", icon: FlaskConical, needs: ["labCases", "labPayments"], feature: "lab",
    render: (p) => <LabReport {...p} /> },
  { id: "attendance", group: "operations", en: "Attendance & Payroll", ar: "الحضور والمرتبات", hintEn: "Hours, lateness, overtime and pay.", hintAr: "ساعات وتأخير وإضافي ومرتب.", icon: Clock, needs: ["staff", "punches"], feature: "attendance",
    render: (p) => <AttendanceReport {...p} /> },
  { id: "inventory", group: "operations", en: "Inventory", ar: "المخزون", hintEn: "Stock value, usage and what to order.", hintAr: "قيمة المخزون والاستهلاك واللي يتطلب.", icon: Package, needs: ["inventory", "inventoryTx"], feature: "inventory",
    render: (p) => <InventoryReport {...p} /> },

  // --- marketing -----------------------------------------------------------------------------------
  { id: "leads", group: "marketing", en: "Marketing Funnel", ar: "قمع التسويق", hintEn: "Leads in, patients out, per channel.", hintAr: "عملاء داخلين ومرضى طالعين، لكل قناة.", icon: Megaphone, needs: [], feature: "leads",
    render: (p) => <LeadFunnelReport leads={p.leads} payments={p.payments} rangeLabel={p.rangeLabel} isAr={p.isAr} /> },
  { id: "whatsapp", group: "marketing", en: "WhatsApp & Assistant", ar: "واتساب والمساعد", hintEn: "What the assistant carried, and how fast people answered.", hintAr: "المساعد شال إيه، والناس ردّت بسرعة قد إيه.", icon: MessageCircle, needs: ["conversations", "appointments", "whatsappLogs", "smsOutbox"], feature: "whatsappIntegration",
    render: (p) => <WhatsappReport {...p} /> },
  { id: "ads", group: "marketing", en: "Ads → WhatsApp", ar: "إعلانات واتساب", hintEn: "Which ad opened chats, and which chats became patients.", hintAr: "أنهي إعلان فتح محادثات، وأنهي محادثات بقت مرضى.", icon: Megaphone, needs: ["conversations", "appointments"], feature: "whatsappIntegration",
    render: (p) => <AdsReport {...p} /> },
];

export function reportById(id: string | null | undefined): ReportDef {
  return REPORTS.find((r) => r.id === id) || REPORTS[0];
}
