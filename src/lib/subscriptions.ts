import { SubscriptionTier, Clinic } from "@/types/saas";

/**
 * Monthly AI allowances are sized against what a credit actually COSTS us, measured 2026-08-26:
 * roughly $0.0076-0.0103 per credit in Gemini fees, and one credit can be several API rounds.
 *
 * At the annual prices these plans sell for (Pro 5,000 EGP, Premium 10,000 EGP), the old
 * allowances of 1,000 and 2,000 a month would have cost more in API fees than the subscription
 * itself if a clinic used them fully. These figures hold that spend near 15% of revenue even in
 * the worst case, with room to survive the Gemini price rise scheduled for 1 January 2027.
 *
 * Raise them per clinic through the superadmin feature overrides when a customer pays for it —
 * do not raise them here without redoing that arithmetic.
 */
export const TIER_LIMITS: Record<SubscriptionTier, {
  maxStaff: number;
  aiMonthlyCredits: number;
  features: {
    whatsappIntegration: boolean;
    inventory: boolean;
    attendance: boolean;
    /** Reactive assistant — the chat bubble. A human asks, the AI answers. */
    aiChat: boolean;
    /** Proactive intelligence — scans and analyses the system runs on its own initiative. */
    aiProactive: boolean;
    /** AI summaries rendered inline across the app instead of inside the bubble. */
    aiEmbedded: boolean;
    /** Dictated clinical notes transcribed and structured into records. */
    aiVoice: boolean;
    /**
     * Marketing add-on, level 1 (Text & Strategy). False on every tier on purpose: it is sold as
     * a separate add-on, switched on per clinic via the feature overrides in the superadmin panel.
     */
    marketingText: boolean;
    /** Marketing add-on, level 2 (Design). Implies nothing by itself — gate design features on it IN ADDITION to marketingText. */
    marketingDesign: boolean;
  }
}> = {
  'Free Trial': {
    maxStaff: 3,
    // Fourteen days, so this is deliberately more per-day than Pro: the trial has to show what
    // the assistant can do, and it costs about a dollar.
    aiMonthlyCredits: 150,
    features: {
      whatsappIntegration: false,
      inventory: false,
      attendance: false,
      aiChat: true,
      aiProactive: false,
      aiEmbedded: false,
      aiVoice: false,
      marketingText: false,
      marketingDesign: false,
    }
  },
  'Basic': {
    maxStaff: 3,
    aiMonthlyCredits: 0,
    features: {
      whatsappIntegration: false,
      inventory: false,
      attendance: false,
      aiChat: false,
      aiProactive: false,
      aiEmbedded: false,
      aiVoice: false,
      marketingText: false,
      marketingDesign: false,
    }
  },
  'Pro': {
    maxStaff: 10,
    /** ~7 assistant actions on every working day. */
    aiMonthlyCredits: 150,
    features: {
      whatsappIntegration: false,
      inventory: true,
      attendance: true,
      aiChat: true,
      aiProactive: false,
      aiEmbedded: false,
      aiVoice: false,
      marketingText: false,
      marketingDesign: false,
    }
  },
  'Premium': {
    maxStaff: 0, // unlimited
    /** ~14 assistant actions on every working day. The scans and briefings cost no credits. */
    aiMonthlyCredits: 300,
    features: {
      whatsappIntegration: true,
      inventory: true,
      attendance: true,
      aiChat: true,
      aiProactive: true,
      aiEmbedded: true,
      aiVoice: true,
      marketingText: false,
      marketingDesign: false,
    }
  }
};

/**
 * Check if the clinic has access to a specific feature based on their subscription tier
 */
export function hasFeature(clinic: Clinic | null, featureKey: keyof typeof TIER_LIMITS['Basic']['features']): boolean {
  if (!clinic) return false;
  
  // If features are overridden on the clinic doc directly, respect those first
  if (clinic.features && typeof clinic.features[featureKey] === 'boolean') {
    return clinic.features[featureKey]!;
  }

  // Otherwise fallback to tier defaults
  const tier = clinic.subscriptionTier || 'Free Trial';
  return TIER_LIMITS[tier].features[featureKey];
}

/**
 * Get monthly AI credit limit for a clinic (with custom overrides)
 */
export function getAiCreditLimit(clinic: Clinic | null): number {
  if (!clinic) return 0;
  if (!hasFeature(clinic, "aiChat")) return 0;
  
  const baseLimit = typeof clinic.features?.aiMonthlyCredits === 'number'
    ? clinic.features.aiMonthlyCredits
    : TIER_LIMITS[clinic.subscriptionTier || 'Free Trial']?.aiMonthlyCredits || 0;

  const extraBonus = typeof clinic.features?.extraAiCredits === 'number' ? clinic.features.extraAiCredits : 0;
  return baseLimit + extraBonus;
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
  
  const limit = clinic.features?.maxStaff ?? TIER_LIMITS[clinic.subscriptionTier || 'Free Trial'].maxStaff;
  if (limit === 0) return true; // unlimited
  return currentStaffCount < limit;
}
