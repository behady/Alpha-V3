"use client";

/**
 * The small pieces every tab of a staff profile is built from: how a figure, a day or a distance
 * is said, the section and empty-state blocks, and the types the page and the tabs pass around.
 *
 * They lived at the top of one 1,100-line StaffProfile; the 2026-10 redesign split the profile into
 * tabs, and each tab wants the same handful of helpers, so they moved here.
 */

import type { ReactNode } from "react";
import type { Schedule } from "@/lib/hrClient";
import type { EarningSettled, StaffSettlement } from "@/lib/staffSettlement";

export type ProfileTab = "summary" | "attendance" | "money" | "settings";
export const PROFILE_TABS: readonly ProfileTab[] = ["summary", "attendance", "money", "settings"];
export function parseTab(raw: string | null): ProfileTab {
  return (PROFILE_TABS as readonly string[]).includes(raw ?? "") ? (raw as ProfileTab) : "summary";
}

export type ProfileStaff = {
  id: string;
  uid?: string;
  name: string;
  role: string;
  isDentist?: boolean;
  phone?: string;
  email?: string;
  bio?: string;
  speciality?: string;
  baseSalary: number;
  commissionPercentage: number;
  overtimeMultiplier: number;
  registeredDeviceId?: string | null;
  permissions?: string[];
};

/**
 * One line of the dentist's rates: an insurance company or a price list, with what is set for
 * this dentist (null = nothing of their own) and what applies when it is blank.
 */
export type RateRow = {
  kind: "payer" | "list";
  id: string;
  name: string;
  own: number | null;
  /** The rate that applies when this dentist has none of their own: the company's, else their usual. */
  fallback: number;
  fallbackIsCompany: boolean;
};

export type PayDraft = {
  baseSalary: number;
  commissionPercentage: number;
  overtimeMultiplier: number;
  speciality: string;
  schedule: Schedule;
};

/**
 * What has been paid against this dentist's earnings, over their whole history, as the page shows
 * it: a figure per line (by the payment id or `${claimId}#${lineIndex}`), the one number still owed,
 * and the part of it that predates the period on screen.
 */
export type SettlementView = {
  byKey: Map<string, EarningSettled>;
  /** Still owed over everything ever earned and settled. Negative: paid ahead of the work. */
  owed: number;
  /** Unpaid on work dated before the period: the debt the period inherits. */
  owedBefore: number;
  paidInPeriod: number;
  deductedInPeriod: number;
  /** Every payout and deduction, newest first. */
  items: StaffSettlement[];
};

/** The payout / deduction form while it is open: typed text, so a half-typed amount is not a number yet. */
export type SettlementForm = { id: string | null; kind: "payout" | "deduction"; amount: string; date: string; note: string; method: string };

export const PAY_METHODS = [
  { id: "Cash", en: "Cash", ar: "كاش" },
  { id: "Card", en: "Card", ar: "كارت" },
  { id: "InstaPay", en: "InstaPay", ar: "إنستاباي" },
  { id: "Bank transfer", en: "Bank transfer", ar: "تحويل بنكي" },
  { id: "Other", en: "Other", ar: "أخرى" },
];

export const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAYS_AR = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];

/** The clinic's clock. The payroll engine splits regular from extra time on it, so this page does too. */
export const CLINIC_TZ = "Africa/Cairo";

/** A punch further than this from the clinic is shown in red. */
export const FAR_M = 300;

/** Today on this computer's clock, as yyyy-mm-dd. */
export function todayYmd(): string {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Arabic with Western digits. Every figure on this page is set in the figure face with 0-9, so a
 * date in Arabic-Indic digits next to them read as a different kind of number.
 */
export const locale = (isAr: boolean) => (isAr ? "ar-EG-u-nu-latn" : "en-GB");

export const money = (n: number) => Math.round(Number(n) || 0).toLocaleString();

export function timeOf(d: Date | null, isAr: boolean): string {
  if (!d) return isAr ? "لسه" : "still in";
  return d.toLocaleTimeString(locale(isAr), { hour: "numeric", minute: "2-digit" });
}

/** "Mon 29 Sep" — a day someone can place, instead of 2026-09-29. Midday, so no zone moves it. */
export function dayOf(ymd: string, isAr: boolean): string {
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(locale(isAr), { weekday: "short", day: "numeric", month: "short" });
}

/** Hours in words for a sentence: "7 hr 30 min" / "٧ ساعات و٣٠ دقيقة" reads better than "7h 30m". */
export function hoursWords(minutes: number, isAr: boolean): string {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (isAr) {
    const hp = h === 0 ? "" : h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h <= 10 ? `${h} ساعات` : `${h} ساعة`;
    const mp = r === 0 ? "" : `${r} دقيقة`;
    return [hp, mp].filter(Boolean).join(" و") || "٠ دقيقة";
  }
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} hr` : `${h} hr ${r} min`;
}

/** "3 days" / "٣ أيام", with the singular and the Arabic dual handled. */
export function daysWords(n: number, isAr: boolean): string {
  if (isAr) return n === 1 ? "يوم واحد" : n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يوم`;
  return `${n} day${n === 1 ? "" : "s"}`;
}

export function timesWords(n: number, isAr: boolean): string {
  if (isAr) return n === 1 ? "مرة" : n === 2 ? "مرتين" : n <= 10 ? `${n} مرات` : `${n} مرة`;
  return n === 1 ? "once" : n === 2 ? "twice" : `${n} times`;
}

export function distanceWords(m: number, isAr: boolean): string {
  if (m <= FAR_M) return isAr ? "من العيادة" : "at the clinic";
  if (m >= 1000) {
    const km = (m / 1000).toFixed(1);
    return isAr ? `على بعد ${km} كم` : `${km} km away`;
  }
  return isAr ? `على بعد ${Math.round(m)} متر` : `${Math.round(m)} m away`;
}

/** A `datetime-local` value from a Date, in local time rather than UTC. */
export function inputValue(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* --- building blocks ------------------------------------------------------------------------- */

/**
 * One section of a tab: a heading a person can read from a chair, a one-sentence note, and the
 * content. Sections inside a tab are separated by a hairline rather than each being its own card —
 * the old page was a stack of seven identical white cards and nothing stood out from anything.
 */
export function Section({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-[20px] font-extrabold leading-tight tracking-tight text-ink">{title}</h3>
        {action}
      </div>
      {note && <p className="mt-1.5 max-w-3xl text-[14px] font-medium leading-relaxed text-ink-muted">{note}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** One quiet line. An empty state used to be a full-height dashed box, so an empty tab looked like three broken sections. */
export function Empty({ text }: { text: string }) {
  return <p className="text-[15px] font-semibold text-ink-muted">{text}</p>;
}

/** A figure on a white card: 30px number, 14px label in everyday words. */
export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <p className="font-figure text-[30px] font-extrabold leading-none text-ink">{value}</p>
      <p className="mt-2 text-[14px] font-semibold leading-tight text-ink-muted">{label}</p>
    </div>
  );
}

/**
 * How much of one earning line has been settled. A dash means the line is not in the history the
 * settlements were poured over (an old row that names the dentist but carries no id).
 */
export function PaidCell({ settled, isAr }: { settled: EarningSettled | null; isAr: boolean }) {
  if (!settled) return <td className="py-3 text-end font-figure font-semibold text-ink-muted">—</td>;
  const full = settled.remaining === 0;
  return (
    <td className={`py-3 text-end font-figure font-semibold ${full ? "text-ink" : "text-ink-muted"}`}>
      {money(settled.paid)}
      {settled.deducted > 0 && (
        <span className="block text-[12px] font-semibold text-danger">−{money(settled.deducted)} {isAr ? "خصم" : "deducted"}</span>
      )}
    </td>
  );
}

export const fieldLabel = "mb-2 block text-[14px] font-bold text-ink-body";
export const fieldInput =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-[16px] font-bold text-ink outline-none focus:border-accent";
export const btnGhost =
  "inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-[14px] font-bold text-ink-body transition-colors hover:text-ink";
export const btnDark = "inline-flex items-center gap-2 rounded-xl bg-ink-slab px-4 py-2.5 text-[14px] font-bold text-white";
export const tableHead = "border-b border-line text-[13px] font-bold text-ink-muted";
