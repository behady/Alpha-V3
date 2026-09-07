import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { loadWhatsappMonthCost, monthKeyOf } from "@/lib/whatsappCostLog";

/**
 * What the clinic's WhatsApp actually costs, for one month.
 *
 * Read-only, and scoped to the clinic on screen rather than the caller's default — the platform
 * owner has no role on a client's clinic and would otherwise be shown their own empty figures
 * under the client's name, a trap this codebase has already fallen into twice.
 *
 * Returns Meta's own billed figure when it has one and our running estimate alongside it, never
 * one in place of the other: the estimate is available immediately and covers what Meta has not
 * reported yet, and the gap between the two is itself worth seeing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authz = await requireAdminUser(request);
  if (!authz.ok) return authz.response;

  try {
    const url = new URL(request.url);
    const clinicId = await resolveUserClinicId(authz.uid, url.searchParams.get("clinicId") || "");
    if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });

    const requested = String(url.searchParams.get("month") || "").trim();
    const monthKey = /^\d{4}-\d{2}$/.test(requested) ? requested : monthKeyOf();

    const cost = await loadWhatsappMonthCost(clinicId, monthKey);
    return NextResponse.json({ ok: true, cost });
  } catch (e) {
    console.error("whatsapp-cost failed", e);
    return NextResponse.json({ ok: false, error: "Failed to load WhatsApp cost" }, { status: 500 });
  }
}
