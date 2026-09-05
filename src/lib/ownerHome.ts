/**
 * The live pieces of the owner's home screen, as plain functions over plain rows.
 *
 * The heavy figures — cash for the period, per-dentist collection, payroll, what slips — come from
 * The Brief's engine (lib/automation/briefing), which is already tested. What is here is the
 * handful of things the owner's screen reads LIVE from the browser's own subscriptions: the
 * waiting room this minute, cash so far today, how bookings ended per dentist, where new patients
 * came from, and how the leads pile is moving. Small, deterministic, and pinned by
 * tests/ownerHome.test.mts.
 */

import { waitingMinutes, type Row } from "@/lib/dentistHome";
import { dueStateFor, statusFor } from "@/lib/labCases";

export type WaitingPatient = { id: string; name: string; minutes: number | null; doctor: string };

/** Who is sitting in the waiting room right now, longest wait first. */
export function waitingRoom(appointments: Row[], now: number): { waiting: WaitingPatient[]; longest: number | null; inChair: number } {
  const waiting = appointments
    .filter((a) => String(a.status) === "Checked In")
    .map((a) => ({
      id: String(a.id),
      name: String(a.patientName || ""),
      minutes: waitingMinutes(a.checkInTime, now),
      doctor: String(a.doctor || ""),
    }))
    .sort((a, b) => (b.minutes ?? -1) - (a.minutes ?? -1));
  const longest = waiting.reduce<number | null>((m, w) => (w.minutes !== null && (m === null || w.minutes > m) ? w.minutes : m), null);
  const inChair = appointments.filter((a) => String(a.status) === "In Chair").length;
  return { waiting, longest, inChair };
}

/**
 * Cash so far today, from the day's ledger rows: what came in, what went out, and the difference.
 *
 * Reads money the way The Brief's engine does — `paid` first for anything coming in, `cost`
 * first for anything going out — so the slab's live figure and the brief's "collected" agree to
 * the pound rather than drifting apart on rows that carry a placeholder zero in one field.
 */
export function cashToday(ledger: Row[], todayKey: string): { collected: number; expenses: number; net: number } {
  let collected = 0;
  let expenses = 0;
  for (const row of ledger) {
    if (String(row.date || "").slice(0, 10) !== todayKey) continue;
    const type = String(row.type);
    if (type === "payment" || type === "income") collected += Number(row.paid) || Number(row.amount) || 0;
    else if (type === "expense") expenses += Number(row.cost) || Number(row.amount) || 0;
  }
  return { collected: r2(collected), expenses: r2(expenses), net: r2(collected - expenses) };
}

const SEEN = new Set(["Checked In", "In Chair", "Checking Out", "Completed"]);

export type DoctorAttendance = { doctor: string; seen: number; missed: number; cancelled: number; rate: number | null };

/**
 * How bookings ended, per dentist, worst no-show rate first. The rate is misses over decided
 * bookings (seen + missed); cancellations are shown but not held against anyone — a patient who
 * rings to cancel did the right thing.
 */
export function attendanceByDoctor(appointments: Row[]): { doctors: DoctorAttendance[]; overall: DoctorAttendance } {
  const by = new Map<string, DoctorAttendance>();
  const overall: DoctorAttendance = { doctor: "", seen: 0, missed: 0, cancelled: 0, rate: null };
  for (const a of appointments) {
    const status = String(a.status || "");
    const kind = SEEN.has(status) ? "seen" : status === "No Show" ? "missed" : status === "Cancelled" ? "cancelled" : null;
    if (!kind) continue;
    const doctor = String(a.doctor || a.doctorName || "").trim() || "—";
    const row = by.get(doctor) || { doctor, seen: 0, missed: 0, cancelled: 0, rate: null };
    row[kind] += 1;
    overall[kind] += 1;
    by.set(doctor, row);
  }
  const rate = (r: DoctorAttendance) => (r.seen + r.missed === 0 ? null : r.missed / (r.seen + r.missed));
  const doctors = [...by.values()].map((r) => ({ ...r, rate: rate(r) })).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  return { doctors, overall: { ...overall, rate: rate(overall) } };
}

/** Where patients said they heard about the clinic, most common first. Blank answers are "Unknown". */
export function sourcesOf(patients: Row[], unknownLabel = "Unknown"): { source: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of patients) {
    const source = String(p.source || "").trim() || unknownLabel;
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return [...counts.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
}

/**
 * The leads pile as a funnel. "Replied" means somebody moved it past new; "booked" means it
 * became a visit (booked or won). A lost lead was replied to — it just did not book.
 */
export function leadsFunnel(leads: Row[]): { asked: number; replied: number; booked: number; untouched: number } {
  let replied = 0;
  let booked = 0;
  let untouched = 0;
  for (const l of leads) {
    const stage = String(l.stage || "new").toLowerCase();
    if (stage === "new") untouched += 1;
    else replied += 1;
    if (stage === "booked" || stage === "won") booked += 1;
  }
  return { asked: leads.length, replied, booked, untouched };
}

/** Lab cases that need chasing: at the lab and past due, or due today. */
export function labChase(cases: Row[], todayKey: string): { late: number; dueToday: number } {
  let late = 0;
  let dueToday = 0;
  for (const c of cases) {
    const status = String(c.status || "");
    if (!statusFor(status).atLab) continue;
    const due = dueStateFor({ status: status as never, dueDate: c.dueDate as string | undefined }, todayKey);
    if (due === "overdue") late += 1;
    else if (due === "due_today") dueToday += 1;
  }
  return { late, dueToday };
}

/** The first day of the period the owner is looking at. Mirrors the brief's own window. */
export function periodStart(period: "day" | "week" | "month", todayKey: string): string {
  if (period === "day") return todayKey;
  if (period === "month") return `${todayKey.slice(0, 7)}-01`;
  const d = new Date(`${todayKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
}

function r2(n: number): number {
  return Number(n.toFixed(2));
}
