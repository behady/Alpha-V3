import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { isDeviceAlive, listClinicDevices, revokeDevice } from "@/lib/sms/devices";
import { recentSms } from "@/lib/sms/outbox";

/**
 * Which phones are sending the clinic's reminders.
 *
 * Read-and-revoke only. There is nothing to create here any more: a phone puts itself on this list
 * by turning its own switch on in the app, which is why the pairing-code endpoint is gone.
 *
 * Admin-only. Seeing every patient message the clinic has queued, and being able to stop a phone
 * sending, is not a receptionist-level decision.
 */

/** GET — sender phones and recent queue activity, for the settings screen. */
export async function GET(request: Request) {
  // The clinic on screen wins over the caller's default. The two can differ for anyone who
  // belongs to more than one clinic — a superadmin viewing Clinic B was being shown Clinic A's
  // (empty) device list, which read as "pairing is broken" when nothing was. Membership is
  // checked against the clinic actually asked for.
  const requested = new URL(request.url).searchParams.get("clinicId")?.trim() || "";
  const admin = await requireAdminUser(request, requested || undefined);
  if (!admin.ok) return admin.response;

  try {
    const clinicId = requested || (await resolveUserClinicId(admin.uid));
    const [devices, messages] = await Promise.all([listClinicDevices(clinicId), recentSms(clinicId)]);

    // Liveness is computed here rather than in the browser so the screen cannot disagree with the
    // nightly job about whether a phone counts as available.
    const now = Date.now();
    return NextResponse.json({
      ok: true,
      devices: devices.map((d) => ({ ...d, alive: isDeviceAlive(d, now) })),
      messages,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** DELETE — stop a phone sending. It also stops asking once its own switch is off. */
export async function DELETE(request: Request) {
  const requested = new URL(request.url).searchParams.get("clinicId")?.trim() || "";
  const admin = await requireAdminUser(request, requested || undefined);
  if (!admin.ok) return admin.response;

  try {
    const clinicId = requested || (await resolveUserClinicId(admin.uid));
    const deviceId = new URL(request.url).searchParams.get("deviceId") || "";
    if (!deviceId) return NextResponse.json({ ok: false, error: "deviceId is required" }, { status: 400 });

    const revoked = await revokeDevice(clinicId, deviceId);
    if (!revoked) return NextResponse.json({ ok: false, error: "That phone is not paired to this clinic." }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
