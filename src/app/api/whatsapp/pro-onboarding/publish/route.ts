import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { reportServerError } from "@/lib/server/reportError";
import { logActivityServer } from "@/lib/server/systemLog";
import { geminiProModel } from "@/lib/botPro/answerWithPro";
import { isEmptyLayer, type ReplaySummary } from "@/lib/botPro/layer";
import { builtinReplayCases, REPLAY_DEADLINE_MS, runReplay, savedReplayCases } from "@/lib/botPro/replay";
import { loadReplayContext } from "@/lib/botPro/replayContext";
import { firestoreOnboardingStore } from "@/lib/botPro/onboarding/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Pro AI onboarding: put the draft layer live, or change which version is live.
 *
 *   POST { clinicId }
 *     Replays the built-in conversations and up to 10 of the clinic's saved real chats (their first
 *     6 turns each) through Pro with the DRAFT layer, in the clinic's own world (its price list,
 *     facts, brief, hours). Nothing is sent or charged. The replay stops starting turns after
 *     240 s (the rest count unavailable, test.timedOut). Only when the test passes is a version
 *     number taken (a transaction on the state doc) and the draft created as v{n}; it is made live
 *     only if liveVersion is still what it was when the run started (the owner may have switched
 *     versions meanwhile, and that choice wins). A failed test stores nothing.
 *       -> { ok: true, published: true, madeLive: true, versionId, test }
 *       -> { ok: true, published: true, madeLive: false, versionId, test }         saved, live left as the owner set it
 *       -> { ok: true, published: false, test }                                    test failed
 *       -> { ok: false, published: false, error: "empty" }            (409)        nothing to publish
 *       -> { ok: false, published: false, error: "busy" }             (409)        a scan step or another publish holds the lock,
 *                                                                                  or the version id was taken meanwhile
 *       -> { ok: false, published: false, error: "test_failed_to_run" }  (500)     the replay itself broke
 *
 *   POST { clinicId, makeLive: "v3" }   switch back to a saved version that passed its test
 *   POST { clinicId, makeLive: null }   switch the clinic layer off (Pro answers without it)
 *       -> { ok: true, liveVersion }
 *       -> { ok: false, error: "not_found" (404) | "not_passed" (409) }
 *
 * makeLive makes no model call and takes no lock, so switching the layer off always works, even
 * with the Pro key missing or a publish running.
 */

const NOT_ON = "Pro AI is not switched on for this clinic.";
/** Longer than maxDuration, so a run that is killed at 300 s still holds the lock to its end; `finally` releases it. */
const PUBLISH_LOCK_MS = 310_000;
/** Saved cases read to find up to 10 usable ones (some have no patient line). */
const SAVED_READ = 40;

/** " — why: rate_limit 12, unreachable 8 (first: …)" for the log, or nothing when every turn was answered. */
function unavailableNote(test: ReplaySummary): string {
  const reasons = Object.entries(test.unavailableReasons ?? {}).filter(([, n]) => (n ?? 0) > 0);
  if (!reasons.length) return "";
  const sample = test.unavailableSample ? ` (first: ${test.unavailableSample.slice(0, 120)})` : "";
  return ` — why: ${reasons.map(([k, n]) => `${k} ${n}`).join(", ")}${sample}${test.retries ? `, ${test.retries} retried` : ""}`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { clinicId?: unknown; makeLive?: unknown };
  const clinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";
  if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required." }, { status: 400 });

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;
  if (!(await clinicHasFeature(clinicId, "whatsappBot").catch(() => false))) {
    return NextResponse.json({ ok: false, error: NOT_ON }, { status: 403 });
  }
  const user = { uid: authz.uid, name: authz.name, role: authz.role };
  const store = firestoreOnboardingStore(clinicId);

  // ---- rollback / off ----------------------------------------------------------------------
  if ("makeLive" in body) {
    const target = body.makeLive;
    if (target !== null && (typeof target !== "string" || !target.trim())) {
      return NextResponse.json({ ok: false, error: "makeLive must be a version id or null." }, { status: 400 });
    }
    try {
      if (target === null) {
        await store.patchState({ liveVersion: null });
        await logActivityServer({ clinicId, user, action: "Pro AI: clinic layer switched off", severity: "MEDIUM", module: "settings" });
        return NextResponse.json({ ok: true, liveVersion: null });
      }
      const id = target.trim();
      const version = (await store.listVersions()).find((v) => v.id === id);
      if (!version) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
      if (version.test?.passed !== true) return NextResponse.json({ ok: false, error: "not_passed" }, { status: 409 });
      await store.patchState({ liveVersion: id });
      await logActivityServer({ clinicId, user, action: `Pro AI: switched to layer ${id}`, details: `version ${version.version}`, severity: "MEDIUM", module: "settings" });
      return NextResponse.json({ ok: true, liveVersion: id });
    } catch (e) {
      reportServerError("pro-onboarding makeLive failed", e, { clinicId });
      return NextResponse.json({ ok: false, error: "Could not change the live version." }, { status: 500 });
    }
  }

  // ---- test, then publish ------------------------------------------------------------------
  const apiKey = (process.env.GEMINI_PRO_API_KEY || "").trim();
  if (!apiKey) return NextResponse.json({ ok: false, error: "Pro AI key is not set." }, { status: 503 });
  const modelName = process.env.GEMINI_PRO_MODEL || "gemini-pro-latest";

  let locked = false;
  try {
    // The scan lock: two publishes (or a publish and a scan step) never run together.
    locked = await store.tryLock(PUBLISH_LOCK_MS, Date.now());
    if (!locked) return NextResponse.json({ ok: false, published: false, error: "busy" }, { status: 409 });

    const state = await store.getState();
    // The layer that is tested is the layer that is saved: read once, before the run.
    const draft = state.draft;
    if (isEmptyLayer(draft)) return NextResponse.json({ ok: false, published: false, error: "empty" }, { status: 409 });

    let test: ReplaySummary;
    try {
      const world = await loadReplayContext(clinicId, { chatId: "pro-publish-replay" });
      if (!world) throw new Error("clinic not found");
      const savedSnap = await adminClinicCollection(clinicId, "bot_test_cases").orderBy("atMs", "desc").limit(SAVED_READ).get().catch(() => null);
      const saved = savedReplayCases((savedSnap?.docs ?? []).map((d) => ({ ...(d.data() || {}), id: d.id })), 10);
      test = await runReplay({
        cases: [...builtinReplayCases(), ...saved],
        layer: draft,
        baseArgs: world.baseArgs,
        context: world.context,
        model: () => geminiProModel(apiKey, modelName),
        deadlineMs: REPLAY_DEADLINE_MS,
      });
    } catch (e) {
      reportServerError("pro-onboarding publish test failed to run", e, { clinicId });
      return NextResponse.json({ ok: false, published: false, error: "test_failed_to_run" }, { status: 500 });
    }

    if (!test.passed) {
      await logActivityServer({
        clinicId,
        user,
        action: "Pro AI: publish refused by the test",
        details: `${test.breaks.length} break(s), ${test.unavailable} unavailable, ${test.unexpectedHandoffs ?? 0} unexpected hand-off(s) of ${test.turns} turns${test.timedOut ? ", timed out" : ""}${unavailableNote(test)}`,
        severity: "LOW",
        module: "settings",
      });
      return NextResponse.json({ ok: true, published: false, test });
    }

    // The number is taken now, in a transaction, not read at the start: nothing can hand it out twice.
    const version = await store.allocateVersion();
    const versionId = `v${version}`;
    const created = await store.saveVersion({ id: versionId, version, layer: draft, createdAt: Date.now(), createdBy: authz.name || authz.uid, test });
    if (!created) return NextResponse.json({ ok: false, published: false, error: "busy" }, { status: 409 });
    // A version the owner switched to (or switched off) while the test ran is their choice: keep it.
    const madeLive = await store.makeLiveIf(state.liveVersion, versionId);
    await logActivityServer({
      clinicId,
      user,
      action: `Pro AI: layer ${versionId} published${madeLive ? "" : " (not made live: the live version changed during the test)"}`,
      details: `test passed: ${test.turns} turns, ${test.unavailable} unavailable, ${test.unexpectedHandoffs ?? 0} unexpected hand-off(s), ${test.actionMisses} off-expectation`,
      severity: "MEDIUM",
      module: "settings",
    });
    return NextResponse.json({ ok: true, published: true, madeLive, versionId, test });
  } catch (e) {
    reportServerError("pro-onboarding publish failed", e, { clinicId });
    return NextResponse.json({ ok: false, published: false, error: "Could not publish." }, { status: 500 });
  } finally {
    if (locked) await store.unlock().catch(() => {});
  }
}
