/**
 * Firestore: `settings/clinicProfile`
 * Global clinic branding, Maps location, and review link (WhatsApp `google_review` template uses `googleReviewUrl`).
 */
export interface ClinicProfile {
  clinicName: string;
  phone: string;
  address: string;
  /** Google Maps URL for directions / listing (not the review-write URL). */
  googleMapsUrl: string;
  /** Direct link for patients to leave a Google review (used for `{{google_link}}`). */
  googleReviewUrl: string;
  logoUrl: string;
  updatedAt?: string;
}
