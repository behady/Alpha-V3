import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { reportServerError } from "@/lib/server/reportError";
import {
  DAILY_COLLECTION,
  MONTHLY_COLLECTION,
  RETENTION_DAYS,
  buildUsageReport,
  dayMinus,
  usageDay,
  type UsageDoc,
} from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Who used what: the superadmin's usage report, across every clinic.
 *
 *   ?days=7|30|60     the last N days, from the per-day detail (kept two months)
 *   ?month=2026-09    one calendar month, from the summaries that are kept for good
 *
 * Superadmin only. It names staff accounts across clinics, which no clinic may see of another.
 */
export async function GET(request: Request) {
  try {
    const authz = await requireSuperAdmin(request);
    if (!authz.ok) return authz.response;

    const url = new URL(request.url);
    const month = url.searchParams.get("month") || "";
    const db = adminDb();
    let docs: UsageDoc[] = [];
    let period: { from: string; to: string };

    if (/^\d{4}-\d{2}$/.test(month)) {
      const snap = await db.collection(MONTHLY_COLLECTION).where("month", "==", month).limit(5000).get();
      docs = snap.docs.map((d) => d.data() as UsageDoc);
      period = { from: `${month}-01`, to: `${month}-31` };
    } else {
      const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), RETENTION_DAYS);
      const today = usageDay();
      const from = dayMinus(today, days - 1);
      const snap = await db.collection(DAILY_COLLECTION).where("day", ">=", from).limit(20000).get();
      docs = snap.docs.map((d) => d.data() as UsageDoc);
      period = { from, to: today };
    }

    const report = buildUsageReport(docs);

    // Clinic names, for the ids that actually appear.
    const clinicIds = [...new Set(report.people.map((p) => p.clinicId))];
    const clinics: Record<string, string> = {};
    await Promise.all(
      clinicIds.map(async (id) => {
        const snap = await db.collection("clinics").doc(id).get();
        clinics[id] = String(snap.data()?.name || id);
      })
    );

    // Which months have a summary at all, for the period picker.
    const monthsSnap = await db.collection(MONTHLY_COLLECTION).select("month").limit(5000).get();
    const months = [...new Set(monthsSnap.docs.map((d) => String(d.data().month || "")).filter(Boolean))].sort().reverse();

    return NextResponse.json({ ok: true, period, clinics, months, ...report });
  } catch (error) {
    reportServerError("Usage report failed:", error);
    return NextResponse.json({ ok: false, error: "Could not load the usage report." }, { status: 500 });
  }
}
