// Fixture test for what may go in the recycle bin and what may come back out. Run with tsx.
//
// The adversarial review of this design found eleven blocking defects. Most were one shape: a
// server route runs on the Admin SDK, which bypasses firestore.rules entirely, so every boundary
// the rules enforce has to be re-enforced in code or it is simply gone. The assertions below are
// those boundaries.
import assert from "node:assert/strict";
import {
  BIN_COLLECTIONS,
  ROUTED_ELSEWHERE,
  checkBinnable,
  checkDeleteAllowed,
  checkRestorable,
  checkRestoreAllowed,
  labelFor,
  restoreOverrides,
} from "../src/lib/recycleBin.ts";

// --- what the route will touch at all ------------------------------------------------------------

// The four global collections are returned UNPREFIXED by adminClinicCollection, so naming one
// makes clinicId stop scoping anything: an Admin of clinic A could delete clinic B, or copy the
// WhatsApp gateway token out of clinic_secrets into a snapshot the bin would then hold.
for (const global of ["users", "clinics", "join_requests", "clinic_secrets"]) {
  const verdict = checkBinnable(global, "anything");
  assert.equal(verdict.ok, false, `${global} must be refused`);
  assert.equal(verdict.reason, "GLOBAL_COLLECTION");
}

// A document id containing a slash is a legal multi-segment path — it escapes the tenant prefix.
assert.equal(checkBinnable("patients", "../../clinics/other").reason, "BAD_PATH");
assert.equal(checkBinnable("patients", "a/b").reason, "BAD_PATH");
assert.equal(checkBinnable("pat/ients", "x").reason, "BAD_PATH");
assert.equal(checkBinnable("patients", "..").reason, "BAD_PATH");

// Money and clinical notes have guarded routes that refuse a charge with payments against it and
// keep the note/ledger cascade atomic. A generic route would be a fourth door with none of that.
for (const [name, route] of Object.entries(ROUTED_ELSEWHERE)) {
  const verdict = checkBinnable(name, "x");
  assert.equal(verdict.ok, false, `${name} must not be binnable`);
  assert.equal(verdict.reason, "ROUTED_ELSEWHERE");
  assert.match(verdict.error, new RegExp(route.replace(/\//g, "\\/")), "the refusal must name the right door");
}

// Absent from the table means DENY. These are the collections the rules close on purpose — the
// audit trails, the credit meter, the outbound message queues — and a permission-map lookup would
// return null for every one of them, which `holdsPermission` reads as "open to any member".
for (const closed of [
  "system_logs", "staff", "settings", "ai_deletion_log", "ai_usage", "ai_usage_log",
  "ai_pending_actions", "message_drafts", "sms_outbox", "sms_devices", "whatsapp_outbox",
  "ledger_audit", "inventory_transactions", "ortho_cases",
]) {
  const verdict = checkBinnable(closed, "x");
  assert.equal(verdict.ok, false, `${closed} must not be binnable`);
}

assert.equal(checkBinnable("patients", "pat1").ok, true);
assert.equal(checkBinnable("", "x").reason, "MISSING");
assert.equal(checkBinnable("patients", "").reason, "MISSING");

// Every rule must carry at least one gate, or it is reachable by any clinic member.
for (const [name, rule] of Object.entries(BIN_COLLECTIONS)) {
  assert.ok(
    rule.permission !== null || rule.adminOnly,
    `${name} has neither a permission nor an admin gate`
  );
}

// --- who may delete -------------------------------------------------------------------------------

const receptionist = { role: "Receptionist", permissions: ["patients.add", "appointments.add", "finance.add"] };
const nurse = { role: "Assistant", permissions: ["patients.edit", "clinical.edit"] };
const admin = { role: "Admin", permissions: [] };

assert.equal(checkDeleteAllowed(BIN_COLLECTIONS.patients, receptionist).ok, false, "no patients.delete");
assert.equal(checkDeleteAllowed(BIN_COLLECTIONS.patients, admin), true, "Admin passes by role");
assert.equal(checkDeleteAllowed(BIN_COLLECTIONS.patient_media, nurse), true, "patients.edit covers media");

// THE ADMIN SHORT-CIRCUIT. requireStaffPermission returns early for an Admin, so an Admin-only
// collection must be gated BEFORE that check and independently of the mapped permission —
// otherwise `services` becomes deletable by anyone holding access.settings, which any role can be
// granted, while firestore.rules requires isClinicAdmin.
const withSettings = { role: "Receptionist", permissions: ["access.settings"] };
const servicesVerdict = checkDeleteAllowed(BIN_COLLECTIONS.services, withSettings);
assert.equal(servicesVerdict.ok, false, "access.settings must not unlock an Admin-only collection");
assert.equal(servicesVerdict.reason, "ADMIN_ONLY");
assert.equal(checkDeleteAllowed(BIN_COLLECTIONS.services, admin), true);

// `leads` is gated by role alone — its permission is null and that is deliberate.
assert.equal(checkDeleteAllowed(BIN_COLLECTIONS.leads, nurse).reason, "ADMIN_ONLY");
assert.equal(checkDeleteAllowed(BIN_COLLECTIONS.leads, admin), true);

// --- who may restore --------------------------------------------------------------------------------

// A restore is a CREATE done with the Admin SDK, so the create permission the rules would have
// demanded is bypassed unless it is demanded here.
const createPerm = (c) => ({ patients: "patients.add", treatment_plans: "clinical.edit" }[c] ?? null);

const deleterWithoutCreate = { role: "Assistant", permissions: ["clinical.delete"] };
const restoreVerdict = checkRestoreAllowed("treatment_plans", BIN_COLLECTIONS.treatment_plans, deleterWithoutCreate, createPerm);
assert.equal(restoreVerdict.ok, false, "deleting is not enough to restore");
assert.equal(restoreVerdict.reason, "NO_CREATE_PERMISSION");

const fullClinical = { role: "Assistant", permissions: ["clinical.delete", "clinical.edit"] };
assert.equal(checkRestoreAllowed("treatment_plans", BIN_COLLECTIONS.treatment_plans, fullClinical, createPerm), true);
// Someone who could never have deleted it does not get to adjudicate the undo.
assert.equal(
  checkRestoreAllowed("treatment_plans", BIN_COLLECTIONS.treatment_plans, receptionist, createPerm).ok,
  false
);

// --- can this snapshot go back ------------------------------------------------------------------------

const base = {
  collection: "patients",
  entryStatus: "deleted",
  targetExists: false,
  missingRefs: [],
  snapshot: { name: "Mona" },
};

assert.equal(checkRestorable(base), true);

// THE ONE THAT MATTERS MOST. The document id is the only foreign key this app has. Restoring under
// a fresh id orphans every pointer at it; overwriting destroys whatever was charted in the gap —
// and `patients.teethData` is written wholesale with no per-tooth history, so an overwrite leaves
// nothing to reconcile against. Refusing is the only answer that cannot lose data.
const occupied = checkRestorable({ ...base, targetExists: true });
assert.equal(occupied.ok, false);
assert.equal(occupied.status, 409);
assert.equal(occupied.reason, "TARGET_OCCUPIED");
assert.match(occupied.error, /merge by hand/);

// Single-use: a double click, or two operators at once, must not restore twice.
assert.equal(checkRestorable({ ...base, entryStatus: "restored" }).reason, "ALREADY_HANDLED");
assert.equal(checkRestorable({ ...base, entryStatus: "purged" }).reason, "ALREADY_HANDLED");

// Live PHI that no screen can reach: every read of a prescription is `where patientId ==`, issued
// from a patient page that will not load. It could never be deleted again either.
const orphan = checkRestorable({
  ...base,
  collection: "prescriptions",
  missingRefs: ["the patient this belongs to"],
});
assert.equal(orphan.reason, "MISSING_REF");
assert.match(orphan.error, /Restore it first/);

// An open shift restored verbatim becomes live: elapsed weeks count as worked minutes.
assert.equal(
  checkRestorable({ ...base, collection: "attendance", snapshot: { date: "2026-01-01" } }).reason,
  "OPEN_SHIFT"
);
assert.equal(
  checkRestorable({ ...base, collection: "attendance", snapshot: { checkIn: "09:00", checkOut: "17:00" } }),
  true
);

// A duplicate name on a service makes which price a patient is charged arbitrary and invisible.
assert.equal(checkRestorable({ ...base, collection: "services", duplicateOf: "Crown" }).reason, "DUPLICATE");
// Only a patient duplicate is overridable, only by an Admin, only deliberately.
assert.equal(checkRestorable({ ...base, duplicateOf: "Mona (+2010)" }).reason, "DUPLICATE");
assert.equal(
  checkRestorable({ ...base, duplicateOf: "Mona (+2010)", acknowledgeDuplicate: true, actorIsAdmin: true }),
  true
);
assert.equal(
  checkRestorable({ ...base, duplicateOf: "x", acknowledgeDuplicate: true, actorIsAdmin: false }).reason,
  "DUPLICATE",
  "a non-Admin cannot wave through a duplicate patient"
);
assert.equal(
  checkRestorable({ ...base, collection: "services", duplicateOf: "Crown", acknowledgeDuplicate: true, actorIsAdmin: true }).reason,
  "DUPLICATE",
  "only patients are overridable"
);

// --- what a restore changes on the way back ---------------------------------------------------------

// Verbatim is right for clinical facts — re-stamping createdAt on a radiograph would file a
// years-old image under "today", which is a falsified record. These are the exceptions: fields
// that enrol the record in something ongoing.
assert.deepEqual(restoreOverrides("diagnosis_chats", { mode: "super" }), { mode: "power" });
assert.deepEqual(restoreOverrides("treatment_plans", { status: "accepted" }), { status: "draft" });
assert.deepEqual(restoreOverrides("treatment_plans", { status: "presented" }), { status: "draft" });
assert.deepEqual(restoreOverrides("treatment_plans", { status: "draft" }), {}, "a draft is left alone");
assert.deepEqual(restoreOverrides("marketing_content", {}), { status: "draft", scheduledDate: null, starred: false });
assert.deepEqual(restoreOverrides("patients", { name: "Mona" }), {}, "clinical records come back verbatim");

// --- the bin list is readable without opening anything -------------------------------------------------

assert.equal(labelFor("patients", { name: "Mona Ali" }), "Mona Ali");
assert.equal(labelFor("patients", { fileNumber: "PT-1042" }), "PT-1042");
assert.equal(labelFor("patient_media", { fileName: "xray.jpg" }), "xray.jpg");
assert.equal(labelFor("services", { name: "Crown" }), "Crown");
assert.equal(labelFor("attendance", { staffName: "Malak", date: "2026-08-01" }), "Malak — 2026-08-01");
assert.equal(labelFor("patients", {}), "Patient", "a label is never blank");

console.log(
  `✓ recycleBin: ${Object.keys(BIN_COLLECTIONS).length} collections binnable, ` +
    `path escapes and audit trails refused, restore never overwrites`
);
