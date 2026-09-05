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

/**
 * How long an unhandled handoff keeps the bot quiet.
 *
 * Long enough that "someone will contact you" is not undone by the bot re-greeting them an hour
 * later; bounded so a handoff nobody clears cannot mute a patient's number for good. Staff
 * marking it handled ends it early.
 */
export const HANDOFF_HOLD_MS = 24 * 60 * 60 * 1000;

/** How long a staff member's own message to the patient keeps the bot out of the thread. */
export const HUMAN_CLAIM_MS = 60 * 60 * 1000;

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
  /** The dentist list last offered; the final entry "" means "any chair". */
  pendingDoctors?: string[];
  /** The dentist the patient chose for this booking; "" or absent means any. */
  pendingDoctor?: string;
  /** The service the patient named when they asked to book, carried onto the appointment. */
  pendingTreatment?: string;
  /**
   * The booking is for someone else — a wife, a child, a parent — and the name we are about to
   * ask for is theirs, not the sender's. Without this "عايز احجز لمراتي" booked the husband.
   */
  pendingForRelative?: boolean;
  /**
   * A person owns this thread right now.
   *
   * True while a handoff is open (raised by the bot, not yet marked handled by staff, and younger
   * than a day) or while a staff member has written to this patient in the last hour. The bot
   * must stay silent for as long as this is true — the one-hour conversation expiry used to
   * reset the state to "new" underneath a live handoff, so the bot re-greeted, with buttons, a
   * patient a receptionist was mid-conversation with.
   */
  humanOwned?: boolean;
  /** AI answers already spent in this conversation. The cap lives in the caller. */
  aiReplies?: number;
  /** Prior AI exchanges, oldest first, for continuity. Dies with the conversation. */
  aiHistory?: Array<{ q: string; a: string }>;
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

  /*
   * Is a person handling this thread?
   *
   * Two signals, either is enough. A handoff the bot raised stays open until staff mark it
   * handled (handledAtMs after handoffAtMs) — with a one-day ceiling so an unattended inbox
   * cannot silence the bot forever. And a staff member writing to the patient from the app
   * claims the thread for an hour, so the bot never answers over a human mid-conversation.
   */
  const handoffAtMs = Number(d.handoffAtMs) || 0;
  const handledAtMs = Number(d.handledAtMs) || 0;
  const humanActiveAtMs = Number(d.humanActiveAtMs) || 0;
  const openHandoff =
    d.needsHuman === true && handoffAtMs > now - HANDOFF_HOLD_MS && !(handledAtMs > handoffAtMs);
  const humanOwned = openHandoff || humanActiveAtMs > now - HUMAN_CLAIM_MS;

  /*
   * A handoff staff have marked handled releases the bot — including from the stored state.
   *
   * The turn that raised the handoff saved "handed_off" as the next state, and that stored value
   * would otherwise keep the bot silent for the rest of the hour even after a person had dealt
   * with it and clicked Handled. Released conversations resume at the menu rather than the
   * greeting: the patient was mid-conversation with a human, and a fresh "أهلاً 👋" with the
   * opt-out footer under it would read as the machine barging back in.
   */
  const storedState = (d.state as BotState) || "new";
  const released = storedState === "handed_off" && !humanOwned && handledAtMs > handoffAtMs;

  return {
    phoneKey,
    phone,
    // The conversation resets; the rate limit, a recorded opt-out and a live handoff do not.
    state: humanOwned ? "handed_off" : expired ? "new" : released ? "awaiting_choice" : storedState,
    humanOwned,
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
    pendingDoctors: !expired && Array.isArray(d.pendingDoctors) ? d.pendingDoctors.map(String) : undefined,
    pendingDoctor: !expired && typeof d.pendingDoctor === "string" ? d.pendingDoctor : undefined,
    pendingTreatment: !expired && typeof d.pendingTreatment === "string" ? d.pendingTreatment : undefined,
    pendingForRelative: !expired && d.pendingForRelative === true,
    aiReplies: !expired ? Number(d.aiReplies) || 0 : 0,
    aiHistory:
      !expired && Array.isArray(d.aiHistory)
        ? d.aiHistory
            .filter((h: unknown) => h && typeof h === "object")
            .map((h: any) => ({ q: String(h.q || ""), a: String(h.a || "") }))
        : undefined,
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
    pending?: { days?: string[]; times?: string[]; date?: string; doctors?: string[]; doctor?: string; treatment?: string; forRelative?: boolean };
    /**
     * A spent AI exchange. Unlike pending options, absence PRESERVES what is stored: the AI
     * budget survives menu turns — a patient cannot refill it by pressing a button.
     */
    aiExchange?: { q: string; a: string };
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
    pendingDoctors: next.pending?.doctors ?? null,
    pendingDoctor: next.pending?.doctor ?? null,
    pendingTreatment: next.pending?.treatment ?? null,
    pendingForRelative: next.pending?.forRelative === true,
    aiReplies: (c.aiReplies ?? 0) + (next.aiExchange ? 1 : 0),
    // Trimmed hard: this is continuity for a three-answer conversation, not an archive.
    aiHistory: next.aiExchange
      ? [...(c.aiHistory ?? []), { q: next.aiExchange.q.slice(0, 300), a: next.aiExchange.a.slice(0, 300) }].slice(-3)
      : (c.aiHistory ?? []),
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
  reason: string,
  details: {
    /** What the patient wrote — the thing a person needs to read to act. */
    text?: string;
    phone?: string;
    patientId?: string;
    patientName?: string;
    /** How loudly staff should be told. Drives the notification, not the flag. */
    severity?: HandoffSeverity;
  } = {}
): Promise<void> {
  const payload: Record<string, unknown> = {
    needsHuman: true,
    handoffReason: reason,
    handoffAt: FieldValue.serverTimestamp(),
    // A plain number beside the server timestamp: the bot compares against it on every read, and
    // a Firestore Timestamp is not a number. Also what re-opens a handoff staff already cleared —
    // a new one is simply later than the last handledAtMs.
    handoffAtMs: Date.now(),
  };
  // Firestore rejects an explicit undefined; optional by nature.
  if (details.text?.trim()) payload.lastInbound = details.text.trim().slice(0, 300);
  if (details.phone) payload.phone = details.phone;
  if (details.patientId) payload.patientId = details.patientId;
  if (details.patientName) payload.patientName = details.patientName;
  payload.severity = details.severity ?? "normal";
  await ref(clinicId, phoneKey).set(payload, { merge: true });
}

export type HandoffSeverity = "urgent" | "complaint" | "normal";

/**
 * A staff member just wrote to this patient from the app: the thread is theirs for a while.
 *
 * Written by the reply route. Two voices in one thread is worse than one slow voice, and until
 * this existed nothing told the bot a human had stepped in — it would answer the patient's next
 * message over the top of the receptionist's.
 */
export async function markHumanActive(clinicId: string, address: string, uid?: string): Promise<void> {
  await ref(clinicId, conversationKey(address)).set(
    {
      phone: address,
      humanActiveAtMs: Date.now(),
      // Replying is handling. The inbox row closes with the reply rather than needing a second click.
      needsHuman: false,
      handledAtMs: Date.now(),
      ...(uid ? { handledBy: uid } : {}),
    },
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
