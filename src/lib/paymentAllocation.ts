/**
 * How much of a payment may be pointed at one treatment.
 *
 * A patient was shown TOTAL TREATMENT 1,400, TOTAL PAID 2,600, BALANCE −1,200. A duplicate
 * treatment and its duplicate payment had been entered and then cleaned up, but the second 1,200
 * ended up settling the 200 EGP consultation — so a 200 EGP charge read "paid 1,400" and the
 * patient looked owed 1,200 they had never been given.
 *
 * Nothing in the system had ever objected, because no two screens agreed on what to do:
 *
 *   - the quick-payment modal refused outright;
 *   - the appointment side panel asked "Amount is greater than remaining. Continue?" and allowed it;
 *   - the patient ledger — the screen this happened on — checked nothing at all;
 *   - and the server, which is the only one of the four that cannot be bypassed, checked nothing
 *     either, so whichever screen was loosest decided what the books could say.
 *
 * The rule lives here so all four ask the same question, and the server asks it last.
 *
 * What is NOT an over-allocation:
 *
 *   - A payment on account. A patient may hand over more than they currently owe, and that money
 *     settles no particular treatment. That is `procedureId: null`, and it is unlimited.
 *   - An edit that reduces an over-allocation that already exists. The rows in the books today
 *     have to be repairable, and refusing to let somebody drag 1,400 down to 200 because 200 is
 *     still "over" would make the damage permanent.
 *   - A charge with no price on it yet. `remaining` would be zero and every payment would be
 *     refused; an unpriced treatment is a different problem, and blocking the till over it is the
 *     worse failure. The screen still flags the row as over-allocated so it is not invisible.
 *
 * Pure and Firebase-free: the caller loads the procedure and its payments however it likes and
 * this decides. This is arithmetic that decides whether money can be recorded, so it is arithmetic
 * that has to be testable without a database.
 */

export const OVER_ALLOCATION_CODE = "over_allocation";

/** Money is stored to two decimals, so comparisons need to tolerate the last half-cent. */
const EPSILON = 0.005;

export type AllocationInput = {
  /** What the treatment costs, after any discount. */
  cost: number;
  /** Everything already settling it, EXCLUDING the row being created or edited. */
  otherPaymentsTotal: number;
  /** What this row would settle once written. */
  amount: number;
  /**
   * What this row settles today. Present only when editing an existing payment; absent when
   * creating one. An edit that moves the figure down is always allowed.
   */
  previousAmount?: number | null;
};

export type AllocationVerdict =
  | { ok: true }
  | {
      ok: false;
      /** What was left to settle before this row. Never negative in the message sense — see `excess`. */
      remaining: number;
      /** How far past the charge this would go. */
      excess: number;
    };

function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

/**
 * May this amount settle this treatment?
 *
 * The comparison is against the charge as a whole, not against "remaining", so two payments that
 * are each individually under the remaining balance cannot add up to more than the charge.
 */
export function checkAllocation(input: AllocationInput): AllocationVerdict {
  const cost = money(input.cost);
  const others = money(input.otherPaymentsTotal);
  const amount = money(input.amount);

  // An unpriced charge has nothing to compare against. See the module comment.
  if (cost <= 0) return { ok: true };

  const total = money(others + amount);
  if (total <= cost + EPSILON) return { ok: true };

  // Repairing downwards is always allowed, even when the result is still over.
  const previous = input.previousAmount == null ? null : money(input.previousAmount);
  if (previous !== null && amount <= previous + EPSILON) return { ok: true };

  return {
    ok: false,
    remaining: money(Math.max(0, cost - others)),
    excess: money(total - cost),
  };
}

/**
 * The refusal, in words a receptionist can act on.
 *
 * It has to say the number they should have typed and what to do with the rest, because the thing
 * they are trying to do — take the patient's money — is legitimate; only the row they are putting
 * it on is wrong.
 */
export function allocationMessage(
  verdict: Extract<AllocationVerdict, { ok: false }>,
  description?: string | null
): string {
  const name = String(description || "").trim();
  const which = name ? `"${name}"` : "this treatment";
  const left =
    verdict.remaining > 0
      ? `Only ${verdict.remaining.toLocaleString()} EGP is still owed on ${which}`
      : `${which} is already paid in full`;
  return (
    `${left}, so this would settle it ${verdict.excess.toLocaleString()} EGP over. ` +
    `Record ${verdict.remaining > 0 ? `${verdict.remaining.toLocaleString()} EGP ` : ""}against it and take the rest as a payment on account, ` +
    `or point this payment at the treatment it actually settles.`
  );
}

/** Arabic, for the screens that show the clinic's own language. */
export function allocationMessageAr(
  verdict: Extract<AllocationVerdict, { ok: false }>,
  description?: string | null
): string {
  const name = String(description || "").trim();
  const which = name ? `"${name}"` : "هذا العلاج";
  const left =
    verdict.remaining > 0
      ? `المتبقي على ${which} هو ${verdict.remaining.toLocaleString()} جنيه فقط`
      : `${which} مسدّد بالكامل`;
  return `${left}، وهذه الدفعة تتجاوزه بمقدار ${verdict.excess.toLocaleString()} جنيه. سجّل المتبقي فقط واحتسب الباقي كدفعة تحت الحساب، أو حوّل الدفعة إلى العلاج الذي تخصّه.`;
}

/**
 * What a treatment charge is worth, read tolerantly.
 *
 * `cost` is where this app writes it, but rows old enough predate that and carry only `amount`.
 * Reading `cost` alone prices every one of those at zero — and a zero-priced charge is waved
 * through the guard above, so the check would silently stop applying to exactly the oldest records.
 * Reading `amount` first has the mirror problem: some rows carry `amount: 0` as a placeholder
 * beside a real `cost`, and every payment against one would be reported as an overpayment.
 *
 * So: the first of the two that is a real figure wins.
 */
export function chargeAmount(row: { cost?: unknown; amount?: unknown }): number {
  return money(row.cost) || money(row.amount) || 0;
}

/**
 * How far past its price a treatment has already been paid, for the rows that exist today.
 *
 * The guard above stops new ones; this is what lets a screen point at the old ones instead of
 * silently rendering "cost 200 / paid 1,400" as though it were normal.
 */
export function overAllocation(cost: number, paidTotal: number): number {
  const excess = money(money(paidTotal) - money(cost));
  return excess > EPSILON ? excess : 0;
}
