import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { runAllBroadcastTicks } from "@/lib/broadcast/server";

/**
 * Every ten minutes: release the next few messages of each running patient broadcast.
 * The pacing rules live in lib/broadcast/server.ts (runBroadcastTick).
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
  const results = await runAllBroadcastTicks();
  return NextResponse.json({ ok: true, broadcasts: results, ms: Date.now() - startedAt });
}
