import { parseApptTimeToMinutes } from "@/lib/appointmentTime";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { holdsPermission } from "@/lib/permissions";
import { parseLedgerProcedureDescription } from "@/lib/ledgerProcedureParse";
import { loadBriefingData, type LedgerRow } from "./data";
import { buildHrSection, rosteredOn } from "./hr";
import { buildMoneySection, buildProductionSection } from "./money";
import {
  buildActionsSection,
  buildGrowthSection,
  buildNextUpSection,
  buildStaleBalances,
  buildStockSection,
} from "./operations";
import type { Briefing, BriefingAccess, BriefingPeriod, TrendPoint, TrendSection } from "./types";

/**
 * Assembles a briefing for a period, for one reader.
 *
 * Redaction happens here rather than in the UI. A receptionist opening the brief gets a payload
 * with no `money` and no `hr` key at all — the figures are never computed into a response that
 * then relies on a component remembering to hide them. What they do get is `redacted`, so the
 * screen can say the sections exist and are not theirs to see, instead of rendering a suspiciously
 * short page.
 */

const ATTENDED = new Set(["Checked In", "In Chair", "Checking Out", "Completed"]);

/** Matches the threshold in operations.ts, and the revenue engine before it. */
const STALE_DAYS = 45;

function shiftDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function monthStartOf(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

export interface BriefingWindow {
  startDate: string;
  endDate: string;
  /** The period before this one, the same length, for "against last time". */
  previousStart: string;
  previousEnd: string;
  /** Daily only: the same weekday a week back. */
  sameWeekday: string | null;
  /** Where the ledger read has to begin so every comparison above has its rows. */
  comparisonStart: string;
  aheadStart: string;
  aheadEnd: string;
  previousLabel: string;
}

/**
 * The dates a brief covers, and the dates it compares itself against.
 *
 * A day compares with the same weekday last week (a Monday against a Monday). A week compares
 * with the seven days before it. A month compares month-to-date with the SAME NUMBER of days at
 * the start of last month — the 1st to the 12th against the 1st to the 12th — because on the 12th
 * "this month vs last month" against a whole thirty-one days would always read as a collapse.
 *
 * Pure, and exported, so the arithmetic of "which days" is pinned by a test without a database.
 */
export function briefingWindow(period: BriefingPeriod, endDate: string): BriefingWindow {
  const aheadStart = shiftDays(endDate, 1);
  if (period === "day") {
    return {
      startDate: endDate,
      endDate,
      previousStart: shiftDays(endDate, -1),
      previousEnd: shiftDays(endDate, -1),
      sameWeekday: shiftDays(endDate, -7),
      comparisonStart: shiftDays(endDate, -7),
      aheadStart,
      aheadEnd: aheadStart,
      previousLabel: shiftDays(endDate, -1),
    };
  }
  if (period === "week") {
    const startDate = shiftDays(endDate, -6);
    const previousEnd = shiftDays(startDate, -1);
    const previousStart = shiftDays(previousEnd, -6);
    return {
      startDate,
      endDate,
      previousStart,
      previousEnd,
      sameWeekday: null,
      comparisonStart: previousStart,
      aheadStart,
      aheadEnd: shiftDays(endDate, 7),
      previousLabel: `${previousStart} – ${previousEnd}`,
    };
  }
  const startDate = monthStartOf(endDate);
  const spanDays = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86_400_000) + 1;
  const lastMonthEnd = shiftDays(startDate, -1);
  const previousStart = monthStartOf(lastMonthEnd);
  const sameSpanEnd = shiftDays(previousStart, spanDays - 1);
  const previousEnd = sameSpanEnd < lastMonthEnd ? sameSpanEnd : lastMonthEnd;
  return {
    startDate,
    endDate,
    previousStart,
    previousEnd,
    sameWeekday: null,
    comparisonStart: previousStart,
    aheadStart,
    aheadEnd: shiftDays(endDate, 7),
    previousLabel: `${previousStart} – ${previousEnd}`,
  };
}

/** Minutes from midnight, right now, on the clinic's clock. */
function nowMinutesInZone(timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

export function resolveBriefingAccess(
  role: string | null | undefined,
  permissions: string[] | null | undefined
): BriefingAccess {
  return {
    money: holdsPermission(role, permissions, "access.finance"),
    // Either permission is enough: `attendance.admin` is the payroll screen's own gate, and anyone
    // trusted with full settings already administers staff records.
    hr:
      holdsPermission(role, permissions, "attendance.admin") ||
      holdsPermission(role, permissions, "access.settings"),
  };
}

function changePercent(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export async function buildBriefing(args: {
  clinicId: string;
  period: BriefingPeriod;
  /** The day, for a daily brief, or the last day of the window for a weekly one. */
  endDate: string;
  access: BriefingAccess;
}): Promise<Briefing> {
  const { clinicId, period, endDate, access } = args;

  const timeZone = clinicTimeZone();
  const today = ymdInTimeZone(timeZone);
  const notes: string[] = [];

  const { startDate, previousStart, previousEnd, sameWeekday, comparisonStart, aheadStart, aheadEnd, previousLabel } =
    briefingWindow(period, endDate);

  const monthStart = monthStartOf(today);
  const attendanceStart = [monthStart, previousStart, startDate].sort()[0];

  const data = await loadBriefingData({
    clinicId,
    startDate,
    endDate,
    comparisonStart,
    attendanceStart,
    previousStart: period === "day" ? null : previousStart,
    previousEnd: period === "day" ? null : previousEnd,
    needsMoney: access.money,
    needsHr: access.hr,
  });

  const appointments = [...data.inRange].sort((a, b) =>
    a.date === b.date ? parseApptTimeToMinutes(a.time) - parseApptTimeToMinutes(b.time) : a.date < b.date ? -1 : 1
  );

  const counts = {
    total: appointments.length,
    attended: appointments.filter((a) => ATTENDED.has(a.status)).length,
    cancelled: appointments.filter((a) => a.status === "Cancelled" || a.status === "No Show").length,
    stillScheduled: appointments.filter((a) => a.status === "Scheduled" || a.status === "Confirmed").length,
  };

  // --- Money and production -------------------------------------------------------------------
  const money = access.money
    ? buildMoneySection({
        rows: data.ledgerWindow,
        startDate,
        endDate,
        previousStart,
        previousEnd,
        previousLabel,
        sameWeekday,
      })
    : undefined;

  const productionResult = access.money
    ? buildProductionSection({
        appointments,
        rows: data.ledgerWindow,
        startDate,
        endDate,
        schedule: data.schedule,
        includeGap: period === "day",
      })
    : null;

  if (productionResult && productionResult.unattributedCollected > 0) {
    notes.push(
      `${Math.round(productionResult.unattributedCollected).toLocaleString()} was collected on rows ` +
        "with no doctor recorded, so it appears in the totals but under no name in the per-doctor table."
    );
  }
  if (access.money && !data.schedule.isConfigured) {
    notes.push(
      "Chair utilisation is blank because the clinic's opening hours have not been set. " +
        "Settings → Schedule fills it in."
    );
  }

  // --- HR -------------------------------------------------------------------------------------
  const hrResult = access.hr
    ? buildHrSection({
        staff: data.staff,
        punches: data.punches,
        startDate,
        endDate,
        today,
        nowMinutes: nowMinutesInZone(timeZone),
        timeZone,
        geofenceRadiusM: data.geofenceRadiusM,
        monthStart,
      })
    : null;

  if (hrResult && hrResult.section.withoutSchedule > 0) {
    notes.push(
      `${hrResult.section.withoutSchedule} staff member${hrResult.section.withoutSchedule === 1 ? " has" : "s have"} ` +
        "no work schedule set, so they can never be counted late or absent. Attendance → the ⚙ beside " +
        "their name sets one."
    );
  }
  if (hrResult && hrResult.section.absentDays > 0) {
    notes.push(
      "Nothing in this system records leave or sick days, so an agreed day off reads here as an " +
        "absence. Check before acting on one."
    );
  }

  // --- Balances, actions, growth, stock -------------------------------------------------------
  const stale = buildStaleBalances(data.ledgerAll, data.patientNames, today);
  if (access.money && data.ledgerAllTruncated) {
    notes.push(
      "The balance scan reads a capped slice of the ledger, so on a long history some accounts " +
        "will be missing from that list. Every other figure here comes from an exact date range."
    );
  }

  const actions = buildActionsSection({
    inRange: appointments,
    ahead: data.ahead,
    unresolved: data.unresolved,
    ledgerWindow: data.ledgerWindow,
    leads: data.leads,
    patientNames: data.patientNames,
    startDate,
    endDate,
    today,
    aheadEnd,
    staleBalances: stale.balances,
    staleBalanceTotal: stale.total,
    includeMoney: access.money,
  });

  if (actions.staleBalanceTotal !== null && actions.staleBalances.length > 0) {
    notes.push(
      `"No recent activity" means no ledger entry for ${STALE_DAYS}+ days. It is not the same as overdue — ` +
        "this system does not record payment due dates."
    );
  }

  const growth = buildGrowthSection({
    leads: data.leads,
    patientCreatedAt: data.patientCreatedAt,
    startDate,
    endDate,
    timeZone,
  });

  const stock = buildStockSection(data.inventory);

  const nextUp = buildNextUpSection({
    ahead: data.ahead,
    key: period === "day" ? "tomorrow" : "next_week",
    startDate: aheadStart,
    endDate: aheadEnd,
    rostered: access.hr ? rosteredOn(data.staff, aheadStart) : null,
  });

  // --- Weekly trend ---------------------------------------------------------------------------
  let trend: TrendSection | undefined;
  if (period !== "day") {
    trend = buildTrend({
      ledger: data.ledgerWindow,
      appointments,
      previousAppointments: data.previousRange,
      startDate,
      endDate,
      previousStart,
      previousEnd,
      access,
      money,
      payrollMonthToDate: hrResult ? hrResult.payrollMonthToDate : null,
      timeZone,
      patientCreatedAt: data.patientCreatedAt,
      newPatientsThisPeriod: growth.newPatients,
    });
  }

  const redacted: string[] = [];
  if (!access.money) redacted.push("money");
  if (!access.hr) redacted.push("hr");

  return {
    period,
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    dateKey: startDate,
    access,
    redacted,
    headline: {
      collected: money ? money.collected : null,
      patientsSeen: counts.attended,
      stillToCome: counts.stillScheduled,
      missed: counts.cancelled,
      staffOnFloor: hrResult ? hrResult.section.onFloorNow : null,
    },
    appointments,
    counts,
    money,
    production: productionResult ? productionResult.section : undefined,
    hr: hrResult ? hrResult.section : undefined,
    actions,
    growth,
    stock,
    nextUp,
    trend,
    notes,
    // Repeated from `actions` for the Android app — see the note on the type.
    staleBalances: actions.staleBalances,
    staleBalanceTotal: actions.staleBalanceTotal,
  };
}

function cashIn(row: LedgerRow): number {
  return row.paid || row.amount || 0;
}

function buildTrend(args: {
  ledger: LedgerRow[];
  appointments: Briefing["appointments"];
  previousAppointments: Briefing["appointments"];
  startDate: string;
  endDate: string;
  previousStart: string;
  previousEnd: string;
  access: BriefingAccess;
  money: Briefing["money"];
  payrollMonthToDate: number | null;
  timeZone: string;
  patientCreatedAt: Map<string, Date>;
  newPatientsThisPeriod: number;
}): TrendSection {
  const {
    ledger,
    appointments,
    previousAppointments,
    startDate,
    endDate,
    previousStart,
    previousEnd,
    access,
    money,
    payrollMonthToDate,
    timeZone,
    patientCreatedAt,
    newPatientsThisPeriod,
  } = args;

  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);

  const collectedOn = (from: string, to: string) =>
    ledger
      .filter((r) => (r.type === "payment" || r.type === "income") && r.date >= from && r.date <= to)
      .reduce((sum, r) => sum + Math.max(0, cashIn(r)), 0);

  const daily: TrendSection["daily"] = [];
  const cursor = new Date(`${startDate}T12:00:00Z`);
  const last = new Date(`${endDate}T12:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    daily.push({
      dateKey: key,
      weekday: cursor.getUTCDay(),
      collected: access.money ? collectedOn(key, key) : null,
      patientsSeen: appointments.filter((a) => a.date === key && ATTENDED.has(a.status)).length,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  /**
   * Ranked on money where the reader can see it, on patients where they cannot — otherwise a
   * receptionist's "best day" would be blank rather than simply measured differently.
   */
  // The comparison period, day by day, so the owner's chart can draw last month under this one.
  const previousDaily: TrendSection["previousDaily"] = [];
  const prevCursor = new Date(`${previousStart}T12:00:00Z`);
  const prevLast = new Date(`${previousEnd}T12:00:00Z`);
  while (prevCursor.getTime() <= prevLast.getTime()) {
    const key = prevCursor.toISOString().slice(0, 10);
    previousDaily.push({
      dateKey: key,
      collected: access.money ? collectedOn(key, key) : null,
      patientsSeen: previousAppointments.filter((a) => a.date === key && ATTENDED.has(a.status)).length,
    });
    prevCursor.setUTCDate(prevCursor.getUTCDate() + 1);
  }
  const rank = (d: TrendSection["daily"][number]) => (access.money ? (d.collected ?? 0) : d.patientsSeen);
  const sorted = [...daily].sort((a, b) => rank(b) - rank(a));
  const anyActivity = sorted.some((d) => rank(d) > 0);

  const procedures = new Map<string, { name: string; count: number; revenue: number }>();
  for (const row of ledger) {
    if (row.type !== "procedure" || row.date < startDate || row.date > endDate) continue;
    const name = parseLedgerProcedureDescription(row.description).procedureLine || "—";
    const bucket = procedures.get(name) || { name, count: 0, revenue: 0 };
    bucket.count += 1;
    bucket.revenue += row.cost || row.amount;
    procedures.set(name, bucket);
  }

  const billed = ledger
    .filter((r) => r.type === "procedure" && r.date >= startDate && r.date <= endDate)
    .reduce((sum, r) => sum + (r.cost || r.amount), 0);
  const collected = collectedOn(startDate, endDate);

  const newPatientsPrevious = Array.from(patientCreatedAt.values()).filter((d) => {
    const key = dayKey(d);
    return key >= previousStart && key <= previousEnd;
  }).length;

  const previousAttended = previousAppointments.filter((a) => ATTENDED.has(a.status)).length;
  const previousMissed = previousAppointments.filter(
    (a) => a.status === "Cancelled" || a.status === "No Show"
  ).length;

  const points: TrendPoint[] = [
    {
      key: "patients_seen",
      current: appointments.filter((a) => ATTENDED.has(a.status)).length,
      previous: previousAttended,
      changePercent: changePercent(appointments.filter((a) => ATTENDED.has(a.status)).length, previousAttended),
      isMoney: false,
    },
    {
      key: "missed",
      current: appointments.filter((a) => a.status === "Cancelled" || a.status === "No Show").length,
      previous: previousMissed,
      changePercent: changePercent(
        appointments.filter((a) => a.status === "Cancelled" || a.status === "No Show").length,
        previousMissed
      ),
      isMoney: false,
    },
    {
      key: "new_patients",
      current: newPatientsThisPeriod,
      previous: newPatientsPrevious,
      changePercent: changePercent(newPatientsThisPeriod, newPatientsPrevious),
      isMoney: false,
    },
  ];

  if (access.money && money) {
    const previousCollected = collectedOn(previousStart, previousEnd);
    points.unshift({
      key: "collected",
      current: money.collected,
      previous: previousCollected,
      changePercent: changePercent(money.collected, previousCollected),
      isMoney: true,
    });
  }

  return {
    points,
    daily,
    previousDaily,
    bestDay: anyActivity ? sorted[0].dateKey : null,
    quietestDay: anyActivity ? sorted[sorted.length - 1].dateKey : null,
    topProcedures: Array.from(procedures.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((p) => ({ name: p.name, count: p.count, revenue: access.money ? p.revenue : null })),
    collectionRate: access.money && billed > 0 ? Math.round((collected / billed) * 100) : null,
    payrollMonthToDate,
  };
}
