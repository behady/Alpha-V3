import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { reportServerError } from "@/lib/server/reportError";
import { sanitizeLayer } from "@/lib/botPro/layer";
import { firestoreOnboardingStore } from "@/lib/botPro/onboarding/store";
import { publicOnboardingState, versionRows } from "@/lib/botPro/onboarding/publicState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pro AI onboarding, the screen's read and its manual edit.
 *
 *   GET ?clinicId=        the state (never the scan queue or the lock), the last 60 chat rows and
 *                         the saved versions
 *   PUT { clinicId, draft }   the owner's own edit of the draft layer, through the sanitiser
 *
 * Admin of that clinic only, and only when the whatsappPro add-on is on. No model call here, so
 * the Pro key is not needed.
 */

const NOT_ON = "Pro AI is not switched on for this clinic.";

export async function GET(request: Request) {
  const clinicId = (new URL(request.url).searchParams.get("clinicId") || "").trim();
  if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required." }, { status: 400 });

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;
  if (!(await clinicHasFeature(clinicId, "whatsappPro").catch(() => false))) {
    return NextResponse.json({ ok: false, error: NOT_ON }, { status: 403 });
  }

  try {
    const store = firestoreOnboardingStore(clinicId);
    const [state, chat, versions] = await Promise.all([store.getState(), store.recentChat(60), store.listVersions()]);
    return NextResponse.json({
      ok: true,
      state: publicOnboardingState(state),
      chat: chat.map((r) => ({ role: r.role, text: r.text, at: r.at ?? 0 })),
      versions: versionRows(versions),
    });
  } catch (e) {
    reportServerError("pro-onboarding GET failed", e, { clinicId });
    return NextResponse.json({ ok: false, error: "Could not read the Pro AI set-up." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { clinicId?: unknown; draft?: unknown };
  const clinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";
  if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required." }, { status: 400 });

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;
  if (!(await clinicHasFeature(clinicId, "whatsappPro").catch(() => false))) {
    return NextResponse.json({ ok: false, error: NOT_ON }, { status: 403 });
  }
  // A missing draft would sanitise to an empty layer and wipe the owner's work: refuse it instead.
  if (!body.draft || typeof body.draft !== "object" || Array.isArray(body.draft)) {
    return NextResponse.json({ ok: false, error: "draft is required." }, { status: 400 });
  }

  try {
    const { layer, dropped } = sanitizeLayer(body.draft);
    await firestoreOnboardingStore(clinicId).patchState({ draft: layer });
    return NextResponse.json({ ok: true, draft: layer, dropped });
  } catch (e) {
    reportServerError("pro-onboarding PUT failed", e, { clinicId });
    return NextResponse.json({ ok: false, error: "Could not save the draft." }, { status: 500 });
  }
}
