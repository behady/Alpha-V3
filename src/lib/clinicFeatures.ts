import { adminDb } from "@/lib/firebaseAdmin";
import { hasFeature, type TIER_LIMITS } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";

/**
 * Server-side feature check for a clinic.
 *
 * `hasFeature` needs the clinic document, which the browser already has in context but the API
 * routes do not. This reads it, with the same per-clinic override-then-tier logic, so a paid
 * feature cannot be reached by calling the endpoint directly.
 */

type FeatureKey = keyof (typeof TIER_LIMITS)["Basic"]["features"];

type CacheEntry = { clinic: Clinic | null; at: number };
const cache = new Map<string, CacheEntry>();

/**
 * Short enough that an upgrade takes effect while the customer is still on the phone about it,
 * long enough that the nightly sweep does not re-read the same document once per patient.
 */
const CACHE_MS = 60_000;

async function loadClinic(clinicId: string): Promise<Clinic | null> {
  const cached = cache.get(clinicId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.clinic;

  try {
    const snap = await adminDb().collection("clinics").doc(clinicId).get();
    const clinic = snap.exists ? ({ id: snap.id, ...snap.data() } as Clinic) : null;
    cache.set(clinicId, { clinic, at: Date.now() });
    return clinic;
  } catch {
    // Deliberately not cached: a transient read failure should not lock a paying clinic out of
    // its features for the next minute.
    return null;
  }
}

/**
 * Whether this clinic's plan includes a feature.
 *
 * Fails closed. An unreadable clinic document resolves to "no", because the alternative — handing
 * out a paid feature whenever Firestore hiccups — is the failure nobody reports.
 */
export async function clinicHasFeature(clinicId: string, featureKey: FeatureKey): Promise<boolean> {
  return hasFeature(await loadClinic(clinicId), featureKey);
}
