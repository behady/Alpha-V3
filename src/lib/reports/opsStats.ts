/**
 * The operations reports: the appointment book, the lab, the stockroom, and the roster.
 *
 * Pure functions over plain rows. Where the app already decides something — which statuses mean
 * "seen", which lab statuses mean "still out", how a payroll line is priced — that decision is
 * imported or copied verbatim rather than re-made here, so the report never disagrees with the
 * screen it summarises.
 */

import { normalizeAppointmentStatus } from "@/lib/appointmentStages";
import { parseApptTimeToMinutes } from "@/lib/appointmentTime";
import { clinicWeekday, daysBetween } from "@/lib/reports/periods";
import { ATTENDED, toYmd, type AppointmentDoc } from "@/lib/reports/patientStats";
import { heatmap, type HeatCell } from "@/lib/reports/ledgerStats";
import { statusFor, type LabCaseStatus } from "@/lib/labCases";
import { isBillable } from "@/lib/labAccounts";

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number) => Number(n.toFixed(2));

// --- appointments --------------------------------------------------------------------------------

export type Outcome = "seen" | "noShow" | "cancelled" | "open";

export function outcomeOf(a: AppointmentDoc, today: string): Outcome {
  const status = normalizeAppointmentStatus(String(a.status || ""));
  if (ATTENDED.has(status)) return "seen";
  if (status === "No Show") return "noShow";
  if (status === "Cancelled") return "cancelled";
  // Scheduled / Confirmed / Delayed / Rescheduled: still ahead, or a past booking nobody closed.
  return toYmd(a.date) < today ? "noShow" : "open";
}

export type OutcomeCounts = { seen: number; noShow: number; cancelled: number; open: number; total: number; noShowPct: number | null };

function emptyCounts(): OutcomeCounts {
  return { seen: 0, noShow: 0, cancelled: 0, open: 0, total: 0, noShowPct: null };
}

function finish(c: OutcomeCounts): OutcomeCounts {
  const decided = c.seen + c.noShow;
  return { ...c, total: c.seen + c.noShow + c.cancelled + c.open, noShowPct: decided ? Number(((c.noShow / decided) * 100).toFixed(1)) : null };
}

export type AppointmentSource = "desk" | "online" | "whatsapp_bot";

export function sourceOf(a: AppointmentDoc): AppointmentSource {
  const s = String(a.source || "").trim();
  return s === "online" || s === "whatsapp_bot" ? s : "desk";
}

export type AppointmentStats = {
  overall: OutcomeCounts;
  byWeekday: (OutcomeCounts & { weekday: number })[];
  byDentist: (OutcomeCounts & { doctor: string })[];
  bySource: (OutcomeCounts & { source: AppointmentSource })[];
  /** Minutes booked per working day (days with at least one booking), seen + open. */
  minutesPerDay: number | null;
  workingDays: number;
  /** Bookings the desk made ahead: average days between booking and appointment. */
  leadDays: number | null;
  /** Check-in to chair, in minutes, over appointments that recorded both. */
  waitMinutes: number | null;
  waitSample: number;
  /** Past bookings still marked Scheduled/Confirmed: nobody closed them. */
  unclosed: number;
  heat: HeatCell[];
};

function seatedAt(a: AppointmentDoc): Date | null {
  const history = Array.isArray(a.statusHistory) ? (a.statusHistory as { status?: unknown; timestamp?: unknown }[]) : [];
  const entry = history.find((h) => normalizeAppointmentStatus(String(h.status || "")) === "In Chair");
  const ts = entry?.timestamp;
  if (!ts) return null;
  if (typeof ts === "object" && ts !== null && "toDate" in ts) return (ts as { toDate: () => Date }).toDate();
  const d = new Date(ts as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "object" && v !== null && "toDate" in v) return (v as { toDate: () => Date }).toDate();
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function appointmentStats(appointments: readonly AppointmentDoc[], today: string, unassigned = "Unassigned"): AppointmentStats {
  const overall = emptyCounts();
  const byWeekday = Array.from({ length: 7 }, (_, weekday) => ({ ...emptyCounts(), weekday }));
  const byDentist = new Map<string, OutcomeCounts & { doctor: string }>();
  const bySource = new Map<AppointmentSource, OutcomeCounts & { source: AppointmentSource }>();
  const minutesByDay = new Map<string, number>();
  const leads: number[] = [];
  const waits: number[] = [];
  let unclosed = 0;

  for (const a of appointments) {
    const outcome = outcomeOf(a, today);
    const day = toYmd(a.date);
    const rawStatus = normalizeAppointmentStatus(String(a.status || ""));
    if (outcome === "noShow" && rawStatus !== "No Show") unclosed += 1;
    overall[outcome] += 1;
    if (day) byWeekday[clinicWeekday(day)][outcome] += 1;
    const doctor = String(a.doctorName || a.doctor || "").replace(/^Dr\.?\s*/i, "").trim() || unassigned;
    const d = byDentist.get(doctor) || { ...emptyCounts(), doctor };
    d[outcome] += 1;
    byDentist.set(doctor, d);
    const source = sourceOf(a);
    const s = bySource.get(source) || { ...emptyCounts(), source };
    s[outcome] += 1;
    bySource.set(source, s);
    if ((outcome === "seen" || outcome === "open") && day) {
      minutesByDay.set(day, (minutesByDay.get(day) || 0) + (num(a.duration) || 30));
    }
    const created = toYmd(a.createdAt);
    if (created && day && day >= created) leads.push(daysBetween(created, day));
    const checkIn = asDate(a.checkInTime);
    const seated = seatedAt(a);
    if (checkIn && seated && seated.getTime() >= checkIn.getTime()) {
      const mins = (seated.getTime() - checkIn.getTime()) / 60000;
      if (mins <= 6 * 60) waits.push(mins);
    }
  }

  const avg = (xs: number[]) => (xs.length ? Number((xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(1)) : null);
  const workingDays = minutesByDay.size;

  return {
    overall: finish(overall),
    byWeekday: byWeekday.map((c) => ({ ...finish(c), weekday: c.weekday })),
    byDentist: [...byDentist.values()].map((c) => ({ ...finish(c), doctor: c.doctor })).sort((x, y) => y.total - x.total),
    bySource: [...bySource.values()].map((c) => ({ ...finish(c), source: c.source })).sort((x, y) => y.total - x.total),
    minutesPerDay: workingDays ? Math.round([...minutesByDay.values()].reduce((s, v) => s + v, 0) / workingDays) : null,
    workingDays,
    leadDays: avg(leads),
    waitMinutes: avg(waits),
    waitSample: waits.length,
    unclosed,
    heat: heatmap(
      appointments.filter((a) => outcomeOf(a, today) !== "cancelled"),
      (a) => toYmd(a.date),
      (a) => (a.time ? parseApptTimeToMinutes(String(a.time)) / 60 : null),
      () => 1,
    ),
  };
}

// --- lab -----------------------------------------------------------------------------------------

export type LabCaseDoc = Record<string, unknown>;

export type LabLine = {
  labId: string;
  labName: string;
  sent: number;
  back: number;
  fitted: number;
  atLab: number;
  overdue: number;
  remakes: number;
  remakePct: number | null;
  /** Average days from sent to received, over cases with both dates. */
  turnaroundDays: number | null;
  /** Promised turnaround, from the lab directory, when known. */
  cost: number;
  paid: number;
};

export type LabStats = {
  total: number;
  byStatus: { status: string; count: number }[];
  overdue: number;
  atLab: number;
  remakes: number;
  remakePct: number | null;
  remakeFault: { fault: string; count: number }[];
  turnaroundDays: number | null;
  cost: number;
  byLab: LabLine[];
  byWorkType: { workType: string; count: number; cost: number; remakes: number }[];
  overdueCases: { code: string; labName: string; patientName: string; dueDate: string; daysLate: number; workType: string }[];
};

export function labStats(cases: readonly LabCaseDoc[], payments: readonly LabCaseDoc[], today: string): LabStats {
  const byStatus = new Map<string, number>();
  const byLab = new Map<string, LabLine & { turnarounds: number[] }>();
  const byWork = new Map<string, { workType: string; count: number; cost: number; remakes: number }>();
  const faults = new Map<string, number>();
  const turnarounds: number[] = [];
  const overdueCases: LabStats["overdueCases"] = [];
  let overdue = 0;
  let atLab = 0;
  let remakes = 0;
  let cost = 0;

  const lab = (c: LabCaseDoc) => {
    const labId = String(c.labId || "");
    const labName = String(c.labName || "").trim() || "—";
    const key = labId || labName;
    let l = byLab.get(key);
    if (!l) {
      l = { labId, labName, sent: 0, back: 0, fitted: 0, atLab: 0, overdue: 0, remakes: 0, remakePct: null, turnaroundDays: null, cost: 0, paid: 0, turnarounds: [] };
      byLab.set(key, l);
    }
    return l;
  };

  for (const c of cases) {
    const status = String(c.status || "draft");
    const meta = statusFor(status);
    byStatus.set(status, (byStatus.get(status) || 0) + 1);
    const l = lab(c);
    const price = num(c.agreedPrice);
    const isRemake = Boolean(c.remakeOfId);
    const workType = String(c.workType || "other");
    const w = byWork.get(workType) || { workType, count: 0, cost: 0, remakes: 0 };
    w.count += 1;
    if (isRemake) w.remakes += 1;
    byWork.set(workType, w);

    if (c.sentAt) l.sent += 1;
    if (isRemake) {
      remakes += 1;
      l.remakes += 1;
      const fault = String(c.remakeFault || "unknown");
      faults.set(fault, (faults.get(fault) || 0) + 1);
    }
    if (meta.atLab) {
      atLab += 1;
      l.atLab += 1;
      const due = toYmd(c.dueDate);
      if (due && due < today) {
        overdue += 1;
        l.overdue += 1;
        overdueCases.push({
          code: String(c.code || ""),
          labName: l.labName,
          patientName: String(c.patientName || "").trim(),
          dueDate: due,
          daysLate: daysBetween(due, today),
          workType,
        });
      }
    }
    if (status === "back" || status === "fitted" || c.receivedAt) l.back += 1;
    if (status === "fitted") l.fitted += 1;
    if (isBillable({ status: status as LabCaseStatus })) {
      cost += price;
      l.cost += price;
      w.cost += price;
    }
    const sent = toYmd(c.sentAt);
    const received = toYmd(c.receivedAt);
    if (sent && received && received >= sent) {
      const d = daysBetween(sent, received);
      turnarounds.push(d);
      l.turnarounds.push(d);
    }
  }
  for (const p of payments) {
    const key = String(p.labId || "") || String(p.labName || "").trim() || "—";
    const l = byLab.get(key) || lab({ labId: p.labId, labName: p.labName });
    l.paid += num(p.amount);
  }

  const avg = (xs: number[]) => (xs.length ? Number((xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(1)) : null);
  const sentTotal = cases.filter((c) => c.sentAt).length;

  return {
    total: cases.length,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
    overdue,
    atLab,
    remakes,
    remakePct: sentTotal ? Number(((remakes / sentTotal) * 100).toFixed(1)) : null,
    remakeFault: [...faults.entries()].map(([fault, count]) => ({ fault, count })).sort((a, b) => b.count - a.count),
    turnaroundDays: avg(turnarounds),
    cost: money(cost),
    byLab: [...byLab.values()]
      .map(({ turnarounds: t, ...l }) => ({ ...l, cost: money(l.cost), paid: money(l.paid), turnaroundDays: avg(t), remakePct: l.sent ? Number(((l.remakes / l.sent) * 100).toFixed(1)) : null }))
      .sort((a, b) => b.cost - a.cost),
    byWorkType: [...byWork.values()].map((w) => ({ ...w, cost: money(w.cost) })).sort((a, b) => b.count - a.count),
    overdueCases: overdueCases.sort((a, b) => b.daysLate - a.daysLate),
  };
}

// --- inventory -----------------------------------------------------------------------------------

export type InventoryItem = Record<string, unknown>;
export type InventoryTx = Record<string, unknown>;

export type InventoryLine = {
  itemId: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  costPerUnit: number;
  value: number;
  used: number;
  usedCost: number;
  added: number;
  below: boolean;
  /** Enough to get back to twice the threshold. */
  reorderQty: number;
};

export type InventoryStats = {
  stockValue: number;
  items: number;
  belowMin: number;
  usedCost: number;
  lines: InventoryLine[];
  byCategory: { category: string; value: number; usedCost: number; items: number; below: number }[];
  reorder: InventoryLine[];
};

function qtyOf(item: InventoryItem, raw: number): number {
  return item.isPercentage ? raw / 100 : raw;
}

export function inventoryStats(items: readonly InventoryItem[], transactions: readonly InventoryTx[]): InventoryStats {
  const used = new Map<string, { used: number; added: number }>();
  for (const t of transactions) {
    const id = String(t.itemId || "");
    if (!id) continue;
    const change = num(t.change);
    const u = used.get(id) || { used: 0, added: 0 };
    if (change < 0) u.used += -change;
    else u.added += change;
    used.set(id, u);
  }
  const lines: InventoryLine[] = items.map((it) => {
    const itemId = String(it.id || "");
    const stock = num(it.stock);
    const minStock = num(it.minStock);
    const costPerUnit = num(it.costPerUnit);
    const u = used.get(itemId) || { used: 0, added: 0 };
    const below = minStock > 0 && stock <= minStock;
    return {
      itemId,
      name: String(it.name || "").trim(),
      category: String(it.category || "").trim() || "General",
      unit: String(it.unit || "pcs"),
      stock,
      minStock,
      costPerUnit,
      value: money(qtyOf(it, stock) * costPerUnit),
      used: u.used,
      usedCost: money(qtyOf(it, u.used) * costPerUnit),
      added: u.added,
      below,
      reorderQty: below ? Math.max(0, Math.ceil(minStock * 2 - stock)) : 0,
    };
  });
  const cats = new Map<string, { category: string; value: number; usedCost: number; items: number; below: number }>();
  for (const l of lines) {
    const c = cats.get(l.category) || { category: l.category, value: 0, usedCost: 0, items: 0, below: 0 };
    c.value += l.value;
    c.usedCost += l.usedCost;
    c.items += 1;
    if (l.below) c.below += 1;
    cats.set(l.category, c);
  }
  return {
    stockValue: money(lines.reduce((s, l) => s + l.value, 0)),
    items: lines.length,
    belowMin: lines.filter((l) => l.below).length,
    usedCost: money(lines.reduce((s, l) => s + l.usedCost, 0)),
    lines: lines.sort((a, b) => b.usedCost - a.usedCost || b.value - a.value),
    byCategory: [...cats.values()].map((c) => ({ ...c, value: money(c.value), usedCost: money(c.usedCost) })).sort((a, b) => b.value - a.value),
    reorder: lines.filter((l) => l.below).sort((a, b) => a.stock / Math.max(1, a.minStock) - b.stock / Math.max(1, b.minStock)),
  };
}

// --- attendance & payroll ------------------------------------------------------------------------

/** One row of /api/payroll's `staff`, as far as this report reads it. */
export type PayrollRow = {
  staffId: string;
  name: string;
  role: string;
  hasSchedule: boolean;
  daysWorked: number;
  minutesWorked: number;
  lateMinutes: number;
  lateDays: number;
  absentDays: number;
  overtimeApprovedMinutes: number;
  overtimePendingMinutes: number;
  estimatedPay: number;
  flags?: string[];
};

export type StaffLine = PayrollRow & { hours: number; commission: number; total: number };

/**
 * Payroll and commission on one line per person. Payroll comes from the server (it owns the
 * schedule and the rates); commission comes from the ledger rows on screen, keyed by staff id.
 */
export function staffLines(payroll: readonly PayrollRow[], commission: ReadonlyMap<string, number>): StaffLine[] {
  return payroll
    .map((p) => {
      const c = money(commission.get(p.staffId) || 0);
      return { ...p, hours: Number((p.minutesWorked / 60).toFixed(1)), commission: c, total: money(num(p.estimatedPay) + c) };
    })
    .sort((a, b) => b.total - a.total);
}
