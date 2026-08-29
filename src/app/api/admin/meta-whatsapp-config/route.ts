import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import {
  META_WA_SECRET_FIELD,
  clearMetaWhatsappConfigCache,
  indexMetaPhoneNumber,
  loadMetaWhatsappConfig,
  sendMetaWhatsappText,
} from "@/lib/metaWhatsapp";
import { CLINIC_SECRETS_COLLECTION } from "@/types/wapilot";

/**
 * A clinic's official WhatsApp Cloud API connection.
 *
 * The Meta counterpart of `admin/wapilot-config`, with the same rules learned there: scoped to the
 * caller's own clinic, stored in `clinic_secrets/{clinicId}` where no client rule can read it, and
 * the token is never echoed back — the UI only ever learns that one is stored. The token is pasted
 * here by the clinic Admin precisely so it never has to travel through anything else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const secretDocRef = (clinicId: string) => adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(clinicId);

export async function GET(request: Request) {
  const authz = await requireAdminUser(request);
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid);
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
    }

    const snap = await secretDocRef(clinicId).get();
    const stored = snap.exists
      ? ((snap.data()?.[META_WA_SECRET_FIELD] as Record<string, unknown> | undefined) ?? {})
      : {};

    const phoneNumberId = typeof stored.phoneNumberId === "string" ? stored.phoneNumberId : "";
    const wabaId = typeof stored.wabaId === "string" ? stored.wabaId : "";
    const tokenSet = typeof stored.token === "string" && stored.token.trim().length > 0;

    return NextResponse.json({
      ok: true,
      configured: Boolean(phoneNumberId && tokenSet),
      phoneNumberId,
      wabaId,
      tokenSet,
      updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load Meta WhatsApp connection";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authz = await requireAdminUser(request);
  if (!authz.ok) return authz.response;

  try {
    const clinicId = await resolveUserClinicId(authz.uid);
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      phoneNumberId?: string;
      wabaId?: string;
      token?: string;
      /** Optional: send a test text to this number after saving, to prove the credentials work. */
      testTo?: string;
    };

    const phoneNumberId = typeof body.phoneNumberId === "string" ? body.phoneNumberId.trim() : "";
    if (!/^\d{5,20}$/.test(phoneNumberId)) {
      return NextResponse.json(
        { ok: false, error: "Phone number ID is required (digits only — from the Meta dashboard, not the phone number itself)" },
        { status: 400 }
      );
    }
    const wabaId = typeof body.wabaId === "string" ? body.wabaId.trim() : "";

    const ref = secretDocRef(clinicId);
    const existingSnap = await ref.get();
    const existing = existingSnap.exists
      ? ((existingSnap.data()?.[META_WA_SECRET_FIELD] as Record<string, unknown> | undefined) ?? {})
      : {};

    const existingToken = typeof existing.token === "string" ? existing.token.trim() : "";
    // Empty token field means "keep the stored one" — the UI never shows it back, so re-saving
    // any other field must not wipe the credential.
    const token = typeof body.token === "string" && body.token.trim() ? body.token.trim() : existingToken;
    if (!token) {
      return NextResponse.json({ ok: false, error: "Access token is required on first save" }, { status: 400 });
    }

    await ref.set(
      {
        [META_WA_SECRET_FIELD]: {
          phoneNumberId,
          wabaId,
          token,
          updatedAt: new Date().toISOString(),
          updatedBy: authz.uid,
        },
      },
      { merge: true }
    );

    // The routing index the inbound webhook depends on: without this row, messages to the number
    // arrive and cannot be matched to a clinic. Written on every save so a corrected id heals it.
    await indexMetaPhoneNumber(clinicId, phoneNumberId);
    clearMetaWhatsappConfigCache(clinicId);

    // Optional proof: one real send through the saved credentials, so "saved" and "working" are
    // not different discoveries made days apart.
    let test: { attempted: boolean; ok?: boolean; error?: string } = { attempted: false };
    const testTo = typeof body.testTo === "string" ? body.testTo.trim() : "";
    if (testTo) {
      const config = await loadMetaWhatsappConfig(clinicId, true);
      if (config) {
        const result = await sendMetaWhatsappText({
          config,
          to: testTo,
          text: "✅ تم ربط الواتساب الرسمي بنجاح — Alpha Dental official WhatsApp connected.",
        });
        test = { attempted: true, ok: result.ok, error: result.error };
      }
    }

    return NextResponse.json({ ok: true, configured: true, phoneNumberId, wabaId, tokenSet: true, test });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save Meta WhatsApp connection";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
