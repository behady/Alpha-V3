import { reserveAiCredits } from "@/lib/aiQuota";

/**
 * The bot's view of the clinic's AI credit pool.
 *
 * A thin shape over `lib/aiQuota`, kept so the voice-note and photo paths read the way they
 * always have: reserve, then charge with a feature name and a one-line detail. The rule itself —
 * plan gate, included allowance, overage, the owner's notice — lives in one place for the bot and
 * the in-app assistant alike.
 */

export type CreditReservation =
  | { ok: true; charge: (feature: string, detail: string, credits?: number) => Promise<void> }
  | { ok: false; reason: "plan" | "no_credits" | "no_clinic" };

export async function reserveAiCredit(clinicId: string, credits = 1): Promise<CreditReservation> {
  const r = await reserveAiCredits(clinicId, credits);
  if (!r.ok) return { ok: false, reason: r.reason };
  return {
    ok: true,
    charge: (feature, detail, n = credits) =>
      r.charge({ feature, detail, credits: n, userId: "whatsapp_bot", userName: "WhatsApp Bot" }),
  };
}
