import { SubscriptionTier, Clinic } from "@/types/saas";

export const TIER_LIMITS: Record<SubscriptionTier, {
  maxStaff: number;
  aiMonthlyCredits: number;
  features: {
    whatsappIntegration: boolean;
    inventory: boolean;
    attendance: boolean;
    aiChat: boolean;
  }
}> = {
  'Free Trial': {
    maxStaff: 3,
    aiMonthlyCredits: 200,
    features: {
      whatsappIntegration: false,
      inventory: false,
      attendance: false,
      aiChat: true,
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
    }
  },
  'Pro': {
    maxStaff: 10,
    aiMonthlyCredits: 1000,
    features: {
      whatsappIntegration: false,
      inventory: true,
      attendance: true,
      aiChat: true,
    }
  },
  'Premium': {
    maxStaff: 0, // unlimited
    aiMonthlyCredits: 2000,
    features: {
      whatsappIntegration: true,
      inventory: true,
      attendance: true,
      aiChat: true,
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
 * Check if the clinic has reached their staff limit
 */
export function canAddStaff(clinic: Clinic | null, currentStaffCount: number): boolean {
  if (!clinic) return false;
  
  const limit = clinic.features?.maxStaff ?? TIER_LIMITS[clinic.subscriptionTier || 'Free Trial'].maxStaff;
  if (limit === 0) return true; // unlimited
  return currentStaffCount < limit;
}
