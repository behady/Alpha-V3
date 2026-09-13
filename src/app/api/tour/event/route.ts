import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { reportServerError } from "@/lib/server/reportError";
import { TOUR_STOP_IDS } from "@/lib/grandTour";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One row per thing that happened on the tour.
 *
 * Through the server rather than straight from the browser, for the ordinary reason: the browser
 * would need write access to a collection, and a collection anyone can write to is a collection
 * anyone can fill. Here the clinic comes from the caller's own membership, the uid and name are
 * taken from the token rather than the body, and the stop id must be one the tour actually has.
 *
 * Nothing here is patient data. The row is: who (staff uid), which stop, what happened, when.
 */

/** Events the client may report. Anything else is dropped rather than stored. */
const EVENTS = new Set([
  "started",
  "stop",
  "skipped_hand",
  "took_over",
  "hands_on_offered",
  "hands_on_started",
  "hands_on_done",
  "hands_on_gave_up",
  "question",
  "finished",
  "left",
]);

const MAX_EVENTS_PER_CALL = 25;
const STOP_IDS = new Set(TOUR_STOP_IDS);

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId : "";
    if (!clinicId) return NextResponse.json({ error: "clinicId is required." }, { status: 400 });

    const authz = await requireStaffUser(request, clinicId);
    if (!authz.ok) return authz.response;

    const rows = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS_PER_CALL) : [];
    if (rows.length === 0) return NextResponse.json({ ok: true, written: 0 });

    const col = adminClinicCollection(clinicId, "tour_events");
    let written = 0;
    for (const row of rows) {
      const event = String(row?.event || "");
      if (!EVENTS.has(event)) continue;
      const stopId = typeof row?.stopId === "string" && STOP_IDS.has(row.stopId) ? row.stopId : null;
      await col.add({
        event,
        stopId,
        run: typeof row?.run === "string" ? row.run.slice(0, 40) : null,
        role: typeof row?.role === "string" ? row.role.slice(0, 20) : null,
        // Free-form, but bounded: a detail object is for "which lesson", not for an essay.
        detail: row?.detail && typeof row.detail === "object" ? JSON.parse(JSON.stringify(row.detail).slice(0, 500)) : null,
        userId: authz.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      written += 1;
    }
    return NextResponse.json({ ok: true, written });
  } catch (error) {
    reportServerError("Tour event log failed:", error);
    // Never a hard failure to the client: the tour must carry on regardless.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
