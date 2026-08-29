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

    // Subscribe the app to the WABA's webhooks, when a WABA id was given. Without this call the
    // callback URL verifies and then never receives a message — a silence indistinguishable from
    // everything else being broken. Best-effort and reported, never fatal to the save.
    let subscribed: { attempted: boolean; ok?: boolean; error?: string } = { attempted: false };
    if (wabaId) {
      try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, any>;
        subscribed = { attempted: true, ok: res.ok && data?.success !== false, error: data?.error?.message };
      } catch (e) {
        subscribed = { attempted: true, ok: false, error: e instanceof Error ? e.message : "failed" };
      }
    }

    // Optional proof: one real send through the saved credentials, so "saved" and "working" are
    // not different discoveries made days apart.
    let test: { attempted: boolean; ok?: boolean; error?: string } = { attempted: false };
    const testTo = typeof body.testTo === "string" ? body.testTo.trim() : "";
    if (testTo) {
      const config = await loadMetaWhatsappConfig(clinicId, true);
      if (config) {
        /*
         * A template, not free text. WhatsApp only delivers free-form text inside the 24-hour
         * window a customer's own message opens — outside it, the API answers "accepted" and the
         * message silently never arrives, which made the first live connection test read as
         * broken credentials when the credentials were fine. hello_world ships pre-approved on
         * test numbers; a real number without it falls back to text, and that fallback arriving
         * proves the window was open anyway.
         */
        const digits = testTo.replace(/\D/g, "");
        let ok = false;
        let error: string | undefined;
        try {
          const res = await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: digits,
              type: "template",
              template: { name: "hello_world", language: { code: "en_US" } },
            }),
          });
          const data = (await res.json().catch(() => ({}))) as Record<string, any>;
          ok = res.ok;
          error = data?.error?.message;
        } catch (e) {
          error = e instanceof Error ? e.message : "failed";
        }
        if (!ok) {
          const result = await sendMetaWhatsappText({
            config,
            to: testTo,
            text: "✅ تم ربط الواتساب الرسمي بنجاح — Alpha Dental official WhatsApp connected.",
          });
          ok = result.ok;
          error = result.error || error;
        }
        test = { attempted: true, ok, error };
      }
    }

    return NextResponse.json({ ok: true, configured: true, phoneNumberId, wabaId, tokenSet: true, test, subscribed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save Meta WhatsApp connection";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
