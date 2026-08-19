import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";

/**
 * One row per AI credit charge, so the Settings page can show WHERE the month's credits went
 * instead of just how many are gone.
 *
 * Two writes per charge: an append-only row in `ai_usage_log` (the visible history) and a
 * per-feature counter on the monthly `ai_usage` doc (the exact breakdown, immune to the log
 * page's row limit). Both are server-only writes — firestore.rules deny clients, because a
 * meter a clinic member can edit is not a meter.
 *
 * Logging must never cost anyone an answer: every failure is swallowed after a console line.
 */
export async function logAiCreditUsage(opts: {
  clinicId: string;
  /** e.g. "chat", "reception", "treatment_plan", "plan_translation", "diagnosis_chat" */
  feature: string;
  credits: number;
  userId?: string;
  userName?: string;
  patientId?: string;
  patientName?: string;
  detail?: string;
}): Promise<void> {
  const monthKey = new Date().toISOString().slice(0, 7);
  try {
    await Promise.all([
      adminClinicCollection(opts.clinicId, "ai_usage_log").add({
        feature: opts.feature,
        credits: opts.credits,
        userId: opts.userId || "",
        userName: opts.userName || "",
        patientId: opts.patientId || "",
        patientName: opts.patientName || "",
        detail: opts.detail || "",
        monthKey,
        createdAt: FieldValue.serverTimestamp(),
      }),
      adminClinicDoc(opts.clinicId, "ai_usage", monthKey).set(
        { byFeature: { [opts.feature]: FieldValue.increment(opts.credits) } },
        { merge: true }
      ),
    ]);
  } catch (e) {
    console.error("Failed to log AI credit usage", e);
  }
}
