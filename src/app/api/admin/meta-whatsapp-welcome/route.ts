import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { resolveUserClinicId } from "@/lib/adminClinicDb";
import { loadMetaWhatsappConfig } from "@/lib/metaWhatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Speak first to people who open the chat from an ad.
 *
 * On the official channel WhatsApp can tell us the moment somebody opens a conversation from a
 * Click-to-WhatsApp ad, before they type — but only if the number has its "welcome message"
 * switched on in Meta's conversational settings. With it on, Meta sends a `request_welcome`
 * event, the webhook treats it as the first turn, and the assistant greets them by the ad they
 * tapped. Without it, the third or so of ad clicks that never type are simply gone.
 *
 * The prompts are the tappable suggestions WhatsApp shows in the empty chat ("ice breakers").
 * They are sent as plain text, so a tap arrives exactly like typing the words — the intent
 * router already understands each of these.
 */
const GRAPH = "https://graph.facebook.com/v21.0";

const PROMPTS_AR = ["عايز أحجز موعد", "الأسعار", "العنوان ومواعيد العمل"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  // Admin of the clinic on screen — the same clinic resolveUserClinicId hands back below.
  const authz = await requireAdminUser(request, url.searchParams.get("clinicId") || undefined, { allowInactive: true });
  if (!authz.ok) return authz.response;
  const clinicId = await resolveUserClinicId(authz.uid, url.searchParams.get("clinicId") || "");
  if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
  const config = await loadMetaWhatsappConfig(clinicId, true);
  if (!config) return NextResponse.json({ ok: true, configured: false, enabled: false });
  try {
    const res = await fetch(`${GRAPH}/${config.phoneNumberId}?fields=conversational_automation`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) return NextResponse.json({ ok: false, configured: true, error: data?.error?.message || `Meta ${res.status}` });
    const auto = data?.conversational_automation || {};
    return NextResponse.json({ ok: true, configured: true, enabled: auto.enable_welcome_message === true, prompts: Array.isArray(auto.prompts) ? auto.prompts : [] });
  } catch (e) {
    return NextResponse.json({ ok: false, configured: true, error: e instanceof Error ? e.message : "failed" });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { clinicId?: string; enable?: boolean };
  const authz = await requireAdminUser(request, typeof body.clinicId === "string" && body.clinicId ? body.clinicId : undefined);
  if (!authz.ok) return authz.response;
  const clinicId = await resolveUserClinicId(authz.uid, typeof body.clinicId === "string" ? body.clinicId : "");
  if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
  const config = await loadMetaWhatsappConfig(clinicId, true);
  if (!config) return NextResponse.json({ ok: false, error: "Official WhatsApp is not connected for this clinic" }, { status: 400 });
  const enable = body.enable !== false;
  try {
    const res = await fetch(`${GRAPH}/${config.phoneNumberId}/conversational_automation`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ enable_welcome_message: enable, prompts: enable ? PROMPTS_AR : [] }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data?.error?.message || `Meta ${res.status}`, code: data?.error?.code });
    }
    return NextResponse.json({ ok: true, enabled: enable, prompts: enable ? PROMPTS_AR : [] });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" });
  }
}
