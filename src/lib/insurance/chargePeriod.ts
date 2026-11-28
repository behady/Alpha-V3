/**
 * Whether a company's treatment belongs to the dates picked on the Finance page.
 *
 * One promise: a whole month on Finance is exactly that month's company sheet.
 *
 * - A procedure the company sheet has placed counts where the sheet put it. Placed by its own end
 *   date, it counts on that day; placed on a month any other way (picked by hand, on a sent list,
 *   rolled on past a sent month), it counts on every day of that month.
 * - A procedure the sheet holds back (not finished, no month picked) is in no period.
 * - Anything the sheet does not place — an approval insurer's treatment, or one dated before the
 *   sheets began — counts on its own date.
 *
 * Pure: no Firebase, no React.
 */
import type { Placement } from "@/lib/insurance/companySheet";
import { toYmd } from "@/lib/reports/patientStats";

export type Period = { start: string; end: string };

export function chargeInPeriod(charge: { date?: unknown }, period: Period, placement?: Placement): boolean {
  const within = (day: string) => day !== "" && day >= period.start && day <= period.end;
  if (!placement) return within(toYmd(charge.date));
  if (!placement.month) return false;
  if (placement.finishDate.slice(0, 7) === placement.month && !placement.sent) return within(placement.finishDate);
  return placement.month >= period.start.slice(0, 7) && placement.month <= period.end.slice(0, 7);
}
