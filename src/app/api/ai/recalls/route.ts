import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { scanRecallDue } from "@/lib/automation/recallDue";
import { scanInventoryAlerts } from "@/lib/automation/inventoryAlerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Reads every patient's last visit plus the whole inventory. See revenue-recovery for why. */
export const maxDuration = 120;

/**
 * Operational checks that read the clinic's own configuration: who is due for a check-up, and
 * what stock has run low.
 *
 * Staff-level rather than Admin-only — unlike the reactivation scan, neither of these exposes
 * clinic-wide finances, and both describe work the front desk is expected to act on. Nothing here
 * sends anything; recall reminders are sent one at a time from the page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinicId = url.searchParams.get("clinicId")?.trim() || undefined;

  const authz = await requireStaffUser(request, requestedClinicId, { allowInactive: true });
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
    const [recalls, inventory] = await Promise.all([
      scanRecallDue(clinicId),
      scanInventoryAlerts(clinicId),
    ]);
    return NextResponse.json({ ok: true, recalls, inventory });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed";
    reportServerError("[Recalls] scan failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
