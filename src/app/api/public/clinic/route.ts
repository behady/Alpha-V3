import { NextResponse } from "next/server";
import { loadPublicClinicProfile, PublicBookingError } from "@/lib/publicBooking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a patient may see about a clinic before booking: its name, its hours, the reasons it
 * offers, and its dentists' display names.
 *
 * Unauthenticated on purpose — this is a public page. It is safe because it reads through a
 * fixed allow-list on the server rather than handing the browser a database connection: the
 * caller cannot ask for anything this route was not written to return. If online booking is
 * switched off, the clinic answers 404 and nothing at all is disclosed.
 */
export async function GET(request: Request) {
  const clinicId = new URL(request.url).searchParams.get("clinicId")?.trim();
  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "Missing clinicId" }, { status: 400 });
  }

  try {
    const profile = await loadPublicClinicProfile(clinicId);
    return NextResponse.json({
      ok: true,
      clinic: {
        clinicName: profile.clinicName,
        enableDoctorSelection: profile.enableDoctorSelection,
        defaultDurationMinutes: profile.defaultDurationMinutes,
        reasons: profile.reasons,
        doctors: profile.doctors,
        // Only what the date picker needs. Never the raw settings document.
        offDays: profile.schedule.offDays,
        scheduleConfigured: profile.schedule.isConfigured,
      },
    });
  } catch (e) {
    if (e instanceof PublicBookingError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    console.error("public/clinic error:", e);
    return NextResponse.json({ ok: false, error: "Could not load clinic" }, { status: 500 });
  }
}
