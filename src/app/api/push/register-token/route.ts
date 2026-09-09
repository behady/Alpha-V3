import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { clinicHasFeature } from "@/lib/clinicFeatures";

const MAX_TOKENS = 8;

export async function POST(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json().catch(() => ({}))) as { token?: string; platform?: string; clinicId?: string };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "token required" }, { status: 400 });
    }

    /**
     * The Android app is a plan feature. The app names itself here (`platform: "android"`) and
     * says which clinic it signed into; a plan without the app gets a clear refusal it can show
     * as the upgrade screen. The browser sends neither field and is never gated by this.
     */
    if (body.platform === "android") {
      const clinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";
      if (clinicId && !(await clinicHasFeature(clinicId, "androidApp"))) {
        return NextResponse.json(
          { ok: false, error: "The Android app is included in the Plus, Clinic and Group plans.", code: "plan" },
          { status: 403 }
        );
      }
    }

    const ref = adminDb().collection("users").doc(authz.uid);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data()?.fcmTokens as unknown) : null;
    const list = Array.isArray(existing) ? existing.filter((t) => typeof t === "string") : [];
    const merged = [token, ...list.filter((t) => t !== token)].slice(0, MAX_TOKENS);

    await ref.set(
      {
        fcmTokens: merged,
        fcmTokensUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Register failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
