/**
 * The three finance questions an owner asks after "how much": where does the money come FROM,
 * where does it GO and how does that compare with the months before, and does more come in than
 * goes out each month.
 *
 * Built on the one-rule figures in ledgerStats — income is cash received, expenses are expense
 * rows, commissions come off payments, lab fees off treatments — so every number here agrees
 * with the Profit & Loss tab to the pound. Pure functions over plain rows; no React, no database.
 */

import { ledgerCashValue } from "@/lib/reportHelpers";
import { PRIVATE_PAYER_ID } from "@/lib/payers";
import { doctorLabel, type ReportLedgerRow } from "@/lib/reportPatients";
import { toYmd } from "@/lib/reports/patientStats";
import { delta, expenseLines, expensesByCategory, groupTotals, normalizeMethod, pnlByMonth, totalsByService, type Delta, type GroupTotal } from "@/lib/reports/ledgerStats";
import type { MonthKey } from "@/lib/reports/periods";

const round2 = (n: number) => Number(n.toFixed(2));
const text = (v: unknown) => (v == null ? "" : String(v)).trim();

// --- where the income comes from ---------------------------------------------------------------------

/** A slice of income, and what the same slice was worth the period before. */
export type SourceGroup = GroupTotal & { prev: number; delta: Delta };

export type IncomeSources = {
  total: number;
  prevTotal: number;
  /** By treatment, the Service tab's attribution. */
  services: SourceGroup[];
  /** By who did the work. A payment without a dentist borrows the treatment's. */
  dentists: SourceGroup[];
  /** By who pays: the insurer or company, or the patient. */
  payers: SourceGroup[];
  /** Cash, card, InstaPay — the Payment Methods tab's five buckets. */
  methods: SourceGroup[];
  /** Where the patient heard about the clinic — the Sources tab's rule. */
  channels: SourceGroup[];
  /** Files opened inside the period against everyone else. */
  newness: SourceGroup[];
};

export type PatientLite = { id: string; referral?: unknown; source?: unknown; createdAt?: unknown };

export type IncomeLabels = {
  unassigned: string;
  privatePayer: string;
  unknownChannel: string;
  newPatient: string;
  returning: string;
  /** Income rows with no patient on them — a sold item, a rent-out, a refund reversed. */
  noPatient: string;
};

export const INCOME_LABELS_EN: IncomeLabels = { unassigned: "Unassigned", privatePayer: "Private (patient pays)", unknownChannel: "Unknown / Walk-in", newPatient: "New patients", returning: "Returning patients", noPatient: "Other income" };
export const INCOME_LABELS_AR: IncomeLabels = { unassigned: "غير محدد", privatePayer: "خاص (المريض بيدفع)", unknownChannel: "غير معروف / مرور", newPatient: "مرضى جدد", returning: "مرضى راجعين", noPatient: "دخل آخر" };

const isCash = (r: ReportLedgerRow) => { const t = text(r.type); return t === "payment" || t === "income"; };

function slices(rows: readonly ReportLedgerRow[], patients: ReadonlyMap<string, PatientLite>, range: { start: string; end: string }, labels: IncomeLabels) {
  const cash = rows.filter(isCash);
  const procs = new Map<string, ReportLedgerRow>();
  for (const r of rows) if (text(r.type) === "procedure" && text(r.id)) procs.set(text(r.id), r);
  const treatmentOf = (r: ReportLedgerRow) => procs.get(text(r.procedureId));
  const dentist = (r: ReportLedgerRow) => doctorLabel(r, "") || (treatmentOf(r) ? doctorLabel(treatmentOf(r)!, "") : "") || labels.unassigned;
  const payer = (r: ReportLedgerRow) => {
    const t = treatmentOf(r);
    const id = text(r.payerId) || text(t?.payerId);
    if (!id || id === PRIVATE_PAYER_ID) return labels.privatePayer;
    return text(r.payerName) || text(t?.payerName) || id;
  };
  const channel = (r: ReportLedgerRow) => {
    const p = patients.get(text(r.patientId));
    return text(p?.referral) || text(p?.source) || text(r.referral) || labels.unknownChannel;
  };
  const newness = (r: ReportLedgerRow) => {
    const pid = text(r.patientId);
    if (!pid) return labels.noPatient;
    const created = toYmd(patients.get(pid)?.createdAt);
    return created && created >= range.start && created <= range.end ? labels.newPatient : labels.returning;
  };
  const cashOf = (r: ReportLedgerRow) => ledgerCashValue(r);
  return {
    total: round2(cash.reduce((s, r) => s + cashOf(r), 0)),
    services: totalsByService(rows).filter((s) => s.income > 0).map((s) => ({ name: s.name, total: s.income, count: s.count, share: 0 })),
    dentists: groupTotals(cash, dentist, cashOf),
    payers: groupTotals(cash, payer, cashOf),
    methods: groupTotals(cash, (r) => normalizeMethod(r.method), cashOf),
    channels: groupTotals(cash, channel, cashOf),
    newness: groupTotals(cash, newness, cashOf),
  };
}

/** Both periods' slices side by side; a source that vanished still appears, at zero, so its loss is visible. */
function withPrev(now: GroupTotal[], then: GroupTotal[], total: number): SourceGroup[] {
  const before = new Map(then.map((g) => [g.name, g.total]));
  const seen = new Set<string>();
  const out: SourceGroup[] = now.map((g) => {
    seen.add(g.name);
    const prev = before.get(g.name) || 0;
    return { ...g, share: total > 0 ? Number(((g.total / total) * 100).toFixed(1)) : 0, prev, delta: delta(prev, g.total) };
  });
  for (const g of then) if (!seen.has(g.name) && g.total > 0) out.push({ name: g.name, total: 0, count: 0, share: 0, prev: g.total, delta: delta(g.total, 0) });
  return out.sort((a, b) => b.total - a.total || b.prev - a.prev);
}

export function incomeSources(
  rows: readonly ReportLedgerRow[],
  previous: readonly ReportLedgerRow[],
  patients: readonly PatientLite[],
  range: { start: string; end: string },
  prevRange: { start: string; end: string },
  labels: IncomeLabels = INCOME_LABELS_EN,
): IncomeSources {
  const map = new Map(patients.map((p) => [p.id, p]));
  const now = slices(rows, map, range, labels);
  const then = slices(previous, map, prevRange, labels);
  return {
    total: now.total,
    prevTotal: then.total,
    services: withPrev(now.services, then.services, now.total),
    dentists: withPrev(now.dentists, then.dentists, now.total),
    payers: withPrev(now.payers, then.payers, now.total),
    methods: withPrev(now.methods, then.methods, now.total),
    channels: withPrev(now.channels, then.channels, now.total),
    newness: withPrev(now.newness, then.newness, now.total),
  };
}

// --- where the expenses go, month against month --------------------------------------------------------

export type ExpenseCategoryTrend = {
  category: string;
  /** One figure per month asked for, in order. */
  byMonth: number[];
  total: number;
  /** Per month that had any activity, so a clinic three months old is not averaged over twelve. */
  average: number;
  /** The last month asked for, and the month before it. */
  last: number;
  before: number;
  delta: Delta;
  share: number;
};

export type ExpenseMatrix = {
  months: MonthKey[];
  categories: ExpenseCategoryTrend[];
  /** Every category, per month. */
  totals: number[];
  /** Expenses as a share of that month's income; null when nothing came in. */
  incomeShare: (number | null)[];
  total: number;
  average: number;
  activeMonths: number;
  peak: { month: MonthKey; value: number } | null;
};

export function expenseMatrix(rows: readonly ReportLedgerRow[], months: readonly MonthKey[]): ExpenseMatrix {
  const per = pnlByMonth(rows, months);
  const names = new Set<string>();
  per.forEach((m) => Object.keys(m.expensesByCategory).forEach((k) => names.add(k)));
  const activeMonths = Math.max(1, per.filter((m) => m.income > 0 || m.expenses > 0 || m.procedures > 0).length);
  const totals = per.map((m) => m.expenses);
  const total = round2(totals.reduce((s, v) => s + v, 0));
  const n = months.length;
  const categories = [...names]
    .map((category) => {
      const byMonth = per.map((m) => round2(m.expensesByCategory[category] || 0));
      const catTotal = round2(byMonth.reduce((s, v) => s + v, 0));
      const last = n ? byMonth[n - 1] : 0;
      const before = n > 1 ? byMonth[n - 2] : 0;
      return { category, byMonth, total: catTotal, average: round2(catTotal / activeMonths), last, before, delta: delta(before, last), share: total > 0 ? Number(((catTotal / total) * 100).toFixed(1)) : 0 };
    })
    .sort((a, b) => b.total - a.total);
  const peakIdx = totals.reduce((best, v, i) => (v > totals[best] ? i : best), 0);
  return {
    months: [...months],
    categories,
    totals,
    incomeShare: per.map((m) => (m.income > 0 ? Number(((m.expenses / m.income) * 100).toFixed(1)) : null)),
    total,
    average: round2(total / activeMonths),
    activeMonths,
    peak: n && totals[peakIdx] > 0 ? { month: months[peakIdx], value: totals[peakIdx] } : null,
  };
}

export type ExpenseCategoryCompare = { category: string; then: number; now: number; delta: Delta; share: number };

/** This period's expenses against another period's, category by category, largest move first. */
export function compareExpenseCategories(current: readonly ReportLedgerRow[], other: readonly ReportLedgerRow[]): ExpenseCategoryCompare[] {
  const now = expensesByCategory(expenseLines(current));
  const then = new Map(expensesByCategory(expenseLines(other)).map((c) => [c.category, c.total]));
  const seen = new Set<string>();
  const out: ExpenseCategoryCompare[] = now.map((c) => {
    seen.add(c.category);
    const before = then.get(c.category) || 0;
    return { category: c.category, then: before, now: c.total, delta: delta(before, c.total), share: c.share };
  });
  for (const [category, before] of then) if (!seen.has(category)) out.push({ category, then: before, now: 0, delta: delta(before, 0), share: 0 });
  return out.sort((a, b) => Math.abs(b.delta.abs) - Math.abs(a.delta.abs));
}

// --- does more come in than goes out -------------------------------------------------------------------

export type CashflowMonth = {
  month: MonthKey;
  inflow: number;
  expenses: number;
  lab: number;
  commissions: number;
  outflow: number;
  net: number;
  /** Net, accumulated from the first month asked for. */
  running: number;
};

export type Cashflow = {
  months: CashflowMonth[];
  inflow: number;
  outflow: number;
  net: number;
  /** Over months with any activity. */
  averageNet: number;
  monthsInRed: number;
  best: CashflowMonth | null;
  worst: CashflowMonth | null;
};

export function cashflow(rows: readonly ReportLedgerRow[], months: readonly MonthKey[]): Cashflow {
  const per = pnlByMonth(rows, months);
  let running = 0;
  const out: CashflowMonth[] = per.map((m) => {
    // Commission is owed, not paid out, until the owner pays the dentist — and that payout is an
    // expense row already inside `m.expenses`.
    const outflow = round2(m.expenses + m.labFees);
    const net = round2(m.income - outflow);
    running = round2(running + net);
    return { month: m.month, inflow: m.income, expenses: m.expenses, lab: m.labFees, commissions: m.commissions, outflow, net, running };
  });
  const active = out.filter((m, i) => m.inflow > 0 || m.outflow > 0 || per[i].procedures > 0);
  const net = round2(out.reduce((s, m) => s + m.net, 0));
  return {
    months: out,
    inflow: round2(out.reduce((s, m) => s + m.inflow, 0)),
    outflow: round2(out.reduce((s, m) => s + m.outflow, 0)),
    net,
    averageNet: active.length ? round2(net / active.length) : 0,
    monthsInRed: active.filter((m) => m.net < 0).length,
    best: active.length ? active.reduce((a, b) => (b.net > a.net ? b : a)) : null,
    worst: active.length > 1 ? active.reduce((a, b) => (b.net < a.net ? b : a)) : null,
  };
}
