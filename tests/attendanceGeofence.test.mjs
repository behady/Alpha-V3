// Regression test for clock-in refusing staff who were standing in the clinic.
//
// The bug: a single GPS reading was compared to the geofence and its stated accuracy was ignored.
// Indoors a fix is typically 30-150m off, so against a 50m fence the same person, in the same
// chair, was allowed in the morning and refused in the afternoon.
//
// Run with tsx so the TS module loads directly: npm run test:attendance
import assert from "node:assert/strict";
import { isUsableGeofence, judgeGeofence, metresBetween } from "../src/lib/attendanceLocation.ts";

const clinic = { lat: 30.0444, lng: 31.2357, radius: 50 };

/** A reading the given number of metres due north of the clinic, with a stated accuracy. */
const readingAtMetres = (north, accuracy) => ({
  latitude: clinic.lat + north / 111_320,
  longitude: clinic.lng,
  accuracy,
});

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log("judgeGeofence");

check("the reported failure: an 80m reading accurate to +/-90m is allowed inside a 50m fence", () => {
  const v = judgeGeofence({ reading: readingAtMetres(80, 90), clinic });
  assert.equal(v.inside, true);
  assert.equal(v.effectiveDistance, 0);
  // The old code compared v.distance (80) directly against radius (50) and refused.
  assert.ok(v.distance > clinic.radius);
});

check("a precise reading just outside the fence is still refused", () => {
  const v = judgeGeofence({ reading: readingAtMetres(120, 10), clinic });
  assert.equal(v.inside, false);
  assert.equal(v.effectiveDistance, 110);
});

check("someone genuinely far away is refused even with a poor fix", () => {
  assert.equal(judgeGeofence({ reading: readingAtMetres(500, 150), clinic }).inside, false);
});

check("a terrible fix cannot widen the fence without limit (allowance capped at 100m)", () => {
  const v = judgeGeofence({ reading: readingAtMetres(300, 5000), clinic });
  assert.equal(v.inside, false);
  assert.equal(v.effectiveDistance, 200, "300 - 100, not 300 - 5000");
});

check("a precise reading inside the fence is allowed", () => {
  assert.equal(judgeGeofence({ reading: readingAtMetres(20, 8), clinic }).inside, true);
});

console.log("isUsableGeofence");

check("rejects NaN coordinates, which previously let everyone through", () => {
  // parseFloat on a malformed setting yields NaN; every comparison against NaN is false, so
  // `distance > radius` was false and the geofence silently passed anyone who tried.
  assert.equal(isUsableGeofence({ lat: NaN, lng: 31.2, radius: 50 }), false);
  assert.equal(isUsableGeofence({ lat: 30.0, lng: NaN, radius: 50 }), false);
});

check("rejects a missing fence or a zero radius", () => {
  assert.equal(isUsableGeofence(null), false);
  assert.equal(isUsableGeofence({ lat: 30, lng: 31, radius: 0 }), false);
});

check("rejects out-of-range coordinates", () => {
  assert.equal(isUsableGeofence({ lat: 130, lng: 31, radius: 50 }), false);
});

check("accepts a real clinic location", () => {
  assert.equal(isUsableGeofence(clinic), true);
});

console.log("metresBetween");

check("measures a known short distance", () => {
  const d = metresBetween(clinic.lat, clinic.lng, clinic.lat + 100 / 111_320, clinic.lng);
  assert.ok(Math.abs(d - 100) <= 2, `expected ~100m, got ${d}`);
});

check("the same point is zero", () => {
  assert.equal(metresBetween(clinic.lat, clinic.lng, clinic.lat, clinic.lng), 0);
});

console.log(`\nAll assertions passed. ${passed} checks.`);
