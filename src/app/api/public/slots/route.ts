import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import {
  computeAvailableSlots,
  isClinicClosedOn,
  loadPublicClinicProfile,
  PublicBookingError,
} from "@/lib/publicBooking";
import { normalizeDateKey } from "@/lib/appointmentTime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How far ahead a stranger may probe the calendar. */
const MAX_DAYS_AHEAD = 90;

/**
 * Free start times for one date.
 *
 * Returns only times, never the appointments they were derived from — a patient must not be able
 * to learn who else is booked, or how busy the clinic is beyond what a booking form needs.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const clinicId = params.get("clinicId")?.trim();
  const rawDate = params.get("date")?.trim();
  const doctor = params.get("doctor")?.trim() || null;
  const branchId = params.get("branch")?.trim() || null;

  if (!clinicId || !rawDate) {
    return NextResponse.json({ ok: false, error: "Missing clinicId or date" }, { status: 400 });
  }

  const dateKey = normalizeDateKey(rawDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return NextResponse.json({ ok: false, error: "Invalid date" }, { status: 400 });
  }

  const today = normalizeDateKey(new Date().toISOString().split("T")[0]);
  const limit = new Date();
  limit.setDate(limit.getDate() + MAX_DAYS_AHEAD);
  if (dateKey < today || dateKey > normalizeDateKey(limit.toISOString().split("T")[0])) {
    return NextResponse.json({ ok: true, slots: [], closed: true });
  }

  try {
    const profile = await loadPublicClinicProfile(clinicId);
    if (isClinicClosedOn(dateKey, profile.schedule)) {
      return NextResponse.json({ ok: true, slots: [], closed: true });
    }
    if (branchId && !profile.branches.some((b) => b.id === branchId)) {
      return NextResponse.json({ ok: false, error: "Unknown branch" }, { status: 400 });
    }
    const slots = await computeAvailableSlots({ clinicId, dateKey, doctorName: doctor, branchId, profile });
    return NextResponse.json({ ok: true, slots, closed: false });
  } catch (e) {
    if (e instanceof PublicBookingError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    reportServerError("public/slots error:", e);
    return NextResponse.json({ ok: false, error: "Could not load availability" }, { status: 500 });
  }
}
