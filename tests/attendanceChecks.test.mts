// The two clock-in switches: location (GPS) and phone lock.
// Run: npm run test:attendance-checks
import assert from "node:assert/strict";
import { isDeviceRefused, readAttendanceChecks } from "../src/lib/attendanceChecks";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log("readAttendanceChecks");

check("a clinic that never saw the switches keeps both checks ON", () => {
  assert.deepEqual(readAttendanceChecks({ attendanceLat: "30.07", attendanceRadius: "36" }), { location: true, device: true });
  assert.deepEqual(readAttendanceChecks({}), { location: true, device: true });
});

check("settings that failed to load keep both checks ON", () => {
  assert.deepEqual(readAttendanceChecks(null), { location: true, device: true });
  assert.deepEqual(readAttendanceChecks(undefined), { location: true, device: true });
});

check("only a saved false turns a check off — junk never loosens anything", () => {
  for (const junk of ["", 0, null, undefined, "no", "off", {}]) {
    const c = readAttendanceChecks({ attendanceRequireLocation: junk, attendanceRequireDevice: junk });
    assert.deepEqual(c, { location: true, device: true }, `junk value ${JSON.stringify(junk)} must not switch a check off`);
  }
});

check("each switch works on its own", () => {
  assert.deepEqual(readAttendanceChecks({ attendanceRequireLocation: false }), { location: false, device: true });
  assert.deepEqual(readAttendanceChecks({ attendanceRequireDevice: false }), { location: true, device: false });
  assert.deepEqual(readAttendanceChecks({ attendanceRequireLocation: false, attendanceRequireDevice: false }), { location: false, device: false });
});

check("switching back on is a saved true", () => {
  assert.deepEqual(readAttendanceChecks({ attendanceRequireLocation: true, attendanceRequireDevice: true }), { location: true, device: true });
});

console.log("isDeviceRefused");

const on = { location: true, device: true };
const lockOff = { location: true, device: false };

check("phone lock on: a different phone is refused", () => {
  assert.equal(isDeviceRefused({ checks: on, registeredDeviceId: "dev_A", currentDeviceId: "dev_B" }), true);
});

check("phone lock on: the registered phone is accepted", () => {
  assert.equal(isDeviceRefused({ checks: on, registeredDeviceId: "dev_A", currentDeviceId: "dev_A" }), false);
});

check("phone lock on: nobody registered yet -> accepted (first clock-in registers)", () => {
  assert.equal(isDeviceRefused({ checks: on, registeredDeviceId: null, currentDeviceId: "dev_B" }), false);
  assert.equal(isDeviceRefused({ checks: on, registeredDeviceId: undefined, currentDeviceId: "dev_B" }), false);
});

check("phone lock off: a different phone is accepted", () => {
  assert.equal(isDeviceRefused({ checks: lockOff, registeredDeviceId: "dev_A", currentDeviceId: "dev_B" }), false);
});

console.log(`\nAll assertions passed. ${passed} checks.`);
