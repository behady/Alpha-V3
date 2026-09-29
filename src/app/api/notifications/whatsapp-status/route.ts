import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { staffWhatsappStatus } from "@/lib/staffWhatsapp";

/**
 * Which number this clinic's staff alerts leave from, for the line under the WhatsApp column on
 * Settings → Alerts & Reports: the clinic's own official number, its own Wapilot number, Alpha's
 * alerts line, or nothing — and if nothing, why.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const clinicId = new URL(request.url).searchParams.get("clinicId")?.trim() || "";
  if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
  const staff = await requireStaffUser(request, clinicId);
  if (!staff.ok) return staff.response;
  try {
    return NextResponse.json({ ok: true, ...(await staffWhatsappStatus(clinicId)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
