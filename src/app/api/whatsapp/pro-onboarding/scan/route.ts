import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { reportServerError } from "@/lib/server/reportError";
import { logActivityServer } from "@/lib/server/systemLog";
import { geminiProJson } from "@/lib/botPro/onboarding/jsonModel";
import { scanStep, startScan, STEP_LOCK_MS } from "@/lib/botPro/onboarding/scan";
import { firestoreOnboardingStore, type OnboardingState } from "@/lib/botPro/onboarding/store";
import { publicOnboardingState } from "@/lib/botPro/onboarding/publicState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Pro AI onboarding: read the clinic's old chats, one step per call.
 *
 *   POST { clinicId, action: "start", mode? }   queue the chats to read (refused while a scan is
 *                                        going). mode "new": only the chats since the last reading,
 *                                        grown into the draft; anything else is "full" (read all
 *                                        again, replace the draft). The first reading is always full.
 *   POST { clinicId, action: "step" }    read one batch, or write the summary when all are read
 *
 * The screen calls "step" again until the status is done or failed. Both answer
 * { ok: true, state, busy? }: busy means another call holds the lock (or a scan is already
 * going, for "start") and nothing was changed — HTTP 200, the screen just waits and asks again.
 * No credits are charged; the Pro key pays.
 */

const NOT_ON = "Pro AI is not switched on for this clinic.";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { clinicId?: unknown; action?: unknown; mode?: unknown };
  const clinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";
  if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required." }, { status: 400 });
  const action = body.action === "start" || body.action === "step" ? body.action : null;
  if (!action) return NextResponse.json({ ok: false, error: 'action must be "start" or "step".' }, { status: 400 });
  const mode = body.mode === "new" ? "new" : "full";

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;
  if (!(await clinicHasFeature(clinicId, "whatsappBot").catch(() => false))) {
    return NextResponse.json({ ok: false, error: NOT_ON }, { status: 403 });
  }
  const apiKey = (process.env.GEMINI_PRO_API_KEY || "").trim();
  if (!apiKey) return NextResponse.json({ ok: false, error: "Pro AI key is not set." }, { status: 503 });

  const store = firestoreOnboardingStore(clinicId);
  try {
    if (action === "start") {
      const now = Date.now();
      // The lock makes "start" exclusive with a running step and with a second start.
      if (!(await store.tryLock(STEP_LOCK_MS, now))) {
        return NextResponse.json({ ok: true, state: publicOnboardingState(await store.getState()), busy: true });
      }
      let started: OnboardingState | null = null;
      try {
        const current = await store.getState();
        // A scan that is going is continued with "step", never restarted under itself.
        const going = current.scan.status === "running" || current.scan.status === "summarizing";
        if (!going) started = await startScan(store, now, mode);
      } finally {
        await store.unlock();
      }
      if (!started) {
        return NextResponse.json({ ok: true, state: publicOnboardingState(await store.getState()), busy: true });
      }
      await logActivityServer({
        clinicId,
        user: { uid: authz.uid, name: authz.name, role: authz.role },
        action: "Pro AI: old-chat scan started",
        details: `${started.scan.total} chats queued, mode ${started.scan.mode}`,
        severity: "LOW",
        module: "settings",
      });
      return NextResponse.json({ ok: true, state: publicOnboardingState(started) });
    }

    const model = geminiProJson(apiKey, process.env.GEMINI_PRO_MODEL || "gemini-pro-latest");
    const out = await scanStep(store, model, Date.now());
    return NextResponse.json({ ok: true, state: publicOnboardingState(out.state), ...(out.busy ? { busy: true } : {}) });
  } catch (e) {
    reportServerError("pro-onboarding scan failed", e, { clinicId, action });
    return NextResponse.json({ ok: false, error: "The scan could not run. Try again." }, { status: 500 });
  }
}
