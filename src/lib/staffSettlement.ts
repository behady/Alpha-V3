/**
 * What the clinic has paid a dentist against what they earned, oldest work first.
 *
 * A dentist's earnings are the commission on each private payment (`staffCommission.ts`) and the
 * share on each insurance service line (`staffInsurance.ts`). The owner records a PAYOUT when cash
 * is handed over and a DEDUCTION when something is held back (a broken instrument, an advance).
 * Both are poured over the earnings from the oldest unpaid one forward, so every line can say how
 * much of it has been paid, and the one number the owner wants — still owed — is the same however
 * the page's period is set.
 *
 * Pure: earnings and settlements in, figures out. The settlements live in `staff_settlements`
 * (clinic-scoped, written only by /api/staff/settlements); a payout also writes a "Salary"
 * expense row on the ledger so Finance sees the cash leave.
 */

export const SETTLEMENTS_COLLECTION = "staff_settlements";

export type SettlementKind = "payout" | "deduction";

export type StaffSettlement = {
  id: string;
  staffId: string;
  kind: SettlementKind;
  amount: number;
  /** yyyy-mm-dd: the day the money moved (payout) or the day it was decided (deduction). */
  date: string;
  note: string;
  /** How a payout was handed over (Cash, Card, InstaPay…); a deduction has none. */
  method: string | null;
  /** The expense row a payout wrote on the ledger; a deduction moves no cash and has none. */
  ledgerId: string | null;
  /** The branch the payout or deduction belongs to; absent on settlements from before branches. */
  branchId?: string;
  /**
   * "daily": the automatic day's share of a paid-daily dentist (`lib/dailyPay.ts`), written by the
   * server and never by hand. It pays exactly `paymentIds` before any other settlement is poured.
   */
  auto?: "daily";
  /** For an automatic daily payout: the payment rows whose share it is. */
  paymentIds?: string[];
};

/** One thing the dentist earned: a payment's commission or an insurance line's share. */
export type Earning = {
  /** The payment's ledger id, or `${claimId}#${lineIndex}`. */
  key: string;
  date: string;
  amount: number;
};

export type EarningSettled = { paid: number; deducted: number; remaining: number };

export type SettlementResult = {
  byKey: Map<string, EarningSettled>;
  earned: number;
  paid: number;
  deducted: number;
  /** Earned and not yet settled, less anything paid beyond the earnings. Negative = paid ahead. */
  owed: number;
  /** Settled beyond what was earned: a payout made before the work it covers. */
  ahead: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function isSettlementKind(v: unknown): v is SettlementKind {
  return v === "payout" || v === "deduction";
}

/** A stored settlement, or null for junk a screen should not show. */
export function parseSettlement(id: string, raw: unknown): StaffSettlement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const staffId = typeof r.staffId === "string" ? r.staffId.trim() : "";
  const amount = num(r.amount);
  const date = typeof r.date === "string" ? r.date : "";
  if (!staffId || !isSettlementKind(r.kind) || amount <= 0 || !ISO_DATE.test(date)) return null;
  return {
    id,
    staffId,
    kind: r.kind,
    amount: round2(amount),
    date,
    note: typeof r.note === "string" ? r.note.trim() : "",
    method: r.kind === "payout" ? (typeof r.method === "string" && r.method.trim() ? r.method.trim() : "Cash") : null,
    ledgerId: typeof r.ledgerId === "string" && r.ledgerId ? r.ledgerId : null,
    ...(typeof r.branchId === "string" && r.branchId ? { branchId: r.branchId } : {}),
    ...(r.kind === "payout" && r.auto === "daily"
      ? { auto: "daily" as const, paymentIds: Array.isArray(r.paymentIds) ? r.paymentIds.filter((p): p is string => typeof p === "string" && p !== "") : [] }
      : {}),
  };
}

/** The automatic day's share of a paid-daily dentist: shown, never edited or deleted by hand. */
export function isAutoDailyPayout(s: Pick<StaffSettlement, "auto">): boolean {
  return s.auto === "daily";
}

/**
 * Pour the settlements over the earnings, oldest earning first.
 *
 * The order of settlements only decides which part of a half-covered line was cash and which was
 * a deduction; the total covered is the same either way. Whatever is left after the last earning
 * is `ahead` — the owner paid before the work — and comes off `owed`, so a dentist paid 5,000
 * against 4,000 of work shows owed −1,000, not 0 with 1,000 vanished.
 *
 * Automatic daily payouts (`auto: "daily"`) go first and pay exactly the payments they list: a
 * paid-daily dentist took that share from those payments, so an older unpaid insurance line must
 * never swallow it. Anything a daily payout has left over (its payments shrank and the line has not
 * been re-worked yet) is poured oldest-first with the rest, so no money vanishes.
 */
export function settleEarnings(earnings: readonly Earning[], settlements: readonly StaffSettlement[]): SettlementResult {
  const lines = [...earnings]
    .filter((e) => e.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
    .map((e) => ({ key: e.key, paid: 0, deducted: 0, remaining: round2(e.amount) }));
  const lineByKey = new Map(lines.map((line) => [line.key, line]));
  const pool = [...settlements].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  let paid = 0;
  let deducted = 0;
  const leftOf = new Map<string, number>();
  for (const s of pool) {
    const amount = round2(s.amount);
    if (s.kind === "payout") paid = round2(paid + amount);
    else deducted = round2(deducted + amount);
    if (s.kind !== "payout" || s.auto !== "daily") continue;
    let left = amount;
    for (const key of s.paymentIds ?? []) {
      const line = lineByKey.get(key);
      if (!line || left <= 0) continue;
      const take = Math.min(left, line.remaining);
      line.paid = round2(line.paid + take);
      line.remaining = round2(line.remaining - take);
      left = round2(left - take);
    }
    leftOf.set(s.id, left);
  }

  let cursor = 0;
  let ahead = 0;
  for (const s of pool) {
    let left = leftOf.get(s.id) ?? round2(s.amount);
    while (left > 0 && cursor < lines.length) {
      const line = lines[cursor];
      if (line.remaining === 0) {
        cursor += 1;
        continue;
      }
      const take = Math.min(left, line.remaining);
      if (s.kind === "payout") line.paid = round2(line.paid + take);
      else line.deducted = round2(line.deducted + take);
      line.remaining = round2(line.remaining - take);
      left = round2(left - take);
      if (line.remaining === 0) cursor += 1;
    }
    ahead = round2(ahead + left);
  }

  const byKey = new Map<string, EarningSettled>();
  let earned = 0;
  let remaining = 0;
  for (const line of lines) {
    byKey.set(line.key, { paid: line.paid, deducted: line.deducted, remaining: line.remaining });
    earned = round2(earned + line.paid + line.deducted + line.remaining);
    remaining = round2(remaining + line.remaining);
  }
  return { byKey, earned, paid, deducted, owed: round2(remaining - ahead), ahead };
}

/** What is still unpaid on work dated before `date`: the debt a period inherits. */
export function owedBefore(result: SettlementResult, earnings: readonly Earning[], date: string): number {
  let sum = 0;
  for (const e of earnings) {
    if (e.date >= date) continue;
    sum += result.byKey.get(e.key)?.remaining ?? 0;
  }
  return round2(sum);
}

/**
 * The lines behind `owedBefore`, oldest first: each earning dated before `date` with something still
 * unpaid. The period's tables only list the period, so without these the carried figure names no
 * work at all — an insurance approval dated last month showed as "590 from before" and nothing else.
 */
export function unpaidBefore(result: SettlementResult, earnings: readonly Earning[], date: string): Array<{ key: string; date: string; remaining: number }> {
  return earnings
    .filter((e) => e.date < date && (result.byKey.get(e.key)?.remaining ?? 0) > 0)
    .map((e) => ({ key: e.key, date: e.date, remaining: result.byKey.get(e.key)?.remaining ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

/** Payouts and deductions dated inside a period, summed by kind. */
export function settledInPeriod(settlements: readonly StaffSettlement[], period: { start: string; end: string }): { paid: number; deducted: number } {
  let paid = 0;
  let deducted = 0;
  for (const s of settlements) {
    if (s.date < period.start || s.date > period.end) continue;
    if (s.kind === "payout") paid = round2(paid + s.amount);
    else deducted = round2(deducted + s.amount);
  }
  return { paid, deducted };
}
