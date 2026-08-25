import { parseApptTimeToMinutes, minutesToTimeKey } from "@/lib/appointmentTime";
import { clinicDayBoundsMinutes, type ClinicScheduleConfig } from "@/lib/clinicSchedule";
import type { LedgerRow } from "./data";
import type {
  BriefingAppointment,
  CategorySplit,
  DoctorProduction,
  MethodSplit,
  MoneySection,
  ProductionSection,
} from "./types";

/**
 * Money and production, on the same cash basis the Finance screen uses.
 *
 * The one rule that matters here: a payment against a procedure is its own ledger row carrying
 * `procedureId`, and the procedure row's `paid` field is a rollup of those payments. Summing both
 * counts every collected pound twice. So "collected" reads payment and income rows only — exactly
 * what the Finance page does when it drops procedure rows from the clinic ledger — and procedure
 * rows are used only for the two things they alone know: what was discounted, and what was
 * charged but not yet covered.
 *
 * Commission, lab fee and clinic profit ride on the payment row, not the procedure, because they
 * are recalculated each time money actually arrives.
 */

const ATTENDED = new Set(["Checked In", "In Chair", "Checking Out", "Completed"]);

/** Cash taken on a row. Matches `ledgerCashValue` on the Finance screen. */
function cashIn(row: LedgerRow): number {
  return row.paid || row.amount || 0;
}

function expenseValue(row: LedgerRow): number {
  return row.cost || row.amount || 0;
}

/** What a procedure was charged at, before any payment against it. */
function procedureCharge(row: LedgerRow): number {
  return row.cost || row.amount || 0;
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function topN<T extends { amount: number }>(rows: Map<string, T>, n: number): T[] {
  return Array.from(rows.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

export function buildMoneySection(args: {
  rows: LedgerRow[];
  startDate: string;
  endDate: string;
  previousStart: string;
  previousEnd: string;
  previousLabel: string;
  /** Daily only: the same weekday a week back, which is a fairer comparison than yesterday. */
  sameWeekday: string | null;
}): MoneySection {
  const { rows, startDate, endDate, previousStart, previousEnd, previousLabel, sameWeekday } = args;

  const inWindow = (r: LedgerRow) => r.date >= startDate && r.date <= endDate;

  let collected = 0;
  let expenses = 0;
  let discounts = 0;
  let labFees = 0;
  let doctorCommissions = 0;
  let clinicProfit = 0;
  let billedUnpaid = 0;

  const methods = new Map<string, MethodSplit>();
  const categories = new Map<string, CategorySplit>();

  for (const row of rows) {
    if (!inWindow(row)) continue;

    if (row.type === "expense") {
      const value = expenseValue(row);
      if (value <= 0) continue;
      expenses += value;
      const key = row.category || "General";
      const bucket = categories.get(key) || { category: key, amount: 0, count: 0 };
      bucket.amount += value;
      bucket.count += 1;
      categories.set(key, bucket);
      continue;
    }

    if (row.type === "procedure") {
      discounts += row.discountAmount;
      billedUnpaid += Math.max(0, procedureCharge(row) - row.paid);
      continue;
    }

    if (row.type !== "payment" && row.type !== "income") continue;

    const value = cashIn(row);
    if (value <= 0) continue;

    collected += value;
    labFees += row.labFee;
    doctorCommissions += row.doctorCommissionAmount;
    clinicProfit += row.clinicProfit || value - row.doctorCommissionAmount - row.labFee;

    const key = row.method || "Cash";
    const bucket = methods.get(key) || { method: key, amount: 0, count: 0 };
    bucket.amount += value;
    bucket.count += 1;
    methods.set(key, bucket);
  }

  const sumCollected = (from: string, to: string) =>
    rows
      .filter((r) => (r.type === "payment" || r.type === "income") && r.date >= from && r.date <= to)
      .reduce((sum, r) => sum + Math.max(0, cashIn(r)), 0);

  const hasPrevious = rows.some((r) => r.date >= previousStart && r.date <= previousEnd);
  const hasSameWeekday = sameWeekday ? rows.some((r) => r.date === sameWeekday) : false;

  return {
    collected,
    byMethod: topN(methods, 6),
    expenses,
    expensesByCategory: Array.from(categories.values()).sort((a, b) => b.amount - a.amount).slice(0, 6),
    netCash: collected - expenses,
    discounts,
    labFees,
    doctorCommissions,
    clinicProfit,
    billedUnpaid,
    comparison: {
      previousLabel,
      // Zero and "no rows at all" are different answers. A clinic that was closed yesterday should
      // not be shown a confident "down 100%".
      previousCollected: hasPrevious ? sumCollected(previousStart, previousEnd) : null,
      sameWeekdayLabel: sameWeekday,
      sameWeekdayCollected: hasSameWeekday && sameWeekday ? sumCollected(sameWeekday, sameWeekday) : null,
    },
  };
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Minutes the clinic is open across the range, or null when its hours were never configured. */
function openMinutesAcross(
  schedule: ClinicScheduleConfig,
  startDate: string,
  endDate: string
): number | null {
  if (!schedule.isConfigured) return null;
  const bounds = clinicDayBoundsMinutes(schedule);
  const perDay = Math.max(0, bounds.end - bounds.start);
  const offDays = new Set(schedule.offDays);

  let total = 0;
  const cursor = new Date(`${startDate}T12:00:00Z`);
  const last = new Date(`${endDate}T12:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    if (!offDays.has(DAY_NAMES[cursor.getUTCDay()])) total += perDay;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

export function buildProductionSection(args: {
  appointments: BriefingAppointment[];
  rows: LedgerRow[];
  startDate: string;
  endDate: string;
  schedule: ClinicScheduleConfig;
  /** Gaps only make sense inside one day. */
  includeGap: boolean;
}): { section: ProductionSection; unattributedCollected: number } {
  const { appointments, rows, startDate, endDate, schedule, includeGap } = args;

  const groups = new Map<string, DoctorProduction>();
  let unattributedCollected = 0;

  const groupFor = (rawName: string): DoctorProduction | null => {
    const name = rawName.trim();
    if (!name) return null;
    const key = normalizeName(name);
    const existing = groups.get(key);
    if (existing) return existing;
    const created: DoctorProduction = {
      key,
      name,
      patientsSeen: 0,
      procedures: 0,
      collected: 0,
      commission: 0,
      labFee: 0,
      clinicProfit: 0,
    };
    groups.set(key, created);
    return created;
  };

  const attended = appointments.filter((a) => ATTENDED.has(a.status));
  for (const appt of attended) {
    const group = groupFor(appt.doctor);
    if (group) group.patientsSeen += 1;
  }

  for (const row of rows) {
    if (row.date < startDate || row.date > endDate) continue;

    if (row.type === "procedure") {
      const group = groupFor(row.doctorName);
      if (group) group.procedures += 1;
      continue;
    }
    if (row.type !== "payment" && row.type !== "income") continue;

    const value = cashIn(row);
    if (value <= 0) continue;

    const group = groupFor(row.doctorName);
    if (!group) {
      // Kept as its own number rather than folded into a doctor, matching how clinicReports
      // reports coverage: a total that quietly drops rows is worse than one that admits the gap.
      unattributedCollected += value;
      continue;
    }
    group.collected += value;
    group.commission += row.doctorCommissionAmount;
    group.labFee += row.labFee;
    group.clinicProfit += row.clinicProfit || value - row.doctorCommissionAmount - row.labFee;
  }

  const booked = appointments.filter((a) => a.status !== "Cancelled" && a.status !== "No Show");
  const bookedMinutes = booked.reduce((sum, a) => sum + a.duration, 0);
  const openMinutes = openMinutesAcross(schedule, startDate, endDate);

  const hourBuckets = new Map<number, number>();
  for (const appt of booked) {
    const minutes = parseApptTimeToMinutes(appt.time);
    if (!minutes && !appt.time) continue;
    const hour = Math.floor(minutes / 60);
    hourBuckets.set(hour, (hourBuckets.get(hour) || 0) + 1);
  }
  let busiestHour: ProductionSection["busiestHour"] = null;
  for (const [hour, count] of hourBuckets) {
    if (!busiestHour || count > busiestHour.count) {
      busiestHour = { hour: minutesToTimeKey(hour * 60), count };
    }
  }

  let biggestGap: ProductionSection["biggestGap"] = null;
  if (includeGap && booked.length > 1 && schedule.isConfigured) {
    const bounds = clinicDayBoundsMinutes(schedule);
    const slots = booked
      .map((a) => ({ start: parseApptTimeToMinutes(a.time), end: parseApptTimeToMinutes(a.time) + a.duration }))
      .filter((s) => s.start > 0)
      .sort((a, b) => a.start - b.start);

    let cursor = Math.max(bounds.start, slots.length ? slots[0].start : bounds.start);
    for (const slot of slots) {
      const gap = slot.start - cursor;
      if (gap > 0 && (!biggestGap || gap > biggestGap.minutes)) {
        biggestGap = { startsAt: minutesToTimeKey(cursor), minutes: gap };
      }
      cursor = Math.max(cursor, slot.end);
    }
  }

  const totalCollected = Array.from(groups.values()).reduce((s, g) => s + g.collected, 0) + unattributedCollected;

  return {
    section: {
      doctors: Array.from(groups.values()).sort((a, b) => b.collected - a.collected || b.patientsSeen - a.patientsSeen),
      revenuePerPatientSeen: attended.length > 0 ? totalCollected / attended.length : null,
      chairUtilisation:
        openMinutes && openMinutes > 0
          ? {
              bookedMinutes,
              openMinutes,
              percent: Math.round((bookedMinutes / openMinutes) * 100),
            }
          : null,
      busiestHour,
      biggestGap,
    },
    unattributedCollected,
  };
}
