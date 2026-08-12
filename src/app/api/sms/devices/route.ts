import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { createPairingCode, listClinicDevices, revokeDevice } from "@/lib/sms/devices";
import { recentSms } from "@/lib/sms/outbox";

/**
 * Managing which phones may send the clinic's reminders.
 *
 * Admin-only throughout. Pairing a phone grants it the standing ability to text every patient in
 * the clinic from the clinic's own number, which is not a receptionist-level decision.
 */

/** GET — paired phones and recent queue activity, for the settings screen. */
export async function GET(request: Request) {
  const admin = await requireAdminUser(request);
  if (!admin.ok) return admin.response;

  try {
    const clinicId = await resolveUserClinicId(admin.uid);
    const [devices, messages] = await Promise.all([listClinicDevices(clinicId), recentSms(clinicId)]);
    return NextResponse.json({ ok: true, devices, messages });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** POST — issue a pairing code for a new phone. */
export async function POST(request: Request) {
  const admin = await requireAdminUser(request);
  if (!admin.ok) return admin.response;

  try {
    const clinicId = await resolveUserClinicId(admin.uid);
    const { code, expiresAt } = await createPairingCode(clinicId, admin.uid);
    return NextResponse.json({ ok: true, code, expiresAt });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** DELETE — unpair a phone, so its token stops working immediately. */
export async function DELETE(request: Request) {
  const admin = await requireAdminUser(request);
  if (!admin.ok) return admin.response;

  try {
    const clinicId = await resolveUserClinicId(admin.uid);
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
