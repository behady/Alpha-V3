/**
 * What a dentist's home screen is made of, as plain functions over plain rows.
 *
 * The screen itself (components/dashboard/DentistHome.tsx) only subscribes and renders; every
 * decision — whose appointment this is, who is next, what the money adds up to, which lab cases
 * need a look, which patients were left mid-treatment — lives here so it can be tested without a
 * browser or a database. All of it is deterministic reads of what the clinic already records;
 * nothing is estimated or predicted.
 */

import { parseApptTimeToMinutes } from "@/lib/appointmentTime";
import { commissionPctForPayment, recalcCommissionFromPayment } from "@/lib/ledgerCommission";
import { dueStateFor, statusFor } from "@/lib/labCases";

export type Row = Record<string, unknown>;

/** The signed-in dentist, as found on their staff row. */
export type DentistIdentity = {
  staffId: string;
  name: string;
  commissionPct: number;
};

/**
 * Is this row the dentist's?
 *
 * `doctorId` is the stable key and wins whenever present. Rows written before it existed carry
 * only the display name in `doctor`, so those fall back to a case-insensitive name match — the
 * same tolerance the ledger's own attribution uses.
 */
export function isMine(row: Row, me: DentistIdentity): boolean {
  const id = String(row.doctorId || "").trim();
  if (id) return id === me.staffId;
  const name = String(row.doctor || row.doctorName || "").trim().toLowerCase();
  return !!name && name === me.name.trim().toLowerCase();
}

/** Statuses after which nothing more happens in the chair today. */
const DONE = new Set(["Completed", "Checking Out", "Cancelled", "No Show", "Rescheduled"]);

export function isDone(status: unknown): boolean {
  return DONE.has(String(status || ""));
}

function minutesOf(row: Row): number {
  // The parser answers 0 for a missing time; a row with no time belongs at the end, not at midnight.
  if (!row.time) return 24 * 60;
  return parseApptTimeToMinutes(String(row.time));
}

/** The day in chair order — by time, with anything unparseable last. */
export function sortDay<T extends Row>(appointments: T[]): T[] {
  return [...appointments].sort((a, b) => minutesOf(a) - minutesOf(b));
}

/**
 * Who is in the chair, who is next, and who follows.
 *
 * A patient already "In Chair" is the current one. Among the rest, a patient who has checked in
 * outranks one who has not, whatever their booked times: the person in the waiting room is the
 * one whose wait the dentist can shorten. Ties fall back to time.
 */
export function pickChair<T extends Row>(appointments: T[]): { current: T | null; next: T | null; after: T | null } {
  const open = sortDay(appointments.filter((a) => !isDone(a.status)));
  const current = open.find((a) => String(a.status) === "In Chair") || null;
  const rest = open
    .filter((a) => a !== current)
    .sort((a, b) => {
      const ca = String(a.status) === "Checked In" ? 0 : 1;
      const cb = String(b.status) === "Checked In" ? 0 : 1;
      return ca - cb || minutesOf(a) - minutesOf(b);
    });
  return { current, next: rest[0] || null, after: rest[1] || null };
}

/** Minutes a checked-in patient has been waiting; null when there is no check-in stamp. */
export function waitingMinutes(checkInTime: unknown, now: number): number | null {
  const t = checkInTime as { toMillis?: () => number; getTime?: () => number } | null | undefined;
  const ms = typeof t?.toMillis === "function" ? t.toMillis() : typeof t?.getTime === "function" ? t.getTime() : NaN;
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round((now - ms) / 60000));
}

/**
 * The money on a ledger row. Mirrors lib/revenueRecovery's `rowAmount` — copied rather than
 * imported because that module reaches for the Admin SDK and cannot be loaded in the browser.
 * A payment's money is in `paid` (with `amount` as the older spelling); a charge's is in
 * `amount`/`cost`.
 */
export function rowMoney(row: Row): number {
  const pick = (v: unknown) => Number(v ?? 0) || 0;
  return String(row.type) === "payment" ? pick(row.paid ?? row.amount) : pick(row.amount ?? row.cost);
}

/**
 * What the dentist's patients paid today, and the dentist's share of it.
 *
 * The share is read off each payment (`doctorCommissionAmount`, written when the payment was
 * taken). Payments older than that field, or written by a path that skipped it, are recomputed
 * from the dentist's current percentage — the same fallback the attendance worksheet uses — so a
 * clinic that never re-saved its old rows still sees a number rather than a zero.
 */
export function moneyToday(ledger: Row[], me: DentistIdentity, todayKey: string): { paid: number; share: number } {
  let paid = 0;
  let share = 0;
  for (const row of ledger) {
    if (String(row.type) !== "payment") continue;
    if (String(row.date || "") !== todayKey) continue;
    if (!isMine(row, me)) continue;
    const amount = rowMoney(row);
    paid += amount;
    const stored = row.doctorCommissionAmount;
    if (typeof stored === "number" && Number.isFinite(stored)) {
      share += stored;
      continue;
    }
    const labFee = Number(row.labFee ?? 0) || 0;
    const pct = commissionPctForPayment(
      { id: String(row.id || ""), doctorCommissionPercentage: null, doctorCommissionAmount: 0 },
      amount,
      labFee
    ) || me.commissionPct;
    share += recalcCommissionFromPayment(amount, labFee, pct).doctorCommissionAmount;
  }
  return { paid: round2(paid), share: round2(share) };
}

/**
 * What the dentist's patients still owe, charge by charge.
 *
 * Every procedure the dentist charged, less the payments booked against that procedure. Kept per
 * charge rather than per patient, and never below zero per charge, for the reason the debtors
 * list gives: a patient whose totals happen to balance can still owe on one crown while having
 * overpaid another.
 */
export function owedByMyPatients(ledger: Row[], me: DentistIdentity): number {
  const paidByProcedure = new Map<string, number>();
  for (const row of ledger) {
    if (String(row.type) !== "payment") continue;
    const pid = String(row.procedureId || "").trim();
    if (!pid) continue;
    paidByProcedure.set(pid, (paidByProcedure.get(pid) || 0) + rowMoney(row));
  }
  let owed = 0;
  for (const row of ledger) {
    if (String(row.type) !== "procedure") continue;
    if (!isMine(row, me)) continue;
    const charged = rowMoney(row);
    const paid = paidByProcedure.get(String(row.id || "")) || 0;
    owed += Math.max(0, charged - paid);
  }
  return round2(owed);
}

/** Same, but for one patient — the balance chip on the next patient's card. */
export function owedByPatient(ledger: Row[], me: DentistIdentity, patientId: string): number {
  return owedByMyPatients(
    ledger.filter((r) => String(r.patientId || "") === patientId || String(r.type) === "payment"),
    me
  );
}

export type LabReturnKind = "late" | "due_today" | "back" | "tryin";

/**
 * The lab cases a dentist should look at today, most urgent first.
 *
 * Back at the clinic and try-ins back are waiting on the dentist to fit them. Cases still at the
 * lab appear only when they are late or due today — everything else at the lab is the lab's
 * problem, and listing it here would bury the two rows that matter.
 */
export function labReturns<T extends Row>(cases: T[], me: DentistIdentity, todayKey: string): Array<T & { kind: LabReturnKind }> {
  const out: Array<T & { kind: LabReturnKind }> = [];
  for (const c of cases) {
    if (!isMine(c, me)) continue;
    const status = String(c.status || "");
    if (statusFor(status).closed) continue;
    if (status === "back") out.push({ ...c, kind: "back" });
    else if (status === "tryin_back") out.push({ ...c, kind: "tryin" });
    else {
      const due = dueStateFor({ status: status as never, dueDate: c.dueDate as string | undefined }, todayKey);
      if (due === "overdue") out.push({ ...c, kind: "late" });
      else if (due === "due_today") out.push({ ...c, kind: "due_today" });
    }
  }
  const rank: Record<LabReturnKind, number> = { late: 0, due_today: 1, back: 2, tryin: 3 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

export type OpenPlan = {
  patientId: string;
  /** Number of the dentist's notes on this patient still marked Ongoing. */
  ongoing: number;
  /** The most recent Ongoing procedure, for the one line the row has. */
  procedure: string;
  /** ISO date of the most recent note the dentist wrote on this patient, "" if undated. */
  lastNoteDate: string;
};

/**
 * Patients the dentist left mid-treatment with nothing booked to finish it.
 *
 * A note marked Ongoing is a treatment the dentist said is not finished. If nobody has booked
 * that patient a future visit — with anyone — they are on the way to disappearing, and this is the
 * list that says so. Sorted by how long ago the dentist last saw them, longest first, because the
 * oldest one is the one closest to being lost.
 */
export function openPlans(notes: Row[], futureAppointments: Row[], me: DentistIdentity, todayKey: string): OpenPlan[] {
  const booked = new Set(
    futureAppointments
      .filter((a) => String(a.date || "") > todayKey && !isDone(a.status) && String(a.status) !== "Cancelled")
      .map((a) => String(a.patientId || ""))
  );
  const byPatient = new Map<string, OpenPlan>();
  const mine = notes.filter((n) => isMine(n, me));
  for (const n of mine) {
    const patientId = String(n.patientId || "");
    if (!patientId || booked.has(patientId)) continue;
    const date = String(n.date || "");
    const existing = byPatient.get(patientId);
    if (String(n.status) === "Ongoing") {
      const label = noteLabel(n);
      if (!existing) {
        byPatient.set(patientId, { patientId, ongoing: 1, procedure: label, lastNoteDate: date });
      } else {
        existing.ongoing += 1;
        if (date >= existing.lastNoteDate) existing.procedure = label;
      }
    }
  }
  // The "last seen" date counts every note the dentist wrote, not only the open ones: a patient
  // whose crown is Ongoing but who came in last week for a cleaning was seen last week.
  for (const n of mine) {
    const plan = byPatient.get(String(n.patientId || ""));
    if (!plan) continue;
    const date = String(n.date || "");
    if (date > plan.lastNoteDate) plan.lastNoteDate = date;
  }
  return [...byPatient.values()].sort((a, b) => (a.lastNoteDate || "0").localeCompare(b.lastNoteDate || "0"));
}

function noteLabel(n: Row): string {
  const procedures = Array.isArray(n.procedures) ? n.procedures.filter(Boolean).map(String) : [];
  const base = procedures[0] || String(n.serviceName || n.procedure || n.title || "").trim();
  const tooth = String(n.tooth || "").trim();
  return tooth && base ? `${base} · ${tooth}` : base || tooth;
}

/** Whole days from `fromYmd` to `toYmd`; null when either is not a date. */
export function daysBetween(fromYmd: string, toYmd: string): number | null {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}
