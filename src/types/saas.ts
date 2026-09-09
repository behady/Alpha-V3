/**
 * The plans a clinic can be on.
 *
 * Sold today: `Starter`, `Plus`, `Clinic`, `Group` — see `PLAN_PRICES_EGP` in `lib/subscriptions.ts`.
 * `Basic`, `Pro` and `Premium` are the plans that were sold before 2026-09-09. They stay in the
 * union because clinics still carry them; nothing new is put on one, and each is mapped to the
 * closest new plan's allowances so a grandfathered clinic gets the new AI allowance immediately
 * while keeping the price it agreed to until renewal.
 */
export type SubscriptionTier =
  | 'Free Trial'
  | 'Starter'
  | 'Plus'
  | 'Clinic'
  | 'Group'
  /** @deprecated grandfathered — move to Starter at renewal */
  | 'Basic'
  /** @deprecated grandfathered — move to Clinic at renewal */
  | 'Pro'
  /** @deprecated grandfathered — move to Clinic (unlimited staff kept) at renewal */
  | 'Premium';

export interface Clinic {
  id: string;
  name: string;
  ownerId: string;
  subscriptionTier: SubscriptionTier;
  expiresAt: Date | any; // Firestore Timestamp
  status: 'Active' | 'Suspended' | 'Expired';
  createdAt: Date | any;
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
    smsAutoSend?: boolean;
    androidApp?: boolean;
    inventory?: boolean;
    attendance?: boolean;
    lab?: boolean;
    ortho?: boolean;
    leads?: boolean;
    multiBranch?: boolean;
    aiChat?: boolean;
    /** Tier 3: scheduled/background AI analysis the system runs without being asked. */
    aiProactive?: boolean;
    /** Tier 3: AI summaries embedded across the app rather than in the chat bubble. */
    aiEmbedded?: boolean;
    /** Tier 3: dictated clinical notes structured into records. */
    aiVoice?: boolean;
    aiMonthlyCredits?: number;
    extraAiCredits?: number;
    /**
     * How far past the included allowance the assistant keeps answering, billed per credit at
     * `AI_OVERAGE_EGP_PER_CREDIT`. Overrides the tier's figure. 0 means a hard stop at the
     * allowance.
     */
    aiOverageCredits?: number;
    maxStaff?: number;
    /** Marketing add-on, level 1: AI content studio, calendar, playbooks. Sold separately from tiers. */
    marketingText?: boolean;
    /** Marketing add-on, level 2: branded designs (Brand Kit, templates, before/after studio). */
    marketingDesign?: boolean;
    /** Monthly cap on marketing AI generations. A single generation costs 1, a month plan costs 5. */
    marketingMonthlyCredits?: number;
  };
  billingCycle?: 'Monthly' | 'Yearly' | '2-Yearly';
  /** What this clinic actually pays per cycle, in EGP, when it differs from the list price. */
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
