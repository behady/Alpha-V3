/**
 * Who owes the clinic money, and for how long.
 *
 * Built off the WHOLE ledger, not the period on screen: a balance from March is still a balance
 * in September, and a report that only saw September's rows would call it paid. The rule is the
 * same one the Collect Dues screen uses — a patient's balance is everything charged to them minus
 * everything they have paid, advances included — so the two screens never disagree about what a
 * person owes.
 *
 * Ageing is by the OLDEST unpaid treatment: payments are applied to a patient's treatments oldest
 * first, and the first one not fully covered is the one the balance has been waiting on. That is
 * what "60 days overdue" means to a desk that is about to pick up the phone.
 *
 * Pure. Money math nobody can test is money math nobody should repeat down a phone line.
 */

import { ledgerCashValue } from "@/lib/reportHelpers";
import { rowDate, type ReportLedgerRow, type ReportPatient } from "@/lib/reportPatients";
import { daysBetween } from "@/lib/reports/periods";
import { payerOf, PRIVATE_PAYER_ID } from "@/lib/payers";

export type AgeBucket = "0-30" | "31-60" | "61-90" | "90+";
export const AGE_BUCKETS: AgeBucket[] = ["0-30", "31-60", "61-90", "90+"];

export type ReceivableLine = {
  patientId: string;
  patientName: string;
  phone: string;
  whatsappOptOut: boolean;
  charged: number;
  paid: number;
  balance: number;
  /** Date of the oldest treatment the payments did not cover. */
  oldestUnpaid: string;
  lastActivity: string;
  ageDays: number;
  bucket: AgeBucket;
  /** Payers seen on this patient's unpaid work, for the insurance conversation. */
  payers: string[];
};

export type AgingTotal = { bucket: AgeBucket; total: number; count: number };

export type PayerReceivable = {
  payerId: string;
  payerName: string;
  charged: number;
  collected: number;
  balance: number;
  patients: number;
  isPrivate: boolean;
};

export type Receivables = {
  lines: ReceivableLine[];
  aging: AgingTotal[];
  byPayer: PayerReceivable[];
  totals: { balance: number; patients: number; credits: number; creditPatients: number };
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number) => Number(n.toFixed(2));

export function bucketFor(ageDays: number): AgeBucket {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

type PatientLite = ReportPatient & { whatsappOptOut?: unknown };

export function receivables(
  ledger: readonly ReportLedgerRow[],
  patients: readonly PatientLite[],
  today: string,
): Receivables {
  const files = new Map(patients.map((p) => [p.id, p]));

  type Acc = {
    name: string;
    charged: number;
    paid: number;
    lastActivity: string;
    procedures: { date: string; price: number; payer: string }[];
  };
  const acc = new Map<string, Acc>();
  const byPayer = new Map<string, PayerReceivable & { patientIds: Set<string> }>();

  const payerRow = (row: ReportLedgerRow) => {
    const { payerId, payerName } = payerOf(row as { payerId?: unknown; payerName?: unknown });
    let p = byPayer.get(payerId);
    if (!p) {
      p = { payerId, payerName, charged: 0, collected: 0, balance: 0, patients: 0, isPrivate: payerId === PRIVATE_PAYER_ID, patientIds: new Set() };
      byPayer.set(payerId, p);
    }
    return p;
  };

  for (const row of ledger) {
    const type = String(row.type || "");
    if (type === "expense" || type === "income") continue;
    const pid = String(row.patientId || "").trim();
    if (!pid) continue;
    let a = acc.get(pid);
    if (!a) {
      a = { name: String(row.patientName || "").trim(), charged: 0, paid: 0, lastActivity: "", procedures: [] };
      acc.set(pid, a);
    }
    if (!a.name) a.name = String(row.patientName || "").trim();
    const date = rowDate(row);
    if (date > a.lastActivity) a.lastActivity = date;
    const payer = payerRow(row);
    payer.patientIds.add(pid);
    if (type === "procedure") {
      const price = num(row.cost) || num(row.amount);
      a.charged += price;
      a.procedures.push({ date, price, payer: payer.payerName });
      payer.charged += price;
    } else if (type === "payment") {
      const cash = ledgerCashValue(row);
      a.paid += cash;
      payer.collected += cash;
    }
  }

  const lines: ReceivableLine[] = [];
  let credits = 0;
  let creditPatients = 0;

  for (const [patientId, a] of acc) {
    const balance = money(a.charged - a.paid);
    if (balance <= 0.005) {
      if (balance < -0.005) {
        credits += -balance;
        creditPatients += 1;
      }
      continue;
    }
    // Oldest-first: walk the treatments, spending the payments as we go.
    let remaining = a.paid;
    let oldestUnpaid = "";
    const payers = new Set<string>();
    for (const proc of [...a.procedures].sort((x, y) => x.date.localeCompare(y.date))) {
      if (remaining >= proc.price - 0.005) {
        remaining -= proc.price;
        continue;
      }
      remaining = 0;
      if (!oldestUnpaid) oldestUnpaid = proc.date;
      payers.add(proc.payer);
    }
    if (!oldestUnpaid) oldestUnpaid = a.lastActivity;
    const ageDays = oldestUnpaid ? Math.max(0, daysBetween(oldestUnpaid, today)) : 0;
    const file = files.get(patientId);
    lines.push({
      patientId,
      patientName: String(file?.name || a.name || "").trim(),
      phone: String(file?.phone || "").trim(),
      whatsappOptOut: Boolean(file?.whatsappOptOut),
      charged: money(a.charged),
      paid: money(a.paid),
      balance,
      oldestUnpaid,
      lastActivity: a.lastActivity,
      ageDays,
      bucket: bucketFor(ageDays),
      payers: [...payers],
    });
  }

  lines.sort((x, y) => y.balance - x.balance || y.ageDays - x.ageDays);

  const aging = AGE_BUCKETS.map((bucket) => {
    const in_ = lines.filter((l) => l.bucket === bucket);
    return { bucket, total: money(in_.reduce((s, l) => s + l.balance, 0)), count: in_.length };
  });

  const payerRows = [...byPayer.values()]
    .map(({ patientIds, ...p }) => ({
      ...p,
      charged: money(p.charged),
      collected: money(p.collected),
      balance: money(Math.max(0, p.charged - p.collected)),
      patients: patientIds.size,
    }))
    .sort((x, y) => y.balance - x.balance);

  return {
    lines,
    aging,
    byPayer: payerRows,
    totals: {
      balance: money(lines.reduce((s, l) => s + l.balance, 0)),
      patients: lines.length,
      credits: money(credits),
      creditPatients,
    },
  };
}
