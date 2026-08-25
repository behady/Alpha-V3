import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { buildBriefing, resolveBriefingAccess } from "@/lib/automation/briefing/build";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A week's brief reads appointments, the ledger, attendance, leads and stock in one pass. */
export const maxDuration = 60;

/**
 * The day, or the last seven days, at a glance.
 *
 * Staff-level rather than plan-gated, but not the same brief for everyone: money and payroll are
 * resolved against the caller's own clinic permissions and simply not computed for a reader who
 * lacks them, so the figures never travel to a browser that should not have them. The response
 * says which sections were withheld, so the screen can be honest about the gap.
 *
 * Computed fresh per request rather than cached. A brief is read once a morning, and a stale one
 * — showing yesterday's takings or a colleague who has since clocked out — is worse than a slow
 * one.
 *
 * The date comes from the clinic's timezone, not the server's. A brief that flips to "tomorrow"
 * at midnight UTC would be wrong for most of the working day in Cairo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinicId = url.searchParams.get("clinicId")?.trim() || undefined;

  const authz = await requireStaffUser(request, requestedClinicId, { allowInactive: true });
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
    const period = url.searchParams.get("period") === "week" ? "week" : "day";
    const endDate = url.searchParams.get("date")?.trim() || ymdInTimeZone(clinicTimeZone());

    const briefing = await buildBriefing({
      clinicId,
      period,
      endDate,
      access: resolveBriefingAccess(authz.role, authz.permissions),
    });

    return NextResponse.json({ ok: true, briefing });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not build the briefing";
    reportServerError("[Briefing] failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
