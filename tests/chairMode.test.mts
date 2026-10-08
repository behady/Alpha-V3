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
eq(isChairMode({ role: "Admin", isDentist: true, homeView: "chair" }), true, "admin-dentist on the chair home");
eq(isChairMode({ role: "Owner", isDentist: true, homeView: "chair" }), true, "owner-dentist on the chair home");
eq(isChairMode({ role: "Admin", isDentist: true, homeView: "desk" }), false, "admin-dentist on the desk keeps the full editor");
eq(isChairMode({ role: "Admin", isDentist: false, homeView: "chair" }), false, "an admin who is not a dentist never gets it");
eq(isChairMode({ role: "Receptionist", homeView: "chair" }), false, "reception never gets it");
eq(isChairMode({}), false, "nothing known = not chair mode");

console.log(`chair mode: ${checks} checks passed`);
