// A clinic cannot be deleted without its name being typed, and never without a copy.
//
// The superadmin Delete button once removed a live clinic's header in one click behind a generic
// "are you sure?". Recovery depended on point-in-time recovery being switched on and somebody
// noticing within seven days. These are the rules that now stand in front of that button, plus a
// grep that the button no longer deletes from the browser at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  headerFromTrash,
  letGoMembers,
  membersFromTrash,
  REMOVE_FIELD,
  trashRecordFrom,
  typedNameMatches,
  welcomeBackPatch,
} from "../src/lib/clinicTrash";

const REPO = join(import.meta.dirname, "..");

// --- the typed name -----------------------------------------------------------------------------

assert.equal(typedNameMatches("Alpha Dental Clinic", "Alpha Dental Clinic"), true);
assert.equal(typedNameMatches("  Alpha  Dental Clinic ", "Alpha Dental Clinic"), true, "stray spaces are a keyboard slip, not inattention");
assert.equal(typedNameMatches("alpha dental clinic", "Alpha Dental Clinic"), false, "case is part of reading the name");
assert.equal(typedNameMatches("Alpha Dental", "Alpha Dental Clinic"), false, "a prefix is not the name");
assert.equal(typedNameMatches("", "Alpha Dental Clinic"), false);
assert.equal(typedNameMatches(undefined, "Alpha Dental Clinic"), false);
assert.equal(typedNameMatches("", ""), false, "an unnamed clinic cannot be deleted by typing nothing");
assert.equal(typedNameMatches("x", undefined), false);

// --- the copy -----------------------------------------------------------------------------------

const header = {
  name: "Alpha Dental Clinic",
  ownerId: "owner-1",
  status: "Active",
  subscriptionTier: "Premium",
  features: { inventory: true, extraAiCredits: 1500 },
  createdAt: "ts",
};
const record = trashRecordFrom(header, { uid: "admin-1", email: "admin@example.com", at: "now" });
assert.deepEqual(
  record,
  { ...header, deletedAt: "now", deletedBy: "admin-1", deletedByEmail: "admin@example.com", members: {} },
  "the trash record is the whole header plus who and when"
);
assert.equal("deletedByEmail" in trashRecordFrom(header, { uid: "admin-1", email: null, at: "now" }), false, "no email, no email field (Firestore rejects undefined)");

assert.deepEqual(headerFromTrash(record), header, "restore hands back exactly the header that was deleted");
assert.notEqual(headerFromTrash(record), record, "a copy, not the same object");

// --- the staff ----------------------------------------------------------------------------------
//
// The owner deleted their clinic to sign up again with the same Google account, and the app
// signed them straight back into the deleted clinic: the header was gone, their role was not.

const CLINIC = "sham";
const owner = { uid: "owner", clinicRoles: { [CLINIC]: "Owner" }, defaultClinicId: CLINIC };
const twoClinics = { uid: "dr", clinicRoles: { [CLINIC]: "Dentist", other: "Admin" }, defaultClinicId: CLINIC };
const elsewhere = { uid: "nurse", clinicRoles: { [CLINIC]: "Nurse", other: "Nurse" }, defaultClinicId: "other" };
const stranger = { uid: "stranger", clinicRoles: { other: "Admin" }, defaultClinicId: "other" };

const { remembered, patches } = letGoMembers(CLINIC, [owner, twoClinics, elsewhere, stranger]);

assert.deepEqual(
  remembered,
  { owner: { role: "Owner", wasDefault: true }, dr: { role: "Dentist", wasDefault: true }, nurse: { role: "Nurse", wasDefault: false } },
  "every member's role is remembered; a non-member is not"
);
assert.equal("stranger" in patches, false, "nobody outside the clinic is touched");
assert.deepEqual(
  patches.owner,
  { [`clinicRoles.${CLINIC}`]: REMOVE_FIELD, defaultClinicId: REMOVE_FIELD },
  "the owner's only clinic goes, and so does the default — next sign-in lands on onboarding"
);
assert.deepEqual(
  patches.dr,
  { [`clinicRoles.${CLINIC}`]: REMOVE_FIELD, defaultClinicId: "other" },
  "someone whose default was this clinic is moved to a clinic they still hold"
);
assert.deepEqual(
  patches.nurse,
  { [`clinicRoles.${CLINIC}`]: REMOVE_FIELD },
  "a default that already points elsewhere is left alone"
);

const trashed = trashRecordFrom(header, { uid: "admin-1", email: null, at: "now" }, remembered);
assert.deepEqual(membersFromTrash(trashed), remembered, "the members survive the round trip through the record");
assert.deepEqual(headerFromTrash(trashed), header, "members are a trash stamp, never written back onto the clinic header");
assert.deepEqual(membersFromTrash({ name: "old" }), {}, "a record from before members were kept restores nobody, and does not throw");
assert.deepEqual(membersFromTrash({ members: { x: "Owner", y: null } }), {}, "garbage in the members map is ignored");

assert.deepEqual(
  welcomeBackPatch(CLINIC, remembered.owner, { uid: "owner", clinicRoles: {}, defaultClinicId: null }),
  { [`clinicRoles.${CLINIC}`]: "Owner", defaultClinicId: CLINIC },
  "restore gives the owner their role and their default back"
);
assert.deepEqual(
  welcomeBackPatch(CLINIC, remembered.dr, { uid: "dr", clinicRoles: { other: "Admin" }, defaultClinicId: "other" }),
  { [`clinicRoles.${CLINIC}`]: "Dentist" },
  "someone who settled on another clinic meanwhile keeps that default"
);
assert.deepEqual(
  welcomeBackPatch(CLINIC, remembered.nurse, null),
  { [`clinicRoles.${CLINIC}`]: "Nurse" },
  "a role that was never the default does not become one"
);

// --- the button ---------------------------------------------------------------------------------

const page = readFileSync(join(REPO, "src/app/superadmin/page.tsx"), "utf8");
assert.ok(!page.includes("deleteDoc("), "the superadmin page must not delete clinics from the browser");
assert.ok(page.includes("/api/admin/clinic-trash"), "delete and restore go through the trash route");
assert.ok(page.includes("typedNameMatches("), "the page checks the typed name before calling the server");

const route = readFileSync(join(REPO, "src/app/api/admin/clinic-trash/route.ts"), "utf8");
assert.ok(route.includes("requireSuperAdmin("), "the trash route is superadmin-only");
assert.ok(route.includes("typedNameMatches("), "the server checks the typed name itself, not just the dialog");
assert.ok(route.includes("runTransaction"), "copy and delete happen together or not at all");
assert.ok(route.includes("letGoMembers("), "deleting a clinic takes its staff's roles with it");
assert.ok(route.includes("welcomeBackPatch("), "restoring a clinic hands the roles back");

console.log("clinicTrash: all assertions passed");
