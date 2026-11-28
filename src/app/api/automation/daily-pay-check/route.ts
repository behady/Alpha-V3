import { NextResponse } from "next/server";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { reportServerError } from "@/lib/server/reportError";
import { syncDailyPay } from "@/lib/server/dailyPaySync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nightly: put every paid-daily dentist's automatic day's share right.
 *
 * Every money edit already re-works the dentist's lines when it is saved
 * (`lib/server/ledgerAudit.ts` → `dailyPaySync.ts`). This is the safety net for an edit that
 * reached the ledger some other way, or whose re-work failed: each paid-daily dentist's whole
 * history is compared with their payments and only days that differ are written.
 *
 * A clinic with no paid-daily dentist costs one staff query and writes nothing.
 * Cron only (CRON_SECRET); there is nothing here for a person to press.
 */

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function runForClinic(clinicId: string): Promise<{ dentists: number; upserted: number; deleted: number }> {
  const snap = await adminClinicCollection(clinicId, "staff").where("paidDaily", "==", true).get();
  let upserted = 0;
  let deleted = 0;
  for (const doc of snap.docs) {
    try {
      const r = await syncDailyPay(clinicId, doc.id, "all");
      upserted += r.upserted;
      deleted += r.deleted;
    } catch (err) {
      reportServerError("Daily pay check failed", err, { clinicId, staffId: doc.id });
    }
  }
  return { dentists: snap.size, upserted, deleted };
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const results = await forEachActiveClinic(runForClinic);
    const touched = results.filter((r) => r.ok && r.result && (r.result.upserted > 0 || r.result.deleted > 0));
    return NextResponse.json({ ok: true, clinics: results.length, changed: touched.map((r) => ({ clinicId: r.clinicId, ...r.result })) });
  } catch (err) {
    reportServerError("Daily pay check run failed", err);
    return NextResponse.json({ ok: false, error: "Run failed" }, { status: 500 });
  }
}
