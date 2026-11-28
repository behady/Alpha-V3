/**
 * Paid-daily dentists: the share they take from each patient payment, recorded as one automatic
 * payout per day.
 *
 * Some dentists are paid the moment the patient pays: their half goes into their hand, not the
 * drawer. The clinic switches that on per dentist (`staff.paidDaily`, from `staff.paidDailyFrom`),
 * and for every day on or after that date the server keeps ONE automatic payout per branch equal to
 * the dentist's share of that day's private payments (`lib/server/dailyPaySync.ts`). Each payout
 * also writes the usual "Salary" expense row, so every screen that already understands a Team-page
 * payout — Finance, the daily sheet, reports, Excel, the owner's reports — shows the cash leaving
 * with no change of its own.
 *
 * Pure: rows and settlements in, a plan out. Nothing here touches the database.
 *
 * Rules (docs/superpowers/specs/2026-11-28-paid-daily-dentists-design.md):
 *   - a day's line = the `doctorCommissionAmount` on that dentist's private payment rows that day;
 *     insurance work (a `claimId`, or a payment on a treatment that belongs to a claim) is not
 *     taken from the payment and stays owed;
 *   - zero for a day → no line;
 *   - only days on or after `paidDailyFrom`, and only while `paidDaily` is on: switched off, every
 *     existing line is frozen as history.
 */

import { commissionByStaff, type CommissionRow, type StaffLite } from "@/lib/staffCommission";
import type { StaffSettlement } from "@/lib/staffSettlement";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The activity a daily payout's ledger row and settlement are written by. */
export const DAILY_PAY_ACTOR = { uid: "system:daily-pay", name: "Automatic (paid daily)", role: "system" } as const;

export type DailyPayRow = CommissionRow & { branchId?: unknown };

/** One day's (and branch's) automatic share. */
export type DailyShare = {
  /** The settlement id: `daily_<staffId>_<date>_<branch or "all">`. */
  id: string;
  date: string;
  branchId: string | null;
  amount: number;
  /** The payments whose share this is, sorted. */
  paymentIds: string[];
};

export type DailyPayOp = { kind: "upsert"; share: DailyShare } | { kind: "delete"; id: string };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function branchKey(branchId: string | null): string {
  return branchId || "all";
}

/** The automatic payout's id. Fixed per dentist, day and branch, so writing it twice is harmless. */
export function dailyPayDocId(staffId: string, date: string, branchId: string | null): string {
  return `daily_${staffId}_${date}_${branchKey(branchId)}`;
}

/** The id of the "Salary" ledger row the automatic payout writes. */
export function dailyPayLedgerId(staffId: string, date: string, branchId: string | null): string {
  return `dailypay_${staffId}_${date}_${branchKey(branchId)}`;
}

/** The first day the switch covers, or null when the dentist is not paid daily. */
export function dailyPayStart(staff: { paidDaily?: unknown; paidDailyFrom?: unknown } | null | undefined): string | null {
  if (!staff || staff.paidDaily !== true) return null;
  const from = typeof staff.paidDailyFrom === "string" ? staff.paidDailyFrom : "";
  return ISO_DATE.test(from) ? from : null;
}

function hasClaim(row: DailyPayRow): boolean {
  return typeof row.claimId === "string" && row.claimId.trim() !== "";
}

/**
 * The dentist's share of each day's private payments, keyed by the automatic payout's id.
 *
 * `rows` are the dentist's ledger rows (the server reads them by `doctorId`); `insuranceRowIds` are
 * treatment rows that belong to an insurance approval, for payments whose treatment sits outside
 * `rows`. The figures are the ones the Team page lists (`commissionByStaff`), so a day's line and
 * the payments it pays can never disagree.
 */
export function dailyShares(rows: readonly DailyPayRow[], staff: StaffLite, insuranceRowIds: ReadonlySet<string> = new Set()): Map<string, DailyShare> {
  const byId = new Map<string, DailyPayRow>();
  const insuranceTreatments = new Set(insuranceRowIds);
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (id) byId.set(id, row);
    if (String(row.type ?? "") !== "payment" && hasClaim(row)) insuranceTreatments.add(id);
  }
  const entries = commissionByStaff(rows, [staff], insuranceTreatments).get(staff.id)?.entries ?? [];

  const out = new Map<string, DailyShare>();
  for (const entry of entries) {
    if (!(entry.amount > 0) || !ISO_DATE.test(entry.date)) continue;
    const row = byId.get(entry.id);
    if (!row) continue;
    if (hasClaim(row) || insuranceTreatments.has(String(row.procedureId ?? ""))) continue;
    const branchId = typeof row.branchId === "string" && row.branchId ? row.branchId : null;
    const id = dailyPayDocId(staff.id, entry.date, branchId);
    const share = out.get(id) || { id, date: entry.date, branchId, amount: 0, paymentIds: [] };
    share.amount = round2(share.amount + entry.amount);
    share.paymentIds.push(entry.id);
    out.set(id, share);
  }
  for (const share of out.values()) share.paymentIds.sort();
  return out;
}

function sameShare(a: DailyShare, b: StaffSettlement): boolean {
  if (round2(a.amount) !== round2(b.amount) || a.date !== b.date) return false;
  if ((a.branchId || null) !== (b.branchId || null)) return false;
  const ids = [...(b.paymentIds ?? [])].sort();
  return ids.length === a.paymentIds.length && ids.every((id, i) => id === a.paymentIds[i]);
}

/**
 * What to write so the automatic payouts match the payments.
 *
 * `existing` is the dentist's settlements (manual ones are ignored); `dates` limits the work to the
 * days an edit touched, or "all" for a full check. Days before the start date, and every day while
 * the switch is off, are never touched.
 */
export function planDailyPay(args: {
  staff: { paidDaily?: unknown; paidDailyFrom?: unknown } | null | undefined;
  shares: ReadonlyMap<string, DailyShare>;
  existing: readonly StaffSettlement[];
  dates: Iterable<string> | "all";
}): DailyPayOp[] {
  const start = dailyPayStart(args.staff);
  if (!start) return [];
  const current = new Map(args.existing.filter((s) => s.auto === "daily" && s.kind === "payout").map((s) => [s.id, s]));

  let scope: Set<string>;
  if (args.dates === "all") {
    scope = new Set([...[...args.shares.values()].map((s) => s.date), ...[...current.values()].map((s) => s.date)]);
  } else {
    scope = new Set([...args.dates].filter((d) => ISO_DATE.test(d)));
  }

  const ops: DailyPayOp[] = [];
  for (const date of [...scope].sort()) {
    if (date < start) continue;
    const wanted = [...args.shares.values()].filter((s) => s.date === date).sort((a, b) => a.id.localeCompare(b.id));
    const wantedIds = new Set(wanted.map((s) => s.id));
    for (const share of wanted) {
      const have = current.get(share.id);
      if (!have || !sameShare(share, have)) ops.push({ kind: "upsert", share });
    }
    for (const have of [...current.values()].filter((s) => s.date === date).sort((a, b) => a.id.localeCompare(b.id))) {
      if (!wantedIds.has(have.id)) ops.push({ kind: "delete", id: have.id });
    }
  }
  return ops;
}
