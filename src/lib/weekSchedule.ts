/**
 * What the dashboard's week view knows about a day, and what a week card has room to say.
 *
 * The week view used to be seven columns of the same card at every height, with nothing above
 * them but a date. Yet the questions a receptionist brings to a week are not about any one card:
 * how full is Tuesday, where is there a gap to offer on the phone, who still has not confirmed,
 * what is coming for the doctor. Those are counts per day, and they are computed here, away from
 * React, so they can be tested against a fixture instead of read off a screen.
 *
 * Everything here works in LOCAL dates. The old view built its columns with `new Date("YYYY-MM-DD")`
 * (parsed as UTC midnight) and the ISO-string date (UTC again), while the query feeding it used local
 * date maths — two answers to "which days are this week", and near midnight they disagreed.
 */

import { normalizeAppointmentStatus } from "./appointmentStages";
import { parseApptTimeToMinutes } from "./appointmentTime";
import { clinicDayBoundsMinutes, type ClinicScheduleConfig } from "./clinicSchedule";

/**
 * Pixels per slot in the week grid. At 100 a 15-minute card is 48px, which is a name and the
 * treatment line; a 30-minute card is 98px, which is everything. At the old 88 a 15-minute card
 * was a name alone, and the one thing the owner asked to see on a card — what it is for — was cut.
 */
export const WEEK_ROW_PX = 100;
/** A card never shrinks below its name row, however short the visit. */
export const WEEK_MIN_CARD_PX = 34;

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseLocal(dateKey: string): Date {
  const [y, m, d] = String(dateKey || "").split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function formatLocal(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * The seven date keys of the week containing `dateKey`, Saturday to Friday — the Egyptian working
 * week. The parent's query and the grid's columns both come from here, so they cannot disagree.
 * A key that will not parse gives the week of today rather than nothing.
 */
export function weekDaysFrom(dateKey: string): string[] {
  let base = parseLocal(dateKey);
  if (Number.isNaN(base.getTime())) base = new Date();
  base = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const diffToSat = (base.getDay() + 1) % 7;
  const start = new Date(base);
  start.setDate(base.getDate() - diffToSat);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(formatLocal(d));
  }
  return days;
}

/** "friday" for 2026-09-25 — the key the clinic's `offDays` list uses. */
export function dayNameKey(dateKey: string): string {
  const d = parseLocal(dateKey);
  if (Number.isNaN(d.getTime())) return "";
  return DAY_KEYS[d.getDay()];
}

export function isOffDay(dateKey: string, config: Pick<ClinicScheduleConfig, "offDays">): boolean {
  const name = dayNameKey(dateKey);
  if (!name) return false;
  return (config.offDays || []).some((d) => String(d).toLowerCase().trim() === name);
}

/** 570 → "09:30". Past-midnight minutes wrap, so 1470 → "00:30". Feeds `timeRange()`. */
export function minutesToClock(minutes: number): string {
  const total = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A visit that will, or did, take up the chair. Cancelled, no-show and rescheduled ones do not. */
export function countsAsVisit(status: unknown): boolean {
  const s = normalizeAppointmentStatus(status as string | undefined);
  return s !== "Cancelled" && s !== "No Show" && s !== "Rescheduled";
}

/** Still waiting on the patient's word — what the desk's "Unconfirmed" count means everywhere. */
export function isUnconfirmed(status: unknown): boolean {
  return normalizeAppointmentStatus(status as string | undefined) === "Scheduled";
}

export type DaySummary = {
  visits: number;
  unconfirmed: number;
  noShows: number;
  /** What the day's visits were quoted at, from each booking's own price. */
  expectedMoney: number;
  /** Slots inside the clinic's own hours with nothing booked over them. */
  freeSlots: number;
  totalSlots: number;
  isOffDay: boolean;
  isEmpty: boolean;
};

type SummaryVisit = { status?: unknown; cost?: unknown; time?: string; duration?: unknown };

/**
 * The numbers above a day column.
 *
 * Free slots are measured against the clinic's OWN hours, not the widened grid: a visit booked
 * before opening is still a visit, but it does not make the morning "full". A slot is taken when
 * any counted visit overlaps it at all, whoever the dentist is — two dentists sharing 09:00 is
 * still one taken slot here; the calendar page owns availability per dentist.
 */
export function daySummary(
  appts: ReadonlyArray<SummaryVisit>,
  config: ClinicScheduleConfig,
  dateKey: string,
): DaySummary {
  const off = isOffDay(dateKey, config);
  const counted = appts.filter((a) => countsAsVisit(a.status));
  const visits = counted.length;
  const unconfirmed = counted.filter((a) => isUnconfirmed(a.status)).length;
  const noShows = appts.filter((a) => normalizeAppointmentStatus(a.status as string | undefined) === "No Show").length;
  const expectedMoney = Math.round(counted.reduce((sum, a) => sum + (Number(a.cost) || 0), 0) * 100) / 100;

  let freeSlots = 0;
  let totalSlots = 0;
  if (!off) {
    const bounds = clinicDayBoundsMinutes(config);
    const slot = Number.isFinite(config.slotDuration) && config.slotDuration > 0 ? config.slotDuration : 30;
    const spans = counted.map((a) => {
      const start = parseApptTimeToMinutes(a.time);
      const dur = Math.max(1, Number(a.duration) || 30);
      return { start, end: start + dur };
    });
    for (let m = bounds.start; m < bounds.end; m += slot) {
      totalSlots++;
      const taken = spans.some((s) => s.start < m + slot && s.end > m);
      if (!taken) freeSlots++;
    }
  }

  return { visits, unconfirmed, noShows, expectedMoney, freeSlots, totalSlots, isOffDay: off, isEmpty: visits === 0 };
}

/**
 * What a week card has room for, by its rendered height.
 *
 * "name" is the name alone; "line" adds what the visit is for and with whom; "time" adds when it
 * starts and ends; "full" adds the phone. The name always fits, because the card never shrinks
 * below WEEK_MIN_CARD_PX.
 */
export type WeekCardTier = "name" | "line" | "time" | "full";

export function weekCardTier(heightPx: number): WeekCardTier {
  const h = Number(heightPx) || 0;
  if (h < 48) return "name";
  if (h < 72) return "line";
  if (h < 96) return "time";
  return "full";
}
