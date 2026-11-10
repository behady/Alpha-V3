/**
 * Which month an insurance approval belongs to.
 *
 * A clinic sends each insurer one closing sheet a month. An approval issued on 20/10 is often worked
 * on across several visits and finished on 5/11, and the company expects it on NOVEMBER's sheet. So:
 *
 * - every service has its own done date (`lineDates`), which is also the month the dentist earns
 *   their share of it in — October's work is October's pay even while the approval is still open;
 * - the approval is FINISHED on its last done date, once every service is Completed or deleted;
 * - an approval saved before per-service dates existed has none, and every one of its services
 *   reads as done on its treated date — exactly the month it was in before.
 *
 * Every date rule lives here. The claims route stores what `billingFields` returns on each write so
 * screens can query by it; nothing else decides a month.
 */
import { isLineRemoved, lineDateOf, lineStatusOf, type InsuranceClaim, type LineStatus } from "./claims";

export { isLineRemoved, lineDateOf };

/** How the Insurance page picks the approvals of a date range. */
export type SheetDateMode = "approval" | "finish";

export type BillingClaim = Pick<InsuranceClaim, "status" | "lines" | "lineStatus" | "lineDates" | "removedLines" | "treatedDate" | "approvalDate">;

/** Only work that was done is billed or paid: an approved claim's services have not happened yet. */
const isWorked = (c: Pick<InsuranceClaim, "status">) => c.status === "treated" || c.status === "sent";

/** The indexes of the services that are on the approval and done. */
function doneLines(c: BillingClaim): number[] {
  const out: number[] = [];
  for (let i = 0; i < c.lines.length; i += 1) {
    if (!isLineRemoved(c, i) && lineStatusOf(c, i) === "Completed") out.push(i);
  }
  return out;
}

/**
 * The day the approval's last service was done, or null while it is not finished: not treated yet,
 * a service still Planned or Ongoing, or nothing left on it at all.
 */
export function claimFinishedDate(c: BillingClaim): string | null {
  if (!isWorked(c)) return null;
  const done = doneLines(c);
  if (done.length === 0) return null;
  const live = c.lines.filter((_, i) => !isLineRemoved(c, i)).length;
  if (done.length !== live) return null;
  let last = "";
  for (const i of done) {
    const d = lineDateOf(c, i);
    if (d > last) last = d;
  }
  return last || null;
}

/** `yyyy-mm` of every month a service on this approval was done in, oldest first. */
export function claimWorkMonths(c: BillingClaim): string[] {
  if (!isWorked(c)) return [];
  const months = new Set<string>();
  for (const i of doneLines(c)) {
    const d = lineDateOf(c, i);
    if (d.length >= 7) months.add(d.slice(0, 7));
  }
  return [...months].sort();
}

/** The derived fields the claims route stores on every write. */
export function billingFields(c: BillingClaim): { finishedDate: string | null; workMonths: string[] } {
  return { finishedDate: claimFinishedDate(c), workMonths: claimWorkMonths(c) };
}

/**
 * `lineDates` after some services change state. A service that BECOMES Completed was done today,
 * unless it already carries a day; one that goes back to Planned or Ongoing loses its day. A
 * service that was already Completed is left alone, so re-saving an old approval stamps nothing.
 */
export function lineDatesAfterStates(
  c: Pick<InsuranceClaim, "lineStatus" | "lineDates">,
  states: Record<number, LineStatus>,
  today: string,
): Record<number, string> {
  const out: Record<number, string> = { ...(c.lineDates ?? {}) };
  for (const [k, state] of Object.entries(states)) {
    const i = Number(k);
    if (state !== "Completed") delete out[i];
    else if (lineStatusOf(c, i) !== "Completed" && !out[i]) out[i] = today;
  }
  return out;
}

/**
 * Whether an edit would move an approval that was already sent to the company onto another
 * month's sheet, or reopen it (the owner's rule: it cannot — mark it not sent first). An approval
 * sent while a service was still open has no finish month yet, so finishing it is allowed.
 */
export function movesSentMonth(before: BillingClaim, after: BillingClaim): boolean {
  if (before.status !== "sent" || after.status !== "sent") return false;
  const was = claimFinishedDate(before);
  if (was === null) return false;
  const now = claimFinishedDate(after);
  return now === null || now.slice(0, 7) !== was.slice(0, 7);
}

/** The date that places an approval in a range: its approval date, or the day it was finished. */
export function sheetDate(c: BillingClaim, mode: SheetDateMode): string | null {
  return mode === "approval" ? c.approvalDate || null : claimFinishedDate(c);
}

/** Whether an approval belongs on the sheet of `[from, to]` (inclusive). Only worked approvals ever do. */
export function inSheetRange(c: BillingClaim, mode: SheetDateMode, from: string, to: string): boolean {
  if (!isWorked(c)) return false;
  const d = sheetDate(c, mode);
  return d !== null && d >= from && d <= to;
}

const YMD = /^(\d{4})-(\d{2})-\d{2}$/;

/** Every `yyyy-mm` from the month of `from` to the month of `to`, inclusive; empty for a bad or backwards range. */
export function monthsBetween(from: string, to: string): string[] {
  const a = YMD.exec(from);
  const b = YMD.exec(to);
  if (!a || !b) return [];
  let y = Number(a[1]);
  let m = Number(a[2]);
  const endY = Number(b[1]);
  const endM = Number(b[2]);
  if (m < 1 || m > 12 || endM < 1 || endM > 12) return [];
  const out: string[] = [];
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 600) return [];
  }
  return out;
}
