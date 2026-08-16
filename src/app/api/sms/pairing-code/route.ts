import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";

/**
 * Pairing, part one: the website mints a short-lived code for THIS clinic.
 *
 * The clinicId comes from the page the person is looking at, verified against their membership —
 * never resolved from a default. That is the entire point of pairing: the code carries the clinic
 * identity across to the phone explicitly, so nothing on either side has to guess.
 *
 * Ten minutes and single-use. Long enough to walk to wherever the clinic phone charges and type
 * six digits; short enough that a code photographed over a shoulder is stale before it is useful.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { clinicId?: string };
  const clinicId = String(body.clinicId || "").trim();
  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "clinicId is required." }, { status: 400 });
  }

  const authz = await requireStaffUser(request, clinicId);
  if (!authz.ok) return authz.response;

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 10 * 60 * 1000;

  await adminDb().collection("sms_pairing_codes").doc(code).set({
    clinicId,
    used: false,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: authz.uid,
  });

  return NextResponse.json({ ok: true, code, expiresAt });
}
