// The lead-grading flow route is the settings registry's declared write path for the
// "lead_grading" section (kind: "server"). This is the guard that claim points at: the route
// must refuse anyone who is not a clinic Admin before it touches a document, and every action
// must resolve the clinic through resolveUserClinicId (so a member of one clinic cannot approve
// another clinic's flow by passing its id). Static, on purpose: it reads the source, so it runs
// without Firebase and fails the moment somebody moves the auth line below a write.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/app/api/leads/grading-flow/route.ts"), "utf8");

const authAt = src.indexOf("await requireAdminUser(request)");
assert.ok(authAt > 0, "the route asks requireAdminUser");
const firstWrite = Math.min(...[".set(", ".update(", ".add(", "draftLeadFlow("].map((s) => src.indexOf(s)).filter((i) => i > 0));
assert.ok(authAt < firstWrite, "admin is required before the first write");
assert.ok(src.includes("resolveUserClinicId(authz.uid"), "the clinic is resolved from the caller, never trusted from the body alone");
assert.ok(/if \(!authz\.ok\) return authz\.response;/.test(src), "a refused caller gets the auth response");
for (const action of ["approve", "reject", "edit", "toggle", "draft"]) {
  assert.ok(src.includes(`"${action}"`), `action ${action} exists`);
}
assert.ok(src.includes("weekKey") && src.includes("/^\\d{4}-W\\d{2}$/"), "the draft id is validated before it becomes a document path");

// The settings registry points here and only here for this section.
const registry = readFileSync(join(process.cwd(), "src/config/settingsRegistry.ts"), "utf8");
assert.ok(registry.includes('route: "/api/leads/grading-flow", guardedBy: "tests/leadGradingFlow.test.mts"'), "the registry names this test as the guard");

console.log("leadGradingFlow: route guard checks passed");
