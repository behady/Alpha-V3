// The allowlist behind the assistant's `navigate_to` tool.
//
// Worth a test because of the specific way this fails. When the model asks for a screen that does
// not exist, the old route handed the path straight to the browser: the chat printed "Opening the
// patient's file…", the router pushed a 404, and the person who asked saw nothing happen. That is
// the exact complaint this file guards — an announcement with no action behind it — and it is
// invisible in code review, because every line involved looks correct on its own.
//
// Every real-world miss belongs here.
import assert from "node:assert/strict";
import { resolveNavigablePath, NAVIGABLE_EXACT, PATIENT_TABS, NAVIGABLE_PATHS_HINT } from "../src/lib/aiNavigation";

// --- every advertised screen resolves ---
for (const path of NAVIGABLE_EXACT) {
  assert.equal(resolveNavigablePath(path), path, `${path} is advertised to the model and must resolve`);
}

// --- the dynamic screens ---
assert.equal(resolveNavigablePath("/patients/abc123"), "/patients/abc123");
assert.equal(resolveNavigablePath("/patients/AbC-1_2"), "/patients/AbC-1_2", "Firestore ids carry - and _");
assert.equal(resolveNavigablePath("/patients/abc123/rx"), "/patients/abc123/rx");
assert.equal(resolveNavigablePath("/patients/abc123/diagnosis"), "/patients/abc123/diagnosis");
assert.equal(resolveNavigablePath("/ortho/abc123"), "/ortho/abc123");
assert.equal(resolveNavigablePath("/help/booking"), "/help/booking");

// --- query strings survive: the tab deep link is how "open her finances" lands on the right tab ---
for (const tab of PATIENT_TABS) {
  assert.equal(
    resolveNavigablePath(`/patients/abc123?tab=${tab}`),
    `/patients/abc123?tab=${tab}`,
    `?tab=${tab} is a documented deep link`,
  );
}
assert.equal(resolveNavigablePath("/appointments?search=Khaled"), "/appointments?search=Khaled");

// A tab that does not exist is still allowed through: it lands on the patient's default tab, which
// is a slightly wrong landing rather than a dead end. Only the *path* is a dead end.
assert.equal(resolveNavigablePath("/patients/abc123?tab=invented"), "/patients/abc123?tab=invented");

// --- the placeholder the old tool description taught it to write ---
// The previous schema said "/patients/[id]?tab=finance", and a model that copies that literally
// produced a 404 with "Opening their finance page…" in front of it.
assert.equal(resolveNavigablePath("/patients/[id]"), null, "the literal placeholder must not navigate");
assert.equal(resolveNavigablePath("/patients/[id]?tab=finance"), null);
assert.equal(resolveNavigablePath("/patients/{id}"), null);

// --- screens that simply do not exist ---
assert.equal(resolveNavigablePath("/billing"), null);
assert.equal(resolveNavigablePath("/dashboard"), null, "the dashboard is at /, not /dashboard");
assert.equal(resolveNavigablePath("/patients/abc123/finance"), null, "finance is a tab, not a route");
assert.equal(resolveNavigablePath("/migrate"), null, "a data tool is not somewhere to send a user");
assert.equal(resolveNavigablePath("/ai"), null, "/ai has no page of its own, only children");

// --- anything that would leave the app ---
// The model's context holds free text that patients and colleagues typed into notes, so an
// off-site path is the one navigation that must never be relayed.
assert.equal(resolveNavigablePath("https://example.com"), null);
assert.equal(resolveNavigablePath("//example.com"), null, "protocol-relative still leaves the site");
assert.equal(resolveNavigablePath("/\\example.com"), null);
assert.equal(resolveNavigablePath("/patients/../../etc"), null);
assert.equal(resolveNavigablePath("javascript:alert(1)"), null);

// --- shapes that are nothing at all ---
assert.equal(resolveNavigablePath(""), null);
assert.equal(resolveNavigablePath(null), null);
assert.equal(resolveNavigablePath(undefined), null);
assert.equal(resolveNavigablePath("patients"), null, "a bare word is not a path");

// --- tidying the model's own sloppiness ---
assert.equal(resolveNavigablePath("  /patients  "), "/patients", "surrounding whitespace is not meaningful");
assert.equal(resolveNavigablePath("/patients/"), "/patients", "a trailing slash is the model's, not the router's");
assert.equal(resolveNavigablePath("/"), "/", "the root keeps its only slash");

// --- the hint the model is shown must describe what actually resolves ---
// These two drifting apart is how the allowlist silently narrows: the schema keeps advertising a
// screen the resolver has stopped accepting, and the model keeps confidently choosing it.
for (const path of NAVIGABLE_EXACT) {
  assert.ok(NAVIGABLE_PATHS_HINT.includes(path), `${path} is accepted but never advertised to the model`);
}

console.log("aiNavigation: all assertions passed");
