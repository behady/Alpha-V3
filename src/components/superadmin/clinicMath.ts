import { Clinic, SubscriptionTier } from "@/types/saas";
import { TIER_LIMITS } from "@/lib/subscriptions";

/** A clinic as the console holds it: the header doc plus what the page joins onto it. */
export interface ConsoleClinic extends Clinic {
  ownerEmail?: string;
  /** Whole days until expiresAt; negative once it has passed; undefined when no date is set. */
  daysRemaining?: number;
  staffCount: number;
  /** Credits charged this calendar month, from clinics/{id}/ai_usage/{YYYY-MM}. */
  aiUsed: number;
  aiLimit: number;
}

export const TIERS: SubscriptionTier[] = ["Free Trial", "Basic", "Pro", "Premium"];

/** Firestore Timestamp, {seconds}, Date or string → Date, or null when it cannot be read. */
export function toDate(val: unknown): Date | null {
  if (!val) return null;
  try {
    const v = val as { toDate?: () => Date; seconds?: number };
    const d = typeof v.toDate === "function" ? v.toDate() : typeof v.seconds === "number" ? new Date(v.seconds * 1000) : new Date(val as string);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

export function daysUntil(val: unknown): number | undefined {
  const d = toDate(val);
  if (!d) return undefined;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/** The agreed price spread over a month. Without one, the tier's list price, as the KPI always did. */
export function monthlyValue(c: Clinic): number {
  if (c.customPrice !== undefined && c.customPrice !== null) {
    const price = Number(c.customPrice) || 0;
    const cycle = c.billingCycle || "Monthly";
    if (cycle === "2-Yearly") return price / 24;
    if (cycle === "Yearly") return price / 12;
    return price;
  }
  if (c.subscriptionTier === "Basic") return 50;
  if (c.subscriptionTier === "Pro") return 150;
  if (c.subscriptionTier === "Premium") return 300;
  return 0;
}

/** What is still owed on the agreed price. Zero when no price was agreed. */
export function balanceOwed(c: Clinic): number {
  const price = Number(c.customPrice) || 0;
  const paid = Number(c.amountPaid) || 0;
  return Math.max(price - paid, 0);
}

/**
 * The update a tier change writes. The add-on switches go back to the new plan's preset but the
 * numbers stay (credits, seats, bonus): those were sold separately and used to vanish here, which
 * silently took back what a clinic had paid for.
 */
export function tierChangeUpdate(c: Clinic, tier: SubscriptionTier): Partial<Clinic> {
  const f = c.features || {};
  return {
    subscriptionTier: tier,
    features: {
      ...TIER_LIMITS[tier].features,
      ...(typeof f.aiMonthlyCredits === "number" ? { aiMonthlyCredits: f.aiMonthlyCredits } : {}),
      ...(typeof f.extraAiCredits === "number" ? { extraAiCredits: f.extraAiCredits } : {}),
      ...(typeof f.maxStaff === "number" ? { maxStaff: f.maxStaff } : {}),
      ...(typeof f.marketingMonthlyCredits === "number" ? { marketingMonthlyCredits: f.marketingMonthlyCredits } : {}),
    },
  };
}

/**
 * The new end date for an extension. Counted from the current end when that is still ahead, from
 * today when it has passed or was never set — extending a clinic that lapsed a month ago by a week
 * must give it a week, not leave it three weeks in the past.
 */
export function extendedExpiry(c: Clinic, days: number): Date {
  const current = toDate(c.expiresAt);
  const from = current && current.getTime() > Date.now() ? current : new Date();
  return new Date(from.getTime() + days * 86_400_000);
}

export function isTrial(c: Clinic): boolean {
  return c.subscriptionTier === "Free Trial";
}
