/**
 * The arithmetic behind the dentist's own report — the charts under their home screen.
 *
 * Plain functions over plain rows, like lib/dentistHome.ts, so every figure a dentist sees about
 * their own work can be pinned by a test without a browser. Everything here is a count or a sum
 * of what the clinic already records for this dentist; nothing is estimated.
 *
 * Only the dentist's own rows ever enter: callers pass what `isMine` let through. Comparing
 * against the rest of the clinic was deliberately left out — a leaderboard is a decision for the
 * clinic to make, not a default.
 */

import { isDone, isMine, rowMoney, shareOf, type DentistIdentity, type Row } from "@/lib/dentistHome";

export type PeriodKind = "week" | "month" | "quarter" | "year";
export type BucketKind = "day" | "week" | "month";

export type Period = {
  kind: PeriodKind;
  /** Inclusive ISO dates. */
  start: string;
  end: string;
  bucket: BucketKind;
};

export type Bucket = { key: string; label: string };

// --- Dates, done by hand so the week starts where the clinic's does -------------------------------

function toDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function fromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ymdAdd(ymd: string, days: number): string {
  const d = toDate(ymd);
  d.setDate(d.getDate() + days);
  return fromDate(d);
}

/**
 * The Saturday on or before a date. The clinic's week starts Saturday — the Egyptian working
 * week — so "this week" and week buckets both hang off it, not off Monday.
 */
export function weekStart(ymd: string): string {
  const d = toDate(ymd);
  const back = (d.getDay() + 1) % 7; // Sat=6 -> 0, Sun=0 -> 1, ..., Fri=5 -> 6
  d.setDate(d.getDate() - back);
  return fromDate(d);
}

function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function monthEnd(ymd: string): string {
  const d = toDate(monthStart(ymd));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return fromDate(d);
}

/** The date window each period name means, and how finely it is bucketed. */
export function periodFor(kind: PeriodKind, today: string): Period {
  switch (kind) {
    case "week": {
      const start = weekStart(today);
      return { kind, start, end: ymdAdd(start, 6), bucket: "day" };
    }
    case "month":
      return { kind, start: monthStart(today), end: monthEnd(today), bucket: "day" };
    case "quarter": {
      const d = toDate(monthStart(today));
      d.setMonth(d.getMonth() - 2);
      return { kind, start: fromDate(d), end: monthEnd(today), bucket: "week" };
    }
    case "year":
      return { kind, start: `${today.slice(0, 4)}-01-01`, end: `${today.slice(0, 4)}-12-31`, bucket: "month" };
  }
}

/** Which bucket a date falls in. */
export function bucketKey(ymd: string, bucket: BucketKind): string {
  if (bucket === "day") return ymd;
  if (bucket === "week") return weekStart(ymd);
  return ymd.slice(0, 7);
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

function bucketLabel(key: string, bucket: BucketKind, isAr: boolean): string {
  const months = isAr ? MONTHS_AR : MONTHS_EN;
  if (bucket === "month") return months[Number(key.slice(5, 7)) - 1] || key;
  const d = toDate(key);
  if (bucket === "week") return `${d.getDate()} ${months[d.getMonth()]}`;
  return String(d.getDate());
}

/** Every bucket in the period, in order, empty ones included — a chart with gaps lies. */
export function bucketsFor(period: Period, isAr = false): Bucket[] {
  const out: Bucket[] = [];
  const seen = new Set<string>();
  for (let ymd = period.start; ymd <= period.end; ymd = ymdAdd(ymd, 1)) {
    const key = bucketKey(ymd, period.bucket);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: bucketLabel(key, period.bucket, isAr) });
  }
  return out;
}

function inPeriod(ymd: unknown, period: Period): boolean {
  const s = String(ymd || "");
  return s.length >= 10 && s.slice(0, 10) >= period.start && s.slice(0, 10) <= period.end;
}

function ymdOf(row: Row): string {
  return String(row.date || "").slice(0, 10);
}

// --- Money ---------------------------------------------------------------------------------------

export type MoneyPoint = { key: string; label: string; charged: number; collected: number; share: number };

/** What the dentist charged and what came in, per bucket, with their share of the latter. */
export function moneyByBucket(ledger: Row[], me: DentistIdentity, period: Period, isAr = false): MoneyPoint[] {
  const points = new Map(bucketsFor(period, isAr).map((b) => [b.key, { ...b, charged: 0, collected: 0, share: 0 }]));
  for (const row of ledger) {
    if (!isMine(row, me) || !inPeriod(row.date, period)) continue;
    const p = points.get(bucketKey(ymdOf(row), period.bucket));
    if (!p) continue;
    const type = String(row.type);
    if (type === "procedure") p.charged += rowMoney(row);
    else if (type === "payment") {
      p.collected += rowMoney(row);
      p.share += shareOf(row, me);
    }
  }
  return [...points.values()].map((p) => ({ ...p, charged: r2(p.charged), collected: r2(p.collected), share: r2(p.share) }));
}

// --- Attendance ------------------------------------------------------------------------------------

export type AttendancePoint = { key: string; label: string; seen: number; noShow: number; cancelled: number };

const SEEN = new Set(["Completed", "Checking Out", "In Chair"]);

/** How the dentist's bookings ended, per bucket. Future and still-open bookings do not count. */
export function attendanceByBucket(appointments: Row[], me: DentistIdentity, period: Period, isAr = false): AttendancePoint[] {
  const points = new Map(bucketsFor(period, isAr).map((b) => [b.key, { ...b, seen: 0, noShow: 0, cancelled: 0 }]));
  for (const a of appointments) {
    if (!isMine(a, me) || !inPeriod(a.date, period)) continue;
    const p = points.get(bucketKey(ymdOf(a), period.bucket));
    if (!p) continue;
    const s = String(a.status || "");
    if (SEEN.has(s)) p.seen += 1;
    else if (s === "No Show") p.noShow += 1;
    else if (s === "Cancelled") p.cancelled += 1;
  }
  return [...points.values()];
}

/** No-shows as a share of the bookings that were decided either way. Null when there were none. */
export function noShowRate(points: AttendancePoint[]): number | null {
  const seen = points.reduce((n, p) => n + p.seen, 0);
  const missed = points.reduce((n, p) => n + p.noShow, 0);
  return seen + missed === 0 ? null : missed / (seen + missed);
}

// --- Procedure mix -------------------------------------------------------------------------------------

export type MixSlice = { name: string; count: number; amount: number; other?: boolean };

/**
 * What the dentist does most, by money charged, with everything past the top five folded into
 * "Other". Five plus Other is the most segments a ring can carry and still be read; past that the
 * table view is the honest form.
 */
export function procedureMix(ledger: Row[], me: DentistIdentity, period: Period, otherLabel = "Other", top = 5): MixSlice[] {
  const byName = new Map<string, MixSlice>();
  for (const row of ledger) {
    if (String(row.type) !== "procedure" || !isMine(row, me) || !inPeriod(row.date, period)) continue;
    const name = String(row.serviceName || row.description || "").trim() || "—";
    const s = byName.get(name) || { name, count: 0, amount: 0 };
    s.count += 1;
    s.amount += rowMoney(row);
    byName.set(name, s);
  }
  const sorted = [...byName.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
  const head = sorted.slice(0, top);
  const tail = sorted.slice(top);
  if (tail.length) {
    head.push({
      name: otherLabel,
      count: tail.reduce((n, s) => n + s.count, 0),
      amount: r2(tail.reduce((n, s) => n + s.amount, 0)),
      other: true,
    });
  }
  return head.map((s) => ({ ...s, amount: r2(s.amount) }));
}

// --- Patients ---------------------------------------------------------------------------------------------

export type PatientsPoint = { key: string; label: string; newPatients: number; returning: number };

/** Any of the shapes a `createdAt` arrives in, as an ISO date; "" when it cannot be read. */
export function toYmd(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const v = value as { toDate?: () => Date; toMillis?: () => number; getTime?: () => number };
  const ms =
    typeof v.toMillis === "function" ? v.toMillis()
    : typeof v.toDate === "function" ? v.toDate().getTime()
    : typeof v.getTime === "function" ? v.getTime()
    : NaN;
  return Number.isFinite(ms) ? fromDate(new Date(ms)) : "";
}

/**
 * Distinct patients the dentist saw per bucket, split into people who joined the clinic during
 * the period and people who were already on the books. A patient counts once per bucket however
 * many times they came; a patient whose record carries no creation date counts as returning,
 * because that is what an undated record almost always is — one that predates the field.
 */
export function patientsByBucket(
  appointments: Row[],
  patientCreatedAt: Map<string, string>,
  me: DentistIdentity,
  period: Period,
  isAr = false
): PatientsPoint[] {
  const points = new Map(bucketsFor(period, isAr).map((b) => [b.key, { ...b, newPatients: 0, returning: 0, ids: new Set<string>() }]));
  for (const a of appointments) {
    if (!isMine(a, me) || !inPeriod(a.date, period) || !SEEN.has(String(a.status || ""))) continue;
    const pid = String(a.patientId || "");
    if (!pid) continue;
    const p = points.get(bucketKey(ymdOf(a), period.bucket));
    if (!p || p.ids.has(pid)) continue;
    p.ids.add(pid);
    const created = patientCreatedAt.get(pid) || "";
    if (created && created >= period.start) p.newPatients += 1;
    else p.returning += 1;
  }
  return [...points.values()].map((p) => ({ key: p.key, label: p.label, newPatients: p.newPatients, returning: p.returning }));
}

/** The headline figures the tiles show, all from the same slices the charts draw. */
export function reportTotals(money: MoneyPoint[], attendance: AttendancePoint[], patients: PatientsPoint[]) {
  return {
    charged: r2(money.reduce((n, p) => n + p.charged, 0)),
    collected: r2(money.reduce((n, p) => n + p.collected, 0)),
    share: r2(money.reduce((n, p) => n + p.share, 0)),
    seen: attendance.reduce((n, p) => n + p.seen, 0),
    noShowRate: noShowRate(attendance),
    patients: patients.reduce((n, p) => n + p.newPatients + p.returning, 0),
    newPatients: patients.reduce((n, p) => n + p.newPatients, 0),
  };
}

/** Re-exported so the report's caller can decide "seen" the same way the tallies do. */
export { isDone };

function r2(n: number): number {
  return Number(n.toFixed(2));
}
