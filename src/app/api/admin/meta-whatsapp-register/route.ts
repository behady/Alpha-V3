import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { loadMetaWhatsappConfig } from "@/lib/metaWhatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Register (or re-register) a phone number on the WhatsApp Cloud API.
 *
 * Exists because Meta's own dashboard answers every failure with "Registration failed. Please try
 * again." and nothing else, while the API behind it returns a precise code — wrong PIN, number
 * still active in the WhatsApp app, re-verification needed, too many attempts. This route calls
 * that API directly and hands the clinic the real reason.
 *
 * It is also the recurring need: a number has to be re-registered after certain Meta-side changes,
 * and that should not require the dev console.
 *
 * The PIN is relayed and never stored, logged or echoed. It arrives over HTTPS from the clinic
 * Admin's own screen and goes to Meta in the same request; nothing here keeps it.
 */

/** Meta's registration error codes, in words a receptionist can act on. */
function explain(code: number | undefined, message: string): string {
  switch (code) {
    case 133005:
      return "Wrong PIN. This number already has a PIN from an earlier registration — use that one.";
    case 133006:
      return "The number needs its SMS verification again. Go to WhatsApp Manager → Phone numbers and verify it, then retry.";
    case 133016:
      return "Too many registration attempts. Meta has temporarily locked this number — wait a few hours and try once.";
    case 133008:
    case 133009:
    case 133010:
      return "Verification code problem. Re-verify the number in WhatsApp Manager and retry.";
    case 133015:
      return "The number is still registered in the WhatsApp app on a phone. Open WhatsApp on that phone → Settings → Account → Delete my account, wait 5 minutes, then retry.";
    case 131000:
      return "Meta's side failed for no stated reason. Wait a minute and try once more.";
    default:
      return message || "Meta did not say why.";
  }
}

export async function POST(request: Request) {
  const authz = await requireAdminUser(request);
  if (!authz.ok) return authz.response;

  const body = (await request.json().catch(() => ({}))) as { clinicId?: string; phoneNumberId?: string; pin?: string };
  // The clinic on screen, not the caller's default — the token lives on the clinic being set up,
  // and a platform owner configuring a client clinic is not a member of it. resolveUserClinicId
  // still refuses any clinic the caller has no role on (superadmins excepted).
  const clinicId = await resolveUserClinicId(authz.uid, typeof body.clinicId === "string" ? body.clinicId : "");
  if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
  const phoneNumberId = typeof body.phoneNumberId === "string" ? body.phoneNumberId.trim() : "";
  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!/^\d{5,20}$/.test(phoneNumberId)) {
    return NextResponse.json({ ok: false, error: "Phone Number ID must be digits" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ ok: false, error: "PIN must be exactly 6 digits" }, { status: 400 });
  }

  // The stored token is the credential; the number being registered may be a NEW one the clinic
  // has not saved yet — that is the whole point of registering before switching over.
  const config = await loadMetaWhatsappConfig(clinicId);
  if (!config?.token) {
    return NextResponse.json({ ok: false, error: "Save the Meta access token first" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;

    if (!res.ok || data?.success === false) {
      const code = Number(data?.error?.code) || undefined;
      const sub = Number(data?.error?.error_subcode) || undefined;
      const raw = String(data?.error?.error_user_msg || data?.error?.message || "");
      return NextResponse.json({
        ok: false,
        code,
        subcode: sub,
        error: explain(code, raw),
        raw: raw.slice(0, 300),
      });
    }

    // Read back the state so the screen shows what Meta now believes, not what we hoped.
    const check = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,status,platform_type,is_pin_enabled`,
      { headers: { Authorization: `Bearer ${config.token}` } }
    );
    const state = (await check.json().catch(() => ({}))) as Record<string, any>;
    return NextResponse.json({
      ok: true,
      phone: state.display_phone_number,
      status: state.status,
      platform: state.platform_type,
      pinEnabled: state.is_pin_enabled === true,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Register failed" }, { status: 500 });
  }
}
