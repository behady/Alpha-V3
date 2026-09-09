import { SubscriptionTier, Clinic } from "@/types/saas";

/**
 * What a clinic buys, and what it costs us. Reconstructed 2026-09-09.
 *
 * Two facts shaped this file, both measured rather than assumed:
 *
 *  1. The only variable cost left in the product is the assistant. One AI credit — one WhatsApp
 *     reply, one assistant action — costs $0.0076–0.0103 in Gemini fees (measured 2026-08-26), about
 *     half an Egyptian pound, doubling on 1 January 2027 when Flash's intro pricing ends. Everything
 *     else a clinic uses costs us the same whether they use it or not. WhatsApp is NOT our cost: a
 *     clinic connects its own Meta account and Meta bills the clinic directly.
 *
 *  2. The old allowances were sized to the bill, not to the job. Premium's 300 credits was eleven
 *     bot replies a working day; a clinic that used the bot as its actual front door ran dry on the
 *     tenth of the month and its patients were handed to a receptionist. So the new allowances are
 *     sized so that the median clinic never sees the ceiling, and a clinic that does is not cut
 *     off — it keeps working on overage, billed per credit, and the owner is told.
 *
 * Prices are anchored on what the assistant replaces (a receptionist at 4,000–8,000 EGP a month),
 * not on our supplier bill. Worst-case AI cost at full allowance is ~27% of the price on every plan
 * that has the assistant; the median clinic sits nearer 10%.
 */

/* -------------------------------------------------------------------------------------------- */
/* Plans and prices                                                                             */
/* -------------------------------------------------------------------------------------------- */

/** The plans a new clinic can be put on, cheapest first. */
export type SellableTier = "Starter" | "Plus" | "Clinic" | "Group";
export const SELLABLE_TIERS: readonly SellableTier[] = ["Starter", "Plus", "Clinic", "Group"];

/** Plans sold before 2026-09-09. Kept so existing clinics keep working; nothing new goes here. */
export type LegacyTier = "Basic" | "Pro" | "Premium";
export const LEGACY_TIERS: readonly LegacyTier[] = ["Basic", "Pro", "Premium"];

export function isLegacyTier(tier: string | undefined | null): tier is LegacyTier {
  return (LEGACY_TIERS as readonly string[]).includes(String(tier || ""));
}

/**
 * List prices in EGP. Annual is the price we steer to; monthly carries a 25% premium.
 *
 * Legacy rows are the last price those plans were documented at, so a grandfathered clinic's
 * revenue is counted at what it actually agreed to. A clinic whose deal differs carries
 * `customPrice` on its document, which always wins (see `monthlyRevenueEgp`).
 */
export const PLAN_PRICES_EGP: Record<SellableTier | LegacyTier, { annual: number; monthly: number }> = {
  Starter: { annual: 4_200, monthly: 440 },
  Plus: { annual: 10_800, monthly: 1_125 },
  Clinic: { annual: 21_600, monthly: 2_250 },
  Group: { annual: 42_000, monthly: 4_375 },
  // Grandfathered. Basic was only ever sold monthly at 50; Pro and Premium at 5,000 and 10,000 a year.
  Basic: { annual: 600, monthly: 50 },
  Pro: { annual: 5_000, monthly: 417 },
  Premium: { annual: 10_000, monthly: 833 },
};

/** What the assistant costs a clinic per credit once its included allowance is used up. */
export const AI_OVERAGE_EGP_PER_CREDIT = 1;

/** The name a clinic sees. Legacy plans are labelled so nobody mistakes them for current ones. */
export function tierDisplayName(tier: SubscriptionTier | string | undefined | null): string {
  const t = String(tier || "Free Trial");
  return isLegacyTier(t) ? `${t} (legacy)` : t;
}

/**
 * What a clinic pays us per month, in EGP, from its own document.
 *
 * The one place this is computed. It used to live in three copies (the KPI strip, the analytics
 * tab and the margin dashboard) that had drifted to three different sets of numbers.
 */
export function monthlyRevenueEgp(clinic: Pick<Clinic, "status" | "subscriptionTier" | "billingCycle" | "customPrice">): number {
  if (clinic.status !== "Active") return 0;
  const cycle = clinic.billingCycle || "Monthly";
  if (clinic.customPrice !== undefined && clinic.customPrice !== null) {
    const price = Number(clinic.customPrice) || 0;
    return cycle === "2-Yearly" ? price / 24 : cycle === "Yearly" ? price / 12 : price;
  }
  const listed = PLAN_PRICES_EGP[clinic.subscriptionTier as SellableTier | LegacyTier];
  if (!listed) return 0;
  return cycle === "Monthly" ? listed.monthly : listed.annual / 12;
}

/* -------------------------------------------------------------------------------------------- */
/* What each plan includes                                                                      */
/* -------------------------------------------------------------------------------------------- */

/**
 * Every switch a plan can flip. The tiers differ on the assistant AND on the modules a clinic
 * gets, so that the step between two plans is a thing an owner can point at — the Android app,
 * the lab tracker, a second branch — and not only a number of replies.
 */
export type TierFeatures = {
  /**
   * Messages go out on their own. Off, they still get written but wait on the clinic phone for a
   * staff member to press send — the Starter experience.
   */
  whatsappIntegration: boolean;
  /** SMS reminders sent automatically from the clinic's own phone, through the Android app. */
  smsAutoSend: boolean;
  /**
   * The native Android app: today's schedule offline, check-in, payments, the clock and the SMS
   * sender. The app reads this at sign-in and shows the upgrade screen when it is off.
   */
  androidApp: boolean;
  inventory: boolean;
  /** Geofenced clock-in, hours and payroll. */
  attendance: boolean;
  /** Lab case tracking: work orders, due dates, the order sheet. */
  lab: boolean;
  /** Orthodontic case tracking. */
  ortho: boolean;
  /** Meta ad-lead intake, the leads inbox and the bot's salesperson mode. */
  leads: boolean;
  /** More than one branch, each with its own rooms and price list. */
  multiBranch: boolean;
  /** Reactive assistant — the chat bubble and the WhatsApp bot. A human or a patient asks, the AI answers. */
  aiChat: boolean;
  /** Proactive intelligence — scans and analyses the system runs on its own initiative. Never metered. */
  aiProactive: boolean;
  /** AI summaries rendered inline across the app instead of inside the bubble. */
  aiEmbedded: boolean;
  /** Dictated clinical notes transcribed and structured into records. */
  aiVoice: boolean;
  /**
   * Marketing add-on, level 1 (Text & Strategy). Included in Group; an add-on for everyone else,
   * switched on per clinic via the feature overrides in the superadmin panel.
   */
  marketingText: boolean;
  /** Marketing add-on, level 2 (Design). Gate design features on it IN ADDITION to marketingText. */
  marketingDesign: boolean;
};

export type TierLimits = {
  /** 0 means unlimited. */
  maxStaff: number;
  /** Credits included in the price each month. 0 with aiChat on means no ceiling at all. */
  aiMonthlyCredits: number;
  /** Credits the assistant may go past the allowance, billed at `AI_OVERAGE_EGP_PER_CREDIT`. */
  aiOverageCredits: number;
  features: TierFeatures;
};

const NOTHING: TierFeatures = {
  whatsappIntegration: false,
  smsAutoSend: false,
  androidApp: false,
  inventory: false,
  attendance: false,
  lab: false,
  ortho: false,
  leads: false,
  multiBranch: false,
  aiChat: false,
  aiProactive: false,
  aiEmbedded: false,
  aiVoice: false,
  marketingText: false,
  marketingDesign: false,
};

/** The system on the web: patients, schedule, clinical, finance, reports. Messages sent by hand. */
const STARTER: TierLimits = { maxStaff: 5, aiMonthlyCredits: 0, aiOverageCredits: 0, features: NOTHING };

/**
 * The assistant, the phone, and automatic sending. ~19 replies every working day, then overage.
 * The proactive scans stay above: they read the whole ledger and are the Clinic plan's reason.
 */
const PLUS: TierLimits = {
  maxStaff: 8,
  aiMonthlyCredits: 500,
  aiOverageCredits: 500,
  features: { ...NOTHING, whatsappIntegration: true, smsAutoSend: true, androidApp: true, lab: true, aiChat: true },
};

/** The whole clinic: every module and every kind of AI. ~38 replies a working day, then overage. */
const CLINIC: TierLimits = {
  maxStaff: 15,
  aiMonthlyCredits: 1_000,
  aiOverageCredits: 1_000,
  features: { ...PLUS.features, inventory: true, attendance: true, ortho: true, leads: true, aiProactive: true, aiEmbedded: true, aiVoice: true },
};

/** Chains: several branches, no staff ceiling, marketing included. ~77 replies a working day. */
const GROUP: TierLimits = {
  maxStaff: 0,
  aiMonthlyCredits: 2_000,
  aiOverageCredits: 2_000,
  features: { ...CLINIC.features, multiBranch: true, marketingText: true, marketingDesign: true },
};

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  /**
   * Fourteen days at Clinic level. 500 credits is two full weeks of the bot as the front door, so
   * the first thing an owner sees is patients it booked. No overage: a trial that runs out is a
   * conversation, not an invoice.
   */
  "Free Trial": { maxStaff: 5, aiMonthlyCredits: 500, aiOverageCredits: 0, features: CLINIC.features },

  Starter: STARTER,
  Plus: PLUS,
  Clinic: CLINIC,
  Group: GROUP,

  /*
   * Grandfathered plans. Each gets the allowances of the plan it maps to — the point is that a
   * Pro clinic's bot stops dying on the tenth of the month today, not at renewal. Pro and Premium
   * both had inventory and attendance, which only Clinic carries now, so both map there; Premium
   * bought unlimited staff and keeps it. Move these to a current plan when the clinic renews.
   */
  Basic: STARTER,
  Pro: CLINIC,
  Premium: { ...CLINIC, maxStaff: 0 },
};

/* -------------------------------------------------------------------------------------------- */
/* Reading a clinic's entitlements                                                              */
/* -------------------------------------------------------------------------------------------- */

function limitsFor(clinic: Clinic | null): TierLimits {
  const tier = (clinic?.subscriptionTier || "Free Trial") as SubscriptionTier;
  return TIER_LIMITS[tier] ?? TIER_LIMITS["Free Trial"];
}

/**
 * Check if the clinic has access to a specific feature based on their subscription tier
 */
export function hasFeature(clinic: Clinic | null, featureKey: keyof TierFeatures): boolean {
  if (!clinic) return false;

  // If features are overridden on the clinic doc directly, respect those first
  if (clinic.features && typeof clinic.features[featureKey] === "boolean") {
    return clinic.features[featureKey]!;
  }

  // Otherwise fallback to tier defaults
  return limitsFor(clinic).features[featureKey];
}

/**
 * Credits included in the clinic's plan this month (with custom overrides). This is the figure a
 * clinic is shown; what it may actually spend is `getAiHardLimit`.
 */
export function getAiCreditLimit(clinic: Clinic | null): number {
  if (!clinic) return 0;
  if (!hasFeature(clinic, "aiChat")) return 0;

  const baseLimit = typeof clinic.features?.aiMonthlyCredits === "number"
    ? clinic.features.aiMonthlyCredits
    : limitsFor(clinic).aiMonthlyCredits;

  const extraBonus = typeof clinic.features?.extraAiCredits === "number" ? clinic.features.extraAiCredits : 0;
  return baseLimit + extraBonus;
}

/** How far past the allowance the assistant keeps answering on overage. */
export function getAiOverageCap(clinic: Clinic | null): number {
  if (!clinic || !hasFeature(clinic, "aiChat")) return 0;
  const custom = clinic.features?.aiOverageCredits;
  return typeof custom === "number" && custom >= 0 ? custom : limitsFor(clinic).aiOverageCredits;
}

/** Included plus overage: the point past which the assistant genuinely stops. */
export function getAiHardLimit(clinic: Clinic | null): number {
  const included = getAiCreditLimit(clinic);
  // An included figure of 0 on a plan with the assistant means "no ceiling" and always has.
  if (included === 0) return hasFeature(clinic, "aiChat") ? Number.POSITIVE_INFINITY : 0;
  return included + getAiOverageCap(clinic);
}

export type AiQuotaVerdict = {
  /** Whether this charge may proceed at all. */
  allowed: boolean;
  /** Why not, when it may not. */
  reason?: "plan" | "no_credits";
  included: number;
  hardLimit: number;
  /** Credits of THIS charge that fall past the included allowance. */
  overageCredits: number;
  /** This charge is the one that first crosses the allowance — the moment to tell the owner. */
  entersOverage: boolean;
};

/**
 * The one decision every metered AI feature makes: given what the clinic has used this month,
 * may it spend `required` more credits, and are any of them overage?
 *
 * Pure, so it can be tested without Firestore and so the bot, the chat bubble, the treatment
 * planner and the diagnosis chat cannot each drift into their own reading of the rule — which is
 * exactly what had happened before it existed.
 */
export function evaluateAiQuota(clinic: Clinic | null, usedThisMonth: number, required: number): AiQuotaVerdict {
  const used = Math.max(0, Number(usedThisMonth) || 0);
  const need = Math.max(0, Number(required) || 0);

  if (!hasFeature(clinic, "aiChat")) {
    return { allowed: false, reason: "plan", included: 0, hardLimit: 0, overageCredits: 0, entersOverage: false };
  }

  const included = getAiCreditLimit(clinic);
  const hardLimit = getAiHardLimit(clinic);

  // No ceiling configured: everything is included, nothing is overage.
  if (included === 0) {
    return { allowed: true, included, hardLimit, overageCredits: 0, entersOverage: false };
  }

  const after = used + need;
  if (after > hardLimit) {
    return { allowed: false, reason: "no_credits", included, hardLimit, overageCredits: 0, entersOverage: false };
  }

  const overageCredits = Math.max(0, Math.min(need, after - included));
  return {
    allowed: true,
    included,
    hardLimit,
    overageCredits,
    entersOverage: overageCredits > 0 && used <= included,
  };
}

/**
 * Marketing generations allowed per month. Separate meter from the clinical AI credits on
 * purpose: the marketing add-on is sold on its own, so a clinic can hold it without aiChat —
 * and burning through campaign content must never eat the credits the chair-side AI runs on.
 */
export const MARKETING_MONTHLY_CREDITS_DEFAULT = 120;

export function getMarketingCreditLimit(clinic: Clinic | null): number {
  if (!clinic) return 0;
  if (!hasFeature(clinic, "marketingText")) return 0;
  const custom = clinic.features?.marketingMonthlyCredits;
  return typeof custom === "number" && custom >= 0 ? custom : MARKETING_MONTHLY_CREDITS_DEFAULT;
}

/**
 * Check if the clinic has reached their staff limit
 */
export function canAddStaff(clinic: Clinic | null, currentStaffCount: number): boolean {
  if (!clinic) return false;

  const limit = clinic.features?.maxStaff ?? limitsFor(clinic).maxStaff;
  if (limit === 0) return true; // unlimited
  return currentStaffCount < limit;
}
