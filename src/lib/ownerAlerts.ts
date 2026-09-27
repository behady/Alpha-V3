/**
 * The owner's home, second pass: what needs you, pace, targets, trends, and who brought the money.
 *
 * Written when the owner said what he actually opens the screen for — "what is wrong that needs
 * me" first, then cash against last month, targets, no-shows as a trend, sources by money, and how
 * much of WhatsApp the bot carried alone. All plain functions over plain rows, pinned by
 * tests/ownerAlerts.test.mts. The brief's engine (lib/automation/briefing) still does the heavy
 * period arithmetic; these read its output and the browser's own live rows.
 */

import { ledgerCashValue } from "@/lib/reportHelpers";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";
import { weekDaysFrom } from "@/lib/weekSchedule";

type Row = Record<string, unknown>;

function r2(n: number): number {
  return Number(n.toFixed(2));
}

/** How far through the clinic's day the clock is: 0 before opening, 1 after closing. */
export function dayFraction(nowMinutes: number, clinicStart: number, clinicEnd: number): number {
  const span = clinicEnd - clinicStart;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (nowMinutes - clinicStart) / span));
}

/** How much of the calendar month has passed by the end of `todayKey`, 0..1. */
export function monthFraction(todayKey: string): number {
  const [y, m, d] = String(todayKey).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 1;
  const days = new Date(y, m, 0).getDate();
  return Math.min(1, Math.max(0, d / days));
}

export type Pace = {
  /** What the comparison period had brought in by this point. */
  expected: number;
  /** Collected over expected; null when there is nothing to compare against. */
  ratio: number | null;
  /** How far short of the expected figure, never negative. */
  behindBy: number;
};

/**
 * Cash against the comparison period, prorated by `elapsed` — how much of this period has passed.
 * The week and month briefs already compare equal windows (the same span of days last month), so
 * they pass 1; a day in progress compares against the same weekday last week times how much of
 * the clinic's day has gone.
 */
export function cashPace(collected: number, previous: number | null | undefined, elapsed: number): Pace {
  const prev = Number(previous);
  if (!Number.isFinite(prev) || prev <= 0) return { expected: 0, ratio: null, behindBy: 0 };
  const expected = r2(prev * Math.min(1, Math.max(0, elapsed)));
  if (expected <= 0) return { expected: 0, ratio: null, behindBy: 0 };
  return { expected, ratio: r2(collected / expected), behindBy: r2(Math.max(0, expected - collected)) };
}

/** Behind means noticeably behind: a tenth under pace is noise, a fifth is a conversation. */
export const PACE_BEHIND_RATIO = 0.8;

export type TargetProgress = { percent: number; expectedPercent: number; onPace: boolean };

/** Where the month stands against a target, and where it should stand by today. Null when no target is set. */
export function targetProgress(actual: number, target: number, elapsed: number): TargetProgress | null {
  if (!(target > 0)) return null;
  const percent = Math.max(0, Math.round((actual / target) * 100));
  const expectedPercent = Math.round(Math.min(1, Math.max(0, elapsed)) * 100);
  return { percent, expectedPercent, onPace: percent >= expectedPercent * PACE_BEHIND_RATIO };
}

export type WeekNoShows = { start: string; noShows: number; cancelled: number; booked: number };

function shiftWeek(start: string, weeks: number): string {
  const d = new Date(`${start}T12:00:00`);
  d.setDate(d.getDate() + weeks * 7);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return weekDaysFrom(key)[0];
}

/**
 * No-shows and cancellations by week, oldest first, over the `weeks` weeks ending in the week of
 * `todayKey`. Weeks run Saturday to Friday like the schedule. A trend, not a rate — the owner
 * asked whether it is getting better or worse.
 */
export function noShowsByWeek(appointments: Row[], todayKey: string, weeks = 4): WeekNoShows[] {
  const thisWeek = weekDaysFrom(todayKey)[0];
  const starts: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) starts.push(shiftWeek(thisWeek, -i));
  const buckets = new Map<string, WeekNoShows>(starts.map((s) => [s, { start: s, noShows: 0, cancelled: 0, booked: 0 }]));
  for (const a of appointments) {
    const date = String(a.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const b = buckets.get(weekDaysFrom(date)[0]);
    if (!b) continue;
    b.booked += 1;
    const status = normalizeAppointmentStatus(String(a.status || ""));
    if (status === "No Show") b.noShows += 1;
    else if (status === "Cancelled") b.cancelled += 1;
  }
  return starts.map((s) => buckets.get(s) as WeekNoShows);
}

/** This week's no-shows against the average of the weeks before: a spike is half again as many, and at least three. */
export function noShowSpike(weeks: WeekNoShows[]): { spike: boolean; thisWeek: number; usual: number } {
  if (weeks.length === 0) return { spike: false, thisWeek: 0, usual: 0 };
  const current = weeks[weeks.length - 1];
  const before = weeks.slice(0, -1);
  const usual = before.length ? before.reduce((n, w) => n + w.noShows, 0) / before.length : 0;
  const spike = current.noShows >= 3 && current.noShows >= usual * 1.5;
  return { spike, thisWeek: current.noShows, usual: r2(usual) };
}

export type SourceCash = { source: string; cash: number; patients: number };

/**
 * Cash by where the patient came from — the figure that says which channel is worth the ad money,
 * which a count of new patients cannot. A payment is attributed to the paying patient's source;
 * a patient with no recorded source lands under `unknownLabel`.
 */
export function cashBySource(ledger: Row[], patients: Row[], unknownLabel = "Unknown"): SourceCash[] {
  const sourceOf = new Map<string, string>();
  for (const p of patients) {
    const id = String(p.id || "");
    const source = String(p.source || "").trim();
    if (id) sourceOf.set(id, source || unknownLabel);
  }
  const out = new Map<string, SourceCash>();
  const seen = new Map<string, Set<string>>();
  for (const row of ledger) {
    const type = String(row.type || "");
    if (type !== "payment" && type !== "income" && type !== "procedure") continue;
    const cash = ledgerCashValue(row);
    if (cash <= 0) continue;
    const patientId = String(row.patientId || "");
    const source = sourceOf.get(patientId) || unknownLabel;
    const cur = out.get(source) || { source, cash: 0, patients: 0 };
    cur.cash = r2(cur.cash + cash);
    out.set(source, cur);
    if (patientId) {
      const s = seen.get(source) || new Set<string>();
      s.add(patientId);
      seen.set(source, s);
    }
  }
  for (const [source, cur] of out) cur.patients = seen.get(source)?.size ?? 0;
  return [...out.values()].sort((a, b) => b.cash - a.cash);
}

export type BotShare = { total: number; handedOff: number; botAlone: number; percentBot: number | null };

/**
 * Of the WhatsApp conversations in the window, how many the bot carried without a person. A
 * conversation counts as handed off when it ended in a handoff or is still flagged for a human.
 */
export function botShare(conversations: Row[]): BotShare {
  let total = 0;
  let handedOff = 0;
  for (const c of conversations) {
    total += 1;
    if (String(c.outcome || "") === "handoff" || c.needsHuman === true) handedOff += 1;
  }
  const botAlone = total - handedOff;
  return { total, handedOff, botAlone, percentBot: total ? Math.round((botAlone / total) * 100) : null };
}

export type NeedsYouKey = "cash_behind" | "lab_late" | "staff_absent" | "staff_late" | "unconfirmed" | "noshow_spike" | "overtime";
export type NeedsYouItem = { key: NeedsYouKey; n: number; severity: "high" | "medium"; extra?: number };

/**
 * The list at the top of the owner's home, most urgent first. Only what is actually wrong: an
 * empty list is the good news, and the screen says so rather than showing six zeros.
 */
export function needsYou(input: {
  pace: Pace;
  labLate: number;
  labDueToday: number;
  absentToday: number;
  lateToday: number;
  unconfirmedTomorrow: number;
  noShows: { spike: boolean; thisWeek: number; usual: number };
  overtimePending: number;
}): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  if (input.pace.ratio !== null && input.pace.ratio < PACE_BEHIND_RATIO) {
    items.push({ key: "cash_behind", n: Math.round((1 - input.pace.ratio) * 100), severity: "high", extra: input.pace.behindBy });
  }
  if (input.labLate > 0 || input.labDueToday > 0) {
    items.push({ key: "lab_late", n: input.labLate, severity: input.labLate > 0 ? "high" : "medium", extra: input.labDueToday });
  }
  if (input.absentToday > 0) items.push({ key: "staff_absent", n: input.absentToday, severity: "high" });
  if (input.lateToday > 0) items.push({ key: "staff_late", n: input.lateToday, severity: "medium" });
  if (input.unconfirmedTomorrow > 0) items.push({ key: "unconfirmed", n: input.unconfirmedTomorrow, severity: "medium" });
  if (input.noShows.spike) items.push({ key: "noshow_spike", n: input.noShows.thisWeek, severity: "medium", extra: input.noShows.usual });
  if (input.overtimePending > 0) items.push({ key: "overtime", n: input.overtimePending, severity: "medium" });
  const rank = (s: NeedsYouItem["severity"]) => (s === "high" ? 0 : 1);
  return items.sort((a, b) => rank(a.severity) - rank(b.severity));
}

/**
 * Work billed per dentist in the window — the value of the treatments performed, paid or not —
 * from the ledger's procedure rows, keyed by the dentist's name as the brief names them.
 */
export function billedByDoctor(ledger: Row[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of ledger) {
    if (String(row.type || "") !== "procedure") continue;
    if (["deleted", "cancelled"].includes(String(row.status || "").toLowerCase())) continue;
    const name = String(row.doctorName || row.doctor || "").trim();
    if (!name) continue;
    const value = Number(row.cost ?? row.amount ?? 0) || 0;
    if (value <= 0) continue;
    out.set(name, r2((out.get(name) || 0) + value));
  }
  return out;
}
