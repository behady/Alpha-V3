import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import {
  disconnectClinicWhatsApp,
  getWhatsAppStatus,
  saveClinicWhatsAppCredentials,
} from "@/lib/whatsappCloudConfig";
import { GRAPH_API_VERSION } from "@/types/whatsappCloud";

/**
 * Per-clinic WhatsApp connection management.
 *
 * Each clinic connects its own WhatsApp Business number, so every operation here is scoped to a
 * clinicId and requires Admin on that specific clinic — not merely Admin somewhere.
 */

/**
 * Ask Meta to confirm the credentials before we store them.
 *
 * Saving unverified credentials means the clinic sees "Connected" and only finds out it's broken
 * when a real patient message silently fails. This turns a typo'd token into an error on the
 * Connect button instead, and hands back the verified name and display number for free.
 */
async function verifyWithMeta(phoneNumberId: string, accessToken: string) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
    phoneNumberId
  )}?fields=display_phone_number,verified_name,quality_rating`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = (payload as { error?: { message?: string; code?: number } }).error;
    const code = err?.code;
    const hint =
      code === 190
        ? "The access token is invalid or expired."
        : code === 100
          ? "That Phone Number ID doesn't exist, or this token can't access it."
          : err?.message || `Meta returned HTTP ${res.status}`;
    throw new Error(hint);
  }

  return payload as { display_phone_number?: string; verified_name?: string };
}

function requireClinicId(url: string): string | null {
  const clinicId = new URL(url).searchParams.get("clinicId")?.trim();
  return clinicId || null;
}

export async function GET(request: Request) {
  const clinicId = requireClinicId(request.url);
  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
  }

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;

  try {
    const status = await getWhatsAppStatus(clinicId);
    return NextResponse.json({ ok: true, ...status });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load WhatsApp status";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      clinicId?: string;
      phoneNumberId?: string;
      accessToken?: string;
      wabaId?: string;
      isTestNumber?: boolean;
    };

    const clinicId = body.clinicId?.trim();
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
    }

    const authz = await requireAdminUser(request, clinicId);
    if (!authz.ok) return authz.response;

    const phoneNumberId = body.phoneNumberId?.trim() || "";
    const accessToken = body.accessToken?.trim() || "";

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json(
        { ok: false, error: "Phone Number ID and access token are both required" },
        { status: 400 }
      );
    }

    const verified = await verifyWithMeta(phoneNumberId, accessToken);

    await saveClinicWhatsAppCredentials(
      clinicId,
      { phoneNumberId, accessToken, wabaId: body.wabaId?.trim() },
      {
        displayPhoneNumber: verified.display_phone_number,
        verifiedName: verified.verified_name,
        isTestNumber: Boolean(body.isTestNumber),
        connectedAt: new Date().toISOString(),
        connectedBy: authz.uid,
      }
    );

    return NextResponse.json({
      ok: true,
      configured: true,
      displayPhoneNumber: verified.display_phone_number,
      verifiedName: verified.verified_name,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to connect WhatsApp";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const clinicId = requireClinicId(request.url);
  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
  }

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;

  try {
    await disconnectClinicWhatsApp(clinicId);
    return NextResponse.json({ ok: true, configured: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to disconnect WhatsApp";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
