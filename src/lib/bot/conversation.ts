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
// A full booking costs four replies (menu, days, times, confirmation); a patient who books and
// asks about hours is at six. Eight was hit by the first real test session within the hour, and
// the silence read as breakage — the cap must fit a legitimate conversation with room to spare
// while still strangling anything resembling a flood.
export const MAX_REPLIES_PER_HOUR = 15;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * A conversation cannot run forever even inside the hour.
 *
 * The engine hands off long before this in normal use; the cap exists for the case the engine has
 * a loop in it that nobody spotted. A bot stuck repeating itself is worse than a silent one.
 */
export const MAX_TURNS = 40;

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
  /**
   * The numbered options the last booking message offered, so "2" next turn means something.
   *
   * Stored days are YYYY-MM-DD keys and times are the canonical `hh:mm AM/PM` strings the
   * calendar uses — the exact values the booking write needs, never re-derived from the label
   * text the patient saw.
   */
  pendingDays?: string[];
  pendingTimes?: string[];
  /** The day the pending times belong to. */
  pendingDate?: string;
  /**
   * This sender said stop, and could not be matched to a patient record to say it there.
   *
   * Exists for `@lid` senders — WhatsApp's anonymised ids, which hide the phone and therefore the
   * patient. Carried across conversation expiry on purpose: the chat lapsing after an hour must
   * not mean the bot greets someone who asked to be left alone, and this flag is the only place
   * that request can live when there is no patient document to hold it.
   */
  optedOut?: boolean;
}

/**
 * The storage key for one sender.
 *
 * A phone reduces to its subscriber digits so every spelling of the same number shares one
 * conversation. An `@lid` id is NOT a phone: its digits are an opaque WhatsApp identifier, and
 * putting them through the phone reduction could collide with a real number's key — so lids get
 * their own prefix and keep every digit.
 */
export function conversationKey(address: string): string {
  const raw = String(address || "").trim();
  if (/@lid$/i.test(raw)) {
    const digits = raw.replace(/\D/g, "");
    return digits ? `lid_${digits}` : "unknown";
  }
  return phoneMatchKey(raw) || raw.replace(/\D/g, "") || "unknown";
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
  const phoneKey = conversationKey(phone);
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
    // The conversation resets; the rate limit and a recorded opt-out do not.
    state: expired ? "new" : ((d.state as BotState) || "new"),
    turns: expired ? 0 : Number(d.turns) || 0,
    patientId: typeof d.patientId === "string" ? d.patientId : undefined,
    patientName: typeof d.patientName === "string" ? d.patientName : undefined,
    lastMessageAt,
    windowStartedAt,
    repliesInWindow,
    optedOut: d.optedOut === true,
    // Expired options are not carried: a list of "tomorrow's" times from last week books the
    // wrong day if a stray "1" arrives after the chat lapses.
    pendingDays: !expired && Array.isArray(d.pendingDays) ? d.pendingDays.map(String) : undefined,
    pendingTimes: !expired && Array.isArray(d.pendingTimes) ? d.pendingTimes.map(String) : undefined,
    pendingDate: !expired && typeof d.pendingDate === "string" ? d.pendingDate : undefined,
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
  next: {
    state: BotState;
    replied: boolean;
    reason: string;
    patientId?: string;
    patientName?: string;
    /** Booking options offered this turn. Absent = clear them — stale lists must not linger. */
    pending?: { days?: string[]; times?: string[]; date?: string };
  },
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
    // Overwritten every turn, cleared when not re-offered: an old list surviving into a new
    // context is how a stray digit books the wrong day.
    pendingDays: next.pending?.days ?? null,
    pendingTimes: next.pending?.times ?? null,
    pendingDate: next.pending?.date ?? null,
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

/**
 * Record "stop" for a sender who has no patient record to record it on.
 *
 * The `@lid` case: the phone is hidden, so `whatsappOptOut` on the patient cannot be reached.
 * This flag is what the bot checks instead, and it survives the conversation expiring. One-way
 * here, like the patient-record version — only a person can decide the sender changed their mind.
 */
export async function markConversationOptedOut(clinicId: string, address: string): Promise<void> {
  await ref(clinicId, conversationKey(address)).set(
    { phone: address, optedOut: true, optedOutAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}
