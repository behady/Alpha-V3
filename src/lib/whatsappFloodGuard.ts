import { FieldValue } from "firebase-admin/firestore";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { conversationKey } from "@/lib/bot/conversation";

/**
 * A ceiling on how many messages the clinic can send one patient without being asked.
 *
 * Every specific cause of a flood gets fixed as it is found — the appointment notice that fired
 * on each drag, the lead welcome that retried, the reminder that ran twice. This is for the next
 * one, which nobody has thought of yet. The number that gets restricted is restricted for the
 * aggregate, not for the single message whose author was careless, so the count has to live below
 * all of them.
 *
 * Deliberately generous: a patient can legitimately receive a booking confirmation, a reminder,
 * a receipt and an aftercare note in one day. What they cannot receive is ten of anything in an
 * hour, and a clinic that hits this ceiling has a bug rather than a busy day.
 *
 * Two things are exempt on purpose. A reply the patient is waiting for — anything the assistant
 * or a staff member writes back into a live conversation — is answering them, not interrupting
 * them, and silencing that is worse than the flood. And staff-audience messages (owner alerts,
 * lab orders) are the clinic writing to itself.
 */

const WINDOW_MS = 60 * 60 * 1000;
/** Six automated messages in an hour is already odd; the seventh is a fault. */
const MAX_PER_WINDOW = 6;

/*
 * The `auto` prefix is not decoration. This document already carries `windowStartedAt` and
 * `repliesInWindow` for the assistant's own hourly reply cap; writing to those from here would
 * quietly re-open or exhaust the bot's budget every time a reminder went out.
 */
interface FloodState {
  autoWindowStartedAt?: number;
  autoSentInWindow?: number;
  autoBlockedInWindow?: number;
  lastBlockedAt?: number;
}

/**
 * Record that a message is about to go out, and say whether it may.
 *
 * Counted on the conversation document, which already exists per patient per clinic and is the
 * same key the chat screen and the opt-out use — so a flood is visible in the one place a
 * receptionist is already looking, rather than in a counter of its own that nobody opens.
 */
export async function allowAutomatedMessage(clinicId: string, to: string, kind: string): Promise<{ allowed: boolean; sentInWindow: number }> {
  const ref = adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(to));
  try {
    const snap = await ref.get();
    const state = (snap.data() || {}) as FloodState;
    const now = Date.now();
    const started = Number(state.autoWindowStartedAt) || 0;
    const fresh = now - started > WINDOW_MS;
    const sent = fresh ? 0 : Number(state.autoSentInWindow) || 0;

    if (sent >= MAX_PER_WINDOW) {
      await ref.set(
        {
          autoBlockedInWindow: FieldValue.increment(1),
          lastBlockedAt: now,
          lastBlockedKind: kind,
          // Left on the document so the desk can see it happened without reading a log.
          floodGuardTrippedAt: now,
        },
        { merge: true }
      );
      return { allowed: false, sentInWindow: sent };
    }

    await ref.set(
      {
        autoWindowStartedAt: fresh ? now : started || now,
        autoSentInWindow: fresh ? 1 : FieldValue.increment(1),
        ...(fresh ? { autoBlockedInWindow: 0 } : {}),
      },
      { merge: true }
    );
    return { allowed: true, sentInWindow: sent + 1 };
  } catch {
    // A counter that cannot be read must not be able to stop the clinic talking to its patients.
    return { allowed: true, sentInWindow: 0 };
  }
}
