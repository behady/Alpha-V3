/**
 * Firestore: `settings/clinic_info` — the clinic's own details, in one document.
 *
 * Was split across `settings/clinic_info` and `settings/clinicProfile` until Phase 2 of the
 * settings rebuild; see the note at the top of src/lib/clinicProfile.ts for what moved and why
 * `name` is the field that must not be renamed.
 */
export interface ClinicProfile {
  /** Stored as BOTH `name` (canonical — Android and every print header read it) and `clinicName`. */
  clinicName: string;
  phone: string;
  address: string;
  /** Google Maps URL for directions / listing (not the review-write URL). */
  googleMapsUrl: string;
  /** Direct link for patients to leave a Google review (used for `{{google_link}}`). */
  googleReviewUrl: string;
  logoUrl: string;
  /**
   * The currency shown on price lists, the briefing, and every treatment-plan PDF.
   *
   * It was read from this document from the beginning and had no screen that could set it, so
   * every clinic was silently on EGP whatever country it billed in. Defaults to "EGP" on read.
   */
  currency: string;
  /**
   * The line printed at the top of every prescription, under the clinic name.
   *
   * Same story as `currency`: printed on every prescription and treatment plan, editable nowhere.
   * Blank falls back to the prescribing doctor's name, which is what happened for everyone.
   */
  rxHeader: string;
  updatedAt?: string;
}
