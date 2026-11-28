import { reportServerError } from "@/lib/server/reportError";
/**
 * Turn "Paid daily" on or off for one dentist.
 *
 * POST { clinicId, staffId, paidDaily: boolean }
 *
 * Admins only. Turning it on stamps today (clinic time) as `paidDailyFrom` and at once writes the
 * day's share for the payments already taken today, so the Team page and Finance agree from the
 * first minute. Turning it off stops new lines; the ones already written stay as history.
 * See lib/dailyPay.ts.
 */

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { dailyPayStart } from "@/lib/dailyPay";
import { logActivityServer } from "@/lib/server/systemLog";
import { syncDailyPay } from "@/lib/server/dailyPaySync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request");
  }
  const requestedClinicId = typeof body.clinicId === "string" ? body.clinicId : null;
  const authz = await requireAdminUser(request, requestedClinicId || undefined);
  if (!authz.ok) return authz.response;
  let clinicId: string;
  try {
    clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
  } catch (e) {
    return bad(e instanceof Error ? e.message : "No clinic for this account.", 403);
  }

  const staffId = String(body.staffId || "").trim();
  if (!staffId) return bad("Which staff member?");
  if (typeof body.paidDaily !== "boolean") return bad("Say whether this dentist is paid daily.");
  const on = body.paidDaily;

  try {
    const ref = adminClinicDoc(clinicId, "staff", staffId);
    const snap = await ref.get();
    if (!snap.exists) return bad("That staff member no longer exists.", 404);
    const data = snap.data() || {};
    const name = String(data.name || "").trim() || "Staff";
    const wasOn = dailyPayStart(data) !== null;
    if (on === wasOn) return NextResponse.json({ ok: true, paidDaily: on, paidDailyFrom: data.paidDailyFrom ?? null, unchanged: true });

    const today = ymdInTimeZone(clinicTimeZone());
    const patch = on
      ? { paidDaily: true, paidDailyFrom: today, paidDailyUpdatedAt: FieldValue.serverTimestamp(), paidDailyUpdatedBy: authz.name }
      : { paidDaily: false, paidDailyUpdatedAt: FieldValue.serverTimestamp(), paidDailyUpdatedBy: authz.name };
    await ref.update(patch);
    await logActivityServer({
      clinicId,
      user: { uid: authz.uid, name: authz.name, role: authz.role },
      action: on ? "Paid Daily Turned On" : "Paid Daily Turned Off",
      details: on ? `${name} now takes their share from each payment, from ${today}` : `${name} is no longer paid daily; their share adds up as owed again`,
      severity: "MEDIUM",
      module: "finance",
    });

    let written = { upserted: 0, deleted: 0 };
    if (on) written = await syncDailyPay(clinicId, staffId, "all");
    return NextResponse.json({ ok: true, paidDaily: on, paidDailyFrom: on ? today : data.paidDailyFrom ?? null, ...written });
  } catch (e) {
    reportServerError("staff/daily-pay failed", e, { staffId });
    return bad("Something went wrong saving that. Nothing was changed.", 500);
  }
}
