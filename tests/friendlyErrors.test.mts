// The sign-up screens speak the reader's language even when the server says no, and the app
// opens in the language the browser is in. Both rules are pure; this is where they are pinned.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_TEXT, friendlyError, isErrorCode, isNetworkFailure } from "../src/lib/friendlyErrors";
import { pickStartupLanguage } from "../src/lib/startupLanguage";

const REPO = join(import.meta.dirname, "..");

// --- every code has both languages, and no sentence is a bare code -------------------------------
for (const [code, text] of Object.entries(ERROR_TEXT)) {
  assert.ok(text.en.length > 15 && text.ar.length > 10, `${code} is a sentence in both languages`);
  assert.ok(/[\u0600-\u06FF]/.test(text.ar), `${code} Arabic is Arabic`);
  assert.ok(!/[\u0600-\u06FF]/.test(text.en), `${code} English is English`);
}

// --- a known code is translated; an unknown one falls back, never to the server's English ------
assert.equal(friendlyError({ code: "clinic-not-found", error: "No clinic has that ID." }, "ar", "join-failed"), ERROR_TEXT["clinic-not-found"].ar);
assert.equal(friendlyError({ code: "clinic-not-found" }, "en", "join-failed"), ERROR_TEXT["clinic-not-found"].en);
assert.equal(friendlyError({ error: "7 PERMISSION_DENIED: Missing or insufficient permissions." }, "ar", "clinic-create-failed"), ERROR_TEXT["clinic-create-failed"].ar, "raw server text never reaches the screen");
assert.equal(friendlyError(null, "en", "invite-failed"), ERROR_TEXT["invite-failed"].en, "no payload at all");
assert.equal(friendlyError({ code: "made-up" }, "en", "join-failed"), ERROR_TEXT["join-failed"].en, "an unknown code is not trusted");
assert.equal(isErrorCode("invite-expired"), true);
assert.equal(isErrorCode("toString"), false, "prototype keys are not codes");
assert.equal(isNetworkFailure(new TypeError("Failed to fetch")), true);
assert.equal(isNetworkFailure(new Error("Failed to fetch")), false);

// --- the routes send the codes the table knows -------------------------------------------------
const routes = [
  "src/app/api/onboarding/create-clinic/route.ts",
  "src/app/api/join-requests/create/route.ts",
  "src/app/api/invites/accept/route.ts",
];
for (const rel of routes) {
  const src = readFileSync(join(REPO, rel), "utf8");
  for (const m of src.matchAll(/code: "([a-z-]+)"/g)) {
    assert.ok(isErrorCode(m[1]), `${rel} sends "${m[1]}", which the table knows`);
  }
  assert.ok(/code: "/.test(src), `${rel} sends codes`);
}
// The accept route builds three codes from the invite state.
for (const state of ["revoked", "expired", "used"]) assert.ok(isErrorCode(`invite-${state}`));

// --- startup language --------------------------------------------------------------------------
assert.equal(pickStartupLanguage(null, ["ar-EG", "en-US"]), "ar");
assert.equal(pickStartupLanguage(null, ["en-GB", "ar"]), "en", "the browser's first language decides");
assert.equal(pickStartupLanguage(null, ["AR"]), "ar");
assert.equal(pickStartupLanguage(null, []), "en");
assert.equal(pickStartupLanguage(null, undefined), "en");
assert.equal(pickStartupLanguage("en", ["ar-EG"]), "en", "a saved choice wins");
assert.equal(pickStartupLanguage("ar", ["en-US"]), "ar");
assert.equal(pickStartupLanguage("fr", ["ar-EG"]), "ar", "a saved value the app does not speak is ignored");

const provider = readFileSync(join(REPO, "src/context/LanguageContext.tsx"), "utf8");
assert.ok(provider.includes("pickStartupLanguage("), "the provider uses the rule");
for (const rel of ["src/app/login/page.tsx", "src/app/onboarding/page.tsx", "src/app/join/[code]/page.tsx"]) {
  assert.ok(readFileSync(join(REPO, rel), "utf8").includes("<LanguageToggle"), `${rel} has the switch`);
}

console.log("friendlyErrors + startupLanguage: all assertions passed");
