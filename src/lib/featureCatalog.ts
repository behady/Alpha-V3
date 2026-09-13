import { hasFeature, type TIER_LIMITS } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";

/**
 * Every add-on the platform sells, in one list.
 *
 * The superadmin panel renders its switches from this, and the locked screen a clinic sees
 * takes its wording from here, so a feature that is not in this list cannot be switched on for
 * anyone and cannot explain itself when it is off. `TIER_LIMITS` in subscriptions.ts still
 * decides what each plan starts with; this only names and groups the keys it defines.
 */
export type FeatureKey = keyof (typeof TIER_LIMITS)["Basic"]["features"];

export type FeatureGroup = "messaging" | "ai" | "modules" | "marketing";

export interface FeatureInfo {
  key: FeatureKey;
  group: FeatureGroup;
  labelEn: string;
  labelAr: string;
  /** One sentence, shown under the switch to whoever is selling it and on the locked screen. */
  descEn: string;
  descAr: string;
  /** Another add-on this one is useless without. The switch is shown but the gate checks both. */
  requires?: FeatureKey;
}

/** The number a locked clinic is told to write to. Egyptian mobile, stored in E.164. */
export const SUPPORT_WHATSAPP = "+201551552440";

export const FEATURE_GROUPS: { id: FeatureGroup; labelEn: string; labelAr: string }[] = [
  { id: "messaging", labelEn: "WhatsApp", labelAr: "واتساب" },
  { id: "ai", labelEn: "AI", labelAr: "الذكاء الاصطناعي" },
  { id: "modules", labelEn: "Modules", labelAr: "الوحدات" },
  { id: "marketing", labelEn: "Marketing", labelAr: "التسويق" },
];

export const FEATURE_CATALOG: FeatureInfo[] = [
  {
    key: "whatsappIntegration",
    group: "messaging",
    labelEn: "WhatsApp Auto Messages",
    labelAr: "رسائل واتساب التلقائية",
    descEn: "Confirmations, changes, receipts, reminders, recalls and review requests sent on their own.",
    descAr: "تأكيدات ومواعيد وإيصالات وتذكيرات ومتابعات تتبعت لوحدها من غير تدخل.",
  },
  {
    key: "whatsappBot",
    group: "messaging",
    labelEn: "WhatsApp Receptionist",
    labelAr: "موظف الاستقبال على واتساب",
    // Its own add-on, on purpose: it shares the connected number with the automatic messages
    // but neither needs the other. Its rule-based answers cost the platform nothing (Meta does
    // not bill replies inside the 24-hour window); the AI-written answers it can fall back to
    // spend the clinic's AI credits and therefore need the AI Assistant add-on as well.
    descEn: "Answers patients on WhatsApp, books and reschedules by itself. AI-written replies also need the AI Assistant.",
    descAr: "يرد على المرضى على واتساب ويحجز ويعدّل المواعيد بنفسه. الردود المكتوبة بالذكاء الاصطناعي تحتاج المساعد الذكي كمان.",
  },
  {
    key: "clinicalPdfs",
    group: "messaging",
    labelEn: "Clinical PDFs on WhatsApp",
    labelAr: "ملفات PDF الطبية على واتساب",
    descEn: "Prescriptions and treatment plans sent to the patient as a PDF.",
    descAr: "الروشتة وخطة العلاج تتبعت للمريض كملف PDF.",
  },
  {
    key: "aiChat",
    group: "ai",
    labelEn: "AI Assistant",
    labelAr: "المساعد الذكي",
    descEn: "The chat bubble: ask, and it answers from the clinic's own data.",
    descAr: "فقاعة الدردشة: اسأل، ويرد من بيانات العيادة نفسها.",
  },
  {
    key: "aiProactive",
    group: "ai",
    labelEn: "AI Proactive Insights",
    labelAr: "تنبيهات ذكية استباقية",
    descEn: "Daily brief, revenue recovery and reactivation scans the system runs by itself.",
    descAr: "ملخص يومي ومسح للإيرادات الضائعة وإعادة تنشيط المرضى يشتغل لوحده.",
    requires: "aiChat",
  },
  {
    key: "aiEmbedded",
    group: "ai",
    labelEn: "AI Summaries in Records",
    labelAr: "ملخصات ذكية داخل الملفات",
    descEn: "AI summaries shown inline across patient records and appointments.",
    descAr: "ملخصات ذكية تظهر داخل ملفات المرضى والمواعيد.",
    requires: "aiChat",
  },
  {
    key: "aiVoice",
    group: "ai",
    labelEn: "AI Voice Notes",
    labelAr: "الملاحظات الصوتية الذكية",
    descEn: "Dictated clinical notes transcribed and structured into the record.",
    descAr: "ملاحظات منطوقة تتحول لنص منظم داخل الملف.",
    requires: "aiChat",
  },
  {
    key: "onlineBooking",
    group: "modules",
    labelEn: "Online Booking",
    labelAr: "الحجز الإلكتروني",
    descEn: "A public booking page patients open from a link.",
    descAr: "صفحة حجز عامة يفتحها المريض من لينك.",
  },
  {
    key: "leads",
    group: "modules",
    labelEn: "Ads Leads",
    labelAr: "عملاء الإعلانات",
    descEn: "The leads inbox from Facebook and Instagram ads, with automatic follow-up.",
    descAr: "صندوق العملاء المحتملين من إعلانات فيسبوك وإنستجرام مع متابعة تلقائية.",
  },
  {
    key: "lab",
    group: "modules",
    labelEn: "Lab Tracking",
    labelAr: "متابعة المعمل",
    descEn: "Cases sent to dental labs, tracked until they come back.",
    descAr: "الحالات المرسلة للمعامل ومتابعتها لحد ما ترجع.",
  },
  {
    key: "ortho",
    group: "modules",
    labelEn: "Orthodontics",
    labelAr: "التقويم",
    descEn: "Orthodontic case tracking with visit history.",
    descAr: "متابعة حالات التقويم وسجل الزيارات.",
  },
  {
    key: "inventory",
    group: "modules",
    labelEn: "Inventory",
    labelAr: "المخزون",
    descEn: "Stock levels, low-stock alerts and usage per treatment.",
    descAr: "مستويات المخزون وتنبيهات النقص والاستهلاك لكل علاج.",
  },
  {
    key: "attendance",
    group: "modules",
    labelEn: "Attendance & Payroll",
    labelAr: "الحضور والرواتب",
    descEn: "Clock-in from the clinic's own devices, hours and payroll.",
    descAr: "تسجيل الحضور من أجهزة العيادة وحساب الساعات والرواتب.",
  },
  {
    key: "reports",
    group: "modules",
    labelEn: "Reports",
    labelAr: "التقارير",
    descEn: "Revenue, services, dentists and patient reports over any date range.",
    descAr: "تقارير الإيرادات والخدمات والأطباء والمرضى لأي فترة.",
  },
  {
    key: "multiBranch",
    group: "modules",
    labelEn: "Multiple Branches",
    labelAr: "أكثر من فرع",
    descEn: "A second branch and beyond. One branch is always included.",
    descAr: "فرع تاني وأكتر. الفرع الأول موجود دايماً.",
  },
  {
    key: "marketingText",
    group: "marketing",
    labelEn: "Marketing — Text & Strategy",
    labelAr: "التسويق — المحتوى والخطة",
    descEn: "The content studio, calendar and playbooks.",
    descAr: "استوديو المحتوى والتقويم وخطط التسويق.",
  },
  {
    key: "marketingDesign",
    group: "marketing",
    labelEn: "Marketing — Design",
    labelAr: "التسويق — التصميم",
    descEn: "Brand kit, branded templates and the before/after studio.",
    descAr: "هوية العيادة والقوالب واستوديو قبل/بعد.",
    requires: "marketingText",
  },
];

/**
 * Whether a clinic may use an add-on: its own switch AND the one it depends on. Every gate —
 * page, nav, API route, bot — asks this rather than `hasFeature` directly, so a bot switched on
 * for a clinic whose automatic messages are off stays silent everywhere at once.
 */
export function isUnlocked(clinic: Clinic | null, key: FeatureKey): boolean {
  if (!hasFeature(clinic, key)) return false;
  const requires = FEATURE_CATALOG.find((f) => f.key === key)?.requires;
  return !requires || hasFeature(clinic, requires);
}

/** Any-of: a screen two add-ons share (the WhatsApp inbox, its settings) opens for either. */
export function isAnyUnlocked(clinic: Clinic | null, keys: FeatureKey | FeatureKey[]): boolean {
  return (Array.isArray(keys) ? keys : [keys]).some((k) => isUnlocked(clinic, k));
}

export function featureInfo(key: FeatureKey): FeatureInfo {
  const found = FEATURE_CATALOG.find((f) => f.key === key);
  // Every key in TIER_LIMITS is meant to be listed above; a miss is a programming error, but the
  // locked screen still needs something to say, so it falls back to the key itself.
  return found ?? { key, group: "modules", labelEn: key, labelAr: key, descEn: "", descAr: "" };
}
