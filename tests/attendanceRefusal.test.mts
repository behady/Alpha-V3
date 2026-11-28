// What gets written to the activity log when a clock-in or clock-out is refused.
// Run: npm run test:attendance-refusal
import assert from "node:assert/strict";
import { deviceKind, punchRefusalLog } from "../src/lib/attendanceRefusal";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log("punchRefusalLog");

check("the action names the direction and files under attendance", () => {
  assert.equal(punchRefusalLog("in", { kind: "settingsLoading" }, "phone").action, "Attendance: clock-in refused");
  assert.equal(punchRefusalLog("out", { kind: "settingsLoading" }, "phone").action, "Attendance: clock-out refused");
});

check("too far: says how far, from where, the limit and how good the signal was", () => {
  const { details } = punchRefusalLog(
    "in",
    { kind: "outside", place: "التجمع الخامس", distance: 280, effectiveDistance: 180, accuracy: 119, radius: 50 },
    "computer"
  );
  assert.equal(details, "Too far: about 180 m from التجمع الخامس (limit 50 m). Measured 280 m, signal ±119 m. On a computer.");
});

check("too far at a clinic with one location says 'the clinic'", () => {
  const { details } = punchRefusalLog(
    "in",
    { kind: "outside", place: "", distance: 90, effectiveDistance: 70, accuracy: 20, radius: 50 },
    "phone"
  );
  assert.ok(details.startsWith("Too far: about 70 m from the clinic (limit 50 m)."), details);
});

check("each location failure reads differently", () => {
  const text = (failure: Parameters<typeof punchRefusalLog>[1]) => punchRefusalLog("in", failure, "phone").details;
  assert.ok(text({ kind: "location", failure: { kind: "denied" } }).startsWith("Location permission is blocked in the browser."));
  assert.ok(text({ kind: "location", failure: { kind: "unavailable" } }).startsWith("The device could not find its location."));
  assert.ok(text({ kind: "location", failure: { kind: "timeout" } }).startsWith("Finding the location took too long."));
  assert.ok(text({ kind: "location", failure: { kind: "unsupported" } }).startsWith("This device cannot give a location."));
  assert.ok(text({ kind: "location", failure: { kind: "inaccurate", accuracy: 640 } }).startsWith("Location signal too weak (±640 m)."));
});

check("the plain refusals", () => {
  const text = (refusal: Parameters<typeof punchRefusalLog>[1]) => punchRefusalLog("in", refusal, "phone").details;
  assert.ok(text({ kind: "noProfile" }).startsWith("No staff profile is linked to this login."));
  assert.ok(text({ kind: "settingsLoading" }).startsWith("Pressed before the clinic settings finished loading."));
  assert.ok(text({ kind: "wrongDevice" }).startsWith("Not the phone registered to this person."));
  assert.ok(text({ kind: "noLocationSet" }).startsWith("The clinic has no clock-in location saved."));
});

check("a failed save keeps the error's code, or its message when there is no code", () => {
  const coded = punchRefusalLog("in", { kind: "saveFailed", error: { code: "permission-denied", message: "Missing or insufficient permissions." } }, "phone");
  assert.ok(coded.details.startsWith("Could not save the punch (permission-denied)."), coded.details);
  const plain = punchRefusalLog("out", { kind: "crashed", error: new Error("boom") }, "phone");
  assert.ok(plain.details.startsWith("Unexpected error (boom)."), plain.details);
  const junk = punchRefusalLog("in", { kind: "crashed", error: undefined }, "phone");
  assert.ok(junk.details.startsWith("Unexpected error (unknown)."), junk.details);
});

check("a huge error message is cut short", () => {
  const { details } = punchRefusalLog("in", { kind: "crashed", error: new Error("x".repeat(900)) }, "phone");
  assert.ok(details.length < 220, `details ran to ${details.length} characters`);
});

check("the device is always the last sentence, and an unknown one is left out", () => {
  assert.ok(punchRefusalLog("in", { kind: "wrongDevice" }, "phone").details.endsWith(" On a phone."));
  assert.ok(punchRefusalLog("in", { kind: "wrongDevice" }, "computer").details.endsWith(" On a computer."));
  assert.equal(punchRefusalLog("in", { kind: "wrongDevice" }, "unknown").details, "Not the phone registered to this person.");
});

console.log("deviceKind");

check("phones and tablets are phones, everything else with a browser is a computer", () => {
  assert.equal(deviceKind("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"), "phone");
  assert.equal(deviceKind("Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36"), "phone");
  assert.equal(deviceKind("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15"), "phone");
  assert.equal(deviceKind("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"), "computer");
  assert.equal(deviceKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"), "computer");
});

check("no user agent at all is unknown", () => {
  assert.equal(deviceKind(""), "unknown");
  assert.equal(deviceKind(undefined), "unknown");
});

console.log(`\n${passed} checks passed`);
