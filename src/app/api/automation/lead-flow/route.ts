import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { draftLeadFlow } from "@/lib/leads/leadFlowDraft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Weekly: the AI writes each clinic's lead-grading flow as a draft for an admin to approve.
 * Cron on Monday morning; a staff member may also run it for their own clinic (the settings
 * card's "draft now" button), which lowers the sample threshold but never skips approval.
 * See lib/leads/leadFlowDraft.ts.
 */

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  try {
    if (isCronAuthorized(request)) {
      const clinics = await forEachActiveClinic((clinicId) => draftLeadFlow(clinicId));
      return NextResponse.json({ ok: true, clinics: clinics.map((c) => ({ clinicId: c.clinicId, ok: c.ok, ...(c.result || {}), error: c.error })) });
    }
    const url = new URL(request.url);
    // Authorised against the clinic it will run for, which resolveUserClinicId agrees with below.
    const staff = await requireStaffUser(request, url.searchParams.get("clinicId") || undefined);
    if (!staff.ok) return staff.response;
    const clinicId = await resolveUserClinicId(staff.uid, url.searchParams.get("clinicId") || "");
    if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
    const result = await draftLeadFlow(clinicId, { force: url.searchParams.get("force") === "1" });
    return NextResponse.json({ ok: true, clinicId, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
