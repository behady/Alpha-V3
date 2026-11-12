import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { clinicTimeZone } from "@/lib/clinicDate";
import { decideAutoClose, parseAutoCloseHours, type WeekSchedule } from "@/lib/attendanceAutoClose";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Closes shifts that were never clocked out.
 *
 * Clocking out needs the person to be in the clinic, so a forgotten clock-out stayed open until
 * they came back and was recorded as a 24-hour (or four-day) shift. With the clinic's
 * "auto clock-out" hours set in Settings → Attendance, an open shift is closed at
 * shift end + those hours. A clinic that has not set the number is not touched at all.
 *
 * The recorded clock-out is the cutoff itself, never the time this job ran, and the row is
 * marked `autoClosed` so nobody mistakes it for a punch the person made.
 */

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

function toDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") return (value as { toDate: () => Date }).toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function scheduleFor(clinicId: string, log: Record<string, unknown>, cache: Map<string, WeekSchedule | null>) {
  const staffId = typeof log.staffId === "string" ? log.staffId : "";
  const userId = typeof log.userId === "string" ? log.userId : "";
  const key = staffId || userId;
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  let data: Record<string, unknown> | undefined;
  if (staffId) data = (await adminClinicDoc(clinicId, "staff", staffId).get()).data();
  if (!data && userId) {
    // Older rows carry only the sign-in id; the staff record is found by it.
    const byUid = await adminClinicCollection(clinicId, "staff").where("uid", "==", userId).limit(1).get();
    data = byUid.docs[0]?.data();
  }
  const schedule = data && typeof data.attendanceSchedule === "object" && data.attendanceSchedule
    ? (data.attendanceSchedule as WeekSchedule)
    : null;
  cache.set(key, schedule);
  return schedule;
}

async function runForClinic(clinicId: string, now: Date): Promise<{ closed: number; open: number; enabled: boolean }> {
  const info = ((await adminClinicDoc(clinicId, "settings", "clinic_info").get()).data() || {}) as Record<string, unknown>;
  const hours = parseAutoCloseHours(info.attendanceAutoCloseHours);
  if (hours === null) return { closed: 0, open: 0, enabled: false };

  const clinicSchedule = info.schedule as { end?: unknown } | undefined;
  const clinicEnd = typeof clinicSchedule?.end === "string" ? clinicSchedule.end : null;
  const timeZone = clinicTimeZone();

  const open = await adminClinicCollection(clinicId, "attendance").where("status", "==", "active").get();
  const schedules = new Map<string, WeekSchedule | null>();
  let closed = 0;

  for (const doc of open.docs) {
    const log = doc.data() as Record<string, unknown>;
    const checkIn = toDate(log.checkIn);
    if (!checkIn) continue;

    const decision = decideAutoClose({
      checkIn,
      schedule: await scheduleFor(clinicId, log, schedules),
      clinicEnd,
      hours,
      timeZone,
      now,
    });
    if (!decision.close) continue;

    // Re-read inside a transaction: the person may be clocking out by hand at this very moment,
    // and their real punch must not be overwritten by ours.
    const didClose = await adminDb().runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists || fresh.data()?.status !== "active") return false;
      tx.update(doc.ref, {
        checkOut: Timestamp.fromDate(decision.cutoff),
        durationMinutes: decision.durationMinutes,
        status: "completed",
        autoClosed: true,
        autoClosedAt: FieldValue.serverTimestamp(),
        autoCloseHours: hours,
      });
      return true;
    });
    if (didClose) closed += 1;
  }

  return { closed, open: open.size, enabled: true };
}

export async function GET(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;
  const now = new Date();
  try {
    if (!authz.cron) {
      const clinicId = await resolveUserClinicId(authz.uid as string);
      return NextResponse.json({ ok: true, clinicId, ...(await runForClinic(clinicId, now)) });
    }
    const clinics = await forEachActiveClinic((clinicId) => runForClinic(clinicId, now));
    return NextResponse.json({
      ok: true,
      clinicsEnabled: clinics.filter((c) => c.result?.enabled).length,
      closed: clinics.reduce((sum, c) => sum + (c.result?.closed ?? 0), 0),
      failed: clinics.filter((c) => !c.ok).map((c) => ({ clinicId: c.clinicId, error: c.error })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
