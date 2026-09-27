import { sendPatientWhatsAppAuto } from "@/lib/whatsappDelivery";
import { recordThreadMessage } from "./thread";

/**
 * The one message an opted-out number still receives: confirmation that it worked.
 *
 * Silence after "stop" reads as "they ignored me", and a patient who thinks that writes again,
 * or reports the number — the outcome the whole opt-out exists to prevent. One line, sent as a
 * direct reply to their own message (so it is inside the 24-hour window on any channel), and
 * then nothing, ever, from the assistant or the automations.
 *
 * Never throws: it runs inside webhooks that must answer 200 whatever happens.
 */
export async function confirmOptOut(clinicId: string, to: string, theirText: string, channel: "meta" | "wapilot"): Promise<void> {
  const latin = /[A-Za-z]/.test(theirText) && !/[؀-ۿ]/.test(theirText);
  const text = latin ? "Done — you won't receive messages from us again." : "تمام، وقفنا الرسايل ومش هنبعتلك تاني 🙏";
  try {
    const waMessageId = await sendPatientWhatsAppAuto(clinicId, to, text);
    await recordThreadMessage(clinicId, to, { direction: "out", author: "bot", text, kind: "opt_out_confirmed", waMessageId, channel }).catch(() => {});
  } catch (e) {
    console.warn("[opt-out] confirmation not sent:", e);
  }
}
