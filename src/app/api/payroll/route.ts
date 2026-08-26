import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { loadBriefingData } from "@/lib/automation/briefing/data";
import { buildHrSection } from "@/lib/automation/briefing/hr";
import { resolveBriefingAccess } from "@/lib/automation/briefing/build";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A month of punches for every member of staff, in one pass. */
export const maxDuration = 60;

/**
 * What the clinic owes its staff for a period.
 *
 * This route exists so the phone can print a payroll sheet without doing the
 * arithmetic. It computes nothing of its own: it calls the same
 * `buildHrSection` the Attendance screen and the weekly brief call, with the
 * same hourly rate derived from base salary over expected monthly hours, the
 * same regular-versus-overtime split, and the same rule that unreviewed
 * overtime is pending rather than assumed.
 *
 * That is the whole point. Two surfaces disagreeing about what somebody earned
 * is not a rendering bug, it is an argument with an employee, and the only way
 * to be sure they agree is for there to be one calculation.
 *
 * Payroll is resolved against the caller's own clinic permissions and is simply
 * not computed for a reader who lacks them — salaries never travel to a client
 * that should not have them and then rely on it to hide them.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinicId = url.searchParams.get("clinicId")?.trim() || undefined;

  const authz = await requireStaffUser(request, requestedClinicId, { allowInactive: true });
  if (!authz.ok) return authz.response;

  const access = resolveBriefingAccess(authz.role, authz.permissions);
  if (!access.hr) {
    return NextResponse.json(
      { ok: false, error: "Payroll is limited to staff who administer attendance." },
      { status: 403 }
    );
  }

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
    const timeZone = clinicTimeZone();
    const today = ymdInTimeZone(timeZone);

    // Defaults to the calendar month so far, which is what "this month's payroll"
    // means to the person asking for it.
    const to = url.searchParams.get("to")?.trim() || today;
    const from = url.searchParams.get("from")?.trim() || `${to.slice(0, 7)}-01`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return NextResponse.json({ ok: false, error: "Bad date range." }, { status: 400 });
    }

    const data = await loadBriefingData({
      clinicId,
      startDate: from,
      endDate: to,
      // No money section, so the comparison and previous windows are unused; they
      // are still required arguments, and pointing them at the same range keeps
      // the loader from reading a wider slice of the ledger than this needs.
      comparisonStart: from,
      previousStart: null,
      previousEnd: null,
      attendanceStart: from,
      needsMoney: false,
      needsHr: true,
    });

    const { section } = buildHrSection({
      staff: data.staff,
      punches: data.punches,
      startDate: from,
      endDate: to,
      today,
      nowMinutes: nowMinutesInZone(timeZone),
      timeZone,
      geofenceRadiusM: data.geofenceRadiusM,
      // The payroll-to-date figure is not used here — this route reports the
      // range it was asked for, not the calendar month around it.
      monthStart: from,
    });

    return NextResponse.json({
      ok: true,
      payroll: {
        from,
        to,
        generatedAt: new Date().toISOString(),
        staff: section.staff,
        labourCost: section.labourCost,
        overtimePendingMinutes: section.overtimePendingMinutes,
        overtimePendingCost: section.overtimePendingCost,
        withoutSchedule: section.withoutSchedule,
        notes: notesFor(section.withoutSchedule),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not build the payroll";
    reportServerError("[Payroll] failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * The qualifications that travel with the figures.
 *
 * Printed on the sheet rather than left to the reader, because a payroll total
 * that quietly excludes pending overtime, or silently counts an agreed day off
 * as an absence, is the kind of thing an employee finds before the manager does.
 */
function notesFor(withoutSchedule: number): string[] {
  const notes = [
    "Estimated from clock-in records. Commission is not included — it is reported on the " +
      "Finance screen against each treatment.",
    "Overtime is counted only once it has been approved. Pending overtime is listed separately " +
      "and is not in the total.",
    "The system records no leave or sick days, so a scheduled day with no punch reads as absent " +
      "even when it was agreed in advance.",
  ];
  if (withoutSchedule > 0) {
    notes.push(
      `${withoutSchedule} staff member${withoutSchedule === 1 ? " has" : "s have"} no work ` +
        "schedule set, so no hourly rate could be derived and their pay shows as zero. " +
        "Attendance → the ⚙ beside their name sets one."
    );
  }
  return notes;
}

/** Minutes from midnight, right now, on the clinic's clock. */
function nowMinutesInZone(timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}
