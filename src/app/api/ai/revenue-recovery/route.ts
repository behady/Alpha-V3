import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { hasFeature } from "@/lib/subscriptions";
import { scanForLostRevenue } from "@/lib/revenueRecovery";
import type { Clinic } from "@/types/saas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Revenue Recovery scan — a Tier 3 (Premium) capability.
 *
 * Admin-only rather than staff-wide: the report exposes every outstanding balance in the clinic
 * plus a list of procedures charged under list price, which is effectively an audit of the
 * team's own billing.
 *
 * Deliberately does not consume AI credits. The detection is pure querying, and metering it
 * would discourage clinics from running the one report that makes them money.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { clinicId?: string };
  const clinicId = body.clinicId?.trim();

  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
  }

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;

  try {
    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    if (!clinicSnap.exists) {
      return NextResponse.json({ ok: false, error: "Clinic not found" }, { status: 404 });
    }

    const clinic = { id: clinicSnap.id, ...clinicSnap.data() } as Clinic;

    if (!hasFeature(clinic, "aiProactive")) {
      return NextResponse.json(
        {
          ok: false,
          error: "Revenue Recovery is available on the Premium plan.",
          upgradeRequired: true,
        },
        { status: 403 }
      );
    }

    const report = await scanForLostRevenue(clinicId);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed";
    console.error("[RevenueRecovery] scan failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
