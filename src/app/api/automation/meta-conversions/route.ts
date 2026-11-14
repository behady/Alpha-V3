import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { isAutomationCallAuthorized } from "@/lib/automation/automationToken";
import { processAllEnabledClinics, processClinicQueue } from "@/lib/metaConversionsServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sends the queued Conversions API events to Meta. Ticked by Vercel every ten minutes.
 *
 * The Firebase trigger only queues — "this appointment was booked / confirmed / visited" — under
 * `clinic_secrets/{clinicId}/meta_conversion_events`. This run finds the ad click behind each one
 * and posts it, retries what Meta bounced, and lets a Purchase wait out its settle period so the
 * day's treatments are in its value. All of that lives in lib/metaConversionsServer; this file is
 * only the door.
 *
 * Two ways in:
 *   - The scheduler (CRON_SECRET, or the shared automation token): every clinic that switched the
 *     feature on. Clinics that never did are not even read.
 *   - An Owner/Admin of one clinic, by hand: that clinic's queue only, so a stuck event can be
 *     pushed without waiting ten minutes. `?clinicId=` picks the clinic on screen.
 */
async function authorize(request: Request) {
  if (await isAutomationCallAuthorized(request)) return { ok: true as const, cron: true as const };
  const requested = new URL(request.url).searchParams.get("clinicId") || "";
  const admin = await requireAdminUser(request, requested || undefined);
  if (!admin.ok) return admin;
  return { ok: true as const, cron: false as const, uid: admin.uid, requested };
}

export async function GET(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;
  try {
    if (!authz.cron) {
      const clinicId = await resolveUserClinicId(authz.uid, authz.requested);
      const summary = await processClinicQueue(clinicId);
      return NextResponse.json({ ok: true, ...summary });
    }
    const runs = await processAllEnabledClinics();
    const total = (k: "sent" | "retried" | "failed" | "skipped") => runs.reduce((n, r) => n + r[k], 0);
    return NextResponse.json({
      ok: true,
      clinics: runs.length,
      sent: total("sent"),
      retried: total("retried"),
      failed: total("failed"),
      skipped: total("skipped"),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export const POST = GET;
