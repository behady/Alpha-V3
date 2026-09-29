import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { conversationKey } from "@/lib/bot/conversation";
import { isWhatsAppBlocked } from "@/lib/patientMessaging";
import { phoneMatchKey, pickPatientPhone } from "@/lib/patientPhone";
import { normalizeToInternationalDigits } from "@/lib/whatsapp";

/**
 * "May the clinic message this number?" — asked once, in one place, for every automated sender.
 *
 * A stop request lands in one of three places depending on who sent it, and until this existed
 * each sender checked a different subset:
 *
 *   patient       — `patients/{id}.whatsappOptOut`, set when the number matched a patient record.
 *                   The reminders, recall and review jobs check this one and only this one.
 *   conversation  — `whatsapp_conversations/{key}.optedOut`, set for anonymised (`@lid`) senders
 *                   the bot cannot match to a phone. The bot and the nudge read this and only this.
 *   number        — `messaging_opt_outs/{digits}`, written when nobody in the clinic had the
 *                   number: a lead, or a patient filed under a spelling no query finds. Written
 *                   since the STOP handling shipped and, until now, read by nothing at all — so a
 *                   lead who said stop was welcomed, followed up and, once booked, reminded.
 *
 * The three are checked together here, and the delivery chokepoint calls this for every
 * unattended patient message. A sender that forgets is still covered; the chokepoint is the
 * protection, and this is its memory.
 */

export type OptOutReason = "patient" | "conversation" | "number";

/**
 * Why this number must not be messaged, or null when it may be.
 *
 * Cheap by default: three point reads. `scan` adds the bounded pass over the patient list that
 * `optOutInbound` uses for oddly-spelled numbers — worth it for a one-off send, not for a batch
 * of forty reminders whose sender already had the patient record in hand.
 */
export async function whatsappOptOutReason(
  clinicId: string,
  phone: string,
  opts?: { scan?: boolean }
): Promise<OptOutReason | null> {
  const raw = String(phone || "").trim();
  if (!raw) return null;
  // A lid has no digits worth looking up under; only the conversation flag can know about it.
  const isLid = /@lid$/i.test(raw);
  const digits = isLid ? "" : normalizeToInternationalDigits(raw) || raw.replace(/\D/g, "");

  try {
    if (digits) {
      const number = await adminClinicCollection(clinicId, "messaging_opt_outs").doc(digits).get();
      if (number.exists) return "number";
    }

    const conversation = await adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(raw)).get();
    if (conversation.exists && conversation.data()?.optedOut === true) return "conversation";

    if (digits) {
      const direct = await adminClinicCollection(clinicId, "patients").where("phone", "==", `+${digits}`).limit(1).get();
      if (!direct.empty) return isWhatsAppBlocked(direct.docs[0].data() as { whatsappOptOut?: boolean }) ? "patient" : null;

      if (opts?.scan) {
        const key = phoneMatchKey(raw);
        if (key.length >= 7) {
          const scan = await adminClinicCollection(clinicId, "patients").limit(3000).get();
          for (const doc of scan.docs) {
            const data = (doc.data() || {}) as Record<string, unknown>;
            if (phoneMatchKey(pickPatientPhone(data)) === key) {
              return isWhatsAppBlocked(data as { whatsappOptOut?: boolean }) ? "patient" : null;
            }
          }
        }
      }
    }
  } catch (e) {
    // An unreadable flag is treated as "no flag": the alternative silently stops every reminder
    // in the clinic the moment Firestore hiccups, which nobody would report for days.
    console.warn("whatsappOptOutReason: read failed", e);
  }
  return null;
}

/**
 * Drop the people who asked to be left alone from a list about to be messaged.
 *
 * For audiences built from patient records the record's own flag is checked first, free; the
 * lookups above run only for the rest. Returns the survivors and how many were removed, so a
 * screen can say "3 patients skipped: they asked not to be messaged" instead of a quieter list.
 */
export async function withoutOptedOut<T>(
  clinicId: string,
  items: T[],
  pick: (item: T) => { phone: string; patient?: { whatsappOptOut?: boolean } | null }
): Promise<{ kept: T[]; removed: number }> {
  const kept: T[] = [];
  let removed = 0;
  for (const item of items) {
    const { phone, patient } = pick(item);
    if (patient && isWhatsAppBlocked(patient)) {
      removed += 1;
      continue;
    }
    if (await whatsappOptOutReason(clinicId, phone)) {
      removed += 1;
      continue;
    }
    kept.push(item);
  }
  return { kept, removed };
}
