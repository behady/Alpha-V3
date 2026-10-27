import assert from "node:assert/strict";
import { knownPatientPatch } from "../src/lib/bot/threadPatientLink";

assert.deepEqual(knownPatientPatch("p1", "رنا اشرف"), { patientId: "p1", patientName: "رنا اشرف" });
assert.deepEqual(knownPatientPatch("p1", "  Patient "), { patientId: "p1" });
assert.deepEqual(knownPatientPatch("p1", ""), { patientId: "p1" });
assert.equal(knownPatientPatch("", "رنا اشرف"), null);
assert.equal(knownPatientPatch(undefined, undefined), null);

console.log("threadPatientLink: all passed");
