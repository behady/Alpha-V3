import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import {
  computeAvailableSlots,
  loadPublicClinicProfile,
  normalizeEgyptianMobile,
  PublicBookingError,
} from "@/lib/publicBooking";
import { normalizeDateKey, normalizeTimeKey } from "@/lib/appointmentTime";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public booking — the one endpoint in this system a stranger can reach without a login.
 *
 * Every limit below exists because this endpoint writes to a clinic's live calendar and creates
 * patient records. Previously it had none of them: no rate limit, so one script could fill a
 * clinic's whole month; no validation, so any string became a patient's name and phone number;
 * and its "is this slot free" check counted cancelled appointments as booked while comparing time
 * strings that could never match. The clinic would have arrived one morning to a calendar full of
 * fictional patients, and no way to tell which were real.
 */

/** Upcoming unconfirmed bookings one phone number may hold at once. */
const MAX_OPEN_PER_PHONE = 3;
/** Online requests a clinic will accept for a single day, across all patients. */
const MAX_ONLINE_PER_DAY = 25;
/** How far ahead a booking may be placed. */
const MAX_DAYS_AHEAD = 90;

const MAX_NAME_LENGTH = 80;

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request");
  }

  const clinicId = String(body.clinicId || "").trim();
  const rawDate = String(body.date || "").trim();
  const rawTime = String(body.time || "").trim();
  const doctor = String(body.doctor || "").trim();
  const patientName = String(body.patientName || "").replace(/\s+/g, " ").trim();
  const rawPhone = String(body.patientPhone || "").trim();
  const reason = String(body.reason || "").trim();

  if (!clinicId || !rawDate || !rawTime || !patientName || !rawPhone) {
    return bad("من فضلك املأ كل البيانات المطلوبة.");
  }

  // --- Shape of the input -------------------------------------------------
  if (patientName.length < 2 || patientName.length > MAX_NAME_LENGTH) {
    return bad("الاسم غير صحيح.");
  }

  const phone = normalizeEgyptianMobile(rawPhone);
  if (!phone) {
    return bad("رقم الموبايل غير صحيح. اكتبه بالشكل ده: 01012345678");
  }

  const dateKey = normalizeDateKey(rawDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return bad("التاريخ غير صحيح.");

  const today = normalizeDateKey(new Date().toISOString().split("T")[0]);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + MAX_DAYS_AHEAD);
  if (dateKey < today || dateKey > normalizeDateKey(horizon.toISOString().split("T")[0])) {
    return bad("التاريخ ده مش متاح للحجز.");
  }

  const time = normalizeTimeKey(rawTime);
  if (!/^\d{2}:\d{2} (AM|PM)$/.test(time)) return bad("الميعاد غير صحيح.");

  try {
    const profile = await loadPublicClinicProfile(clinicId);

    // A reason the clinic does not offer suggests a hand-crafted request, not the form.
    if (reason && !profile.reasons.includes(reason)) {
      return bad("سبب الزيارة غير متاح.");
    }
    if (doctor && profile.enableDoctorSelection && !profile.doctors.includes(doctor)) {
      return bad("الدكتور المختار غير متاح.");
    }

    const clinicRef = adminDb().collection("clinics").doc(clinicId);
    const appointmentsRef = clinicRef.collection("appointments");

    // --- Rate limits ------------------------------------------------------
    // Counting existing records rather than keeping a separate counter: it needs no extra
    // storage, survives restarts, and limits what actually matters — junk on the calendar —
    // rather than raw request volume.
    const openForPhoneSnap = await appointmentsRef.where("patientPhone", "==", phone).get();
    const openForPhone = openForPhoneSnap.docs.filter((d) => {
      const a = d.data() || {};
      if (String(a.date || "") < today) return false;
      const status = normalizeAppointmentStatus(String(a.status || ""));
      return status !== "Cancelled" && status !== "No Show";
    }).length;
    if (openForPhone >= MAX_OPEN_PER_PHONE) {
      return bad("عندك حجوزات كتير مفتوحة بالفعل. كلّم العيادة من فضلك.", 429);
    }

    const daySnap = await appointmentsRef.where("date", "==", dateKey).get();
    const onlineThatDay = daySnap.docs.filter((d) => String(d.data()?.source || "") === "online").length;
    if (onlineThatDay >= MAX_ONLINE_PER_DAY) {
      return bad("مفيش أماكن حجز أونلاين لليوم ده. كلّم العيادة من فضلك.", 429);
    }

    // --- Is the slot genuinely free? --------------------------------------
    // Recomputed here rather than trusted from the browser. This single check also enforces
    // opening hours, days off, and appointment length, so a request that skipped the form
    // cannot place a booking at 3am on a Friday.
    const free = await computeAvailableSlots({ clinicId, dateKey, doctorName: doctor || null, profile });
    if (!free.includes(time)) {
      return NextResponse.json(
        { ok: false, error: "الميعاد ده اتحجز خلاص. اختار ميعاد تاني." },
        { status: 409 }
      );
    }

    // --- Patient ----------------------------------------------------------
    const patientsRef = clinicRef.collection("patients");
    const existing = await patientsRef.where("phone", "==", phone).limit(1).get();

    let patientId: string;
    if (existing.empty) {
      const created = await patientsRef.add({
        name: patientName,
        phone,
        createdAt: FieldValue.serverTimestamp(),
        lastVisit: null,
        notes: "Created via Online Booking",
        nextAppointment: dateKey,
        source: "Online Booking",
      });
      patientId = created.id;
    } else {
      patientId = existing.docs[0].id;
    }

    // --- Appointment ------------------------------------------------------
    await appointmentsRef.add({
      patientId,
      patientName,
      patientPhone: phone,
      date: dateKey,
      // Stored in the same `hh:mm AM/PM` form the clinic app writes. The old endpoint stored
      // 24-hour strings, which no other screen was looking for.
      time,
      duration: profile.defaultDurationMinutes,
      doctor: doctor || "Any",
      treatment: reason || "Consultation",
      // "Pending" is not one of the workflow stages, so these requests were invisible to every
      // status filter. "Scheduled" already renders as "Unconfirmed", which is what an online
      // request is; source:"online" below keeps the distinction.
      status: "Scheduled",
      source: "online",
      notes: "Online Booking Request",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, success: true, message: "Appointment requested successfully." });
  } catch (e) {
    if (e instanceof PublicBookingError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    console.error("Public Book API Error:", e);
    return NextResponse.json({ ok: false, error: "حصلت مشكلة. جرب تاني." }, { status: 500 });
  }
}
