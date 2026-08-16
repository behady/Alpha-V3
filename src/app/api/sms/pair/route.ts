import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * Pairing, part two: the phone redeems the code the website showed.
 *
 * This exists because "which clinic does this phone send for?" used to be answered by guessing —
 * the phone used its signed-in user's default clinic, the settings page used the viewer's default
 * clinic, and for anyone who belongs to more than one clinic the two guesses could disagree,
 * leaving a working phone invisible on the screen that was supposed to show it. A code typed from
 * one screen into the other replaces both guesses with a statement.
 *
 * Redeeming requires BOTH the code and staff membership of the code's clinic. The code alone must
 * not be enough: it is six digits shown on a screen in a busy reception, and whoever glimpses it
 * should gain nothing without also holding a signed-in staff account there.
 *
 * On success the server writes the device row itself, so the phone appears in the settings list
 * the same second — pairing that "worked" but shows nothing for fifteen minutes reads as broken.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    deviceId?: string;
    deviceName?: string;
  };

  const code = String(body.code || "").replace(/\D/g, "");
  const deviceId = String(body.deviceId || "").trim();
  const deviceName = String(body.deviceName || "").trim() || "Clinic phone";

  if (code.length !== 6 || !deviceId) {
    return NextResponse.json({ ok: false, error: "A 6-digit code and a device are required." }, { status: 400 });
  }

  const db = adminDb();
  const codeRef = db.collection("sms_pairing_codes").doc(code);
  const snap = await codeRef.get();
  const data = snap.data();

  if (!snap.exists || !data || data.used === true) {
    return NextResponse.json({ ok: false, error: "This code is not valid. Generate a fresh one on the website." }, { status: 400 });
  }
  const expiresAt = typeof data.expiresAt === "number" ? data.expiresAt : 0;
  if (Date.now() > expiresAt) {
    return NextResponse.json({ ok: false, error: "This code has expired. Generate a fresh one on the website." }, { status: 400 });
  }

  const clinicId = String(data.clinicId || "");
  const authz = await requireStaffUser(request, clinicId);
  if (!authz.ok) return authz.response;

  // Burn the code before writing the device: a code that pairs two phones is worse than one that
  // occasionally has to be regenerated.
  await codeRef.update({ used: true, usedAt: FieldValue.serverTimestamp(), usedByUid: authz.uid });

  await db
    .collection("clinics")
    .doc(clinicId)
    .collection("sms_devices")
    .doc(deviceId)
    .set(
      {
        name: deviceName,
        platform: "android",
        enabled: true,
        lastSeenAt: new Date().toISOString(),
        pairedAt: FieldValue.serverTimestamp(),
        pairedByUid: authz.uid,
      },
      { merge: true }
    );

  return NextResponse.json({ ok: true, clinicId });
}
