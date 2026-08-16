/**
 * The client-safe half of the Help Center.
 *
 * Kept apart from `help.ts` on purpose: that file reads the articles off disk with `node:fs`, and
 * the components that render them are client components. Importing the two through one module
 * dragged `fs` into the browser bundle and failed the build. Types and section metadata live
 * here, file reading lives there, and nothing in this file touches the filesystem.
 */

export type HelpLang = "en" | "ar";

export type HelpSectionId =
  | "setup"
  | "frontdesk"
  | "money"
  | "clinical"
  | "operations"
  | "ai"
  | "settings"
  | "troubleshooting";

export type HelpArticle = {
  slug: string;
  lang: HelpLang;
  title: string;
  summary: string;
  section: HelpSectionId;
  /** Position within its section. Articles are meant to be read in order. */
  order: number;
  /** Who the article is written for. Empty means everyone. */
  roles: string[];
  /** Plan needed for the feature, if any — shown as a badge so nobody hunts for a missing button. */
  plan: string;
  body: string;
};

export const HELP_SECTIONS: {
  id: HelpSectionId;
  titleEn: string;
  titleAr: string;
  blurbEn: string;
  blurbAr: string;
}[] = [
  {
    id: "setup",
    titleEn: "Setting up your clinic",
    titleAr: "تجهيز العيادة",
    blurbEn: "Everything you do once, in the order you do it.",
    blurbAr: "كل حاجة بتعملها مرة واحدة، بالترتيب.",
  },
  {
    id: "frontdesk",
    titleEn: "Front desk",
    titleAr: "الاستقبال",
    blurbEn: "Patients, appointments, and running the day.",
    blurbAr: "المرضى والمواعيد وتشغيل اليوم.",
  },
  {
    id: "money",
    titleEn: "Money",
    titleAr: "الحسابات",
    blurbEn: "Payments, receipts, the ledger, and chasing dues.",
    blurbAr: "المدفوعات والإيصالات والسجل وتحصيل المتأخرات.",
  },
  {
    id: "clinical",
    titleEn: "Clinical",
    titleAr: "السجل السريري",
    blurbEn: "The chart, procedures, notes, and prescriptions.",
    blurbAr: "الرسم السني والإجراءات والملاحظات والوصفات.",
  },
  {
    id: "operations",
    titleEn: "Running the clinic",
    titleAr: "إدارة العيادة",
    blurbEn: "Dashboard, reports, inventory, and attendance.",
    blurbAr: "لوحة التحكم والتقارير والمخزون والحضور.",
  },
  {
    id: "ai",
    titleEn: "AI features",
    titleAr: "مزايا الذكاء الاصطناعي",
    blurbEn: "What the assistant does, and what it will not do.",
    blurbAr: "المساعد بيعمل إيه، وإيه اللي مش هيعمله.",
  },
  {
    id: "settings",
    titleEn: "Settings",
    titleAr: "الإعدادات",
    blurbEn: "Hours, prices, messaging, and the rest of the switches.",
    blurbAr: "المواعيد والأسعار والرسائل وباقي الإعدادات.",
  },
  {
    id: "troubleshooting",
    titleEn: "When something looks wrong",
    titleAr: "لما حاجة تبان غلط",
    blurbEn: "The questions people actually ask.",
    blurbAr: "الأسئلة اللي بتتسأل فعلاً.",
  },
];
