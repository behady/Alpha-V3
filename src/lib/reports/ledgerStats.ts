/**
 * The figures every money report is built from, computed one way.
 *
 * Seven report tabs each summed the ledger by hand and each disagreed a little — one counted
 * expenses by `cost || amount`, another by `amount`, one read commissions off procedures and
 * another off payments. The comparison reports cannot afford that: "up 12% on last month" is
 * only true if both months were added up by the same rule. So the rule lives here, once:
 *
 *   - **Income** is cash on payment and income rows (`ledgerCashValue`), never a procedure's
 *     mirrored `paid`.
 *   - **Charged** is the price of procedure rows — the work done, paid or not.
 *   - **Commissions** are read off payment rows, where the clinic stamps them when money moves.
 *     They are what the clinic OWES its dentists, not cash that left: the owner pays a dentist from
 *     the Team page, and that payout is an expense row ("Salary"). So commissions are reported but
 *     never subtracted here — subtracting them too would count the same money twice.
 *   - **Lab fees** are read off procedure rows.
 *   - **Expenses** are expense rows. **Net** is income − lab − expenses.
 *   - **Discounts** are `discountAmount` on procedure rows — what was given away.
 *
 * Pure functions over plain rows. No React, no database.
 */

import { ledgerCashValue } from "@/lib/reportHelpers";
import { attributeService, buildProcedureIndex, type AttributableRow } from "@/lib/serviceAttribution";
import { doctorLabel, rowDate, type ReportLedgerRow } from "@/lib/reportPatients";
import { clinicWeekday, monthKeyOf, type MonthKey } from "@/lib/reports/periods";

export type LedgerTotals = {
  income: number;
  charged: number;
  commissions: number;
  labFees: number;
  expenses: number;
  discounts: number;
  net: number;
  procedures: number;
  payments: number;
  /** Distinct patient ids seen on any row. */
  patients: number;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function emptyTotals(): LedgerTotals {
  return { income: 0, charged: 0, commissions: 0, labFees: 0, expenses: 0, discounts: 0, net: 0, procedures: 0, payments: 0, patients: 0 };
}

export function summarizeLedger(rows: readonly ReportLedgerRow[]): LedgerTotals {
  const t = emptyTotals();
  const patients = new Set<string>();
  for (const row of rows) {
    const type = String(row.type || "");
    const pid = String(row.patientId || "");
    if (pid) patients.add(pid);
    if (type === "procedure") {
      t.procedures += 1;
      t.charged += num(row.cost) || num(row.amount);
      t.labFees += num(row.labFee);
      t.discounts += num(row.discountAmount);
    } else if (type === "expense") {
      t.expenses += ledgerCashValue(row);
    } else if (type === "payment" || type === "income") {
      t.payments += 1;
      t.income += ledgerCashValue(row);
      t.commissions += num(row.doctorCommissionAmount);
    }
  }
  t.patients = patients.size;
  t.net = t.income - t.labFees - t.expenses;
  return round(t);
}

function round<T extends Record<string, number>>(t: T): T {
  const out = { ...t };
  for (const k of Object.keys(out) as (keyof T)[]) out[k] = Number((out[k] as number).toFixed(2)) as T[keyof T];
  return out;
}

/** A change between two figures. `pct` is null when there was nothing to grow from. */
export type Delta = { from: number; to: number; abs: number; pct: number | null };

export function delta(from: number, to: number): Delta {
  const abs = Number((to - from).toFixed(2));
  const pct = from === 0 ? (to === 0 ? 0 : null) : Number((((to - from) / Math.abs(from)) * 100).toFixed(1));
  return { from, to, abs, pct };
}

/** Rows whose date falls in a month, keyed by month. Months with no rows are present and empty. */
export function splitByMonth(rows: readonly ReportLedgerRow[], months: readonly MonthKey[]): Map<MonthKey, ReportLedgerRow[]> {
  const out = new Map<MonthKey, ReportLedgerRow[]>();
  months.forEach((m) => out.set(m, []));
  for (const row of rows) {
    const day = rowDate(row);
    if (!day) continue;
    const bucket = out.get(monthKeyOf(day));
    if (bucket) bucket.push(row);
  }
  return out;
}

export type MonthTotals = LedgerTotals & { month: MonthKey };

export function totalsByMonth(rows: readonly ReportLedgerRow[], months: readonly MonthKey[]): MonthTotals[] {
  const split = splitByMonth(rows, months);
  return months.map((month) => ({ month, ...summarizeLedger(split.get(month) || []) }));
}

// --- by service, for the comparison table ------------------------------------------------------

export type ServiceTotals = { key: string; name: string; count: number; income: number };

export function totalsByService(rows: readonly ReportLedgerRow[]): ServiceTotals[] {
  const index = buildProcedureIndex(rows.filter((r) => String(r.type) === "procedure") as AttributableRow[]);
  const map = new Map<string, ServiceTotals>();
  for (const row of rows) {
    const type = String(row.type || "");
    if (type === "expense") continue;
    const { key, name } = attributeService(row as AttributableRow, index);
    const s = map.get(key) || { key, name, count: 0, income: 0 };
    if (type === "procedure") s.count += 1;
    else s.income += ledgerCashValue(row);
    map.set(key, s);
  }
  return [...map.values()].map((s) => ({ ...s, income: Number(s.income.toFixed(2)) })).sort((a, b) => b.income - a.income);
}

export type ServiceCompare = ServiceTotals & { prevCount: number; prevIncome: number; incomeDelta: Delta; countDelta: Delta };

/**
 * Every service in either period, with what it did in each.
 *
 * Matched on the catalogue key first and on the NAME second: a service that gained its catalogue
 * id between the two periods (older rows carry only a label) would otherwise appear twice — once
 * as "gone" and once as "new" — which is the kind of lie a comparison exists to catch.
 */
export function compareServices(current: readonly ReportLedgerRow[], previous: readonly ReportLedgerRow[]): ServiceCompare[] {
  const now = totalsByService(current);
  const thenList = totalsByService(previous);
  const thenByKey = new Map(thenList.map((s) => [s.key, s]));
  const thenByName = new Map(thenList.map((s) => [s.name.trim().toLowerCase(), s]));
  const used = new Set<string>();
  const out: ServiceCompare[] = [];
  for (const s of now) {
    const p = thenByKey.get(s.key) || thenByName.get(s.name.trim().toLowerCase());
    if (p) used.add(p.key);
    out.push({ ...s, prevCount: p?.count || 0, prevIncome: p?.income || 0, incomeDelta: delta(p?.income || 0, s.income), countDelta: delta(p?.count || 0, s.count) });
  }
  for (const p of thenList) {
    if (used.has(p.key)) continue;
    out.push({ key: p.key, name: p.name, count: 0, income: 0, prevCount: p.count, prevIncome: p.income, incomeDelta: delta(p.income, 0), countDelta: delta(p.count, 0) });
  }
  return out.sort((a, b) => Math.abs(b.incomeDelta.abs) - Math.abs(a.incomeDelta.abs));
}

// --- by dentist, per month ---------------------------------------------------------------------

export type DentistTrend = { doctor: string; total: number; cases: number; byMonth: { month: MonthKey; income: number; cases: number; commission: number }[] };

export function dentistTrend(rows: readonly ReportLedgerRow[], months: readonly MonthKey[], unassigned = "Unassigned"): DentistTrend[] {
  const map = new Map<string, DentistTrend>();
  const ensure = (doctor: string) => {
    let d = map.get(doctor);
    if (!d) {
      d = { doctor, total: 0, cases: 0, byMonth: months.map((month) => ({ month, income: 0, cases: 0, commission: 0 })) };
      map.set(doctor, d);
    }
    return d;
  };
  const idx = new Map(months.map((m, i) => [m, i]));
  for (const row of rows) {
    const type = String(row.type || "");
    if (type === "expense") continue;
    const day = rowDate(row);
    const i = idx.get(monthKeyOf(day));
    if (i === undefined) continue;
    const d = ensure(doctorLabel(row, unassigned));
    if (type === "procedure") {
      d.byMonth[i].cases += 1;
      d.cases += 1;
    } else {
      const inc = ledgerCashValue(row);
      d.byMonth[i].income += inc;
      d.byMonth[i].commission += num(row.doctorCommissionAmount);
      d.total += inc;
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// --- when the money happens ---------------------------------------------------------------------

export type HeatCell = { weekday: number; hour: number; value: number; count: number };

/**
 * A 7 × 24 grid of money by clinic weekday (Saturday first) and hour.
 *
 * Ledger rows carry a date but no time, so `hourOf` is what tells a row which hour it belongs to;
 * the appointments report passes the appointment's time, the money report passes the payment's
 * `createdAt`. Rows the caller cannot place in an hour are counted in the weekday only (hour -1).
 */
export function heatmap<T>(rows: readonly T[], dateOf: (r: T) => string, hourOf: (r: T) => number | null, valueOf: (r: T) => number): HeatCell[] {
  const cells = new Map<string, HeatCell>();
  for (const row of rows) {
    const day = dateOf(row);
    if (!/^\d{4}-\d{2}-\d{2}/.test(day)) continue;
    const weekday = clinicWeekday(day.slice(0, 10));
    const h = hourOf(row);
    const hour = h === null || !Number.isFinite(h) ? -1 : Math.max(0, Math.min(23, Math.floor(h)));
    const key = `${weekday}:${hour}`;
    const cell = cells.get(key) || { weekday, hour, value: 0, count: 0 };
    cell.value += valueOf(row);
    cell.count += 1;
    cells.set(key, cell);
  }
  return [...cells.values()];
}

/** The hour of a Firestore timestamp, ms number or ISO string, in the browser's zone. */
export function hourOfTimestamp(v: unknown): number | null {
  if (!v) return null;
  let d: Date | null = null;
  if (typeof v === "object" && v !== null && "toDate" in v) d = (v as { toDate: () => Date }).toDate();
  else if (typeof v === "number") d = new Date(v);
  else if (typeof v === "string") d = new Date(v);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.getHours() + d.getMinutes() / 60;
}

// --- P&L -----------------------------------------------------------------------------------------

export const EXPENSE_CATEGORIES = ["General", "Supplies", "Rent", "Salary", "Lab"] as const;

export type PnlMonth = MonthTotals & {
  expensesByCategory: Record<string, number>;
  /** Net as a share of income, or null when there was no income. */
  marginPct: number | null;
};

export function pnlByMonth(rows: readonly ReportLedgerRow[], months: readonly MonthKey[]): PnlMonth[] {
  const split = splitByMonth(rows, months);
  return months.map((month) => {
    const bucket = split.get(month) || [];
    const totals = summarizeLedger(bucket);
    const expensesByCategory: Record<string, number> = {};
    for (const row of bucket) {
      if (String(row.type) !== "expense") continue;
      const cat = String(row.category || "").trim() || "General";
      expensesByCategory[cat] = Number(((expensesByCategory[cat] || 0) + ledgerCashValue(row)).toFixed(2));
    }
    return { month, ...totals, expensesByCategory, marginPct: totals.income > 0 ? Number(((totals.net / totals.income) * 100).toFixed(1)) : null };
  });
}

// --- expenses ------------------------------------------------------------------------------------

export type ExpenseLine = { id: string; date: string; category: string; description: string; amount: number; recurring: boolean; method: string };
export type ExpenseCategory = { category: string; total: number; count: number; recurring: number; share: number };

export function expenseLines(rows: readonly ReportLedgerRow[]): ExpenseLine[] {
  return rows
    .filter((r) => String(r.type) === "expense")
    .map((r) => ({
      id: String(r.id || ""),
      date: rowDate(r),
      category: String(r.category || "").trim() || "General",
      description: String(r.description || "").trim(),
      amount: ledgerCashValue(r),
      recurring: Boolean(r.isRecurring),
      method: String(r.method || "").trim() || "Cash",
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
}

export function expensesByCategory(lines: readonly ExpenseLine[]): ExpenseCategory[] {
  const map = new Map<string, ExpenseCategory>();
  let total = 0;
  for (const l of lines) {
    const c = map.get(l.category) || { category: l.category, total: 0, count: 0, recurring: 0, share: 0 };
    c.total += l.amount;
    c.count += 1;
    if (l.recurring) c.recurring += l.amount;
    total += l.amount;
    map.set(l.category, c);
  }
  return [...map.values()]
    .map((c) => ({ ...c, total: Number(c.total.toFixed(2)), share: total > 0 ? Number(((c.total / total) * 100).toFixed(1)) : 0 }))
    .sort((a, b) => b.total - a.total);
}

// --- discounts -----------------------------------------------------------------------------------

export type DiscountLine = {
  id: string;
  date: string;
  patientId: string;
  patientName: string;
  service: string;
  doctor: string;
  listPrice: number;
  price: number;
  discount: number;
  /** Share of the list price given away. */
  pct: number;
  reason: string;
};

export function discountLines(rows: readonly ReportLedgerRow[], unassigned = "Unassigned"): DiscountLine[] {
  const procedures = rows.filter((r) => String(r.type) === "procedure") as AttributableRow[];
  const index = buildProcedureIndex(procedures);
  return (procedures as ReportLedgerRow[])
    .filter((r) => num(r.discountAmount) > 0)
    .map((r) => {
      const price = num(r.cost) || num(r.amount);
      const discount = num(r.discountAmount);
      const listPrice = num(r.listPrice) || price + discount;
      return {
        id: String(r.id || ""),
        date: rowDate(r),
        patientId: String(r.patientId || ""),
        patientName: String(r.patientName || "").trim(),
        service: attributeService(r as AttributableRow, index).name,
        doctor: doctorLabel(r, unassigned),
        listPrice,
        price,
        discount,
        pct: listPrice > 0 ? Number(((discount / listPrice) * 100).toFixed(1)) : 0,
        reason: String(r.discountReason || "").trim(),
      };
    })
    .sort((a, b) => b.discount - a.discount);
}

export type GroupTotal = { name: string; total: number; count: number; share: number };

export function groupTotals<T>(lines: readonly T[], nameOf: (l: T) => string, amountOf: (l: T) => number): GroupTotal[] {
  const map = new Map<string, GroupTotal>();
  let total = 0;
  for (const l of lines) {
    const name = nameOf(l) || "—";
    const g = map.get(name) || { name, total: 0, count: 0, share: 0 };
    const amount = amountOf(l);
    g.total += amount;
    g.count += 1;
    total += amount;
    map.set(name, g);
  }
  return [...map.values()]
    .map((g) => ({ ...g, total: Number(g.total.toFixed(2)), share: total > 0 ? Number(((g.total / total) * 100).toFixed(1)) : 0 }))
    .sort((a, b) => b.total - a.total);
}

// --- payment methods -----------------------------------------------------------------------------

export type PaymentMethod = "Cash" | "Card" | "InstaPay" | "Insurance" | "Other";

/**
 * The stored `method` is free text and three screens spell it three ways — "Card" and "Visa" are
 * the same machine, "Instapay" and "InstaPay" the same app. Folded into five buckets so the
 * drawer can be reconciled against the bank.
 */
export function normalizeMethod(raw: unknown): PaymentMethod {
  const m = String(raw || "").trim().toLowerCase();
  if (!m || m === "cash" || m === "كاش" || m === "نقدي") return "Cash";
  if (m.includes("visa") || m.includes("card") || m.includes("master") || m.includes("pos") || m.includes("فيزا")) return "Card";
  if (m.includes("insta")) return "InstaPay";
  if (m.includes("insur") || m.includes("تأمين")) return "Insurance";
  return "Other";
}

export type MethodTotals = { method: PaymentMethod; total: number; count: number; share: number };
export type MethodDay = { date: string; total: number; byMethod: Record<PaymentMethod, number> };

export function paymentMethods(rows: readonly ReportLedgerRow[]): { totals: MethodTotals[]; byDay: MethodDay[] } {
  const totals = new Map<PaymentMethod, MethodTotals>();
  const days = new Map<string, MethodDay>();
  let grand = 0;
  for (const row of rows) {
    const type = String(row.type || "");
    if (type !== "payment" && type !== "income") continue;
    const amount = ledgerCashValue(row);
    if (!amount) continue;
    const method = normalizeMethod(row.method);
    const t = totals.get(method) || { method, total: 0, count: 0, share: 0 };
    t.total += amount;
    t.count += 1;
    totals.set(method, t);
    grand += amount;
    const date = rowDate(row);
    if (date) {
      const d = days.get(date) || { date, total: 0, byMethod: { Cash: 0, Card: 0, InstaPay: 0, Insurance: 0, Other: 0 } };
      d.total += amount;
      d.byMethod[method] += amount;
      days.set(date, d);
    }
  }
  return {
    totals: [...totals.values()]
      .map((t) => ({ ...t, total: Number(t.total.toFixed(2)), share: grand > 0 ? Number(((t.total / grand) * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.total - a.total),
    byDay: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
  };
}
