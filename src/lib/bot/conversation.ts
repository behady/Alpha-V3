import { FieldValue } from "firebase-admin/firestore";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { phoneMatchKey } from "@/lib/patientPhone";
import type { BotState } from "./engine";

/**
 * What the bot remembers between one message and the next.
 *
 * Without this every message is judged alone, which is the difference between a bot and an
 * autoresponder: "١" only means "book me an appointment" if something remembers that a menu was
 * just sent. One document per phone number per clinic, and the clinic is in the path, so two
 * clinics can never read each other's conversations even if the same person is a patient at both.
 *
 * Deliberately short-lived. A conversation that has gone quiet is not paused, it is over: someone
 * answering "١" three days after the menu means something different from answering it in thirty
 * seconds, and treating those the same is how a bot books an appointment nobody asked for.
 */

const COLLECTION = "whatsapp_conversations";

/** Silence longer than this ends the conversation; the next message starts a fresh one. */
export const CONVERSATION_TTL_MS = 60 * 60 * 1000;

/**
 * How many times the bot will speak to one number within an hour.
 *
 * This is ban protection, not tidiness. A number that answers instantly, endlessly, at any hour is
 * exactly what an automated account looks like from the outside, and the clinic's own number is
 * what gets restricted. A patient who genuinely needs more than this needs a person anyway.
 */
export const MAX_REPLIES_PER_HOUR = 8;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * A conversation cannot run forever even inside the hour.
 *
 * The engine hands off long before this in normal use; the cap exists for the case the engine has
 * a loop in it that nobody spotted. A bot stuck repeating itself is worse than a silent one.
 */
export const MAX_TURNS = 12;

export interface BotConversation {
  phoneKey: string;
  phone: string;
  state: BotState;
  turns: number;
  patientId?: string;
  patientName?: string;
  /** Epoch ms of the last message from the patient. */
  lastMessageAt: number;
  /** Epoch ms when the current rate-limit window opened. */
  windowStartedAt: number;
  /** Replies sent inside the current window. */
  repliesInWindow: number;
}

function ref(clinicId: string, phoneKey: string) {
  return adminClinicDoc(clinicId, COLLECTION, phoneKey);
}

/**
 * The conversation for this number, aged out if it has gone quiet.
 *
 * An expired conversation is returned as a fresh one rather than deleted: the rate-limit window is
 * a property of the *number*, not of the conversation, and dropping it would let anyone reset the
 * limit by simply waiting for the chat to lapse.
 */
export async function loadConversation(
  clinicId: string,
  phone: string,
  now: number
): Promise<BotConversation> {
  const phoneKey = phoneMatchKey(phone) || phone.replace(/\D/g, "") || "unknown";
  const snap = await ref(clinicId, phoneKey).get();

  const fresh: BotConversation = {
    phoneKey,
    phone,
    state: "new",
    turns: 0,
    lastMessageAt: now,
    windowStartedAt: now,
    repliesInWindow: 0,
  };

  if (!snap.exists) return fresh;
  const d = (snap.data() || {}) as Record<string, unknown>;

  const lastMessageAt = Number(d.lastMessageAt) || 0;
  const expired = now - lastMessageAt > CONVERSATION_TTL_MS;

  let windowStartedAt = Number(d.windowStartedAt) || now;
  let repliesInWindow = Number(d.repliesInWindow) || 0;
  if (now - windowStartedAt > RATE_WINDOW_MS) {
    windowStartedAt = now;
    repliesInWindow = 0;
  }

  return {
    phoneKey,
    phone,
    // The conversation resets, the rate limit does not.
    state: expired ? "new" : ((d.state as BotState) || "new"),
    turns: expired ? 0 : Number(d.turns) || 0,
    patientId: typeof d.patientId === "string" ? d.patientId : undefined,
    patientName: typeof d.patientName === "string" ? d.patientName : undefined,
    lastMessageAt,
    windowStartedAt,
    repliesInWindow,
  };
}

/** Whether the bot is still allowed to speak to this number right now, and why not. */
export function replyAllowance(c: BotConversation): { allowed: boolean; reason?: string } {
  if (c.repliesInWindow >= MAX_REPLIES_PER_HOUR) return { allowed: false, reason: "rate_limited" };
  if (c.turns >= MAX_TURNS) return { allowed: false, reason: "too_many_turns" };
  return { allowed: true };
}

/**
 * Record the turn that just happened.
 *
 * `replied` is passed rather than inferred, because a turn where the bot deliberately said nothing
 * still advances the conversation and still needs its state written — it just must not count
 * against the number's reply budget.
 */
export async function saveConversation(
  clinicId: string,
  c: BotConversation,
  next: { state: BotState; replied: boolean; reason: string; patientId?: string; patientName?: string },
  now: number
): Promise<void> {
  const payload: Record<string, unknown> = {
    phone: c.phone,
    state: next.state,
    turns: c.turns + 1,
    lastMessageAt: now,
    lastReason: next.reason,
    windowStartedAt: c.windowStartedAt,
    repliesInWindow: c.repliesInWindow + (next.replied ? 1 : 0),
    updatedAt: FieldValue.serverTimestamp(),
  };
  // Firestore rejects an explicit undefined, and these are optional by nature.
  if (next.patientId ?? c.patientId) payload.patientId = next.patientId ?? c.patientId;
  if (next.patientName ?? c.patientName) payload.patientName = next.patientName ?? c.patientName;

  await ref(clinicId, c.phoneKey).set(payload, { merge: true });
}

/**
 * Flag a conversation for a person to pick up.
 *
 * Written onto the conversation itself rather than a separate queue, so the thing staff open shows
 * the whole exchange and not just the sentence that triggered the handoff.
 */
export async function markHandoff(
  clinicId: string,
  phoneKey: string,
  reason: string
): Promise<void> {
  await ref(clinicId, phoneKey).set(
    { needsHuman: true, handoffReason: reason, handoffAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}
