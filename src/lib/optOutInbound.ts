import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { isOptOutReply } from "@/lib/patientMessaging";
import { phoneMatchKey, pickPatientPhone } from "@/lib/patientPhone";
import { normalizeToInternationalDigits } from "@/lib/whatsapp";

/**
 * Acting on a patient who replied "STOP".
 *
 * The footer added to every automated message promises this. If the promise is not kept, the
 * footer makes things worse rather than better: a patient who asks twice to be left alone and is
 * messaged again does not ask a third time — they press "Report spam", which is the single signal
 * that gets a clinic's WhatsApp number restricted. So this is not a courtesy feature bolted onto
 * the footer; it is the half of it that does the protecting.
 *
 * Opting out is deliberately one-way here. Only a staff member can turn messaging back on for a
 * patient, from the patient's own profile — an automated re-subscribe from, say, the word "start"
 * would let a mis-typed message undo an explicit request.
 */

export type InboundChannel = "whatsapp" | "sms";

export type OptOutResult =
  /** The reply was not a stop request. The overwhelmingly common case. */
  | { status: "ignored" }
  | { status: "opted_out"; patientId: string; patientName: string }
  /** Already opted out — a patient repeating themselves must not look like a failure. */
  | { status: "already" ; patientId: string }
  /** Nobody in this clinic has that number. Recorded so a person can look. */
  | { status: "unknown_number"; phone: string };

/**
 * Find the patient behind an inbound number.
 *
 * One indexed query for the shape almost every record actually uses, then a bounded scan
 * comparing `phoneMatchKey` — because the stored shapes genuinely vary in this data
 * (`+201551552440`, `01024348877`, `٠١٢٢٢٦٨١٥٧٨` all appear), and an equality query can only
 * ever find the one spelling it was handed. The scan is capped: an inbound webhook must not be
 * able to trigger an unbounded read of a large clinic's whole patient list.
 */
async function findPatientByPhone(
  clinicId: string,
  phone: string
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const key = phoneMatchKey(phone);
  if (key.length < 7) return null;

  // Fast path: the dominant stored format is `+<international digits>` on the `phone` field.
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits) {
    const direct = await adminClinicCollection(clinicId, "patients")
      .where("phone", "==", `+${digits}`)
      .limit(1)
      .get();
    if (!direct.empty) {
      const doc = direct.docs[0];
      return { id: doc.id, data: (doc.data() || {}) as Record<string, unknown> };
    }
  }

  const scan = await adminClinicCollection(clinicId, "patients").limit(3000).get();
  for (const doc of scan.docs) {
    const data = (doc.data() || {}) as Record<string, unknown>;
    if (phoneMatchKey(pickPatientPhone(data)) === key) {
      return { id: doc.id, data };
    }
  }

  return null;
}

/**
 * Apply an inbound reply, if it is a stop request.
 *
 * Both channels are switched off together, whichever one the reply arrived on. A patient who says
 * stop means stop being messaged, not stop being messaged in this particular app — and reading it
 * narrowly is how someone who asked to be left alone starts receiving texts instead. This is the
 * same reasoning that makes an unset `smsOptOut` inherit `whatsappOptOut`; see lib/patientMessaging.
 *
 * Never throws. It is called from webhook handlers that must answer 200 whatever happens, because
 * a gateway that receives an error retries the delivery, and a retried STOP is not more stop.
 */
export async function applyInboundOptOut(args: {
  clinicId: string;
  phone: string;
  text: string;
  channel: InboundChannel;
}): Promise<OptOutResult> {
  const { clinicId, phone, text, channel } = args;

  if (!isOptOutReply(text)) return { status: "ignored" };

  try {
    const found = await findPatientByPhone(clinicId, phone);

    if (!found) {
      // Worth writing down even with nobody to attach it to: it is evidence for the clinic that
      // an unrecognised number asked to be left alone, and the number may well belong to a lead
      // or to a patient whose record has the phone under a name nobody expected.
      await adminClinicCollection(clinicId, "messaging_opt_outs")
        .doc(normalizeToInternationalDigits(phone) || phone.replace(/\D/g, "") || "unknown")
        .set({
          phone,
          channel,
          reply: text,
          matchedPatient: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      return { status: "unknown_number", phone };
    }

    const already = found.data.whatsappOptOut === true && found.data.smsOptOut === true;
    const patientName = (typeof found.data.name === "string" && found.data.name.trim()) || "Patient";

    if (already) return { status: "already", patientId: found.id };

    await adminClinicDoc(clinicId, "patients", found.id).update({
      whatsappOptOut: true,
      smsOptOut: true,
      optOutAt: FieldValue.serverTimestamp(),
      optOutChannel: channel,
      optOutSource: "patient_reply",
    });

    // Written to the same log the outgoing messages use, so the patient's message history shows
    // the request alongside what the clinic sent — the context anyone reviewing a complaint needs.
    await adminClinicCollection(clinicId, "whatsapp_logs").add({
      patientId: found.id,
      type: `opt_out_${channel}`,
      message: text,
      status: "received",
      createdAt: FieldValue.serverTimestamp(),
    });

    return { status: "opted_out", patientId: found.id, patientName };
  } catch (e) {
    console.warn("applyInboundOptOut failed:", e);
    return { status: "ignored" };
  }
}
