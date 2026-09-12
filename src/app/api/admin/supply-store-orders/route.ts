import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { summariseCommission, type SupplyCommissionRow } from "@/lib/supplyStore";

/**
 * What the supply store has earned the platform, and from whom.
 *
 * SUPERADMIN ONLY. This is the invoice you send your partner at month end, so it reads from
 * `supply_commissions` — the root collection firestore.rules denies to every client, written only
 * by the order route. There is no clinic-scoped version of this and there must never be one.
 *
 * Reads only. The figures are frozen at order time and updated only when a status changes.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authz = await requireSuperAdmin(request);
  if (!authz.ok) return authz.response;

  try {
    const url = new URL(request.url);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 200));

    const snap = await adminDb()
      .collection("supply_commissions")
      .orderBy("placedAt", "desc")
      .limit(limit)
      .get();

    const rows = snap.docs.map((doc) => doc.data() as SupplyCommissionRow);
    const summary = summariseCommission(rows);

    return NextResponse.json({ ok: true, rows, ...summary });
  } catch (error) {
    // An index that has not been built yet fails here, and the message says which — worth
    // surfacing to a superadmin rather than swallowing into an empty table.
    const message = error instanceof Error ? error.message : "Could not load supply store earnings";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
