/**
 * The desk's daily sheet: one line per patient per day — who they are, whose file it is (the
 * clinic's own or an insurance company's), how they paid, what the day came to, what they paid and
 * what is left. The clinic kept this by hand in Excel; the Finance page's "Daily sheet" tab draws it
 * from the ledger and exports it in the same shape.
 *
 * A line's figures are the PATIENT's alone:
 * - Total is the treatments charged to them that day: the whole price on an ordinary treatment, the
 *   patient's share on an approval treatment (the insurer's approved part is the insurer's bill,
 *   collected on the insurer's tab). When they paid more than that day's treatments, the extra was
 *   an earlier balance being settled, and the line's total is what they paid.
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
  total: number;
  paid: number;
  remaining: number;
};

export type SheetTotals = {
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

/** What the patient is charged on one treatment row. */
export function patientCharge(row: SheetLedgerRow): number {
  const cost = num(row.cost) || num(row.amount);
  if (!isApprovalRow(row)) return Math.max(0, cost);
  return Math.max(0, cost - Math.min(cost, Math.max(0, num(row.insurerCovered))));
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
      acc = { date, patientId, patientName, payerIds: [], payerNames: [], methods: [], total: 0, paid: 0, charged: 0, first: millis(row.createdAt) };
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

    if (charge) acc.charged += patientCharge(row);
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
    return { n: i + 1, date, patientId, patientName, payerIds, payerNames, methods, total, paid, remaining: round2(Math.max(0, total - paid)) };
  });

  const totals: SheetTotals = {
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
  if (k === "bank transfer") return isAr ? "تحويل" : "Transfer";
  if (k === "wallet" || k === "vodafone cash") return isAr ? "محفظة" : "Wallet";
  return method.trim() || (isAr ? "أخرى" : "Other");
}

/** "07/10/2026" from "2026-10-07"; anything else as it came. */
export function sheetDay(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}
