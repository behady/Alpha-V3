import { parseApptTimeToMinutes } from "@/lib/appointmentTime";
import type { InventoryRecord, LeadRecord, LedgerRow } from "./data";
import type {
  ActionItem,
  ActionsSection,
  BriefingAppointment,
  GrowthSection,
  NextUpSection,
  StaleBalance,
  StockSection,
} from "./types";

/**
 * The parts of a brief that are about work not yet done: what will be missed, who is new, what
 * has run out, and what is coming.
 *
 * These are the sections an owner acts on. Everything here is a list of names with a reason
 * attached, never a score — the point is that someone picks up the phone, and a phone call needs
 * a person, not a probability.
 */

const ATTENDED = new Set(["Checked In", "In Chair", "Checking Out", "Completed"]);

/** Matches the revenue engine's threshold so the two features cannot disagree about "stale". */
const STALE_DAYS = 45;
const MIN_BALANCE = 1;
const LIST_CAP = 12;

function daysBetween(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T12:00:00Z`).getTime();
  const to = new Date(`${toKey}T12:00:00Z`).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86400000));
}

/**
 * Balances owed, and how long since anything happened on the account.
 *
 * There is no stored balance to read — the field on the patient document is written as 0 at
 * creation and never updated — so it is charged minus paid across the whole ledger. And it is
 * deliberately not called "overdue": nothing in this system records a payment due date, so the
 * only honest claim is that the account has gone quiet.
 */
export function buildStaleBalances(
  ledgerAll: LedgerRow[],
  patientNames: Map<string, string>,
  today: string
): { balances: StaleBalance[]; total: number } {
  const billed = new Map<string, number>();
  const paid = new Map<string, number>();
  const lastActivity = new Map<string, string>();

  for (const row of ledgerAll) {
    if (!row.patientId) continue;

    if (row.type === "payment") paid.set(row.patientId, (paid.get(row.patientId) || 0) + (row.paid || row.amount));
    else if (row.type === "procedure")
      billed.set(row.patientId, (billed.get(row.patientId) || 0) + (row.cost || row.amount));

    if (row.date) {
      const current = lastActivity.get(row.patientId);
      if (!current || row.date > current) lastActivity.set(row.patientId, row.date);
    }
  }

  const balances: StaleBalance[] = [];
  for (const [patientId, billedTotal] of billed) {
    const balance = billedTotal - (paid.get(patientId) || 0);
    if (balance < MIN_BALANCE) continue;

    const last = lastActivity.get(patientId);
    if (!last) continue;
    const days = daysBetween(last, today);
    if (days < STALE_DAYS) continue;

    balances.push({
      patientId,
      patientName: patientNames.get(patientId) || "Unnamed patient",
      balance,
      daysSinceLastActivity: days,
    });
  }

  balances.sort((a, b) => b.balance - a.balance);
  return { balances, total: balances.reduce((sum, b) => sum + b.balance, 0) };
}

export function buildActionsSection(args: {
  inRange: BriefingAppointment[];
  ahead: BriefingAppointment[];
  unresolved: BriefingAppointment[];
  ledgerWindow: LedgerRow[];
  leads: LeadRecord[];
  patientNames: Map<string, string>;
  startDate: string;
  endDate: string;
  today: string;
  /** End of the look-ahead window used for the unconfirmed count. */
  aheadEnd: string;
  staleBalances: StaleBalance[];
  staleBalanceTotal: number;
  includeMoney: boolean;
}): ActionsSection {
  const {
    inRange,
    ahead,
    unresolved,
    ledgerWindow,
    leads,
    patientNames,
    startDate,
    endDate,
    today,
    aheadEnd,
    staleBalances,
    staleBalanceTotal,
    includeMoney,
  } = args;

  /**
   * Anyone with a future appointment on the books. Read from the whole future, not just the
   * preview window — a patient booked for next month has not been forgotten.
   */
  const bookedAhead = new Set(ahead.filter((a) => a.status !== "Cancelled").map((a) => a.patientId).filter(Boolean));

  // A visit later today is not yet unresolved, and neither is yesterday's until the day has
  // properly ended. Same one-day grace the standalone scan uses.
  const unresolvedCutoff = new Date(`${today}T12:00:00Z`);
  unresolvedCutoff.setUTCDate(unresolvedCutoff.getUTCDate() - 1);
  const unresolvedCutoffKey = unresolvedCutoff.toISOString().slice(0, 10);

  const unresolvedRows = unresolved
    .filter((a) => a.date && a.date < unresolvedCutoffKey)
    .map<ActionItem>((a) => ({
      id: a.id,
      patientId: a.patientId,
      patientName: a.patientName,
      detail: a.treatment || a.doctor || a.status,
      daysAgo: daysBetween(a.date, today),
    }))
    .sort((a, b) => (a.daysAgo || 0) - (b.daysAgo || 0));

  const seenWithoutNext = inRange
    .filter((a) => ATTENDED.has(a.status) && a.patientId && !bookedAhead.has(a.patientId))
    .map<ActionItem>((a) => ({
      id: a.id,
      patientId: a.patientId,
      patientName: a.patientName,
      detail: a.treatment || a.doctor || "",
    }));

  /**
   * Only computed for readers who can see money, because the ledger is only loaded for them. An
   * empty list that actually means "not read" would be indistinguishable from a clean sheet.
   */
  const billedOwing = new Map<string, { name: string; amount: number }>();
  for (const row of includeMoney ? ledgerWindow : []) {
    if (row.type !== "procedure") continue;
    if (row.date < startDate || row.date > endDate) continue;
    if (!row.patientId || bookedAhead.has(row.patientId)) continue;
    const owing = Math.max(0, (row.cost || row.amount) - row.paid);
    if (owing < MIN_BALANCE) continue;
    const bucket = billedOwing.get(row.patientId) || {
      name: patientNames.get(row.patientId) || row.patientName,
      amount: 0,
    };
    bucket.amount += owing;
    billedOwing.set(row.patientId, bucket);
  }

  const billedWithoutBooking = Array.from(billedOwing.entries())
    .map<ActionItem>(([patientId, v]) => ({
      id: patientId,
      patientId,
      patientName: v.name,
      detail: "",
      amount: includeMoney ? v.amount : undefined,
    }))
    .sort((a, b) => (b.amount || 0) - (a.amount || 0));

  const overdueFollowUps = leads
    .filter((l) => l.followUpDate && l.followUpDate < today && l.stage !== "won" && l.stage !== "lost")
    .map<ActionItem>((l) => ({
      id: l.id,
      patientId: l.patientId,
      patientName: l.name,
      detail: l.source,
      daysAgo: daysBetween(l.followUpDate, today),
    }))
    .sort((a, b) => (b.daysAgo || 0) - (a.daysAgo || 0));

  const unconfirmedAhead = ahead.filter(
    (a) => a.date > endDate && a.date <= aheadEnd && a.status === "Scheduled"
  ).length;

  return {
    unresolvedAppointments: unresolvedRows.slice(0, LIST_CAP),
    unresolvedCount: unresolvedRows.length,
    seenWithoutNextVisit: seenWithoutNext.slice(0, LIST_CAP),
    seenWithoutNextVisitCount: seenWithoutNext.length,
    billedWithoutBooking: billedWithoutBooking.slice(0, LIST_CAP),
    billedWithoutBookingCount: billedWithoutBooking.length,
    overdueFollowUps: overdueFollowUps.slice(0, LIST_CAP),
    overdueFollowUpCount: overdueFollowUps.length,
    unconfirmedAhead,
    staleBalances: includeMoney ? staleBalances.slice(0, LIST_CAP) : [],
    staleBalanceTotal: includeMoney ? staleBalanceTotal : null,
  };
}

export function buildGrowthSection(args: {
  leads: LeadRecord[];
  patientCreatedAt: Map<string, Date>;
  startDate: string;
  endDate: string;
  timeZone: string;
}): GrowthSection {
  const { leads, patientCreatedAt, startDate, endDate, timeZone } = args;

  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
  const inWindow = (d: Date | null) => {
    if (!d) return false;
    const key = dayKey(d);
    return key >= startDate && key <= endDate;
  };

  let newPatients = 0;
  for (const created of patientCreatedAt.values()) if (inWindow(created)) newPatients += 1;

  const newLeads = leads.filter((l) => inWindow(l.createdAt));

  const sources = new Map<string, number>();
  for (const lead of newLeads) sources.set(lead.source, (sources.get(lead.source) || 0) + 1);

  /**
   * Conversions are counted from leads created in the window that have since been won, not from
   * every won lead. There is no timestamp for *when* a stage changed, so a lead won today but
   * created last month cannot be attributed to today without inventing the date.
   */
  const leadsConverted = newLeads.filter((l) => l.stage === "won" || Boolean(l.patientId)).length;

  const leadsUntouched = leads.filter(
    (l) => l.stage === "new" && l.createdAt && dayKey(l.createdAt) < startDate
  ).length;

  return {
    newPatients,
    newLeads: newLeads.length,
    leadsBySource: Array.from(sources.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    leadsConverted,
    leadsUntouched,
  };
}

/**
 * Stock at or below its reorder point.
 *
 * An item whose `minStock` is 0 has no threshold configured — that was the field's old default,
 * not a deliberate "tell me when this hits empty". Counting those as healthy is how a low-stock
 * check reports all-clear over a shelf nobody set up, so they are excluded and reported as their
 * own number instead.
 */
export function buildStockSection(inventory: InventoryRecord[]): StockSection {
  const low = inventory
    .filter((item) => item.minStock > 0 && item.stock <= item.minStock)
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      stock: item.stock,
      minStock: item.minStock,
      unit: item.unit,
      outOfStock: item.stock <= 0,
    }))
    .sort((a, b) => {
      if (a.outOfStock !== b.outOfStock) return a.outOfStock ? -1 : 1;
      return a.stock - a.minStock - (b.stock - b.minStock);
    });

  return {
    low: low.slice(0, LIST_CAP),
    lowCount: low.length,
    outOfStockCount: low.filter((i) => i.outOfStock).length,
    noThresholdCount: inventory.filter((i) => i.minStock <= 0).length,
  };
}

export function buildNextUpSection(args: {
  ahead: BriefingAppointment[];
  key: "tomorrow" | "next_week";
  startDate: string;
  endDate: string;
  rostered: string[] | null;
}): NextUpSection {
  const { ahead, key, startDate, endDate, rostered } = args;

  const window = ahead
    .filter((a) => a.date >= startDate && a.date <= endDate && a.status !== "Cancelled")
    .sort((a, b) => (a.date === b.date ? parseApptTimeToMinutes(a.time) - parseApptTimeToMinutes(b.time) : a.date < b.date ? -1 : 1));

  const doctors = Array.from(new Set(window.map((a) => a.doctor).filter(Boolean))).sort();

  return {
    key,
    startDate,
    endDate,
    appointments: window.length,
    firstAppointmentTime: window.length > 0 ? window[0].time || null : null,
    doctors,
    unconfirmed: window.filter((a) => a.status === "Scheduled").length,
    staffRostered: rostered,
  };
}
