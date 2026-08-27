// Who may ask the assistant to change a record.
//
// Worth a test because of how this failed. /api/gemini reaches Firestore through the Admin SDK,
// which bypasses firestore.rules completely, and every staff role shares one chat surface. The
// route checked WHICH collections the assistant may touch — the same answer for everybody — and
// never checked WHETHER THIS PERSON may make the change. So a receptionist who cannot write a
// clinical note from the screen that owns it could ask the assistant to write one, and it would.
//
// Nothing about that is visible in a code review of either half: the collection allowlist looks
// like an authorization check, and the role check that should sit beside it is simply absent.
//
// Every real-world miss belongs here.
import assert from "node:assert/strict";
import {
  AI_WRITABLE_COLLECTIONS,
  AI_DELETABLE_COLLECTIONS,
  requiredWritePermission,
  mayWrite,
} from "../src/lib/aiWritePolicy";
import { COLLECTION_WRITE_PERMISSIONS, expandPermissions, ROLE_BASELINE } from "../src/lib/permissions";

/** The permissions each role actually carries, as update-user materialises them. */
const perms = (role: string) => expandPermissions(role, []);
const RECEPTIONIST = perms("Receptionist");
const DENTIST = perms("Dentist");
const ASSISTANT = perms("Assistant");

// --- the mapping mirrors the one firestore.rules enforces -------------------------------------
for (const mode of ["create", "update", "delete"] as const) {
  for (const [collection, permission] of Object.entries(COLLECTION_WRITE_PERMISSIONS[mode])) {
    assert.equal(
      requiredWritePermission(collection, mode),
      permission,
      `${mode} ${collection} must demand the same permission the rules demand`,
    );
  }
}

// --- absent means "clinic membership is enough", never "deny" ----------------------------------
// tickets is handed to any active clinic member by firestore.rules (memberMayWrite). Denying it
// here would make the assistant refuse what the booking screen allows.
assert.equal(requiredWritePermission("tickets", "create"), null, "tickets needs no extra permission");
assert.ok(mayWrite("tickets", "create", "Receptionist", RECEPTIONIST), "reception books tickets");
assert.equal(requiredWritePermission("not_a_collection", "create"), null);

// --- every writable collection is a decision someone made --------------------------------------
// If a collection joins the assistant's writable set, this forces a choice about its permission
// rather than letting it default to "anyone".
const KNOWN_UNGATED = new Set(["tickets"]);
for (const collection of AI_WRITABLE_COLLECTIONS) {
  const required = requiredWritePermission(collection, "create");
  assert.ok(
    required || KNOWN_UNGATED.has(collection),
    `${collection} is assistant-writable with no permission mapping and is not a known blanket-write collection`,
  );
}
for (const collection of AI_DELETABLE_COLLECTIONS) {
  assert.ok(AI_WRITABLE_COLLECTIONS.has(collection), `${collection} is deletable but not writable`);
}

// --- payroll and the price list stay out of reach entirely -------------------------------------
assert.ok(!AI_WRITABLE_COLLECTIONS.has("staff"), "staff holds salaries and must never be assistant-writable");
assert.ok(!AI_WRITABLE_COLLECTIONS.has("services"), "the price list is read-only to the assistant");
assert.ok(!AI_WRITABLE_COLLECTIONS.has("settings"), "clinic settings are not assistant-writable");

// --- the reported hole: a receptionist writing clinical and financial records ------------------
assert.ok(!ROLE_BASELINE.Receptionist.includes("clinical.edit"), "premise: reception has no clinical.edit");
assert.equal(
  mayWrite("clinical_notes", "create", "Receptionist", RECEPTIONIST), false,
  "a receptionist must not write a clinical note through the assistant",
);
assert.equal(
  mayWrite("ledger", "update", "Receptionist", RECEPTIONIST), false,
  "reception takes payments (finance.add) but does not edit the ledger (finance.edit)",
);
assert.equal(
  mayWrite("patients", "delete", "Receptionist", RECEPTIONIST), false,
  "deleting a patient needs patients.delete, which no baseline role carries",
);
assert.equal(
  mayWrite("patients", "update", "Receptionist", RECEPTIONIST), true,
  "reception edits patient details on the screen, so the assistant may too",
);
assert.equal(
  mayWrite("ledger", "create", "Receptionist", RECEPTIONIST), true,
  "reception takes payments — finance.add is in its baseline",
);

// --- the other half: legitimate users must not be locked out -----------------------------------
assert.equal(mayWrite("clinical_notes", "create", "Dentist", DENTIST), true, "dentists write notes");
assert.equal(mayWrite("ledger", "create", "Dentist", DENTIST), true, "a billed procedure posts its charge");
assert.equal(mayWrite("clinical_notes", "create", "Assistant", ASSISTANT), true, "assistants have clinical.edit");
assert.equal(mayWrite("inventory", "create", "Assistant", ASSISTANT), true, "assistants stock materials");
assert.equal(
  mayWrite("inventory", "create", "Dentist", DENTIST), false,
  "a dentist consumes stock (inventory.edit) but does not add items (inventory.add)",
);

// --- Owner and Admin pass without consulting a list --------------------------------------------
// expandPermissions returns [] for them by design, so a list-based check would refuse everyone.
assert.deepEqual(perms("Admin"), [], "premise: admins carry no materialised list");
for (const role of ["Admin", "Owner"]) {
  for (const mode of ["create", "update", "delete"] as const) {
    assert.equal(mayWrite("ledger", mode, role, []), true, `${role} may ${mode} ledger`);
    assert.equal(mayWrite("clinical_notes", mode, role, []), true, `${role} may ${mode} clinical notes`);
  }
}

// --- shapes that must never be read as permission ----------------------------------------------
assert.equal(mayWrite("clinical_notes", "create", null, undefined), false, "no role, no list, no write");
assert.equal(mayWrite("clinical_notes", "create", "Receptionist", undefined), false);
assert.equal(mayWrite("clinical_notes", "create", "", []), false);
assert.equal(mayWrite("  clinical_notes  ", "create", "Receptionist", RECEPTIONIST), false, "padding is trimmed, not a bypass");

console.log("aiWritePolicy: all assertions passed");
