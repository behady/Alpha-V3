import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { logAiCreditUsage } from "@/lib/aiCreditLog";
import { getAiCreditLimit, hasFeature } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";

/**
 * The clinic's AI credit pool, as one gate every paid WhatsApp feature answers to.
 *
 * The AI answer path had this inline; voice-note transcription needs the same check and the same
 * bill-on-success rule, and two copies of a billing rule is how one of them drifts. Reserve first
 * (plan gate + pool check), charge only after the model actually produced something.
 */

export type CreditReservation =
  | { ok: true; charge: (feature: string, detail: string, credits?: number) => Promise<void> }
  | { ok: false; reason: "plan" | "no_credits" | "no_clinic" };

export async function reserveAiCredit(clinicId: string, credits = 1): Promise<CreditReservation> {
  const db = adminDb();
  const clinicSnap = await db.collection("clinics").doc(clinicId).get();
  if (!clinicSnap.exists) return { ok: false, reason: "no_clinic" };
  const clinic = { id: clinicSnap.id, ...clinicSnap.data() } as Clinic;
  if (!hasFeature(clinic, "aiChat")) return { ok: false, reason: "plan" };

  const monthKey = new Date().toISOString().slice(0, 7);
  const usageRef = db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey);
  const usageSnap = await usageRef.get();
  const used = usageSnap.exists ? Number(usageSnap.data()?.creditsUsed) || 0 : 0;
  const limit = getAiCreditLimit(clinic);
  if (limit > 0 && used + credits > limit) return { ok: false, reason: "no_credits" };

  return {
    ok: true,
    charge: async (feature, detail, n = credits) => {
      await usageRef.set(
        { monthKey, creditsUsed: FieldValue.increment(n), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      await logAiCreditUsage({
        clinicId,
        feature,
        credits: n,
        userId: "whatsapp_bot",
        userName: "WhatsApp Bot",
        detail: detail.slice(0, 120),
      }).catch(() => {});
    },
  };
}
