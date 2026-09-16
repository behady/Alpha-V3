export type SubscriptionTier = 'Free Trial' | 'Basic' | 'Pro' | 'Premium';

export interface Clinic {
  id: string;
  name: string;
  ownerId: string;
  subscriptionTier: SubscriptionTier;
  expiresAt: Date | any; // Firestore Timestamp
  status: 'Active' | 'Suspended' | 'Expired';
  createdAt: Date | any;
  /** Stamped by scripts/seed-demo-clinic.mjs on the sample clinic and everything in it. */
  __demo?: boolean;
  /**
   * Which events the clinic asked to be told about, from Settings → Alerts.
   *
   * Declared here because it is read to DECIDE whether to raise an alert, not merely rendered on
   * the settings screen that writes it. Absent means the clinic has never opened that screen, and
   * every consumer treats that as "no" — a notification nobody chose is the kind that teaches
   * people to ignore the bell.
   */
  alertPreferences?: {
    inApp?: { patientArrival?: boolean; labReady?: boolean; newBooking?: boolean };
    email?: Record<string, boolean>;
  };
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
    /** AI reading of x-rays into a structured report. Needs aiChat (it spends AI credits). */
    aiXray?: boolean;
    aiMonthlyCredits?: number;
    extraAiCredits?: number;
    maxStaff?: number;
    /** Marketing add-on, level 1: AI content studio, calendar, playbooks. Sold separately from tiers. */
    marketingText?: boolean;
    /** Marketing add-on, level 2: branded designs (Brand Kit, templates, before/after studio). */
    marketingDesign?: boolean;
    /** Monthly cap on marketing AI generations. A single generation costs 1, a month plan costs 5. */
    marketingMonthlyCredits?: number;
    /** The add-ons listed in src/lib/featureCatalog.ts. Absent means "whatever the tier says". */
    whatsappBot?: boolean;
    onlineBooking?: boolean;
    leads?: boolean;
    lab?: boolean;
    ortho?: boolean;
    reports?: boolean;
    multiBranch?: boolean;
    clinicalPdfs?: boolean;
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
