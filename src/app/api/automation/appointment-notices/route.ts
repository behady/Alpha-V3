import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { clinicNow } from "@/lib/publicBooking";
import { sendAppointmentPatientMessage } from "@/lib/patientNotifications";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One "your appointment moved" message per move, not one per drag.
 *
 * A receptionist looking for a free slot drags a booking across the calendar half a dozen times.
 * Each drop is a genuine change to a genuine field, so nothing about the write looks wrong — and
 * the old code messaged the patient on every one of them. A real patient received ten templates
 * in nine minutes, each announcing a time that was already stale when it arrived, and Meta
 * charged for all ten. A number doing that is also exactly what a reported business looks like.
 *
 * The edit no longer sends. It stamps `changeNoticePendingAt` on the appointment and this runs a
 * few minutes later, reads wherever the appointment finally landed, and sends once. Re-editing
 * pushes the stamp forward, so the quiet period restarts and the clinic can fiddle as long as it
 * likes for the price of one message.
 *
 * Two guards ride along:
 *   - What the patient was last TOLD is remembered (`noticeSentFor`). Moving a booking and moving
 *     it back says nothing at all, instead of two messages that cancel out.
 *   - A change to an appointment that has already happened, or been cancelled, or is more than a
 *     day in the past is dropped: nobody needs to hear their Tuesday moved on Thursday.
 */

/** How long the calendar must sit still before the patient is told. */
const SETTLE_MS = 6 * 60 * 1000;
/** Past this, a pending notice is stale rather than late — the run that would send it never came. */
const GIVE_UP_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 50;

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function authorize(request: Request) {
  if (isCronAuthorized(request)) return { ok: true as const, cron: true as const };
  const staff = await requireStaffUser(request);
  if (!staff.ok) return staff;
  return { ok: true as const, cron: false as const, uid: staff.uid };
}

/** What the patient would be told, as one comparable string. */
function noticeKey(date: string, time: string, doctor: string): string {
  return [date, time, doctor].map((s) => String(s || "").trim()).join("|");
}

interface NoticeResult {
  appointmentId: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

async function runForClinic(clinicId: string): Promise<{ results: NoticeResult[] }> {
  const now = Date.now();
  const snap = await adminClinicCollection(clinicId, "appointments")
    .where("changeNoticePendingAt", "<=", now - SETTLE_MS)
    .limit(200)
    .get();
  const results: NoticeResult[] = [];
  const today = clinicNow().dateKey;
  let sent = 0;

  for (const doc of snap.docs) {
    if (sent >= MAX_PER_RUN) break;
    const a = doc.data() || {};
    const clear = async (reason: string) => {
      await doc.ref.set({ changeNoticePendingAt: FieldValue.delete() }, { merge: true });
      results.push({ appointmentId: doc.id, status: "skipped", reason });
    };

    const markedAt = Number(a.changeNoticePendingAt) || 0;
    if (now - markedAt > GIVE_UP_MS) {
      await clear("too_old");
      continue;
    }

    const status = normalizeAppointmentStatus(String(a.status || ""));
    // A cancellation sent its own message the moment it happened, and a visit that already took
    // place cannot be moved. Either way there is nothing useful left to say.
    if (status === "Cancelled" || status === "Completed" || status === "No Show") {
      await clear(`status_${status}`);
      continue;
    }

    const date = String(a.date || "").trim();
    const time = String(a.time || "").trim();
    const doctor = String(a.doctor || "").trim();
    const patientId = String(a.patientId || "").trim();
    if (!patientId) {
      await clear("no_patient");
      continue;
    }
    if (date && date < today) {
      await clear("in_the_past");
      continue;
    }

    const key = noticeKey(date, time, doctor);
    if (key === String(a.noticeSentFor || "")) {
      // Moved away and moved back. They already believe the right thing.
      await clear("unchanged_since_last_notice");
      continue;
    }

    try {
      const outcome = await sendAppointmentPatientMessage({ clinicId, patientId, template: "edit", date, time, doctor });
      await doc.ref.set(
        {
          changeNoticePendingAt: FieldValue.delete(),
          noticeSentFor: key,
          noticeSentAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      results.push({
        appointmentId: doc.id,
        status: outcome.status === "sent" || outcome.status === "queued" ? "sent" : "skipped",
        reason: outcome.status === "skipped" ? outcome.reason : undefined,
      });
      if (outcome.status === "sent" || outcome.status === "queued") sent += 1;
    } catch (e) {
      // Left marked so the next run tries again; GIVE_UP_MS stops it trying forever.
      results.push({ appointmentId: doc.id, status: "failed", reason: e instanceof Error ? e.message : "send_failed" });
    }
  }
  return { results };
}

export async function GET(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;
  try {
    if (!authz.cron) {
      const clinicId = await resolveUserClinicId(authz.uid as string);
      return NextResponse.json({ ok: true, clinicId, ...(await runForClinic(clinicId)) });
    }
    const clinics = await forEachActiveClinic((clinicId) => runForClinic(clinicId));
    const results = clinics.flatMap((c) => c.result?.results ?? []);
    return NextResponse.json({
      ok: true,
      sent: results.filter((r) => r.status === "sent").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

export const POST = GET;
