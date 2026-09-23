/**
 * What an appointment card on the day schedule has room to say, and what it should say with it.
 *
 * A card is as tall as the visit is long — a 90-minute crown prep is six times the height of a
 * 15-minute review, which is right, because the schedule is a picture of the day. But the card used
 * to hold the same four things whatever its height: name and phone pinned to the top edge, the
 * treatment and the time pinned to the bottom, and on a long visit a white gap between them that
 * read as broken rather than as spacious.
 *
 * So the space becomes information, in the order the front desk needs it:
 *
 *   1. Timing — once the patient has arrived. How long they have been waiting, or how long they
 *      have been in the chair against how long was booked. This is the one that changes minute to
 *      minute, and the one that tells a receptionist who to go and check on.
 *   2. Money — what this visit came to and what is still owed on it, so nobody leaves without the
 *      conversation that should have happened at the desk.
 *   3. Notes — what was written when the visit was booked. It takes whatever lines are left, so a
 *      long visit shows the whole note and a short one shows its first line.
 *
 * A row with nothing to say is skipped rather than shown empty, and its space goes to the next one.
 * All of this is pure so the rules can be tested without a screen.
 */

/** Height of the part of a card that is always there: header, treatment line, footer, padding. */
export const CARD_BASE_PX = 126;
/** One line of detail. */
export const CARD_LINE_PX = 20;

/** How many detail lines fit on a card of this height. Never negative. */
export function detailLines(heightPx: number): number {
  return Math.max(0, Math.floor((Number(heightPx) - CARD_BASE_PX) / CARD_LINE_PX));
}

type TimestampLike = { toDate?: () => Date; seconds?: number } | Date | string | number | null | undefined;

/** A Firestore Timestamp, a Date, an ISO string or epoch millis — as a Date, or null. */
export function toDateLoose(value: TimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        return value.toDate();
      } catch {
        return null;
      }
    }
    if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
    return null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type CardTiming =
  | { kind: "none" }
  /** Checked in and waiting. `long` once it has gone on long enough to be worth a look. */
  | { kind: "waiting"; arrivedAt: Date; waitedMin: number; long: boolean }
  /**
   * In the chair. `progress` runs 0 → 1 over the booked duration and past 1 when the visit is
   * running over; `overMin` is how far over, 0 while it is on time.
   */
  | { kind: "inChair"; arrivedAt: Date | null; seatedAt: Date; elapsedMin: number; progress: number; overMin: number }
  /** Finished, or being checked out. */
  | { kind: "done"; arrivedAt: Date | null; finishedAt: Date | null };

/** Waiting this long is worth a receptionist's attention. */
export const LONG_WAIT_MIN = 15;

/** The most recent moment the visit entered this status, from its history. */
function lastEntered(history: unknown, status: string): Date | null {
  if (!Array.isArray(history)) return null;
  let latest: Date | null = null;
  for (const entry of history) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { status?: unknown; timestamp?: TimestampLike };
    if (e.status !== status) continue;
    const at = toDateLoose(e.timestamp);
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest;
}

/**
 * Where the visit is in the building, and for how long.
 *
 * "Seated at" has no field of its own — the status history is the only record of it — so it is read
 * from there. An appointment with no arrival yet has nothing to say here, which is most of them.
 */
export function cardTiming(
  apt: { status?: unknown; checkInTime?: TimestampLike; checkOutTime?: TimestampLike; statusHistory?: unknown; duration?: unknown },
  now: Date,
): CardTiming {
  const status = String(apt.status ?? "");
  const arrivedAt = toDateLoose(apt.checkInTime) ?? lastEntered(apt.statusHistory, "Checked In");
  const minutes = (from: Date) => Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60000));

  if (status === "Checked In") {
    if (!arrivedAt) return { kind: "none" };
    const waitedMin = minutes(arrivedAt);
    return { kind: "waiting", arrivedAt, waitedMin, long: waitedMin >= LONG_WAIT_MIN };
  }

  if (status === "In Chair") {
    const seatedAt = lastEntered(apt.statusHistory, "In Chair");
    if (!seatedAt) return { kind: "none" };
    const booked = Math.max(1, Number(apt.duration) || 30);
    const elapsedMin = minutes(seatedAt);
    return {
      kind: "inChair",
      arrivedAt,
      seatedAt,
      elapsedMin,
      progress: elapsedMin / booked,
      overMin: Math.max(0, elapsedMin - booked),
    };
  }

  if (status === "Checking Out" || status === "Completed") {
    return { kind: "done", arrivedAt, finishedAt: toDateLoose(apt.checkOutTime) };
  }

  return { kind: "none" };
}

export type VisitMoney = { charged: number; paid: number; owed: number };

/**
 * What each visit came to and what was paid against it, from the day's ledger.
 *
 * Read off the TREATMENT rows, grouped by the appointment they were recorded on. A treatment row's
 * `paid` is kept equal to every payment against it by the money routes, whatever day the money
 * came in — so a crown charged on this visit and paid off next week still shows as settled here,
 * which a sum of today's payments could never do.
 */
export function moneyByAppointment(rows: readonly Record<string, unknown>[]): Map<string, VisitMoney> {
  const out = new Map<string, VisitMoney>();
  for (const row of rows) {
    if (String(row.type ?? "") !== "procedure") continue;
    const appointmentId = String(row.appointmentId ?? "").trim();
    if (!appointmentId) continue;
    if (["deleted", "cancelled"].includes(String(row.status ?? "").toLowerCase())) continue;
    const charged = Number(row.cost ?? row.amount ?? 0) || 0;
    const paid = Number(row.paid ?? 0) || 0;
    const prev = out.get(appointmentId) || { charged: 0, paid: 0, owed: 0 };
    prev.charged += charged;
    prev.paid += paid;
    out.set(appointmentId, prev);
  }
  for (const m of out.values()) {
    m.charged = Math.round(m.charged * 100) / 100;
    m.paid = Math.round(m.paid * 100) / 100;
    // Overpaid is settled, not negative debt.
    m.owed = Math.max(0, Math.round((m.charged - m.paid) * 100) / 100);
  }
  return out;
}

/** "09:00 – 09:45", from a start time and a length. */
export function timeRange(start: string, durationMin: number): string {
  const [h, m] = String(start || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(start || "");
  const end = h * 60 + m + Math.max(0, Number(durationMin) || 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)} – ${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
}

export type DetailPlan = {
  timing: boolean;
  money: boolean;
  /** How many lines the note may take. 0 = not shown. */
  noteLines: number;
};

/**
 * Which details go on a card of this height, in priority order.
 *
 * Timing first because it changes minute to minute and says who to check on; money second; the
 * note takes whatever is left. A detail with nothing to say gives its line to the next one.
 */
export function planDetails(
  heightPx: number,
  has: { timing: boolean; money: boolean; note: boolean },
): DetailPlan {
  let left = detailLines(heightPx);
  const plan: DetailPlan = { timing: false, money: false, noteLines: 0 };
  if (has.timing && left > 0) {
    plan.timing = true;
    left -= 1;
  }
  if (has.money && left > 0) {
    plan.money = true;
    left -= 1;
  }
  if (has.note && left > 0) plan.noteLines = Math.min(left, 4);
  return plan;
}
