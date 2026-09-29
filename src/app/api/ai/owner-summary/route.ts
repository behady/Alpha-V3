import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { resolveBriefingAccess } from "@/lib/automation/briefing/build";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { holdsPermission } from "@/lib/permissions";
import { getOrWriteOwnerSummary } from "@/lib/ownerSummary";
import { reportServerError } from "@/lib/server/reportError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/owner-summary?clinicId=&date=YYYY-MM-DD
 *
 * The owner's three-line summary of a day (yesterday by default), written on first request and
 * stored, so the morning read costs the clinic one credit a day however many times the screen
 * opens. Admins and finance holders only: the line carries the day's cash.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinicId = url.searchParams.get("clinicId")?.trim() || undefined;
  // Not exempt from the subscription check: this route writes the stored summary.
  const authz = await requireStaffUser(request, requestedClinicId);
  if (!authz.ok) return authz.response;

  const access = resolveBriefingAccess(authz.role, authz.permissions);
  const isAdmin = authz.role === "Owner" || authz.role === "Admin" || authz.role === "Clinic Admin";
  if (!isAdmin && !holdsPermission(authz.role, authz.permissions, "access.finance")) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
    const tz = clinicTimeZone();
    const requested = url.searchParams.get("date")?.trim();
    const dateKey = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : ymdInTimeZone(tz, new Date(Date.now() - 86_400_000));
    const summary = await getOrWriteOwnerSummary(clinicId, dateKey, { moneyVisible: access.money });
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    reportServerError("[OwnerSummary] failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Could not write the summary" }, { status: 500 });
  }
}
