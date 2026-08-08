import { adminDb } from "@/lib/firebaseAdmin";

/**
 * Run a job once per active clinic.
 *
 * Scheduled routes have no signed-in user to resolve a clinic from, and the pattern they used
 * instead — reading root-level `appointments` / `patients` — hit collections that do not exist
 * in this data model, so the nightly reminder job silently processed nothing. Anything running
 * on a timer has to iterate tenants explicitly; this is the one place that decides what
 * "active" means, matching `isClinicActive()` in firestore.rules (status defaults to Active
 * when the field is absent).
 *
 * One clinic's failure must not abort the rest of the run, so errors are collected and
 * returned rather than thrown.
 */
export type ClinicRunResult<T> = {
  clinicId: string;
  ok: boolean;
  result?: T;
  error?: string;
};

export async function forEachActiveClinic<T>(
  job: (clinicId: string) => Promise<T>
): Promise<ClinicRunResult<T>[]> {
  const snap = await adminDb().collection("clinics").get();

  const active = snap.docs.filter((doc) => {
    const status = (doc.data() || {}).status;
    // Absent status means Active, per the rules helper.
    return status === undefined || status === null || status === "Active";
  });

  const results: ClinicRunResult<T>[] = [];
  for (const doc of active) {
    try {
      results.push({ clinicId: doc.id, ok: true, result: await job(doc.id) });
    } catch (error: unknown) {
      results.push({
        clinicId: doc.id,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return results;
}
