import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { LOCATIONS_DOC, parseClinicBranches } from "@/lib/clinicLocations";
import { buildBriefing, resolveBriefingAccess } from "@/lib/automation/briefing/build";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { allowedFor } from "@/lib/server/branchAccess";
import { isFullAccessRole } from "@/lib/permissions";

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
    const requested = url.searchParams.get("period");
    const period = requested === "week" || requested === "month" ? requested : "day";
    const endDate = url.searchParams.get("date")?.trim() || ymdInTimeZone(clinicTimeZone());

    // Optional `branchId`: the brief of one branch. An id the clinic does not have is ignored (the
    // clinic total); no param, as the phone sends, is the clinic total exactly as before. A
    // non-admin asking for a branch they may not work in is refused, not quietly answered.
    let branchId = "";
    const wantedBranch = url.searchParams.get("branchId")?.trim() || "";
    if (wantedBranch) {
      const locations = await adminClinicDoc(clinicId, "settings", LOCATIONS_DOC).get();
      const branches = parseClinicBranches(locations.exists ? locations.data() : null);
      if (branches.some((b) => b.id === wantedBranch)) branchId = wantedBranch;
      if (branchId && !isFullAccessRole(authz.role) && !(await allowedFor(clinicId, authz.uid, branches)).some((b) => b.id === branchId)) {
        return NextResponse.json(
          { ok: false, error: "You can't see that branch's figures. / مش مسموحلك تشوف أرقام الفرع ده.", code: "branch_forbidden" },
          { status: 403 }
        );
      }
    }

    const briefing = await buildBriefing({
      clinicId,
      period,
      endDate,
      access: resolveBriefingAccess(authz.role, authz.permissions),
      ...(branchId ? { branchId } : {}),
    });

    return NextResponse.json({ ok: true, briefing });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not build the briefing";
    reportServerError("[Briefing] failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
