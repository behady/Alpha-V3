/**
 * What an appointment card on the day schedule has room to say, and what it should say with it.
 *
 * A card is as tall as the visit is long — a 90-minute crown prep is six times the height of a
 * 15-minute review, which is right, because the schedule is a picture of the day. But the card used
 * to hold the same four things whatever its height: name and phone pinned to the top edge, the
 * treatment and the time pinned to the bottom, and on a long visit a white gap between them that
 * read as broken rather than as spacious.
 *
 * So the space becomes information, in the order the front desk needs it — which depends on whether
 * the patient has walked in yet.
 *
 *   Before they arrive: a medical alert from their file; money still owed from earlier visits;
 *   confirmed or not, and first visit or when they were last in.
 *   After: the medical alert; how long they have been waiting or in the chair against how long was
 *   booked; what this visit came to; what is owed from before, which is still worth raising at the
 *   desk on the way out.
 *
 * The medical alert leads both, and also has a badge beside the name on every card whatever its
 * height, because whether it is safe to treat somebody cannot depend on how long they were booked
 * for. The booking note takes whatever lines are left.
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

/* --- before they arrive ------------------------------------------------------------------------ */

/**
 * Words people type into a medical field to mean "nothing".
 *
 * A card that flagged "Allergies: None" in red on every patient would teach the desk to ignore the
 * red, which is the one thing a medical alert cannot afford.
 */
const NOTHING = /^(none|no|nil|nothing|n\/?a|-+|\.|0|لا|لا يوجد|لايوجد|مفيش|لا شيء|سليم)$/i;

/**
 * Allergies and medical history, as one line, or "" when there is nothing real in either.
 *
 * Read off the patient's file, which the schedule already has loaded — so it costs nothing, and it
 * is the one thing on this card a dentist most needs before the patient sits down.
 */
export function medicalAlert(patient: { allergies?: unknown; medicalHistory?: unknown } | null | undefined): string {
  if (!patient) return "";
  const clean = (v: unknown) => {
    const t = String(v ?? "").replace(/\s+/g, " ").trim();
    return t && !NOTHING.test(t) ? t : "";
  };
  return [clean(patient.allergies), clean(patient.medicalHistory)].filter(Boolean).join(" · ");
}

export type PatientHistory = {
  /** Unpaid on treatments from BEFORE the day being viewed. This visit's own charges are not in it. */
  owedBefore: number;
  /** Days with at least one treatment before the day being viewed. */
  visits: number;
  /** The last of those days, YYYY-MM-DD, or "" for somebody with none. */
  lastVisit: string;
};

/**
 * What the clinic already knows about each patient, from their treatment rows.
 *
 * "Before" is strict — the day being viewed is excluded — so the card never says a patient owes
 * money from before when what they owe is the visit they are sitting in, which the money line
 * already shows.
 *
 * Owed is counted treatment by treatment and never goes below zero on any one, so an overpaid crown
 * does not quietly cancel an unpaid filling. A payment taken "on account", against no treatment,
 * is not credited here — it belongs to no treatment, and the patient's own account screen is where
 * that reconciliation lives.
 *
 * Visits are counted as distinct days with a treatment. A visit where nothing was charged does not
 * count, which in a dental clinic is rare — even a consultation is a line.
 */
export function historyByPatient(
  rows: readonly Record<string, unknown>[],
  beforeDate: string,
): Map<string, PatientHistory> {
  const days = new Map<string, Set<string>>();
  const out = new Map<string, PatientHistory>();
  for (const row of rows) {
    if (String(row.type ?? "") !== "procedure") continue;
    if (["deleted", "cancelled"].includes(String(row.status ?? "").toLowerCase())) continue;
    const patientId = String(row.patientId ?? "").trim();
    const date = String(row.date ?? "").slice(0, 10);
    if (!patientId || !date || date >= beforeDate) continue;

    const h = out.get(patientId) || { owedBefore: 0, visits: 0, lastVisit: "" };
    const cost = Number(row.cost ?? row.amount ?? 0) || 0;
    const paid = Number(row.paid ?? 0) || 0;
    h.owedBefore += Math.max(0, cost - paid);
    if (date > h.lastVisit) h.lastVisit = date;
    out.set(patientId, h);

    const seen = days.get(patientId) || new Set<string>();
    seen.add(date);
    days.set(patientId, seen);
  }
  for (const [id, h] of out) {
    h.visits = days.get(id)?.size ?? 0;
    h.owedBefore = Math.round(h.owedBefore * 100) / 100;
  }
  return out;
}

/* --- what fits --------------------------------------------------------------------------------- */

/**
 * The one-line details a card can carry. The note is separate: it takes whatever is left.
 *
 *   alert  — allergies / medical history
 *   timing — arrived, waiting, in the chair, done
 *   money  — what THIS visit came to and what is owed on it
 *   owes   — what is still unpaid from earlier visits
 *   status — confirmed or not, and first visit or last seen
 */
export type DetailKey = "alert" | "timing" | "money" | "owes" | "status";

export type DetailPlan = {
  show: ReadonlySet<DetailKey>;
  /** How many lines the note may take. 0 = not shown. */
  noteLines: number;
};

/**
 * The order the desk needs things in, which depends on where the patient is.
 *
 * Before they arrive: is it safe to treat them, do they owe us, are they coming, have we seen them.
 * After: is it safe, how long have they been here, what does this visit come to, what do they owe
 * from before — the last is still worth raising at check-out. Confirmation and history stop
 * mattering the moment they walk in.
 *
 * The medical alert leads both, because it is the only line whose absence could hurt somebody.
 */
export function detailOrder(arrived: boolean, present: Partial<Record<DetailKey, boolean>>): DetailKey[] {
  const order: DetailKey[] = arrived
    ? ["alert", "timing", "money", "owes"]
    : ["alert", "owes", "status", "money"];
  return order.filter((k) => present[k]);
}

/**
 * Which details go on a card of this height.
 *
 * Takes them in the order given, one line each, while there is room; the note gets whatever is left,
 * up to four lines. A detail with nothing to say is simply not in the list, so its line goes to the
 * next one.
 */
export function planDetails(heightPx: number, order: readonly DetailKey[], hasNote: boolean): DetailPlan {
  let left = detailLines(heightPx);
  const show = new Set<DetailKey>();
  for (const key of order) {
    if (left <= 0) break;
    show.add(key);
    left -= 1;
  }
  return { show, noteLines: hasNote && left > 0 ? Math.min(left, 4) : 0 };
}
