import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { buildE164FromDialAndNational } from "@/lib/whatsappDialCountries";
import { sendWhatsApp } from "@/lib/whatsapp";

export async function POST(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      dialCode?: string;
      nationalNumber?: string;
      /** Optional full E.164 if client sends it instead */
      phoneE164?: string;
      message?: string;
    };

    let to = "";
    if (typeof body.phoneE164 === "string" && body.phoneE164.trim()) {
      to = body.phoneE164.trim();
    } else {
      to = buildE164FromDialAndNational(body.dialCode || "", body.nationalNumber || "");
    }

    if (!to || to.length < 8) {
      return NextResponse.json({ ok: false, error: "Invalid phone number" }, { status: 400 });
    }

    const text =
      typeof body.message === "string" && body.message.trim()
        ? body.message.trim()
        : "Alpha Dental — WhatsApp API test message. If you received this, the integration works.";

    // The test has to go out over the same credentials the clinic's real messages use, or it
    // proves nothing about whether that clinic can actually send.
    const clinicId = await resolveUserClinicId(authz.uid);
    const result = await sendWhatsApp({ clinicId, to, text });
    return NextResponse.json({ ok: true, to, result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Send failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
