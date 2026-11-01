/**
 * The four Pro AI onboarding routes: admin-only, behind the whatsappPro add-on, on the Pro key
 * only, never charging credits. Source assertions (like botProWiring) plus the pure helpers that
 * shape what the screen sees.
 *
 * Run: npm run test:pro-onboarding-routes
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { publicOnboardingState, versionRows } from "../src/lib/botPro/onboarding/publicState";
import { EMPTY_STATE, type LayerVersion, type OnboardingState } from "../src/lib/botPro/onboarding/store";

async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  console.log(`ok - ${name}`);
}

const ROOT = "src/app/api/whatsapp/pro-onboarding";
const ROUTES = {
  state: `${ROOT}/route.ts`,
  scan: `${ROOT}/scan/route.ts`,
  chat: `${ROOT}/chat/route.ts`,
  publish: `${ROOT}/publish/route.ts`,
} as const;

const source = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** The code without its comments, so a comment cannot satisfy (or break) an assertion. */
const code = (p: string) =>
  source(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

await test("all four route files exist", () => {
  for (const p of Object.values(ROUTES)) assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), `${p} exists`);
});

await test("every route is admin-only, behind whatsappPro, nodejs and never cached", () => {
  for (const p of Object.values(ROUTES)) {
    const c = code(p);
    assert.ok(c.includes("requireAdminUser("), `${p}: requireAdminUser`);
    assert.match(c, /clinicHasFeature\(\s*clinicId\s*,\s*"whatsappPro"\s*\)/, `${p}: clinicHasFeature(clinicId, "whatsappPro")`);
    assert.ok(c.includes("Pro AI is not switched on for this clinic."), `${p}: the 403 message`);
    assert.match(c, /export const runtime = "nodejs"/, `${p}: nodejs runtime`);
    assert.match(c, /export const dynamic = "force-dynamic"/, `${p}: force-dynamic`);
    // The admin check comes before the add-on check (an outsider learns nothing about the clinic).
    assert.ok(c.indexOf("requireAdminUser(") < c.indexOf("clinicHasFeature("), `${p}: auth before the feature check`);
  }
});

await test("scan, chat and publish use the Pro key only; GET/PUT need no key", () => {
  for (const p of [ROUTES.scan, ROUTES.chat, ROUTES.publish]) {
    const c = code(p);
    assert.ok(c.includes("process.env.GEMINI_PRO_API_KEY"), `${p}: reads GEMINI_PRO_API_KEY`);
    assert.ok(c.includes("Pro AI key is not set."), `${p}: the 503 message`);
    assert.match(c, /status:\s*503/, `${p}: 503`);
  }
  for (const p of Object.values(ROUTES)) {
    assert.ok(!/GEMINI_API_KEY/.test(code(p).replace(/GEMINI_PRO_API_KEY/g, "")), `${p}: never GEMINI_API_KEY`);
  }
  assert.ok(!code(ROUTES.state).includes("GEMINI_PRO_API_KEY"), "GET/PUT do not need the key");
});

await test("the model is the Pro one, from GEMINI_PRO_MODEL", () => {
  for (const p of [ROUTES.scan, ROUTES.chat]) {
    assert.match(code(p), /geminiProJson\(/, `${p}: geminiProJson`);
    assert.ok(code(p).includes('process.env.GEMINI_PRO_MODEL || "gemini-pro-latest"'), `${p}: model name`);
  }
  assert.match(code(ROUTES.publish), /geminiProModel\(/, "publish replays on geminiProModel");
  assert.ok(code(ROUTES.publish).includes('process.env.GEMINI_PRO_MODEL || "gemini-pro-latest"'), "publish: model name");
});

await test("the scan/chat model call has a 90 s request timeout", () => {
  const c = code("src/lib/botPro/onboarding/jsonModel.ts");
  assert.match(c, /JSON_MODEL_TIMEOUT_MS = 90_000/);
  assert.match(c, /\}, \{ timeout: JSON_MODEL_TIMEOUT_MS \}\)/, "passed as getGenerativeModel's request options");
});

await test("maxDuration: scan 120, chat 60, publish 300", () => {
  assert.match(code(ROUTES.scan), /export const maxDuration = 120;/);
  assert.match(code(ROUTES.chat), /export const maxDuration = 60;/);
  assert.match(code(ROUTES.publish), /export const maxDuration = 300;/);
});

await test("no route charges credits", () => {
  for (const p of Object.values(ROUTES)) {
    const c = code(p);
    assert.ok(!c.includes("logAiCreditUsage"), `${p}: no logAiCreditUsage`);
    assert.ok(!c.includes("ai_usage"), `${p}: no ai_usage write`);
    assert.ok(!c.includes("creditsUsed"), `${p}: no credit counter`);
    assert.ok(!/charge:\s*true/.test(c), `${p}: never charge:true`);
  }
});

await test("GET returns the public state (no queue), PUT sanitises the draft", () => {
  const c = code(ROUTES.state);
  assert.match(c, /export async function GET\(/);
  assert.match(c, /export async function PUT\(/);
  assert.ok(c.includes("publicOnboardingState("), "GET goes through publicOnboardingState");
  assert.ok(!/\bqueue\b/.test(c), "the route never touches queue itself");
  assert.ok(c.includes("recentChat(60)"), "last 60 chat rows");
  assert.ok(c.includes("sanitizeLayer("), "PUT sanitises");
});

await test("scan start refuses while a scan holds the lock or is running; start and step are logged/locked", () => {
  const c = code(ROUTES.scan);
  assert.ok(c.includes("startScan("), "start calls startScan");
  assert.ok(c.includes("scanStep("), "step calls scanStep");
  assert.ok(c.includes("tryLock("), "start takes the lock");
  assert.match(c, /"running"/);
  assert.match(c, /"summarizing"/);
  assert.match(c, /busy:\s*true/);
  assert.ok(c.includes("logActivityServer("), "scan start is logged");
  assert.match(c, /finally\s*\{[\s\S]*?unlock\(\)/, "start always unlocks");
});

await test("chat: owner turn with the clinic's price names; a model failure is a 502", () => {
  const c = code(ROUTES.chat);
  assert.ok(c.includes("ownerChatTurn("));
  assert.ok(c.includes("priceNames("), "price names from the clinic's services");
  assert.match(c, /status:\s*502/);
  assert.match(c, /error:\s*"model"/);
});

await test("publish: lock, empty refusal, replay, version only on a pass, rollback and off", () => {
  const c = code(ROUTES.publish);
  assert.match(c, /tryLock\(\s*PUBLISH_LOCK_MS/, "publish takes the scan lock");
  assert.match(c, /const PUBLISH_LOCK_MS = 310_000;/, "the lock outlives maxDuration 300");
  assert.match(c, /finally\s*\{[\s\S]*?unlock\(\)/, "always unlocks");
  assert.ok(c.includes("isEmptyLayer("), "refuses an empty draft");
  assert.match(c, /error:\s*"empty"/);
  assert.ok(c.includes("runReplay("), "runs the replay test");
  assert.ok(c.includes("builtinReplayCases("), "built-in cases");
  assert.ok(c.includes("savedReplayCases("), "the clinic's saved cases");
  assert.ok(c.includes("bot_test_cases"), "saved cases come from bot_test_cases");
  assert.ok(c.includes("loadReplayContext("), "the clinic's own context");
  assert.match(c, /error:\s*"test_failed_to_run"/);
  assert.match(c, /`v\$\{[^}]*\}`/, "version id is v{n}");
  assert.ok(c.includes("saveVersion("));
  assert.ok(c.indexOf("test.passed") < c.indexOf("saveVersion("), "saved only after the pass check");
  // The number is taken in a transaction right before the save, never read at the start.
  assert.ok(c.includes("allocateVersion()"), "nextVersion is allocated by the store");
  assert.ok(c.indexOf("test.passed") < c.indexOf("allocateVersion()") && c.indexOf("allocateVersion()") < c.indexOf("saveVersion("), "allocated after the pass, before the save");
  assert.ok(!c.includes("state.nextVersion"), "the start-of-run nextVersion is never used");
  assert.match(c, /if \(!created\) return NextResponse\.json\(\{ ok: false, published: false, error: "busy" \}, \{ status: 409 \}\)/, "a create conflict is a 409 busy");
  assert.ok(c.includes("makeLiveIf(state.liveVersion, versionId)"), "live only if it did not move during the run");
  assert.match(c, /published: true, madeLive/, "the response says whether it went live");
  assert.ok(c.includes("deadlineMs: REPLAY_DEADLINE_MS"), "the replay has a deadline");
  assert.ok(c.includes("makeLive"), "rollback / off");
  assert.ok((c.match(/logActivityServer\(/g) || []).length >= 2, "publish and rollback are logged");
});

await test("store: versions are created, never overwritten; nextVersion and liveVersion move in transactions", () => {
  const c = code("src/lib/botPro/onboarding/store.ts");
  const save = c.slice(c.indexOf("async saveVersion("), c.indexOf("async makeLiveIf("));
  assert.ok(save.includes(".create("), "saveVersion uses create()");
  assert.ok(!save.includes(".set("), "saveVersion never set()s");
  assert.ok(save.includes("isAlreadyExists(e)") && save.includes("return false"), "an existing id is reported, not thrown");
  const alloc = c.slice(c.indexOf("async allocateVersion("), c.indexOf("async saveVersion("));
  assert.ok(alloc.includes("runTransaction(") && alloc.includes("nextVersion: n + 1"), "allocateVersion is a transaction");
  const live = c.slice(c.indexOf("async makeLiveIf("));
  assert.ok(live.includes("runTransaction(") && live.includes("!== expected"), "makeLiveIf compares in a transaction");
});

await test("PUT: undo swaps draft and previousDraft; a save keeps the replaced draft", () => {
  const c = code(ROUTES.state);
  assert.match(c, /body\.undo === true/, "PUT accepts { undo: true }");
  assert.ok(c.includes("patchState({ draft: state.previousDraft, previousDraft: state.draft })"), "undo swaps the two");
  assert.match(c, /error: "nothing_to_undo" \}, \{ status: 409 \}/, "nothing to undo is a 409");
  assert.ok(c.indexOf("body.undo === true") < c.indexOf("draft is required."), "undo needs no draft in the body");
  assert.ok(c.includes("previousDraft: state.draft } : {})"), "a changed save keeps the old draft");
});

await test("pro-battery builds its context through the shared loader (one copy)", () => {
  const battery = code("scripts/pro-battery.mts");
  assert.ok(battery.includes("loadReplayContext("), "pro-battery uses loadReplayContext");
  assert.ok(!battery.includes('collection("settings").doc("whatsapp")'), "the settings read lives in the shared loader");
  const loader = code("src/lib/botPro/replayContext.ts");
  assert.ok(loader.includes("export async function loadReplayContext("));
});

const STATE: OnboardingState = {
  ...EMPTY_STATE,
  scan: { status: "running", queue: ["a", "b"], total: 10, done: 4, chatsRead: 3, lockUntil: 99, startedAt: 5, error: "boom" },
  learned: ["l1"],
  questions: ["q1"],
  liveVersion: "v2",
  nextVersion: 3,
};

await test("publicOnboardingState: never queue or lockUntil; the listed fields only", () => {
  const out = publicOnboardingState(STATE);
  assert.deepEqual(out, {
    scan: { status: "running", total: 10, done: 4, chatsRead: 3, error: "boom" },
    learned: ["l1"],
    questions: ["q1"],
    draft: STATE.draft,
    hasPreviousDraft: false,
    liveVersion: "v2",
  });
  assert.equal(publicOnboardingState({ ...STATE, previousDraft: STATE.draft }).hasPreviousDraft, true);
  assert.equal(JSON.stringify(publicOnboardingState({ ...STATE, previousDraft: STATE.draft })).includes("previousDraft\":{"), false, "the old draft itself stays on the server");
  assert.equal(JSON.stringify(out).includes("queue"), false);
  const clean = publicOnboardingState({ ...STATE, scan: { ...STATE.scan, error: undefined } });
  assert.equal("error" in clean.scan, false);
});

await test("versionRows: passed and break count, tolerant of a missing test", () => {
  const v = (id: string, test: unknown): LayerVersion =>
    ({ id, version: Number(id.slice(1)), layer: EMPTY_STATE.draft, createdAt: 7, createdBy: "Dr A", test }) as LayerVersion;
  const rows = versionRows([
    v("v2", { passed: true, turns: 3, unavailable: 0, actionMisses: 0, breaks: [], ms: 1 }),
    v("v1", { passed: false, turns: 3, unavailable: 0, actionMisses: 0, breaks: [{ caseId: "x", q: "", reply: "", rules: [] }], ms: 1 }),
    v("v0", undefined),
  ]);
  assert.deepEqual(rows, [
    { id: "v2", version: 2, createdAt: 7, createdBy: "Dr A", passed: true, breaks: 0 },
    { id: "v1", version: 1, createdAt: 7, createdBy: "Dr A", passed: false, breaks: 1 },
    { id: "v0", version: 0, createdAt: 7, createdBy: "Dr A", passed: false, breaks: 0 },
  ]);
});

await test("the screen: Teach Pro your clinic opens only inside the proInPlan branch", () => {
  const SETTINGS = "src/components/settings/WhatsAppSettings.tsx";
  const c = code(SETTINGS);
  assert.match(c, /import ProSetup from "@\/components\/whatsapp\/ProSetup"/, "WhatsAppSettings imports ProSetup");
  assert.equal(c.split("<ProSetup").length - 1, 1, "ProSetup is mounted exactly once");
  const branch = c.indexOf('autoReplyMode === "ai" && proInPlan');
  assert.ok(branch > 0, "the proInPlan branch exists");
  const mount = c.indexOf("<ProSetup");
  assert.ok(mount > branch, "ProSetup comes after the proInPlan check");
  // Nothing between the check and the mount closes the branch: the mount sits inside the same block.
  assert.ok(c.indexOf("<AutoReplySteps") > mount, "ProSetup sits above the steps, in the picker block that proInPlan guards");
  assert.ok(c.slice(branch, mount).split("proInPlan").length === 2, "no second proInPlan check between the branch and the mount");
  assert.ok(c.includes("Teach Pro your clinic") && source(SETTINGS).includes("علّم Pro عيادتك") , "the button label in both languages");
  assert.match(c, /<ProSetup[\s\S]*?clinicId=\{clinicId \?\? ""\}/, "ProSetup receives the clinic id");
});

await test("the screen: ProSetup posts to all four routes with clinicId and the ID token", () => {
  const P = "src/components/whatsapp/ProSetup.tsx";
  assert.ok(existsSync(new URL(`../${P}`, import.meta.url)), "ProSetup.tsx exists");
  const c = code(P);
  assert.match(c, /export default function ProSetup\(/, "default export ProSetup");
  assert.ok(c.includes('const API = "/api/whatsapp/pro-onboarding"'), "one base path, the routes' folder");
  for (const sub of ["scan", "chat", "publish"]) assert.ok(c.includes("${API}/" + sub), `calls the ${sub} route`);
  assert.ok(c.includes("${API}?clinicId="), "reads the state route");
  assert.match(c, /method:\s*"PUT"/, "saves the draft with PUT");
  assert.ok(c.includes("clinicId"), "sends clinicId");
  assert.ok(c.includes("getIdToken()") && c.includes("Authorization"), "sends the Firebase ID token");
  assert.match(c, /makeLive/, "can switch the live version");
  assert.match(c, /makeLive\(null\)/, "can switch the clinic layer off");
  assert.match(c, /body\.ok\b/, "reads body.ok, not only res.ok");
  assert.ok(!/text-accent/.test(c.replace(/hover:text-accent-ink/g, "")), "accent is a fill, never text");
});

await test("the screen: the step loop stops when the dialog closes", () => {
  const c = code("src/components/whatsapp/ProSetup.tsx");
  assert.match(c, /abortedRef/, "an aborted ref exists");
  assert.match(c, /abortedRef\.current\s*=\s*true/, "closing or unmounting sets it");
  const loop = c.slice(c.indexOf("while ("));
  assert.ok(c.includes("while ("), "there is a loop");
  assert.match(loop.slice(0, 1200), /abortedRef\.current/, "the loop checks the ref");
  assert.match(c, /busy/, "a busy answer is handled");
  assert.match(c, /3000|3_000/, "waits 3 seconds on busy");
  assert.match(c, /loopRunning/, "a guard keeps two loops from running");
});

await test("the screen: a scan running with no loop gets a Continue button, failed steps retry twice", () => {
  const c = code("src/components/whatsapp/ProSetup.tsx");
  assert.match(c, /going && !loopActive/, "running without an active loop is its own state");
  assert.ok(c.includes("t.cont") && c.includes("كمّل") && c.includes('"Continue"'), "Continue button, both languages");
  assert.match(c, /onClick=\{\(\) => void runLoop\(\)\}/, "Continue calls runLoop");
  assert.match(c, /STEP_RETRIES = 2/, "a failed step is retried twice");
  assert.match(c, /setStepError\(/, "the last error is kept for the screen");
  assert.ok(c.includes("confirm(t.unsavedClose)") && c.includes("فيه تعديلات مش متحفظة"), "closing with unsaved edits asks first");
  assert.ok(c.includes("جرّب الرد المتقدم (Pro)") && c.includes("جرّب القواعد الجديدة (المسودة)"), "the Arabic hint names the real toggles");
  assert.match(c, /setPending\(message\)/, "the owner's message shows while Pro answers");
});

await test("the screen: undo, the full result card, and no state after close on publish", () => {
  const c = code("src/components/whatsapp/ProSetup.tsx");
  assert.ok(c.includes("undo: true") && c.includes('"Undo last change"') && c.includes("رجّع آخر تعديل"), "Undo last change, both languages, PUTs undo");
  assert.match(c, /data\.state\.hasPreviousDraft &&/, "the undo button shows only when there is something to undo");
  for (const k of ["t.turnsLbl", "t.unavailableLbl", "t.handoffsLbl", "t.offLbl"]) assert.ok(c.includes(k), `card shows ${k}`);
  assert.ok(c.includes("replayShortfalls(") && c.includes("t.whyFailed"), "a failed run names the failed condition");
  assert.ok(c.includes("b.rules.map(ruleName)"), "each break names its rules");
  assert.ok(c.includes("s.timedOut") && c.includes("The test took too long"), "a timed-out run says so");
  assert.ok(c.includes("t.passedNotLive(") && c.includes("madeLive"), "published but not made live is said");
  assert.ok(c.includes("numbers like times and counts aren't kept in the rules"), "the number reason has its copy");
  const pub = c.slice(c.indexOf("const publish = async"), c.indexOf("const undo = async"));
  const afterAwait = pub.slice(pub.indexOf("await call("));
  assert.ok(afterAwait.indexOf("abortedRef.current") >= 0 && afterAwait.indexOf("abortedRef.current") < afterAwait.indexOf("setTest("), "publish checks abortedRef before any state update");
});

console.log("all pro onboarding route tests passed");
