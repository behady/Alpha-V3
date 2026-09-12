// A tourist in the sample clinic can open every screen and change nothing. The permission list
// is the whole of that guarantee — firestore.rules and the server routes consult it before any
// write and never expand a role's floor — so this file checks the list against the catalogue.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAllPermissionIds } from "../src/config/permissionsCatalog";
import { DEMO_TOUR_PERMISSIONS, DEMO_TOUR_ROLE, homeClinicFor, isDemoClinic } from "../src/lib/demoTour";

const REPO = join(import.meta.dirname, "..");
const catalogue = new Set(getAllPermissionIds());

// --- the view-only list ------------------------------------------------------------------------

for (const id of DEMO_TOUR_PERMISSIONS) {
  assert.ok(catalogue.has(id), `${id} is a real permission id`);
  assert.ok(id === "dashboard.view" || id.startsWith("access."), `${id} is a view id, not an action`);
  assert.ok(!/\.(add|edit|delete|admin|export)$/.test(id), `${id} cannot write`);
}
const viewIds = [...catalogue].filter((id) => id === "dashboard.view" || id.startsWith("access."));
assert.deepEqual([...DEMO_TOUR_PERMISSIONS].sort(), viewIds.sort(), "every module opens; a new access.* id must be added here too");
assert.equal(DEMO_TOUR_ROLE, "Assistant", "a role that is never full access");

// --- the clinic marker and the way home --------------------------------------------------------

assert.equal(isDemoClinic({ __demo: true }), true);
assert.equal(isDemoClinic({ __demo: "true" }), false, "only the boolean the seed writes");
assert.equal(isDemoClinic(null), false);

assert.equal(homeClinicFor({ A: "Owner", DEMO: "Assistant" }, "A", "DEMO"), "A");
assert.equal(homeClinicFor({ A: "Owner", DEMO: "Assistant" }, "DEMO", "DEMO"), "A", "a default pointed at the demo is skipped");
assert.equal(homeClinicFor({ A: "Owner", B: "Admin" }, "B", "DEMO"), "B");
assert.equal(homeClinicFor({ DEMO: "Assistant" }, null, "DEMO"), null, "the demo is all they have");
assert.equal(homeClinicFor(null, "A", "DEMO"), null, "a default with no role behind it does not count");

// --- wiring ------------------------------------------------------------------------------------

const route = readFileSync(join(REPO, "src/app/api/demo/tour/route.ts"), "utf8");
assert.ok(route.includes("DEMO_TOUR_PERMISSIONS"), "the route grants exactly this list");
assert.ok(!route.includes("/staff"), "no staff card for a tourist");
assert.ok(route.includes("alreadyMember"), "an existing member of the demo clinic keeps their real role");
const layout = readFileSync(join(REPO, "src/app/(dashboard)/layout.tsx"), "utf8");
assert.ok(layout.includes("<DemoTourBanner"), "the banner is above every page");
const welcome = readFileSync(join(REPO, "src/app/(dashboard)/welcome/page.tsx"), "utf8");
assert.ok(welcome.includes("<DemoTourCard"), "the welcome guide offers the tour");

console.log("demoTour: all assertions passed");
