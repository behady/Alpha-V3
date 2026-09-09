import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { logAiCreditUsage, type AiTokenUsage } from "@/lib/aiCreditLog";
import { sendClinicPush } from "@/lib/push";
import { AI_OVERAGE_EGP_PER_CREDIT, evaluateAiQuota, type AiQuotaVerdict } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";

/**
 * The clinic's AI credit pool, as the one gate every metered AI feature answers to.
 *
 * Five routes and the WhatsApp bot each used to read the clinic, read the month's usage, compare
 * against the limit and write the charge — six copies of one billing rule, and when the rule
 * changed (the assistant now keeps working on overage instead of stopping) six places to change
 * it. Now they all reserve here and charge here.
 *
 * Reserve first (plan gate + pool check), charge only after the model actually produced
 * something: billing on entry means a clinic pays for requests that error out, which is the kind
 * of charge that generates support tickets.
 */

export type ChargeDetails = {
  feature: string;
  detail?: string;
  userId?: string;
  userName?: string;
  patientId?: string;
  patientName?: string;
  usage?: AiTokenUsage;
  /** Charge a different amount than reserved (a turn that turned out cheaper). */
  credits?: number;
};

export type AiReservation =
  | {
      ok: true;
      clinic: Clinic;
      verdict: AiQuotaVerdict;
      usedThisMonth: number;
      charge: (details: ChargeDetails) => Promise<void>;

    }
  | { ok: false; reason: "plan" | "no_credits" | "no_clinic"; clinic: Clinic | null; verdict: AiQuotaVerdict | null };

const monthKeyNow = () => new Date().toISOString().slice(0, 7);

/**
 * What a route says when a clinic cannot spend another credit this month. Only reached once the
 * included allowance AND the plan's overage are both gone, so it says that rather than implying
 * the allowance alone ran out.
 */
export function quotaExhaustedMessage(verdict: AiQuotaVerdict | null): string {
  if (!verdict) return "This clinic's AI allowance for the month is used up. Resets on the 1st.";
  const included = verdict.included.toLocaleString("en-US");
  const hard = Number.isFinite(verdict.hardLimit) ? verdict.hardLimit.toLocaleString("en-US") : included;
  return `This clinic has used its ${included} included AI credits and the ${hard} ceiling its plan allows this month. Resets on the 1st, or ask us to raise the ceiling.`;
}

export async function reserveAiCredits(clinicId: string, required = 1): Promise<AiReservation> {
  const db = adminDb();
  const clinicSnap = await db.collection("clinics").doc(clinicId).get();
  if (!clinicSnap.exists) return { ok: false, reason: "no_clinic", clinic: null, verdict: null };
  const clinic = { id: clinicSnap.id, ...clinicSnap.data() } as Clinic;

  const monthKey = monthKeyNow();
  const usageRef = db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey);
  const usageSnap = await usageRef.get();
  const used = usageSnap.exists ? Number(usageSnap.data()?.creditsUsed) || 0 : 0;

  const verdict = evaluateAiQuota(clinic, used, required);
  if (!verdict.allowed) return { ok: false, reason: verdict.reason ?? "no_credits", clinic, verdict };

  return {
    ok: true,
    clinic,
    verdict,
    usedThisMonth: used,
    charge: async ({ feature, detail = "", userId = "", userName = "", patientId, patientName, usage, credits }) => {
      const n = typeof credits === "number" && credits >= 0 ? credits : required;
      // Re-derive the overage share for the amount actually charged, which can differ from the
      // amount reserved.
      const overage = n === required ? verdict.overageCredits : evaluateAiQuota(clinic, used, n).overageCredits;

      await usageRef.set(
        {
          monthKey,
          creditsUsed: FieldValue.increment(n),
          ...(overage > 0 ? { overageCredits: FieldValue.increment(overage) } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await logAiCreditUsage({
        clinicId,
        feature,
        credits: n,
        userId,
        userName,
        patientId,
        patientName,
        detail: detail.slice(0, 120),
        usage,
      }).catch(() => {});

      if (verdict.entersOverage) void notifyOverageEntered(clinicId, verdict.included);
    },
  };
}

/**
 * Tell the owner, once a month, that the included replies are used up and the assistant is now
 * running on overage. The old behaviour — the bot going quiet and patients being handed to the
 * receptionist — is what this replaces, so the message says what is happening and what it costs.
 */
async function notifyOverageEntered(clinicId: string, included: number) {
  const alerts = adminDb().collection("clinics").doc(clinicId).collection("settings").doc("bot_alerts");
  const monthKey = monthKeyNow();
  try {
    const snap = await alerts.get();
    if (snap.data()?.overageAlertMonth === monthKey) return;
    await alerts.set({ overageAlertMonth: monthKey }, { merge: true });
    await sendClinicPush(
      clinicId,
      {
        title: "المساعد الذكي شغّال على الرصيد الإضافي",
        body: `استخدمت ${included.toLocaleString("en-US")} رد المشمولة في باقتك هذا الشهر. المساعد لسه بيرد على المرضى، وكل رد إضافي بـ ${AI_OVERAGE_EGP_PER_CREDIT} جنيه على الفاتورة الجاية.`,
      },
      { roles: ["Admin"] }
    );
  } catch {
    // A missed notice is not worth failing a reply over.
  }
}
