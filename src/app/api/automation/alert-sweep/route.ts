import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { runAlertSweep } from "@/lib/alerts/sweep";

/**
 * Every ten minutes: the alerts that are true for a while before anyone notices, and the batched
 * alerts due to go out. See lib/alerts/sweep.ts.
 */
export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    const staff = await requireStaffUser(request);
    if (!staff.ok) return staff.response;
    if (!staff.isSuperAdmin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const startedAt = Date.now();
  const results = await forEachActiveClinic((clinicId) => runAlertSweep(clinicId));
  return NextResponse.json({
    ok: true,
    clinics: results.length,
    raised: results.filter((r) => r.ok && r.result && r.result.raised.length > 0).map((r) => ({ clinicId: r.clinicId, raised: r.result!.raised })),
    failed: results.filter((r) => !r.ok).map((r) => ({ clinicId: r.clinicId, error: r.error })),
    ms: Date.now() - startedAt,
  });
}
