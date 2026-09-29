/**
 * Lead grades: hot / warm / cold, and the free rule score behind the AI's.
 *
 * Two people grade every lead. The receptionist taps one of three words on the Leads page —
 * that is the ground truth, because she is the one who ends up on the phone with them. The AI
 * grades the same lead from the chat, first silently (so the weekly review can say how often
 * it agreed with her), and, once the clinic has approved a grading flow, visibly.
 *
 * The rule score here is what runs on every message for free. It is deliberately simple and
 * explainable: each signal is a fact anybody can point at in the thread ("she named a service",
 * "he said it's expensive", "no reply for three days"). The model refines it; it never replaces
 * it, so a lead is never ungraded because a model call failed.
 *
 * Pure and browser-safe: the Leads page imports the labels and the effective-grade rule from
 * here, so nothing in this file may touch Firebase.
 */

import { normalizeReplyText } from "@/lib/patientMessaging";

export const LEAD_GRADES = ["hot", "warm", "cold"] as const;
export type LeadGrade = (typeof LEAD_GRADES)[number];

/** The grade fields a lead document carries. All optional: an ungraded lead is a normal lead. */
export interface LeadGradeFields {
  /** What the receptionist tapped. The ground truth the AI is measured against. */
  staffGrade?: LeadGrade | null;
  staffGradeAtMs?: number | null;
  staffGradeBy?: string | null;
  staffGradeByName?: string | null;
  /** The AI's grade — rules or model — and the one-line reason it gives. */
  aiGrade?: LeadGrade | null;
  aiGradeReason?: string | null;
  aiGradeScore?: number | null;
  aiGradeBy?: "rules" | "model" | null;
  aiGradeAtMs?: number | null;
  /** The conversation's lastMessageAt when the model last read it — so it is not re-read for free. */
  aiGradeThreadAt?: number | null;
  /** When the model last spent a credit on this lead; one per lead per day. */
  aiGradeModelAtMs?: number | null;
  /** Filled when both grades exist: did the AI agree with the desk? */
  aiGradeAgree?: boolean | null;
}

export function isLeadGrade(v: unknown): v is LeadGrade {
  return v === "hot" || v === "warm" || v === "cold";
}

export function gradeLabel(g: LeadGrade | null | undefined, lang: "en" | "ar"): string {
  if (!g) return "";
  const map = { hot: { en: "Hot", ar: "ساخن" }, warm: { en: "Warm", ar: "دافي" }, cold: { en: "Cold", ar: "بارد" } };
  return map[g][lang];
}

export function gradeEmoji(g: LeadGrade): string {
  return g === "hot" ? "🔥" : g === "warm" ? "🌤️" : "❄️";
}

/** Pill classes per grade, in the app's status-pill idiom. */
export function gradeStyles(g: LeadGrade | null | undefined): { pill: string; active: string } {
  switch (g) {
    case "hot":
      return { pill: "bg-rose-100 text-rose-700", active: "bg-rose-500 text-white border-rose-500" };
    case "warm":
      return { pill: "bg-amber-100 text-amber-700", active: "bg-amber-400 text-ink border-amber-400" };
    case "cold":
      return { pill: "bg-sky-100 text-sky-700", active: "bg-sky-500 text-white border-sky-500" };
    default:
      return { pill: "bg-surface-muted text-ink-body", active: "bg-ink text-white border-ink" };
  }
}

/** Sort weight: hot first. Ungraded sits after cold so a graded cold still ranks above unknown. */
export function gradeRank(g: LeadGrade | null | undefined): number {
  return g === "hot" ? 0 : g === "warm" ? 1 : g === "cold" ? 2 : 3;
}

/**
 * The grade a screen shows for a lead.
 *
 * The desk's word always wins. The AI's shows only once the clinic has approved a grading
 * flow — before that it is still learning, and a grade nobody has vetted on a lead a
 * receptionist is about to call is exactly the kind of confident guess this system avoids.
 */
export function effectiveGrade(lead: LeadGradeFields, aiApproved: boolean): { grade: LeadGrade | null; by: "staff" | "ai" | null } {
  if (isLeadGrade(lead.staffGrade)) return { grade: lead.staffGrade, by: "staff" };
  if (aiApproved && isLeadGrade(lead.aiGrade)) return { grade: lead.aiGrade, by: "ai" };
  return { grade: null, by: null };
}

/** Did the AI agree with the desk? Null while either side has not graded. */
export function gradeAgreement(lead: LeadGradeFields): boolean | null {
  if (!isLeadGrade(lead.staffGrade) || !isLeadGrade(lead.aiGrade)) return null;
  return lead.staffGrade === lead.aiGrade;
}

// ------------------------------------------------------------------------------------------------
// Signals: what the thread says, as facts.
// ------------------------------------------------------------------------------------------------

export interface GradeSignals {
  /** Messages the person wrote (not taps, not the bot). */
  patientMessages: number;
  /** They named a service the clinic offers, or the ad they came from names one. */
  namedService: boolean;
  /** Implants, braces, veneers, crowns, a full smile — the treatments that pay for the ad. */
  highValue: boolean;
  /** Pain, swelling, a broken tooth: people in pain book today. */
  urgency: boolean;
  /** Asked for a time, a day, "can I come", "book me". */
  askedToBook: boolean;
  /** Asked a price. */
  askedPrice: boolean;
  /** Asked a price and nothing else — no service, no booking words. The classic shopper. */
  priceOnly: boolean;
  /** "expensive", "I'll think about it", "cheaper elsewhere". */
  objection: boolean;
  /** "not now", "later", "no thanks". */
  declined: boolean;
  /** Hours since the person last wrote; null when they never did. */
  hoursSinceLastInbound: number | null;
  /** Arrived from a paid ad or post. */
  fromAd: boolean;
  /** Already a patient here. */
  existingPatient: boolean;
  /** A person on the desk has already replied in the thread. */
  staffReplied: boolean;
  /** The lead's stage says booked or won. */
  booked: boolean;
}

const HIGH_VALUE = ["زراعة", "زرع", "تقويم", "فينير", "ابتسامة", "هوليود", "تركيب", "طربوش", "بورسلين", "تجميل", "implant", "braces", "veneer", "crown", "smile", "invisalign", "اينفزلاين"];
const SERVICE_WORDS = [...HIGH_VALUE, "تبييض", "تنظيف", "حشو", "خلع", "عصب", "جذور", "اطفال", "أطفال", "ضرس", "عقل", "تلبيس", "whitening", "cleaning", "filling", "root", "extraction", "kids"];
const URGENCY = ["الم", "ألم", "وجع", "بيوجع", "ورم", "وارم", "نزيف", "بينزف", "كسر", "مكسور", "اتكسر", "مستعجل", "طوارئ", "مش قادر", "صديد", "خراج", "pain", "hurt", "swollen", "swelling", "broken", "urgent", "emergency"];
const BOOKING = ["احجز", "أحجز", "حجز", "ميعاد", "موعد", "معاد", "امتى", "إمتى", "متى", "متاح", "فاضي", "فاضية", "اجي", "آجي", "أجي", "النهارده", "النهاردة", "بكره", "بكرة", "book", "appointment", "available", "when can", "today", "tomorrow", "slot"];
const PRICE = ["بكام", "كام", "سعر", "اسعار", "أسعار", "التكلفة", "تكلفة", "الحساب", "price", "cost", "how much", "fees"];
const OBJECTION = ["غالي", "غاليه", "غالية", "هفكر", "افكر", "أفكر", "ارخص", "أرخص", "عيادة تانية", "مكان تاني", "expensive", "think about", "cheaper"];
const DECLINE = ["مش دلوقتي", "مش دلوقت", "بعدين", "لا شكرا", "لا شكراً", "مش عايز", "مش عايزة", "مش محتاج", "not now", "later", "no thanks"];

function hasAny(text: string, needles: string[]): boolean {
  const t = normalizeReplyText(text);
  return needles.some((n) => t.includes(normalizeReplyText(n)));
}

/**
 * Read the signals off a thread. `patientTexts` are the person's own messages in order; the
 * rest are facts the caller already knows from the lead and conversation documents.
 */
export function signalsFromThread(args: {
  patientTexts: string[];
  adText?: string;
  interest?: string;
  lastInboundAtMs?: number | null;
  now?: number;
  fromAd?: boolean;
  existingPatient?: boolean;
  staffReplied?: boolean;
  stage?: string;
}): GradeSignals {
  const texts = args.patientTexts.map((t) => String(t || "")).filter((t) => t.trim());
  const all = [...texts, args.interest || ""].join(" \n ");
  const withAd = `${all} \n ${args.adText || ""}`;
  const askedPrice = hasAny(all, PRICE);
  const namedService = hasAny(withAd, SERVICE_WORDS);
  const askedToBook = hasAny(all, BOOKING);
  const now = args.now ?? Date.now();
  const last = args.lastInboundAtMs || 0;
  return {
    patientMessages: texts.length,
    namedService,
    highValue: hasAny(withAd, HIGH_VALUE),
    urgency: hasAny(all, URGENCY),
    askedToBook,
    askedPrice,
    priceOnly: askedPrice && !namedService && !askedToBook && !hasAny(all, URGENCY),
    objection: hasAny(all, OBJECTION),
    declined: hasAny(all, DECLINE),
    hoursSinceLastInbound: last > 0 ? Math.max(0, (now - last) / 3_600_000) : null,
    fromAd: Boolean(args.fromAd),
    existingPatient: Boolean(args.existingPatient),
    staffReplied: Boolean(args.staffReplied),
    booked: args.stage === "booked" || args.stage === "won",
  };
}

// ------------------------------------------------------------------------------------------------
// The rule score.
// ------------------------------------------------------------------------------------------------

export const HOT_FROM = 65;
export const WARM_FROM = 40;

export function gradeFromScore(score: number): LeadGrade {
  return score >= HOT_FROM ? "hot" : score >= WARM_FROM ? "warm" : "cold";
}

/**
 * Score the signals. Every line is a reason the desk can read back.
 *
 * Reasons are Arabic because that is what the Leads page shows under the grade; the score is
 * what the weekly review and the model see.
 */
export function rulesGrade(s: GradeSignals): { grade: LeadGrade; score: number; reasons: string[] } {
  if (s.booked) return { grade: "hot", score: 100, reasons: ["حجز فعلاً"] };
  let score = 30;
  const reasons: string[] = [];
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(why);
  };
  if (s.urgency) add(25, "عنده ألم أو حالة مستعجلة");
  if (s.askedToBook) add(25, "طلب ميعاد");
  if (s.namedService) add(15, "سأل عن خدمة محددة");
  if (s.highValue) add(10, "خدمة كبيرة (زراعة/تقويم/تجميل)");
  if (s.askedPrice && !s.priceOnly) add(5, "سأل عن السعر");
  if (s.priceOnly) add(-20, "سأل عن السعر بس");
  // Heavier than the service bonus it usually comes with: "braces? too expensive, I'll think"
  // is a named high-value service AND a person walking away, and the desk grades that cold.
  if (s.objection) add(-25, "عنده اعتراض (غالي / هيفكر)");
  if (s.declined) add(-30, "قال مش دلوقتي");
  if (s.patientMessages >= 3) add(10, "كمّل المحادثة");
  else if (s.patientMessages === 0) add(-10, "فتح الشات ومكتبش");
  if (s.fromAd && s.patientMessages > 0) add(5, "جاي من إعلان وكتب");
  if (s.existingPatient) add(5, "مريض قديم");
  if (s.staffReplied) add(0, "الاستقبال رد عليه");
  const h = s.hoursSinceLastInbound;
  if (h !== null) {
    if (h > 24 * 7) add(-25, "ساكت من أكتر من أسبوع");
    else if (h > 48) add(-15, "ساكت من يومين");
  }
  // "Not now" is an answer, not a signal to be outweighed: however good the rest of the chat
  // looked, the person said no for now, and the desk does not chase a no as warm.
  if (s.declined) score = Math.min(score, WARM_FROM - 5);
  score = Math.max(0, Math.min(100, score));
  return { grade: gradeFromScore(score), score, reasons: reasons.filter((r) => r !== "الاستقبال رد عليه") };
}

/** The ISO week a timestamp belongs to, as the id of that week's draft flow: "2026-W40". */
export function weekKeyOf(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
