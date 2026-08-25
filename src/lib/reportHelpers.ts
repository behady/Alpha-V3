export const getFirstDay = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
export const getToday = () => new Date().toISOString().split("T")[0];

/**
 * Cash actually collected (or spent) on a ledger row.
 *
 * Which field holds the money depends on the write path that created the row, and several paths
 * store a placeholder `0` in the fields they don't use instead of omitting them — the inline
 * appointment payment writes `amount: 0, paid: <real amount>`, for example. That makes a `??`
 * chain the wrong tool here: `??` only falls through on null/undefined, so the placeholder `0`
 * wins and the row reads as free. Take the first candidate that is actually non-zero instead.
 *
 * Priority is per row type: payments and manual income carry the money in `paid`, expenses in
 * `cost`, and a procedure row only counts as cash once something has been `paid` against it
 * (its `cost`/`amount` are the treatment plan total, not money in the drawer).
 */
export function ledgerCashValue(row: Record<string, unknown>): number {
  const type = String(row.type || "");
  const candidates =
    type === "expense" ? [row.cost, row.amount] :
    type === "procedure" ? [row.paid] :
    [row.paid, row.amount];

  for (const candidate of candidates) {
    const n = Number(candidate ?? 0) || 0;
    if (n !== 0) return n;
  }
  return 0;
}

export function cleanName(value: unknown, fallback = "Unknown"): string {
  const v = String(value ?? "").trim();
  if (!v || v === "undefined" || v === "null") return fallback;
  return v;
}
