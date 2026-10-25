/**
 * Who may put a patient's payment on a day that has already closed.
 *
 * A closed day is one before today in the clinic's own zone: its nightly report has gone to the
 * owner, and the cash it lists is what the desk handed over. DENT INN, 24 Oct 2026: a 10,000
 * payment entered on the 24th had its date changed to the 21st, so the 21st gained 10,000 after its
 * report went out and the 24th's report told the owner the patient still owed 11,500. Nothing
 * stopped it and nothing said it had happened.
 *
 * The daily report now lists such payments either way. This is the clinic's own choice on top of
 * that: when `lockPastPaymentsNonAdmin` is on (Settings → Treatments & prices → Discounts), only an
 * Owner or Admin may record a payment on a closed day, move one onto or off a closed day, or change
 * the amount of one that sits on a closed day. Off by default, so a clinic that never turns it on
 * works exactly as before.
 *
 * The patient's payments only. The insurer's own payments, expenses and other income are recorded
 * by their own screens on the day the money moved, and are not what the desk hands over.
 *
 * Pure: the ledger route passes what it read, the test passes fixtures.
 */

import { isFullAccessRole } from "@/lib/permissions";

export const PAST_DAY_LOCKED = "PAST_DAY_LOCKED";

export const PAST_DAY_LOCKED_MESSAGE =
  "This payment is on a day that has already closed. Only an Owner or Admin can record, move or change a payment on an earlier day — ask one of them, or record it today. / الدفعة دي على يوم اتقفل خلاص. تسجيل أو نقل أو تعديل دفعة على يوم فات بيعمله المالك أو الأدمن بس — اطلب منهم، أو سجّلها بتاريخ النهارده.";

const day = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 10) : "");

/** Money is stored to two decimals; a re-sent unchanged amount is not an edit. */
const sameMoney = (a: unknown, b: unknown) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

/** A new payment dated `date`: refused when the lock is on, the day is closed and the person is not an Owner or Admin. */
export function refusesPastPayment(args: { locked: boolean; role: string; today: string; date: unknown }): boolean {
  if (!args.locked || isFullAccessRole(args.role)) return false;
  const d = day(args.date);
  return d !== "" && d < args.today;
}

/**
 * An edit to a payment: refused under the same conditions when it moves the payment onto or off a
 * closed day, or changes the amount of one on a closed day. A date or amount re-sent unchanged —
 * the edit dialog sends both on every save — is not a change, so fixing the note on last week's
 * payment still works.
 */
export function refusesPastPaymentEdit(args: {
  locked: boolean;
  role: string;
  today: string;
  before: { date?: unknown; paid?: unknown; amount?: unknown };
  patch: { date?: unknown; paid?: unknown };
}): boolean {
  if (!args.locked || isFullAccessRole(args.role)) return false;
  const from = day(args.before.date);
  const to = args.patch.date === undefined ? from : day(args.patch.date);
  const closed = (d: string) => d !== "" && d < args.today;
  if (to !== from && (closed(from) || closed(to))) return true;
  const storedPaid = args.before.paid ?? args.before.amount;
  if (args.patch.paid !== undefined && !sameMoney(args.patch.paid, storedPaid) && (closed(from) || closed(to))) return true;
  return false;
}
