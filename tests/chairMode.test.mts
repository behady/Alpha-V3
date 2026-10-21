/**
 * Who is in "chair mode": the dentist's no-money experience.
 * Run: npm run test:chair
 */
import assert from "node:assert/strict";
import { isChairMode } from "../src/lib/chairMode";

let checks = 0;
const eq = (a: unknown, b: unknown, m: string) => { assert.equal(a, b, m); checks += 1; };

eq(isChairMode({ role: "Dentist" }), true, "role Dentist, always");
eq(isChairMode({ role: "Dentist", homeView: "desk" }), true, "role Dentist even on the desk view");
eq(isChairMode({ role: "Admin", isDentist: true, homeView: "chair" }), false, "admin-dentist on the chair home still sees prices and discounts (owner, 2026-10-14)");
eq(isChairMode({ role: "Owner", isDentist: true, homeView: "chair" }), false, "owner-dentist on the chair home still sees prices and discounts");
eq(isChairMode({ role: "Admin", isDentist: true, homeView: "desk" }), false, "admin-dentist on the desk keeps the full editor");
eq(isChairMode({ role: "Admin", isDentist: false, homeView: "chair" }), false, "an admin who is not a dentist never gets it");
eq(isChairMode({ role: "Receptionist", homeView: "chair" }), false, "reception never gets it");
eq(isChairMode({}), false, "nothing known = not chair mode");

// The dentist home's "+ Service" and the chair popup used to pass `dentistMode` literally, so an
// owner adding a service there lost the discount (owner, 2026-10-22). Both must ask the rule.
import { readFileSync } from "node:fs";
for (const f of ["src/components/dashboard/DentistHome.tsx", "src/components/chair/ChairPopup.tsx"]) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  eq(/\bdentistMode\s*\n/.test(src) || /\bdentistMode\s*\/?>/.test(src), false, `${f}: no hard-coded dentistMode`);
  eq(src.includes("isChairMode({ role })"), true, `${f}: dentistMode follows the role rule`);
}

console.log(`chair mode: ${checks} checks passed`);
