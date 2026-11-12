// A clinic with two branches has two places where staff clock in.
//
// The bug: one location was saved for the whole clinic, so everyone at the second branch was
// told they were kilometres away and could not start their shift.
//
// Run: npm run test:attendance-sites
import assert from "node:assert/strict";
import { judgeSites, readAttendanceSites, punchBranchFields } from "../src/lib/attendanceSites";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const maadi = { id: "b1", name: "Maadi", rooms: [] };
const zayed = { id: "b2", name: "Zayed", rooms: [] };
// Roughly 25 km apart, like two real Cairo branches.
const MAADI = { lat: "29.9602", lng: "31.2569", radius: "50" };
const ZAYED = { lat: "30.0131", lng: "30.9760", radius: "80" };
const legacy = { attendanceLat: MAADI.lat, attendanceLng: MAADI.lng, attendanceRadius: "50" };

const at = (site: { lat: string; lng: string }, north = 0, accuracy = 10) => ({
  latitude: Number(site.lat) + north / 111_320,
  longitude: Number(site.lng),
  accuracy,
});

console.log("readAttendanceSites");

check("no branches: the one clinic location, exactly as before", () => {
  const sites = readAttendanceSites(legacy, []);
  assert.deepEqual(sites, [{ lat: 29.9602, lng: 31.2569, radius: 50, branchId: "", branchName: "" }]);
});

check("one branch: still the one clinic location", () => {
  const sites = readAttendanceSites({ ...legacy, attendanceBranchSites: { b1: ZAYED } }, [maadi]);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].branchId, "");
});

check("nothing saved anywhere: no sites, so the screen can say the location is not set", () => {
  assert.deepEqual(readAttendanceSites({}, []), []);
  assert.deepEqual(readAttendanceSites({}, [maadi, zayed]), []);
  assert.deepEqual(readAttendanceSites(null, [maadi, zayed]), []);
});

check("a radius left empty falls back to 50 m, as the single location always did", () => {
  const sites = readAttendanceSites({ attendanceLat: "30", attendanceLng: "31", attendanceRadius: "" }, []);
  assert.equal(sites[0].radius, 50);
});

check("two branches, none filled in yet: the old clinic location keeps working", () => {
  const sites = readAttendanceSites(legacy, [maadi, zayed]);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].branchId, "");
});

check("two branches, one filled in: that branch plus the old location", () => {
  const sites = readAttendanceSites({ ...legacy, attendanceBranchSites: { b2: ZAYED } }, [maadi, zayed]);
  assert.deepEqual(sites.map((s) => s.branchId), ["b2", ""]);
  assert.equal(sites[0].branchName, "Zayed");
  assert.equal(sites[0].radius, 80);
});

check("two branches, both filled in: only the branches — the old location retires", () => {
  const sites = readAttendanceSites({ ...legacy, attendanceBranchSites: { b1: MAADI, b2: ZAYED } }, [maadi, zayed]);
  assert.deepEqual(sites.map((s) => s.branchId), ["b1", "b2"]);
});

check("a half-typed or cleared branch location is ignored, never read as 0,0", () => {
  const broken = { b1: { lat: "", lng: "", radius: "" }, b2: { lat: "abc", lng: "31", radius: "50" } };
  const sites = readAttendanceSites({ ...legacy, attendanceBranchSites: broken }, [maadi, zayed]);
  assert.deepEqual(sites.map((s) => s.branchId), [""]);
});

check("a location saved for a branch that was since deleted is ignored", () => {
  const sites = readAttendanceSites({ attendanceBranchSites: { gone: ZAYED, b1: MAADI } }, [maadi, zayed]);
  assert.deepEqual(sites.map((s) => s.branchId), ["b1"]);
});

console.log("judgeSites");

const both = readAttendanceSites({ attendanceBranchSites: { b1: MAADI, b2: ZAYED } }, [maadi, zayed]);

check("the reported failure: standing in the second branch is allowed, and names that branch", () => {
  const v = judgeSites(at(ZAYED, 20), both);
  assert.equal(v?.inside, true);
  assert.equal(v?.site.branchName, "Zayed");
});

check("standing in the first branch still works", () => {
  const v = judgeSites(at(MAADI, 10), both);
  assert.equal(v?.inside, true);
  assert.equal(v?.site.branchId, "b1");
});

check("at home, far from both: refused, and the message can name the nearer branch", () => {
  const v = judgeSites(at(ZAYED, 3000), both);
  assert.equal(v?.inside, false);
  assert.equal(v?.site.branchName, "Zayed");
  assert.ok((v?.effectiveDistance ?? 0) > 2500);
});

check("each branch is judged by its own allowed distance", () => {
  // 70 m out with a sharp fix: inside Zayed's 80 m, outside Maadi's 50 m.
  assert.equal(judgeSites(at(ZAYED, 70, 5), both)?.inside, true);
  assert.equal(judgeSites(at(MAADI, 70, 5), both)?.inside, false);
});

check("no sites at all: nothing to judge", () => {
  assert.equal(judgeSites(at(MAADI), []), null);
});

console.log("punchBranchFields");

check("a punch at a branch records which branch", () => {
  const v = judgeSites(at(ZAYED), both)!;
  assert.deepEqual(punchBranchFields(v.site, "in"), { checkInBranchId: "b2", checkInBranchName: "Zayed" });
  assert.deepEqual(punchBranchFields(v.site, "out"), { checkOutBranchId: "b2", checkOutBranchName: "Zayed" });
});

check("a punch at the old clinic-wide location adds nothing — and never an undefined", () => {
  const v = judgeSites(at(MAADI), readAttendanceSites(legacy, []))!;
  assert.deepEqual(punchBranchFields(v.site, "in"), {});
});

console.log(`attendanceSites: ${passed} checks passed`);
