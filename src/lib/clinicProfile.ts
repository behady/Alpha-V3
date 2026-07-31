import { doc, getDoc, type Firestore } from "firebase/firestore";
import type { ClinicProfile } from "@/types/clinicProfile";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

export const CLINIC_PROFILE_DOC = { collection: "settings", docId: "clinicProfile" } as const;

export function normalizeClinicProfileRecord(data: Record<string, unknown> | undefined): ClinicProfile | null {
  if (!data) return null;
  return {
    clinicName: typeof data.clinicName === "string" ? data.clinicName : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    address: typeof data.address === "string" ? data.address : "",
    googleMapsUrl: typeof data.googleMapsUrl === "string" ? data.googleMapsUrl : "",
    googleReviewUrl: typeof data.googleReviewUrl === "string" ? data.googleReviewUrl : "",
    logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : "",
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
};

/** Safe for forms: never leaves optional keys undefined (avoids uncontrolled→controlled input warnings). */
export function sanitizeClinicProfile(
  partial: Partial<ClinicProfile> | Record<string, unknown> | null | undefined
): ClinicProfile {
  return normalizeClinicProfileRecord((partial ?? {}) as Record<string, unknown>) ?? EMPTY_CLINIC_PROFILE;
}

/** Client-side fetch for dashboards / forms. Returns a fully-shaped profile when the doc exists. */
export async function getClinicProfile(db: Firestore): Promise<ClinicProfile | null> {
  const snap = await getDoc(getClinicDoc(CLINIC_PROFILE_DOC.collection, CLINIC_PROFILE_DOC.docId));
  if (!snap.exists()) return null;
  return sanitizeClinicProfile(snap.data() as Record<string, unknown>);
}
