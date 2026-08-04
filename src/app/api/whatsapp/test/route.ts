import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { buildE164FromDialAndNational } from "@/lib/whatsappDialCountries";
import { sendWhatsAppTemplate, sendWhatsAppText } from "@/lib/whatsapp";

/**
 * Connection test for a clinic's WhatsApp number.
 *
 * Defaults to the `hello_world` template rather than free-form text: a first message to a contact
 * is always business-initiated, and Meta only delivers templates outside the 24-hour customer
 * service window. Sending text here would fail with code 131047 for anyone who hasn't messaged
 * the clinic recently — which is exactly the case when you're testing a fresh number.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    dialCode?: string;
    nationalNumber?: string;
    phoneE164?: string;
    message?: string;
    clinicId?: string;
    /** "template" (default) or "text" to exercise the 24-hour window path. */
    mode?: "template" | "text";
    templateName?: string;
    languageCode?: string;
  };

  const authz = await requireStaffUser(request, body.clinicId);
  if (!authz.ok) return authz.response;

  try {
    let to = "";
    if (typeof body.phoneE164 === "string" && body.phoneE164.trim()) {
      to = body.phoneE164.trim();
    } else {
      to = buildE164FromDialAndNational(body.dialCode || "", body.nationalNumber || "");
    }

    if (!to || to.length < 8) {
      return NextResponse.json({ ok: false, error: "Invalid phone number" }, { status: 400 });
    }

    const clinicId = body.clinicId || null;
    const mode = body.mode === "text" ? "text" : "template";

    if (mode === "text") {
      const text =
        typeof body.message === "string" && body.message.trim()
          ? body.message.trim()
          : "Alpha Dental — WhatsApp API test message. If you received this, the integration works.";
      const result = await sendWhatsAppText({ to, text, clinicId });
      return NextResponse.json({ ok: true, to, mode, result });
    }

    const result = await sendWhatsAppTemplate({
      to,
      templateName: body.templateName?.trim() || "hello_world",
      languageCode: body.languageCode?.trim() || "en_US",
      clinicId,
    });
    return NextResponse.json({ ok: true, to, mode, result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Send failed";
    const metaCode = (e as Error & { metaCode?: number })?.metaCode;
    return NextResponse.json({ ok: false, error: message, metaCode }, { status: 500 });
  }
}
