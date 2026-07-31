/**
 * Canonical patient fields used across the app (Firestore: patients/{id}).
 * Extend as needed; many screens still use loose typing — migrate gradually.
 */
export interface Patient {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: string;
  dob?: string;
  gender?: string;
  status?: string;
  referral?: string;
  allergies?: string;
  historyTags?: string[];
  /** When true, automated WhatsApp messages must not be sent to this patient. */
  whatsappOptOut?: boolean;
  [key: string]: unknown;
}
