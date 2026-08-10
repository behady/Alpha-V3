import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { scanUnresolvedAppointments } from "@/lib/automation/unresolvedAppointments";
import { scanNoShowRisk } from "@/lib/automation/noShowRisk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Reads the full appointment history to score no-show risk. See revenue-recovery for why. */
export const maxDuration = 120;

/** The only two answers to "did they come?" that this endpoint will record. */
const ALLOWED_OUTCOMES = new Set(["Completed", "No Show"]);

/**
 * Attendance: what was never closed out, and what the closed-out history implies.
 *
 * Staff-level. Resolving an appointment is ordinary front-desk work — the same edit already
 * available from the appointment screen's status dropdown, just reachable from the list of ones
 * that need it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedClinicId = url.searchParams.get("clinicId")?.trim() || undefined;

  const authz = await requireStaffUser(request, requestedClinicId);
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
    const [unresolved, risk] = await Promise.all([
      scanUnresolvedAppointments(clinicId),
      scanNoShowRisk(clinicId),
    ]);
    return NextResponse.json({ ok: true, unresolved, risk });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed";
    console.error("[Attendance] scan failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Record whether a past appointment was attended or missed.
 *
 * Restricted to those two outcomes: this endpoint exists to close out history, not as a general
 * status editor. Anything else belongs on the appointment screen where the full workflow is
 * visible. The statusHistory entry matches what the dashboard writes, so a correction made here
 * is indistinguishable from one made there.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    clinicId?: string;
    appointmentId?: string;
    outcome?: string;
    userName?: string;
  };

  const requestedClinicId = body.clinicId?.trim();
  if (!requestedClinicId || !body.appointmentId) {
    return NextResponse.json({ ok: false, error: "clinicId and appointmentId are required" }, { status: 400 });
  }
  if (!body.outcome || !ALLOWED_OUTCOMES.has(body.outcome)) {
    return NextResponse.json(
      { ok: false, error: "outcome must be 'Completed' or 'No Show'" },
      { status: 400 }
    );
  }

  const authz = await requireStaffUser(request, requestedClinicId);
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid, requestedClinicId);
    const ref = adminClinicDoc(clinicId, "appointments", body.appointmentId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
    }

    const actor = body.userName || authz.uid;

    await ref.update({
      status: body.outcome,
      modifiedBy: actor,
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: body.outcome,
        timestamp: new Date(),
        modifiedBy: actor,
      }),
    });

    return NextResponse.json({ ok: true, status: body.outcome });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not update that appointment";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
