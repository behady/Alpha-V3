import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { clinicTimeZone } from "@/lib/clinicDate";
import { resolveNotify } from "@/lib/notificationCatalog";
import { deliverClinicNotification, readAlertPreferences } from "@/lib/notificationDelivery";
import { punchAlertText, shiftStartFor } from "@/lib/alerts/punchAlert";

/**
 * Tell the owner somebody just clocked in or out (`staffClockInOut`, off unless the clinic
 * switched it on).
 *
 * The attendance page saves the punch straight to Firestore, then calls this with the record's id.
 * Nothing the browser sends is believed except that id: the name, the time, the branch and the
 * lateness are read from the saved record and the person's roster here, so a page cannot put words
 * in the owner's phone. Only the person who punched may ring it, only for a punch made in the last
 * few minutes, and only once per punch (a marker in `alert_marks`).
 *
 * Not for the automatic clock-out at night: that record carries `autoClosed` and is not a punch
 * anybody made.
 */

const FRESH_MS = 15 * 60_000;

function toMs(v: unknown): number {
  if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : 0;
}

function clockOf(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: clinicTimeZone(), hour12: false, hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { clinicId?: string; attendanceId?: string; direction?: string };
    const clinicId = str(body.clinicId);
    const attendanceId = str(body.attendanceId);
    const direction = body.direction === "out" ? "out" : body.direction === "in" ? "in" : null;
    if (!clinicId || !attendanceId || !direction || attendanceId.includes("/")) {
      return NextResponse.json({ ok: false, error: "clinicId, attendanceId and direction are required" }, { status: 400 });
    }

    const staff = await requireStaffUser(request, clinicId);
    if (!staff.ok) return staff.response;

    // The cheap question first: almost every clinic has this switched off.
    const prefs = await readAlertPreferences(clinicId);
    const resolved = resolveNotify("staffClockInOut", prefs);
    if (!resolved || !(resolved.bell || resolved.push || resolved.whatsapp)) {
      return NextResponse.json({ ok: true, raised: false, reason: "off" });
    }

    const snap = await adminClinicDoc(clinicId, "attendance", attendanceId).get();
    const punch = snap.data();
    if (!punch) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (str(punch.userId) !== staff.uid) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (direction === "out" && punch.autoClosed) return NextResponse.json({ ok: true, raised: false, reason: "auto" });

    const at = toMs(direction === "in" ? punch.checkIn : punch.checkOut);
    if (!at || Math.abs(Date.now() - at) > FRESH_MS) {
      return NextResponse.json({ ok: true, raised: false, reason: "stale" });
    }

    try {
      await adminClinicDoc(clinicId, "alert_marks", `staffClockInOut_${direction}_${attendanceId}`).create({ at: FieldValue.serverTimestamp() });
    } catch {
      return NextResponse.json({ ok: true, raised: false, reason: "sent" });
    }

    const staffId = str(punch.staffId);
    const profile = staffId ? (await adminClinicDoc(clinicId, "staff", staffId).get()).data() : undefined;
    const text = punchAlertText({
      direction,
      name: str(profile?.name) || str(punch.userName) || "Staff",
      at: clockOf(at),
      shiftStart: shiftStartFor(profile?.attendanceSchedule, str(punch.date)),
      branch: str(direction === "in" ? punch.checkInBranchName : punch.checkOutBranchName) || null,
      durationMinutes: Number(punch.durationMinutes) || 0,
    });

    const result = await deliverClinicNotification(clinicId, text, {
      event: "staffClockInOut",
      channel: "alpha_clinic",
      actionUrl: "/attendance",
      data: { screen: "attendance" },
    });
    return NextResponse.json({ ok: true, raised: result.raised });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
