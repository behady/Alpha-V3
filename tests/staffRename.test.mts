// Renaming a member of staff: which copies of the old name are rewritten, and — the part that
// matters more — which are left alone. A patient who shares the dentist's name must keep theirs.
//
// Run with tsx: npm run test:rename
import assert from "node:assert/strict";
import { renameInDocument, renamedValue, validateStaffName, type RenameTarget } from "../src/lib/staffRename";

let checks = 0;
function eq<T>(actual: T, expected: T, message: string) {
  assert.deepEqual(actual, expected, message);
  checks++;
}

const T: RenameTarget = { oldName: "Norhan", newName: "Norhan Adel", ids: ["staffDoc1", "uid1"] };

// ── the value itself ────────────────────────────────────────────────────────
eq(renamedValue("Norhan", T), "Norhan Adel", "exact name");
eq(renamedValue("  norhan ", T), "Norhan Adel", "case and spacing ignored");
eq(renamedValue("Dr. Norhan", T), "Dr. Norhan Adel", "title kept");
eq(renamedValue("د. Norhan", T), "د. Norhan Adel", "Arabic title kept");
eq(renamedValue("Norhana", T), null, "a longer name is someone else");
eq(renamedValue("Norhan Ali", T), null, "a fuller name is someone else");
eq(renamedValue("Dr. Norhan", { ...T, newName: "Dr. N. Adel" }), "Dr. N. Adel", "new title wins");

// ── a booking: id-anchored and name-only fields together ────────────────────
const booking = {
  patientName: "Norhan",
  patientId: "p1",
  doctor: "Norhan",
  doctorId: "staffDoc1",
  addedBy: "Norhan",
  modifiedBy: "Malak",
  notes: "Norhan asked for a later slot",
  statusHistory: [
    { status: "Scheduled", modifiedBy: "Norhan" },
    { status: "Completed", modifiedBy: "Malak" },
  ],
  createdAt: new Date(0),
};
const b = renameInDocument(booking, T);
eq(b.patch.doctor, "Norhan Adel", "doctor renamed");
eq(b.patch.addedBy, "Norhan Adel", "addedBy renamed");
eq("patientName" in b.patch, false, "a patient with the same name keeps it");
eq("notes" in b.patch, false, "free text untouched");
eq("modifiedBy" in b.patch, false, "someone else's field untouched");
eq(
  b.patch.statusHistory,
  [
    { status: "Scheduled", modifiedBy: "Norhan Adel" },
    { status: "Completed", modifiedBy: "Malak" },
  ],
  "status history rewritten entry by entry"
);
eq(booking.doctor, "Norhan", "input not mutated");

// ── id anchors correct a copy taken under an even older name ────────────────
const payment = { doctorId: "staffDoc1", doctorName: "Nour", createdBy: "uid1", createdByName: "Nour H", amount: 100 };
const p = renameInDocument(payment, T);
eq(p.patch, { doctorName: "Norhan Adel", createdByName: "Norhan Adel" }, "anchored by staff id and uid");

// …but another dentist's row with the same old name under an id that is not theirs stays.
const other = { doctorId: "staffDoc2", doctorName: "Ramy", addedBy: "Ramy" };
eq(renameInDocument(other, T).changes, 0, "other staff untouched");

// ── nested objects and name lists ───────────────────────────────────────────
const room = { name: "Room 1", dentists: ["Norhan", "Ramy"], schedule: [{ staffId: "staffDoc1", name: "Norhan" }] };
const r = renameInDocument(room, T);
eq(r.patch.dentists, ["Norhan Adel", "Ramy"], "string list of names");
eq(r.patch.schedule, [{ staffId: "staffDoc1", name: "Norhan Adel" }], "nested id + name entry");
eq("name" in r.patch, false, "the document's own top-level name is not a person");

// A top-level `name` beside an id is the document's own subject — a patient called Norhan.
const patient = { id: "staffDoc1", name: "Norhan" };
eq(renameInDocument(patient, T).changes, 0, "top-level id+name never treated as staff");

// Keys that only look like `…By`.
eq(renameInDocument({ lobby: "Norhan", hobby: "Norhan" }, T).changes, 0, "lowercase 'by' is not a person key");

// Nothing to do → nothing written.
eq(renameInDocument({ doctor: "Ramy", amount: 5 }, T), { patch: {}, changes: 0 }, "no-op");

// ── the new name ────────────────────────────────────────────────────────────
eq(validateStaffName("  Norhan   Adel "), { ok: true, name: "Norhan Adel" }, "spacing tidied");
eq(validateStaffName("   ").ok, false, "blank refused");
eq(validateStaffName("x".repeat(81)).ok, false, "too long refused");

console.log(`staffRename: ${checks} checks passed`);
