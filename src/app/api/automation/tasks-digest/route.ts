import { NextResponse } from "next/server";
import { reportServerError } from "@/lib/server/reportError";
import { runTasksDigest } from "@/lib/server/tasksDigest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hourly (vercel.json). Sends the platform owner's Tasks message once a day, at the Cairo hour
 * saved on the Tasks tab; every other run is one settings read and nothing else. Cron only —
 * the "Send now" button goes through /api/admin/tasks/digest instead.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || (request.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runTasksDigest();
    return NextResponse.json({ ok: true, ...result, to: undefined });
  } catch (error) {
    reportServerError("tasks digest cron error:", error);
    return NextResponse.json({ ok: false, error: "Digest failed" }, { status: 500 });
  }
}
