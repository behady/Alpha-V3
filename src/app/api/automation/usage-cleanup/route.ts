import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { reportServerError } from "@/lib/server/reportError";
import { DAILY_COLLECTION, RETENTION_DAYS, dayMinus, usageDay } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Nightly: deletes the per-day usage documents older than two months.
 *
 * Nothing has to be "summarised" first — every beat already added itself to the person's month
 * document as it arrived (see /api/usage/beat), so by the time a day is old enough to delete, its
 * figures are in the summary that stays. This only removes the detail.
 *
 * Touches `usage_daily` and nothing else. No clinic record is read or written.
 */

const MAX_PER_RUN = 4000;

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function run() {
  const db = adminDb();
  const cutoff = dayMinus(usageDay(), RETENTION_DAYS);
  let deleted = 0;
  while (deleted < MAX_PER_RUN) {
    const snap = await db.collection(DAILY_COLLECTION).where("day", "<", cutoff).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (snap.size < 400) break;
  }
  return { cutoff, deleted };
}

export async function GET(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      const authz = await requireSuperAdmin(request);
      if (!authz.ok) return authz.response;
    }
    return NextResponse.json({ ok: true, ...(await run()) });
  } catch (error) {
    reportServerError("Usage cleanup failed:", error);
    return NextResponse.json({ ok: false, error: "Usage cleanup failed" }, { status: 500 });
  }
}
