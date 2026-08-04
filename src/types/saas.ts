export type SubscriptionTier = 'Free Trial' | 'Basic' | 'Pro' | 'Premium';

export interface Clinic {
  id: string;
  name: string;
  ownerId: string;
  subscriptionTier: SubscriptionTier;
  expiresAt: Date | any; // Firestore Timestamp
  status: 'Active' | 'Suspended' | 'Expired';
  createdAt: Date | any;
  features?: {
    whatsappIntegration?: boolean;
    inventory?: boolean;
    attendance?: boolean;
    aiChat?: boolean;
    /** Tier 3: scheduled/background AI analysis the system runs without being asked. */
    aiProactive?: boolean;
    /** Tier 3: AI summaries embedded across the app rather than in the chat bubble. */
    aiEmbedded?: boolean;
    /** Tier 3: dictated clinical notes structured into records. */
    aiVoice?: boolean;
    aiMonthlyCredits?: number;
    extraAiCredits?: number;
    maxStaff?: number;
  };
  billingCycle?: 'Monthly' | 'Yearly' | '2-Yearly';
  customPrice?: number;
  amountPaid?: number;
  adminNotes?: string;
}

export interface UserClinicRole {
  clinicId: string;
  role: 'Admin' | 'Dentist' | 'Assistant' | 'Receptionist';
  isDentist?: boolean;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  name: string;
  isSuperAdmin?: boolean; // True if this user can access the Super Admin dashboard
  clinicRoles: Record<string, 'Admin' | 'Dentist' | 'Assistant' | 'Receptionist'>; // clinicId -> role
  defaultClinicId?: string; // The clinic to load when logging in
  createdAt: Date | any;
  // Legacy fields (still present on root user docs for backwards compatibility)
  role?: string;
  isDentist?: boolean;
  staffId?: string;
  permissions?: string[];
}

export interface ClinicJoinRequest {
  id?: string;
  clinicId: string;
  userId: string;
  userEmail: string;
  userName: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  requestedAt: Date | any;
  respondedAt?: Date | any;
}
