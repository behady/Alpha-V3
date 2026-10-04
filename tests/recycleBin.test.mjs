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
  CASCADE_CHILD_COLLECTIONS,
  MAX_ACTION_BYTES,
  PATIENT_CASCADE_COLLECTIONS,
  binNoticeOf,
  describeLinked,
  cascadeCollectionsFor,
  cascadeCounts,
  checkCascadeAllowed,
  checkNotCascadeChild,
  checkPatientCascade,
  checkBinnable,
  checkClaimCascade,
  checkDeleteAllowed,
  claimLinkedRows,
  checkRestorable,
  checkRestoreAllowed,
  labelFor,
  logModuleFor,
  restoreOverrides,
} from "../src/lib/recycleBin.ts";
import { storagePathsFrom } from "../src/lib/server/recycleBinStore.ts";

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
// The Owner is an admin everywhere else in the product (isClinicAdmin in the rules, isFullAccessRole
// in the app). Checking the literal "Admin" here refused every clinic owner's deletes with a 403.
assert.equal(checkDeleteAllowed(BIN_COLLECTIONS.patients, { role: "Owner", permissions: [] }), true, "Owner passes by role");
assert.equal(checkDeleteAllowed(BIN_COLLECTIONS.services, { role: "Owner", permissions: [] }), true, "Owner passes an Admin-only collection");
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

// Insurance approvals: binnable with the patient-edit gate, labelled by approval number, and the
// uploaded document's path is recorded (it lives at snapshot.doc.path, a nested object).
assert.equal(checkBinnable("insurance_claims", "c1").ok, true);
assert.deepEqual(BIN_COLLECTIONS.insurance_claims, { permission: "patients.edit", adminOnly: false, refFields: ["patientId"] });
assert.equal(logModuleFor(["insurance_claims"]), "patients");
assert.equal(labelFor("insurance_claims", { approvalNumber: "D6000001", patientName: "Test" }), "Approval D6000001 — Test");
assert.equal(labelFor("insurance_claims", {}), "Insurance approval", "a label is never blank");
assert.deepEqual(
  storagePathsFrom("insurance_claims", { doc: { path: "clinics/c/insurance_docs/d/a.pdf" } }),
  ["clinics/c/insurance_docs/d/a.pdf"]
);
assert.deepEqual(storagePathsFrom("insurance_claims", {}), [], "a claim with no document names no file");
// insurance_docs is bookkeeping only — never binnable.
assert.equal(checkBinnable("insurance_docs", "x").ok, false);

// An approval takes its treatment rows into the bin with it. The rows are children only: a client
// still cannot bin, list or restore a ledger row or a note on its own.
for (const child of CASCADE_CHILD_COLLECTIONS) {
  assert.equal(checkBinnable(child, "x").ok, false, `${child} is never binned by itself`);
  assert.equal(BIN_COLLECTIONS[child], undefined, `${child} never appears in the bin list`);
}
assert.deepEqual(
  claimLinkedRows({ ledgerIds: { 0: { ledgerId: "L0", noteId: "N0" }, 2: { ledgerId: "L2", noteId: "N2" } } }),
  [{ ledgerId: "L0", noteId: "N0" }, { ledgerId: "L2", noteId: "N2" }]
);
assert.deepEqual(claimLinkedRows({}), [], "an approval saved before treatment rows links none");
assert.deepEqual(claimLinkedRows({ ledgerIds: [] }), []);
assert.deepEqual(
  claimLinkedRows({ ledgerIds: { 0: { ledgerId: "../patients/p1", noteId: "N0" }, 1: { ledgerId: "L1" }, 2: "junk", 3: { ledgerId: " L3", noteId: "N3" } } }),
  [],
  "an id that could step out of its collection, half a link, or junk is never followed"
);
assert.equal(checkClaimCascade([{ paid: 0 }, null, { paid: "0" }]), true, "unpaid rows (and rows already gone) go with the approval");
const paidVerdict = checkClaimCascade([{ paid: 0 }, { paid: 100 }]);
assert.equal(paidVerdict.ok, false, "one paid row blocks the whole approval");
assert.equal(paidVerdict.error, "This approval has payments recorded; reverse them first.");
assert.equal(paidVerdict.status, 409);
assert.equal(labelFor("ledger", { description: "Crown (T: Gen) | MetLife D1" }), "Crown (T: Gen) | MetLife D1");
assert.equal(labelFor("clinical_notes", {}), "Treatment note", "a label is never blank");

// --- a patient takes their whole file into the bin ------------------------------------------------

// Every record that finds its patient by patientId goes with them — money, visits, approvals and
// the ortho and lab work included — so Finance and Insurance stop showing a deleted patient.
for (const c of ["ledger", "clinical_notes", "appointments", "prescriptions", "patient_media", "insurance_claims", "ortho_cases"]) {
  assert.ok(PATIENT_CASCADE_COLLECTIONS.includes(c), `${c} goes with its patient`);
}
// A lab case is what the clinic owes the lab; binning it would leave the lab's payments standing.
assert.ok(!PATIENT_CASCADE_COLLECTIONS.includes("lab_cases"), "lab cases stay when a patient is deleted");
// The logs are the record that things happened, not part of the file.
for (const c of ["system_logs", "ledger_audit", "sms_outbox", "whatsapp_outbox", "notifications"]) {
  assert.ok(!PATIENT_CASCADE_COLLECTIONS.includes(c), `${c} stays when a patient is deleted`);
}
// Children of a patient are children only: the cascade never makes a collection binnable alone.
for (const c of ["ledger", "clinical_notes", "appointments", "ortho_cases", "lab_cases"]) {
  assert.equal(checkBinnable(c, "x").ok, false, `${c} is still never binned by itself`);
}
assert.deepEqual(cascadeCollectionsFor("patients"), PATIENT_CASCADE_COLLECTIONS);
assert.deepEqual(cascadeCollectionsFor("insurance_claims"), CASCADE_CHILD_COLLECTIONS);
assert.deepEqual(cascadeCollectionsFor("services"), [], "a price is deleted alone");
assert.deepEqual(
  cascadeCounts([{ collection: "ledger" }, { collection: "ledger" }, { collection: "appointments" }]),
  { ledger: 2, appointments: 1 }
);

assert.equal(checkPatientCascade({ alreadyInBin: [], totalBytes: 1000 }), true);
const taken = checkPatientCascade({ alreadyInBin: ["Approval D7000102 — Omar"], totalBytes: 1000 });
assert.equal(taken.reason, "CHILD_ALREADY_IN_BIN", "an older copy in the bin is never overwritten");
assert.match(taken.error, /Approval D7000102 — Omar/, "the refusal names the record in the way");
assert.match(taken.error, /permanently/, "and says how to clear it");
assert.equal(checkPatientCascade({ alreadyInBin: [], totalBytes: MAX_ACTION_BYTES + 1 }).reason, "TOO_LARGE");
assert.ok(MAX_ACTION_BYTES < 10 * 1024 * 1024, "one action must fit one Firestore commit");

// Deleting a patient never deletes more than the person could delete one record at a time.
const assistant = { role: "Assistant", permissions: ["patients.delete", "patients.edit"] };
assert.equal(checkCascadeAllowed({ patient_media: 2, insurance_claims: 1 }, assistant), true);
const noMoney = checkCascadeAllowed({ ledger: 3, appointments: 1 }, assistant);
assert.equal(noMoney.reason, "CASCADE_NO_PERMISSION");
assert.match(noMoney.error, /finance\.delete/);
assert.match(noMoney.error, /appointments\.delete/);
assert.equal(checkCascadeAllowed({ ledger: 3 }, { role: "Assistant", permissions: ["finance.delete"] }), true);
assert.equal(checkCascadeAllowed({ ledger: 3, clinical_notes: 9 }, { role: "Admin", permissions: [] }), true, "an admin may");
assert.equal(checkCascadeAllowed({ ledger: 3 }, { role: "Owner", permissions: [] }), true, "an owner may");
assert.equal(checkCascadeAllowed({ ledger: 0 }, assistant), true, "a zero count needs nothing");
assert.equal(checkCascadeAllowed({ something_new: 1 }, assistant).reason, "CASCADE_NO_PERMISSION", "an unmapped kind is admin-only");
for (const c of PATIENT_CASCADE_COLLECTIONS) {
  assert.equal(checkCascadeAllowed({ [c]: 1 }, { role: "Assistant", permissions: [] }).ok, false, `${c} needs a permission`);
}

// A child comes back, or goes for good, only with its parent.
assert.equal(checkNotCascadeChild({}), true);
const child = checkNotCascadeChild({ cascadeOf: "abc", cascadeParentLabel: "Omar Khaled" });
assert.equal(child.reason, "CASCADE_CHILD");
assert.match(child.error, /"Omar Khaled"/);
assert.match(checkNotCascadeChild({ cascadeOf: "abc" }).error, /another record/, "no label still reads as a sentence");

assert.equal(labelFor("appointments", { date: "2026-10-04", time: "19:30" }), "2026-10-04 19:30");
assert.equal(labelFor("appointments", {}), "Appointment");

// The confirm prompt reads as words, not collection names, in both languages.
assert.equal(describeLinked({ ledger: 5, appointments: 3 }, false), "5 charges & payments, 3 appointments");
assert.equal(describeLinked({ ledger: 5, appointments: 3 }, true), "حسابات ومدفوعات (5)، مواعيد (3)");
assert.equal(describeLinked({ ledger: 0, insurance_claims: 2 }, false), "2 insurance approvals", "a zero is not listed");
assert.equal(describeLinked({ something_new: 1 }, false), "1 something new", "an unnamed kind still reads");
assert.equal(describeLinked(undefined, false), "");
for (const c of PATIENT_CASCADE_COLLECTIONS) {
  assert.doesNotMatch(describeLinked({ [c]: 1 }, false), /_/, `${c} has an English name`);
  assert.doesNotMatch(describeLinked({ [c]: 1 }, true), /[a-z]/, `${c} has an Arabic name`);
}

// --- "this is in Recently Deleted", for the screens that must say so ----------------------------------

const when = new Date("2026-10-04T10:00:00.000Z");
assert.deepEqual(
  binNoticeOf({ status: "deleted", deletedAt: { toDate: () => when }, deletedByName: "Malak" }),
  { deletedAt: "2026-10-04T10:00:00.000Z", deletedByName: "Malak", withParent: null }
);
assert.deepEqual(
  binNoticeOf({ status: "deleted", cascadeOf: "p1", cascadeParentLabel: "Omar Khaled" }),
  { deletedAt: null, deletedByName: "Unknown", withParent: "Omar Khaled" },
  "deleted with its patient: the notice names the patient to restore"
);
assert.equal(binNoticeOf({ status: "restored" }), null, "a restored entry is not in the bin");
assert.equal(binNoticeOf(undefined), null);

console.log(
  `✓ recycleBin: ${Object.keys(BIN_COLLECTIONS).length} collections binnable, ` +
    `path escapes and audit trails refused, restore never overwrites`
);
