import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { clinicNow } from "@/lib/publicBooking";
import { reportServerError } from "@/lib/server/reportError";
import { priceNames } from "@/lib/botPro/proContext";
import { geminiProJson } from "@/lib/botPro/onboarding/jsonModel";
import { ownerChatTurn } from "@/lib/botPro/onboarding/ownerChat";
import { firestoreOnboardingStore } from "@/lib/botPro/onboarding/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pro AI onboarding: one turn of the owner's conversation with Pro, which rewrites the draft layer.
 *
 *   POST { clinicId, text }  ->  { ok: true, reply, draft, dropped }
 *                            |   { ok: false, error: "empty" | "too_long" | "cap" | "not_ready" }  (HTTP 200)
 *                            |   { ok: false, error: "model" }  (HTTP 502: the model failed, nothing changed in the draft)
 *
 * The refusals come back with HTTP 200 on purpose: they are normal answers the screen shows in
 * words (the daily cap, the scan not finished yet). No credits are charged; the Pro key pays.
 */

const NOT_ON = "Pro AI is not switched on for this clinic.";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { clinicId?: unknown; text?: unknown };
  const clinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";
  if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required." }, { status: 400 });
  const text = typeof body.text === "string" ? body.text : "";

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;
  if (!(await clinicHasFeature(clinicId, "whatsappPro").catch(() => false))) {
    return NextResponse.json({ ok: false, error: NOT_ON }, { status: 403 });
  }
  const apiKey = (process.env.GEMINI_PRO_API_KEY || "").trim();
  if (!apiKey) return NextResponse.json({ ok: false, error: "Pro AI key is not set." }, { status: 503 });

  try {
    const model = geminiProJson(apiKey, process.env.GEMINI_PRO_MODEL || "gemini-pro-latest");
    // Names only (the same services read as Pro's price list): the owner chat never sees a price.
    const names = await priceNames(clinicId);
    const out = await ownerChatTurn(firestoreOnboardingStore(clinicId), model, { text, todayKey: clinicNow().dateKey, priceNames: names });
    return NextResponse.json(out);
  } catch (e) {
    reportServerError("pro-onboarding owner chat failed", e, { clinicId });
    return NextResponse.json({ ok: false, error: "model" }, { status: 502 });
  }
}
