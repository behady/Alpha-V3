import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { runStaffReportsForClinic } from "@/lib/reports/sendStaffReport";

/**
 * Hourly: the scheduled reports, on WhatsApp, for every clinic whose hour it is.
 *
 * Runs every hour and lets each clinic pick its own hour per report (Settings → Alerts & Reports),
 * the same way the Functions push jobs do. WhatsApp only — see lib/reports/sendStaffReport.ts for
 * why the bell and the push are not sent from here.
 *
 * Every clinic on the platform is walked, so like the reminders run this needs the long timeout.
 */
export const maxDuration = 300;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    // A superadmin may trigger the tick by hand to watch it run. Nobody else.
    const staff = await requireStaffUser(request);
    if (!staff.ok) return staff.response;
    if (!staff.isSuperAdmin) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const startedAt = Date.now();
  const results = await forEachActiveClinic((clinicId) => runStaffReportsForClinic(clinicId));
  const touched = results.filter((r) => r.ok && r.result && (r.result.sent.length > 0 || r.result.skipped.length > 0));
  return NextResponse.json({
    ok: true,
    clinics: results.length,
    touched: touched.map((r) => ({ clinicId: r.clinicId, ...r.result })),
    failed: results.filter((r) => !r.ok).map((r) => ({ clinicId: r.clinicId, error: r.error })),
    ms: Date.now() - startedAt,
  });
}
