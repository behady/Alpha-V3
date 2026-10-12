/**
 * The desk's daily sheet: one line per patient per day — who they are, whose file it is (the
 * clinic's own or an insurance company's), how they paid, what the day came to, what they paid and
 * what is left. The clinic kept this by hand in Excel; the Finance page's "Daily sheet" tab draws it
 * from the ledger and exports it in the same shape.
 *
 * A line carries the day's work and who answers for it:
 * - Work is the full price of the day's treatments, whoever pays.
 * - Company is the part an insurance or contract company answers for: the approved part on an
 *   approval treatment; on a contract company's treatment with no approval (GASCO), the whole price
 *   less what the patient paid on it — the same split the company's Finance tab collects.
 * - Total is the PATIENT's part: the whole price on a private treatment, the share outside the
 *   approval on an approval treatment, nothing on a contract company's. When they paid more than
 *   that, the extra was an earlier balance being settled, and the line's total is what they paid.
 *   (The owner confirmed 2026-10-12: a GASCO patient owes nothing; GASCO does.)
 * - Paid is their payments that day. The insurer's own payments (method "Insurance") are not the
 *   patient's money and are left out.
 * - Remaining is total − paid, never below zero.
 *
 * Pure: the page passes the period's rows (charges and cash, already narrowed to the branch on
 * screen), the test passes fixtures.
 */

import { INSURER_PAYMENT_METHOD, isApprovalRow } from "@/lib/ledgerInsurer";
import { PRIVATE_PAYER_ID } from "@/lib/payers";
import { normalizeMethod } from "@/lib/reports/ledgerStats";

export type SheetLedgerRow = {
  id: string;
  type?: unknown;
  date?: unknown;
  patientId?: unknown;
  patientName?: unknown;
  payerId?: unknown;
  payerName?: unknown;
  claimId?: unknown;
  procedureId?: unknown;
  cost?: unknown;
  amount?: unknown;
  paid?: unknown;
  insurerCovered?: unknown;
  method?: unknown;
  status?: unknown;
  createdAt?: unknown;
};

export type SheetLine = {
  /** 1-based, in the order the patients came. */
  n: number;
  date: string;
  patientId: string;
  patientName: string;
  /** Insurance companies behind the day's work (ids); empty = the clinic's own file. */
  payerIds: string[];
  /** The names stored on the rows, for a company no longer on the clinic's list. */
  payerNames: string[];
  /** Payment methods, spellings folded ("Card"/"Visa", "Instapay"/"InstaPay"), in the order first used. */
  methods: string[];
  /** The full price of the day's treatments. */
  work: number;
  /** The part an insurance or contract company answers for. */
  company: number;
  total: number;
  paid: number;
  remaining: number;
};

export type SheetTotals = {
  work: number;
  company: number;
  total: number;
  paid: number;
  remaining: number;
  /** Paid, by method (folded as on the line), in the order first seen. */
  byMethod: { method: string; paid: number }[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function millis(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    if ("toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
    if ("seconds" in v) return num((v as { seconds: unknown }).seconds) * 1000;
  }
  return Number.POSITIVE_INFINITY;
}

const treatmentCost = (row: SheetLedgerRow) => Math.max(0, num(row.cost) || num(row.amount));

/** A treatment billed to an insurance or contract company rather than to the patient. */
const companyPays = (row: SheetLedgerRow) => {
  const payerId = text(row.payerId);
  return payerId !== "" && payerId !== PRIVATE_PAYER_ID;
};

/** What the patient is charged on one treatment row. */
export function patientCharge(row: SheetLedgerRow): number {
  const cost = treatmentCost(row);
  if (isApprovalRow(row)) return Math.max(0, cost - Math.min(cost, Math.max(0, num(row.insurerCovered))));
  return companyPays(row) ? 0 : cost;
}

/**
 * The company's part of one treatment row. `patientPaidOnRow` is what the patient paid against
 * this treatment; on a contract company's treatment that comes off the company's bill.
 */
export function companyCharge(row: SheetLedgerRow, patientPaidOnRow = 0): number {
  const cost = treatmentCost(row);
  if (isApprovalRow(row)) return Math.min(cost, Math.max(0, num(row.insurerCovered)));
  return companyPays(row) ? Math.max(0, cost - patientPaidOnRow) : 0;
}

/** A payment row's value, read as the Finance page's cash list reads it: `paid`, else `amount`. */
const paymentValue = (row: SheetLedgerRow) => num(row.paid ?? row.amount);

/** One name per way of paying: the Reports buckets, and anything else as written. */
function methodOf(raw: unknown): string {
  const folded = normalizeMethod(raw);
  return folded === "Other" ? text(raw) || "Other" : folded;
}

const isPatientPayment = (row: SheetLedgerRow) =>
  String(row.type || "") === "payment" && text(row.method) !== INSURER_PAYMENT_METHOD && paymentValue(row) > 0;

const isLiveCharge = (row: SheetLedgerRow) =>
  String(row.type || "") === "procedure" && !["deleted", "cancelled"].includes(String(row.status || "").toLowerCase());

export function dailySheet(rows: readonly SheetLedgerRow[]): { lines: SheetLine[]; totals: SheetTotals } {
  type Acc = Omit<SheetLine, "n" | "remaining"> & { first: number; charged: number };
  const byKey = new Map<string, Acc>();
  const methodTotals = new Map<string, number>();

  // The patient's own payments against each treatment: they come off a contract company's bill.
  const paidOnRow = new Map<string, number>();
  for (const row of rows) {
    if (!isPatientPayment(row)) continue;
    const target = text(row.procedureId);
    if (target) paidOnRow.set(target, (paidOnRow.get(target) ?? 0) + paymentValue(row));
  }

  for (const row of rows) {
    const charge = isLiveCharge(row);
    const payment = isPatientPayment(row);
    if (!charge && !payment) continue;
    const date = text(row.date);
    const patientId = text(row.patientId);
    const patientName = text(row.patientName);
    if (!date || (!patientId && !patientName)) continue;
    const key = `${date}|${patientId || `name:${patientName}`}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = { date, patientId, patientName, payerIds: [], payerNames: [], methods: [], work: 0, company: 0, total: 0, paid: 0, charged: 0, first: millis(row.createdAt) };
      byKey.set(key, acc);
    }
    if (!acc.patientName && patientName) acc.patientName = patientName;
    acc.first = Math.min(acc.first, millis(row.createdAt));

    const payerId = text(row.payerId);
    if (payerId && payerId !== PRIVATE_PAYER_ID && !acc.payerIds.includes(payerId)) {
      acc.payerIds.push(payerId);
      const name = text(row.payerName);
      if (name && !acc.payerNames.includes(name)) acc.payerNames.push(name);
    }

    if (charge) {
      acc.charged += patientCharge(row);
      acc.work += treatmentCost(row);
      acc.company += companyCharge(row, paidOnRow.get(row.id) ?? 0);
    }
    if (payment) {
      const value = paymentValue(row);
      acc.paid += value;
      const method = methodOf(row.method);
      if (!acc.methods.includes(method)) acc.methods.push(method);
      methodTotals.set(method, (methodTotals.get(method) ?? 0) + value);
    }
  }

  const ordered = [...byKey.values()].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.first - b.first));
  const lines: SheetLine[] = ordered.map((acc, i) => {
    const paid = round2(acc.paid);
    const total = round2(Math.max(acc.charged, paid));
    const { date, patientId, patientName, payerIds, payerNames, methods } = acc;
    return {
      n: i + 1, date, patientId, patientName, payerIds, payerNames, methods,
      work: round2(acc.work), company: round2(acc.company), total, paid, remaining: round2(Math.max(0, total - paid)),
    };
  });

  const totals: SheetTotals = {
    work: round2(lines.reduce((t, l) => t + l.work, 0)),
    company: round2(lines.reduce((t, l) => t + l.company, 0)),
    total: round2(lines.reduce((t, l) => t + l.total, 0)),
    paid: round2(lines.reduce((t, l) => t + l.paid, 0)),
    remaining: round2(lines.reduce((t, l) => t + l.remaining, 0)),
    byMethod: [...methodTotals].map(([method, paid]) => ({ method, paid: round2(paid) })),
  };
  return { lines, totals };
}

/** A payment method in plain words. (The clinic's paper says "VC" and "Insta"; on screen "VC" was not understood.) */
export function sheetMethodLabel(method: string, isAr = false): string {
  const k = method.trim().toLowerCase();
  if (k === "cash") return isAr ? "كاش" : "Cash";
  if (k === "instapay") return isAr ? "انستاباي" : "InstaPay";
  if (k === "card") return isAr ? "فيزا" : "Visa";
  if (k === "insurance") return isAr ? "تأمين" : "Insurance";
  if (k === "bank transfer") return isAr ? "تحويل" : "Transfer";
  if (k === "wallet" || k === "vodafone cash") return isAr ? "محفظة" : "Wallet";
  return method.trim() || (isAr ? "أخرى" : "Other");
}

/**
 * A payment row's stored method in plain words, spellings folded ("Visa" is the card machine,
 * "Instapay"/"InstaPay" one app); anything else as written. Empty when nothing was recorded.
 */
export function paymentMethodLabel(raw: unknown, isAr = false): string {
  const t = text(raw);
  return t ? sheetMethodLabel(methodOf(t), isAr) : "";
}

/** "07/10/2026" from "2026-10-07"; anything else as it came. */
export function sheetDay(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}
