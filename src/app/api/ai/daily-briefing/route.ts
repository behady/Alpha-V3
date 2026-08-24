import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { buildDailyBriefing } from "@/lib/automation/dailyBriefing";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Only today's schedule plus stale balances, but the balance check still walks the ledger. */
export const maxDuration = 60;

/**
 * Today at a glance.
 *
 * Staff-level and not plan-gated: this is the day's own schedule, which everyone on the floor can
 * already see on the appointments screen. Computed fresh per request rather than cached, because
 * it is small and a stale schedule is worse than no schedule.
 *
 * The date comes from the clinic's timezone, not the server's — a briefing that flips to
 * "tomorrow" at midnight UTC would be wrong for most of the working day in Cairo.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinicId = url.searchParams.get("clinicId")?.trim() || undefined;

  const authz = await requireStaffUser(request, requestedClinicId, { allowInactive: true });
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
    const dateKey = url.searchParams.get("date")?.trim() || ymdInTimeZone(clinicTimeZone());

    const briefing = await buildDailyBriefing(clinicId, dateKey);
    return NextResponse.json({ ok: true, briefing });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not build the briefing";
    reportServerError("[DailyBriefing] failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
