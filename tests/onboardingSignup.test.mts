// One signup must produce one clinic, no matter how many times its owner presses Create.
//
// The scenario that made this file: a tester pressed Create, the confirmation was slow to reach
// the browser, the screen said "refresh", the form came back, they typed the name again — two
// clinics, one owner, one signup. The server had been asked twice and said yes twice. These are
// the three rules that now stand between a second press and a second clinic, plus a check that
// the screen no longer hands out the advice that started it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isValidSignupKey,
  normalizeClinicName,
  pickExistingClinic,
} from "../src/lib/onboardingSignup";

const REPO = join(import.meta.dirname, "..");
const OWNER = { A: "Owner" };

// --- rule 1: an orphan is repaired before anything else ---------------------------------------

assert.deepEqual(
  pickExistingClinic([{ id: "A", name: "Nour" }], {}, { name: "Something else", signupKey: "k1" }),
  { id: "A", reason: "orphan" },
  "a clinic the owner cannot reach is handed back whatever they typed"
);
assert.deepEqual(
  pickExistingClinic([{ id: "A", name: "Nour" }], { A: "" }, { name: "Nour" }),
  { id: "A", reason: "orphan" },
  "an empty role string is no role"
);

// --- rule 2: the same signup attempt lands on the same clinic ---------------------------------

assert.deepEqual(
  pickExistingClinic(
    [{ id: "A", name: "Ossama clinic", signupKey: "k1" }],
    OWNER,
    { name: "Ossama's clinic", signupKey: "k1" }
  ),
  { id: "A", reason: "same-request" },
  "the tester's exact case: refreshed, retyped the name differently, same tab"
);
assert.equal(
  pickExistingClinic([{ id: "A", name: "Nour", signupKey: "k1" }], OWNER, { name: "Branch two", signupKey: "k2" }),
  null,
  "a fresh key with a fresh name is a deliberate second clinic"
);
assert.equal(
  pickExistingClinic([{ id: "A", name: "Nour", signupKey: "k1" }], OWNER, { name: "Branch two", signupKey: null }),
  null,
  "no key at all (old client, private mode) never matches on key"
);

// --- rule 3: one owner, one name, one clinic --------------------------------------------------

assert.deepEqual(
  pickExistingClinic([{ id: "A", name: "Nour Dental" }], OWNER, { name: "  nour   dental " }),
  { id: "A", reason: "same-name" },
  "case and whitespace do not make a new clinic"
);
assert.deepEqual(
  pickExistingClinic([{ id: "A", name: "Ossama’s clinic" }], OWNER, { name: "Ossama's clinic" }),
  { id: "A", reason: "same-name" },
  "curly and straight apostrophes are the same name"
);
assert.equal(
  pickExistingClinic([{ id: "A", name: "Nour Dental" }], OWNER, { name: "Nour Dental Clinic" }),
  null,
  "a different name is a different clinic — no fuzzy matching"
);
assert.equal(pickExistingClinic([], {}, { name: "Nour" }), null, "a first clinic is always created");

// Orphan wins over a name match on a different clinic: the unreachable one is the emergency.
assert.deepEqual(
  pickExistingClinic(
    [{ id: "A", name: "Nour" }, { id: "B", name: "Nour" }],
    { B: "Owner" },
    { name: "Nour" }
  ),
  { id: "A", reason: "orphan" }
);

// --- the key is client input ------------------------------------------------------------------

assert.equal(isValidSignupKey("3f2c1b0e-9a8d-4c7b-b6a5-1234567890ab"), true);
assert.equal(isValidSignupKey("abc"), false, "too short to be an attempt id");
assert.equal(isValidSignupKey("x".repeat(65)), false, "bounded");
assert.equal(isValidSignupKey("has space"), false);
assert.equal(isValidSignupKey(42), false);
assert.equal(isValidSignupKey(undefined), false);

assert.equal(normalizeClinicName(undefined), "");
assert.equal(normalizeClinicName("  A  B "), "a b");

// --- the screen and the route are wired to the rule ------------------------------------------

const route = readFileSync(join(REPO, "src/app/api/onboarding/create-clinic/route.ts"), "utf8");
assert.ok(route.includes("pickExistingClinic("), "create-clinic must consult the dedupe rule before creating");
assert.ok(route.includes("signupKey"), "create-clinic must read and store the signup key");

const page = readFileSync(join(REPO, "src/app/onboarding/page.tsx"), "utf8");
assert.ok(!page.includes("location.reload()"), "the onboarding screen must never tell people to refresh into the same form");
assert.ok(page.includes("signupKey"), "the onboarding screen must send a signup key");
assert.ok(page.includes('get("new")'), "the onboarding screen must send existing owners away unless ?new=1");

const switcher = readFileSync(join(REPO, "src/components/dashboard/ClinicSwitcher.tsx"), "utf8");
assert.ok(switcher.includes("/onboarding?new=1"), "Add clinic must opt in to the form with ?new=1");

console.log("onboardingSignup: all assertions passed");
