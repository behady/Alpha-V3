import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";

/**
 * Learning which patient hides behind a WhatsApp `@lid`.
 *
 * WhatsApp's privacy rollout strips the phone number from inbound messages: the sender is only
 * `172357054414966@lid`. The gateway's endpoint for resolving that back to a phone answers 500 on
 * every input, and sending TO a lid fails at their worker with a 422 — both verified live. So the
 * mapping has to be learned rather than asked for, and there is exactly one place it leaks:
 * our own outgoing messages.
 *
 * When the clinic sends a booking confirmation to `+201551552440`, the gateway delivers it into a
 * chat that IT knows by lid — and with the `message.any` webhook event enabled, it tells us about
 * that delivery using the lid as the chat id. We know what text we just sent and to whom; the
 * event says which lid that text landed in. Match the two and the lid is bound to the patient,
 * permanently, on their own record.
 *
 * From then on that patient is identifiable again: the assistant greets them by name, a stop
 * request flags their actual record, and — the part that matters most — replies can go to their
 * REAL phone, which delivers, instead of to the lid, which does not.
 */

/** The chat a gateway event belongs to, when that chat is behind a lid. */
export function lidChatFromEvent(event: Record<string, unknown> | null | undefined): string {
  if (!event || typeof event !== "object") return "";

  const isLid = (v: unknown): v is string => typeof v === "string" && /@lid$/i.test(v.trim());

  // whatsapp-web.js message ids are `<fromMe>_<chatId>_<hash>`; the chat survives in the id even
  // when the from/to fields are shaped differently between event types.
  const id = typeof event.id === "string" ? event.id : "";
  const idParts = id.split("_");
  if (idParts.length >= 3 && isLid(idParts[1])) return idParts[1].trim();

  for (const field of [event.to, event.from, event.chatId, event.chat_id]) {
    if (isLid(field)) return field.trim();
  }
  return "";
}

/** The patient already bound to this lid, if any. */
export async function findPatientByLid(
  clinicId: string,
  lidChatId: string
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const lid = String(lidChatId || "").trim();
  if (!lid) return null;
  const snap = await adminClinicCollection(clinicId, "patients")
    .where("whatsappLid", "==", lid)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, data: (doc.data() || {}) as Record<string, unknown> };
}

/** Comparable form of a message body: the same text however whitespace got mangled in transit. */
function bodyKey(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** Bodies older than this are not evidence — the same template goes out every day. */
const MATCH_WINDOW_MS = 15 * 60 * 1000;

/**
 * Try to bind a lid to a patient, given an outgoing message the gateway reported.
 *
 * The binding must be UNAMBIGUOUS: the event's text has to match exactly one recent logged
 * message with exactly one patient behind it. Two patients sent identical texts in the same
 * quarter hour means no binding at all — a wrong binding here would route one patient's
 * conversation, and their opt-out, onto another patient's record, which is strictly worse than
 * staying unidentified. The next non-identical message binds them instead.
 */
export async function learnPatientLid(
  clinicId: string,
  lidChatId: string,
  messageBody: string,
  now = Date.now()
): Promise<{ learned: boolean; patientId?: string; reason: string }> {
  const lid = String(lidChatId || "").trim();
  const key = bodyKey(messageBody);
  // Short bodies ("ok", "تمام") repeat across patients constantly; they are not evidence.
  if (!lid || key.length < 25) return { learned: false, reason: "no_evidence" };

  const existing = await findPatientByLid(clinicId, lid);
  if (existing) return { learned: false, patientId: existing.id, reason: "already_known" };

  // Recent outgoing log rows, matched in code rather than by an equality query: message bodies
  // are long and Arabic, and a scan of 25 recent rows beats depending on how Firestore indexes
  // multi-kilobyte strings.
  const snap = await adminClinicCollection(clinicId, "whatsapp_logs")
    .orderBy("createdAt", "desc")
    .limit(25)
    .get();

  const patientIds = new Set<string>();
  for (const doc of snap.docs) {
    const d = (doc.data() || {}) as Record<string, unknown>;
    const pid = typeof d.patientId === "string" && d.patientId ? d.patientId : "";
    if (!pid) continue;
    const createdAt = (d.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    if (createdAt && now - createdAt > MATCH_WINDOW_MS) continue;
    if (bodyKey(d.message) !== key) continue;
    patientIds.add(pid);
  }

  if (patientIds.size !== 1) {
    return { learned: false, reason: patientIds.size === 0 ? "no_match" : "ambiguous" };
  }

  const patientId = [...patientIds][0];
  await adminClinicDoc(clinicId, "patients", patientId).update({
    whatsappLid: lid,
    whatsappLidLearnedAt: FieldValue.serverTimestamp(),
    whatsappLidSource: "echo_learned",
  });
  return { learned: true, patientId, reason: "learned" };
}
