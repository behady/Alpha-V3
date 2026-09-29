/**
 * Every report, described once, with no React in it.
 *
 * The website's registry (components/reports/registry.tsx) adds a `render` to each of these; the
 * phone's report route (app/api/reports) reads the same list to know what exists, what data each
 * report needs, and which add-on locks it. One list, two readers, so a report added here appears
 * on both the website and the phone with the same name.
 */

import type { FeatureKey } from "@/lib/featureCatalog";

export type ReportGroupId = "overview" | "money" | "patients" | "operations" | "marketing";

export type DatasetKey =
  | "ledgerPrev"
  | "ledgerLastYear"
  | "ledgerMonths12"
  | "ledgerAll"
  | "appointments"
  | "appointmentsWide"
  | "treatmentPlans"
  | "labCases"
  | "labPayments"
  | "inventory"
  | "inventoryTx"
  | "staff"
  | "punches"
  | "conversations"
  | "whatsappLogs"
  | "smsOutbox"
  | "recallSettings";

export const REPORT_GROUP_META: { id: ReportGroupId; en: string; ar: string }[] = [
  { id: "overview", en: "Overview", ar: "نظرة عامة" },
  { id: "money", en: "Money", ar: "الفلوس" },
  { id: "patients", en: "Patients", ar: "المرضى" },
  { id: "operations", en: "Operations", ar: "التشغيل" },
  { id: "marketing", en: "Marketing", ar: "التسويق" },
];

export type ReportMeta = {
  id: string;
  group: ReportGroupId;
  en: string;
  ar: string;
  hintEn: string;
  hintAr: string;
  needs: DatasetKey[];
  /** The add-on this report belongs to; locked when the clinic does not have it. */
  feature?: FeatureKey;
  /** True when the report runs over the whole history rather than the range on screen. */
  allTime?: boolean;
};

export const REPORT_CATALOG: ReportMeta[] = [
  { id: "clinic", group: "overview", en: "Clinic Overview", ar: "نظرة عامة", hintEn: "The period in one screen.", hintAr: "الفترة في شاشة واحدة.", needs: [] },
  { id: "compare", group: "overview", en: "vs Previous Period", ar: "مقارنة بالفترة السابقة", hintEn: "This period against the one before it.", hintAr: "الفترة دي مقابل اللي قبلها.", needs: ["ledgerPrev"] },
  { id: "lastYear", group: "overview", en: "vs Last Year", ar: "مقارنة بالسنة اللي فاتت", hintEn: "The same dates a year earlier.", hintAr: "نفس التواريخ السنة اللي فاتت.", needs: ["ledgerLastYear"] },
  { id: "year", group: "overview", en: "Year in Review", ar: "السنة شهر بشهر", hintEn: "The last twelve months, month by month.", hintAr: "آخر ١٢ شهر، شهر بشهر.", needs: ["ledgerMonths12"] },
  { id: "heatmap", group: "overview", en: "Days & Hours", ar: "الأيام والساعات", hintEn: "When patients and money actually happen.", hintAr: "المرضى والفلوس بييجوا إمتى بالظبط.", needs: ["appointments"] },

  { id: "pnl", group: "money", en: "Profit & Loss", ar: "الأرباح والخسائر", hintEn: "Gross to net, the way an accountant lays it out.", hintAr: "من الإجمالي للصافي زي ما المحاسب بيكتبها.", needs: ["ledgerMonths12"] },
  { id: "service", group: "money", en: "Service Analysis", ar: "تحليل الخدمات", hintEn: "What each treatment earned.", hintAr: "كل علاج جاب كام.", needs: [] },
  { id: "dentist", group: "money", en: "Dentist Performance", ar: "أداء الأطباء", hintEn: "Income, commission and cases per dentist.", hintAr: "دخل وعمولة وحالات كل دكتور.", needs: [] },
  { id: "dentistTrend", group: "money", en: "Dentist Trend", ar: "الأطباء شهر بشهر", hintEn: "Each dentist over the last twelve months.", hintAr: "كل دكتور على مدار ١٢ شهر.", needs: ["ledgerMonths12"] },
  { id: "payers", group: "money", en: "Insurance & Payers", ar: "التأمين وجهات الدفع", hintEn: "Charged against collected, per payer.", hintAr: "المطلوب مقابل المحصّل لكل جهة.", needs: [] },
  { id: "receivables", group: "money", en: "Outstanding Balances", ar: "المستحقات", hintEn: "Who owes what, and for how long.", hintAr: "مين عليه كام، ومن إمتى.", needs: ["ledgerAll"], allTime: true },
  { id: "expenses", group: "money", en: "Expenses", ar: "المصروفات", hintEn: "Where the clinic's own money goes.", hintAr: "فلوس العيادة بتروح فين.", needs: ["ledgerMonths12"] },
  { id: "discounts", group: "money", en: "Discounts", ar: "الخصومات", hintEn: "What was given away, by whom, and why.", hintAr: "اتخصم كام، من مين، وليه.", needs: [] },
  { id: "methods", group: "money", en: "Payment Methods", ar: "طرق الدفع", hintEn: "Cash, card and transfer, day by day.", hintAr: "كاش وفيزا وتحويل، يوم بيوم.", needs: [] },
  { id: "cases", group: "money", en: "Case Sheet", ar: "سجل الحالات", hintEn: "One line per case, filterable.", hintAr: "سطر لكل حالة، بفلاتر.", needs: [] },

  { id: "source", group: "patients", en: "Patient Sources", ar: "مصادر المرضى", hintEn: "Where patients heard about the clinic.", hintAr: "المرضى عرفوا العيادة منين.", needs: [] },
  { id: "retention", group: "patients", en: "Retention", ar: "الرجوع", hintEn: "Who comes back, and who stopped.", hintAr: "مين بيرجع، ومين بطّل.", needs: ["ledgerAll", "appointmentsWide"], allTime: true },
  { id: "recall", group: "patients", en: "Recall Due", ar: "الاستدعاء", hintEn: "Due back and not booked.", hintAr: "ميعادهم جه ومحجزوش.", needs: ["ledgerAll", "appointmentsWide", "recallSettings"], allTime: true },
  { id: "ltv", group: "patients", en: "Patient Value", ar: "قيمة المريض", hintEn: "What a patient is worth over their lifetime.", hintAr: "المريض بيساوي كام على طول.", needs: ["ledgerAll"], allTime: true },
  { id: "demographics", group: "patients", en: "Demographics", ar: "الأعمار والنوع", hintEn: "Age and gender, and what each group comes for.", hintAr: "الأعمار والنوع، وكل فئة بتيجي ليه.", needs: [] },
  { id: "plans", group: "patients", en: "Treatment Plans", ar: "خطط العلاج", hintEn: "Presented, accepted, and actually done.", hintAr: "اتعرضت، اتقبلت، واتعملت فعلاً.", needs: ["treatmentPlans", "ledgerAll"], allTime: true },

  { id: "appointments", group: "operations", en: "Appointments", ar: "المواعيد", hintEn: "Seen, missed, cancelled; by day, dentist and source.", hintAr: "حضور وغياب وإلغاء؛ باليوم والدكتور والمصدر.", needs: ["appointments"] },
  { id: "lab", group: "operations", en: "Lab", ar: "المعمل", hintEn: "Turnaround, remakes and cost, per lab.", hintAr: "المدة والإعادة والتكلفة، لكل معمل.", needs: ["labCases", "labPayments"], feature: "lab" },
  { id: "attendance", group: "operations", en: "Attendance & Payroll", ar: "الحضور والمرتبات", hintEn: "Hours, lateness, overtime and pay.", hintAr: "ساعات وتأخير وإضافي ومرتب.", needs: ["staff", "punches"], feature: "attendance" },
  { id: "inventory", group: "operations", en: "Inventory", ar: "المخزون", hintEn: "Stock value, usage and what to order.", hintAr: "قيمة المخزون والاستهلاك واللي يتطلب.", needs: ["inventory", "inventoryTx"], feature: "inventory" },

  { id: "leads", group: "marketing", en: "Marketing Funnel", ar: "قمع التسويق", hintEn: "Leads in, patients out, per channel.", hintAr: "عملاء داخلين ومرضى طالعين، لكل قناة.", needs: [], feature: "leads" },
  { id: "whatsapp", group: "marketing", en: "WhatsApp & Assistant", ar: "واتساب والمساعد", hintEn: "What the assistant carried, and how fast people answered.", hintAr: "المساعد شال إيه، والناس ردّت بسرعة قد إيه.", needs: ["conversations", "appointments", "whatsappLogs", "smsOutbox"], feature: "whatsappIntegration" },
  { id: "ads", group: "marketing", en: "Ads → WhatsApp", ar: "إعلانات واتساب", hintEn: "Which ad opened chats, and which chats became patients.", hintAr: "أنهي إعلان فتح محادثات، وأنهي محادثات بقت مرضى.", needs: ["conversations", "appointments"], feature: "whatsappIntegration" },
];

export function reportMeta(id: string | null | undefined): ReportMeta {
  return REPORT_CATALOG.find((r) => r.id === id) || REPORT_CATALOG[0];
}
