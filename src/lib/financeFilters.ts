/**
 * The Finance page filter. Every field that is set must hold (AND); the empty filter keeps every
 * row. Filtering is in memory, after the rows are loaded.
 */

import { PRIVATE_PAYER_ID } from "@/lib/payers";
import { ledgerCashValue } from "@/lib/reportHelpers";
import type { LedgerLite } from "@/lib/insurerLedger";

export type FinanceFilter = {
  kind: "all" | "payment" | "income" | "expense";
  method: string | "all";
  /** A payer's id; `PRIVATE_PAYER_ID` also takes treatment and payment rows that name no payer. */
  payerId: string | "all";
  doctorId: string | "all";
  patientQuery: string;
  category: string | "all";
  receivedBy: string | "all";
  receiptQuery: string;
  amountMin: number | null;
  amountMax: number | null;
  onlyOutstanding: boolean;
};

export const EMPTY_FINANCE_FILTER: FinanceFilter = {
  kind: "all",
  method: "all",
  payerId: "all",
  doctorId: "all",
  patientQuery: "",
  category: "all",
  receivedBy: "all",
  receiptQuery: "",
  amountMin: null,
  amountMax: null,
  onlyOutstanding: false,
};

const DIACRITICS = /[ً-ٰٟـ]/g;

/** One spelling for comparing a typed name: lower case, no marks, أ/إ/آ as ا, ة as ه, ى as ي. */
function fold(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function rowPayer(row: Record<string, unknown>): string {
  const id = text(row.payerId);
  if (id) return id;
  // Work recorded before payers existed, and payments on account, are the clinic's own.
  const type = String(row.type || "");
  return type === "procedure" || type === "payment" ? PRIVATE_PAYER_ID : "";
}

export function applyFinanceFilters<T extends LedgerLite & Record<string, unknown>>(rows: readonly T[], f: FinanceFilter): T[] {
  const patient = fold(f.patientQuery);
  const receipt = f.receiptQuery.trim().toLowerCase();
  return rows.filter((row) => {
    const type = String(row.type || "");
    if (f.kind !== "all" && type !== f.kind) return false;
    if (f.method !== "all" && text(row.method) !== f.method) return false;
    if (f.payerId !== "all" && rowPayer(row) !== f.payerId) return false;
    if (f.doctorId !== "all" && text(row.doctorId) !== f.doctorId) return false;
    if (f.category !== "all" && text(row.category) !== f.category) return false;
    if (f.receivedBy !== "all" && text(row.receivedBy) !== f.receivedBy) return false;
    if (patient && !fold(row.patientName).includes(patient) && !fold(row.patientPhone).includes(patient)) return false;
    if (receipt && !text(row.receiptNumber).toLowerCase().includes(receipt)) return false;
    if (f.amountMin !== null || f.amountMax !== null) {
      const value = ledgerCashValue(row);
      if (f.amountMin !== null && value < f.amountMin) return false;
      if (f.amountMax !== null && value > f.amountMax) return false;
    }
    if (f.onlyOutstanding) {
      if (type !== "procedure") return false;
      const cost = Number(row.cost) || Number(row.amount) || 0;
      if (!(cost - (Number(row.paid) || 0) > 0.009)) return false;
    }
    return true;
  });
}
