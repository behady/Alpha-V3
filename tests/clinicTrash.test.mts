// A clinic cannot be deleted without its name being typed, and never without a copy.
//
// The superadmin Delete button once removed a live clinic's header in one click behind a generic
// "are you sure?". Recovery depended on point-in-time recovery being switched on and somebody
// noticing within seven days. These are the rules that now stand in front of that button, plus a
// grep that the button no longer deletes from the browser at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { headerFromTrash, trashRecordFrom, typedNameMatches } from "../src/lib/clinicTrash";

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
  { ...header, deletedAt: "now", deletedBy: "admin-1", deletedByEmail: "admin@example.com" },
  "the trash record is the whole header plus who and when"
);
assert.equal("deletedByEmail" in trashRecordFrom(header, { uid: "admin-1", email: null, at: "now" }), false, "no email, no email field (Firestore rejects undefined)");

assert.deepEqual(headerFromTrash(record), header, "restore hands back exactly the header that was deleted");
assert.notEqual(headerFromTrash(record), record, "a copy, not the same object");

// --- the button ---------------------------------------------------------------------------------

const page = readFileSync(join(REPO, "src/app/superadmin/page.tsx"), "utf8");
assert.ok(!page.includes("deleteDoc("), "the superadmin page must not delete clinics from the browser");
assert.ok(page.includes("/api/admin/clinic-trash"), "delete and restore go through the trash route");
assert.ok(page.includes("typedNameMatches("), "the page checks the typed name before calling the server");

const route = readFileSync(join(REPO, "src/app/api/admin/clinic-trash/route.ts"), "utf8");
assert.ok(route.includes("requireSuperAdmin("), "the trash route is superadmin-only");
assert.ok(route.includes("typedNameMatches("), "the server checks the typed name itself, not just the dialog");
assert.ok(route.includes("runTransaction"), "copy and delete happen together or not at all");

console.log("clinicTrash: all assertions passed");
