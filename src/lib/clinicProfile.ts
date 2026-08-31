import { getDoc } from "firebase/firestore";
import type { ClinicProfile } from "@/types/clinicProfile";
import { getClinicDoc } from "@/lib/db-utils";

/**
 * The clinic's own details — one document.
 *
 * Phase 2 of the settings rebuild. There used to be two: `settings/clinic_info` and
 * `settings/clinicProfile`, both holding the clinic's name, phone and address, and the profile
 * screen wrote both by hand on every save. Roughly thirty places read the first — every printed
 * header, every outbound WhatsApp message, the AI routes, the Android app — while only the logo
 * and the two Google links ever came from the second. Someone had already left a warning about it
 * in lib/labOrderPrint.ts.
 *
 * `clinic_info` won because the alternative was migrating those thirty readers plus a native app
 * that reads Firestore directly and ships on its own schedule. The three fields that only lived on
 * the profile document — the logo and the two Google links — moved onto it.
 *
 * ## The one field you may not rename
 *
 * `name` is canonical. The Android app reads `snap.getString("name")` with no fallback, so a
 * clinic whose name lives only under `clinicName` prints a blank letterhead on every prescription
 * issued from a phone. `clinicName` is still written beside it because existing documents and a
 * few web readers use it, but it is a mirror, not the source.
 *
 * ## Why reads still fall back
 *
 * Clinics that have not opened and saved the profile screen since this shipped still have their
 * logo and Google links on the old document. Reading falls back to it so nothing disappears in
 * the meantime; the next save on the profile screen copies them across, and
 * `scripts/backfill-clinic-profile.mjs` does it for every clinic at once. Once the backfill has
 * run everywhere, `readLegacyProfile` and the old document can both go.
 */

/** The single document. Named for what it is rather than where it used to live. */
export const CLINIC_PROFILE_DOC = { collection: "settings", docId: "clinic_info" } as const;

/** The document being retired. Read-only from here on — nothing writes it any more. */
export const LEGACY_CLINIC_PROFILE_DOC = { collection: "settings", docId: "clinicProfile" } as const;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Map a stored document onto the profile shape.
 *
 * `name` is preferred over `clinicName` in that order, matching every print header in the app and
 * the Android reader. Returns null only for a document that does not exist.
 */
export function normalizeClinicProfileRecord(
  data: Record<string, unknown> | undefined
): ClinicProfile | null {
  if (!data) return null;
  return {
    clinicName: str(data.name) || str(data.clinicName),
    phone: str(data.phone),
    address: str(data.address),
    googleMapsUrl: str(data.googleMapsUrl),
    googleReviewUrl: str(data.googleReviewUrl),
    logoUrl: str(data.logoUrl),
    currency: str(data.currency) || "EGP",
    rxHeader: str(data.rxHeader),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
  };
}

export const EMPTY_CLINIC_PROFILE: ClinicProfile = {
  clinicName: "",
  phone: "",
  address: "",
  googleMapsUrl: "",
  googleReviewUrl: "",
  logoUrl: "",
  currency: "EGP",
  rxHeader: "",
};

/** Safe for forms: never leaves optional keys undefined (avoids uncontrolled→controlled warnings). */
export function sanitizeClinicProfile(
  partial: Partial<ClinicProfile> | Record<string, unknown> | null | undefined
): ClinicProfile {
  return normalizeClinicProfileRecord((partial ?? {}) as Record<string, unknown>) ?? EMPTY_CLINIC_PROFILE;
}

/**
 * The fields that only ever lived on the old document, for a clinic that has not re-saved yet.
 *
 * Only these three. Name, phone and address are taken from `clinic_info` even when they are
 * blank there — the old document's copy of them is the stale one, and preferring it would undo
 * an edit made on any of the other settings screens.
 */
export const LEGACY_ONLY_FIELDS = ["googleMapsUrl", "googleReviewUrl", "logoUrl"] as const;

function needsLegacyFallback(profile: ClinicProfile): boolean {
  return LEGACY_ONLY_FIELDS.some((field) => !profile[field]);
}

function mergeLegacy(profile: ClinicProfile, legacy: ClinicProfile | null): ClinicProfile {
  if (!legacy) return profile;
  const merged = { ...profile };
  for (const field of LEGACY_ONLY_FIELDS) {
    if (!merged[field] && legacy[field]) merged[field] = legacy[field];
  }
  return merged;
}

/**
 * Client-side fetch for dashboards / forms. Returns a fully-shaped profile when it exists.
 *
 * Takes no arguments on purpose. It used to accept a Firestore instance and ignore it, which read
 * as though a caller could point it at another database or another clinic; it cannot. The clinic
 * comes from the one `getClinicDoc` resolves, which is whichever clinic the person is currently
 * working in.
 */
export async function getClinicProfile(): Promise<ClinicProfile | null> {
  const snap = await getDoc(getClinicDoc(CLINIC_PROFILE_DOC.collection, CLINIC_PROFILE_DOC.docId));
  const current = snap.exists()
    ? sanitizeClinicProfile(snap.data() as Record<string, unknown>)
    : null;

  if (current && !needsLegacyFallback(current)) return current;

  const legacySnap = await getDoc(
    getClinicDoc(LEGACY_CLINIC_PROFILE_DOC.collection, LEGACY_CLINIC_PROFILE_DOC.docId)
  );
  const legacy = legacySnap.exists()
    ? sanitizeClinicProfile(legacySnap.data() as Record<string, unknown>)
    : null;

  if (!current) return legacy;
  return mergeLegacy(current, legacy);
}

/**
 * What a save writes.
 *
 * Both `name` and `clinicName` on purpose: `name` is what Android and every print header read,
 * `clinicName` is what a handful of web screens still read. One save, one document, both spellings
 * — which is a different thing from the two-document split this replaced, because they can no
 * longer drift apart.
 */
export function clinicProfileWritePayload(profile: ClinicProfile): Record<string, unknown> {
  return {
    name: profile.clinicName,
    clinicName: profile.clinicName,
    phone: profile.phone,
    address: profile.address,
    googleMapsUrl: profile.googleMapsUrl,
    googleReviewUrl: profile.googleReviewUrl,
    logoUrl: profile.logoUrl,
    currency: profile.currency,
    rxHeader: profile.rxHeader,
    updatedAt: new Date().toISOString(),
  };
}
