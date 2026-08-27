// What a per-clinic restore may touch.
//
// A restore is run once, under stress, by someone who will not be reading the code at the time.
// Every refusal below is a decision made calmly in advance; these assertions are what stop it
// being quietly softened later by someone who has forgotten why it was there.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOT_COVERED,
  ROOT_COLLECTIONS,
  SIDE_EFFECTING,
  checkRestoreRequest,
  collectionVerdict,
  decideDocument,
  differingKeys,
  documentDenied,
  restoreOrder,
  labelOf,
  sameValue,
  whenOf,
} from "../src/lib/restorePlan.ts";

// --- what must never be restored ------------------------------------------------------------

for (const name of ROOT_COLLECTIONS) {
  assert.equal(collectionVerdict(name).mode, "never", `${name} must never be restored`);
}

// users is the one that matters most and deserves its own assertion. It holds clinicRoles and
// clinicPermissions — who may sign in and what they may do. Twenty-four ghost accounts had their
// access revoked here; a restore that copied users back from an older snapshot would hand every
// one of them its key again, as a side effect of recovering a ledger.
const users = collectionVerdict("users");
assert.equal(users.mode, "never");
assert.match(users.reason, /revoked/i);

// A path in a collection name would climb out of the clinic subtree.
assert.equal(collectionVerdict("patients/x").mode, "never");
assert.equal(collectionVerdict("").mode, "never");

// --- what is held back ------------------------------------------------------------------------

// The distinction that matters and is least obvious: copying back a ledger row changes a number
// on a screen; copying back an sms_outbox row SENDS A TEXT MESSAGE to a real patient.
assert.equal(collectionVerdict("sms_outbox").mode, "hold");
assert.match(collectionVerdict("sms_outbox").reason, /re-sends/i);
for (const name of Object.keys(SIDE_EFFECTING)) {
  const v = collectionVerdict(name);
  assert.equal(v.mode, "hold", `${name} should be held back`);
  assert.ok(v.reason.length > 40, `${name} needs a reason the operator can act on`);
}

// Held, not banned: there are disasters where the queue really was the thing lost.
assert.ok(!ROOT_COLLECTIONS.includes("sms_outbox"), "held is not the same as banned");

// --- ordinary clinic data ---------------------------------------------------------------------

for (const name of ["patients", "ledger", "appointments", "clinical_notes", "settings"]) {
  const v = collectionVerdict(name);
  assert.equal(v.mode, "restore", `${name} is the clinic's own data`);
  assert.equal(v.known, true, `${name} should be a recognised collection`);
}

// An unfamiliar collection is still restored — it is the clinic's data and discarding it is not
// ours to decide — but it is flagged, because "never seen this before" during a disaster is worth
// ten seconds of a human's attention.
const stranger = collectionVerdict("some_collection_nobody_wrote");
assert.equal(stranger.mode, "restore");
assert.equal(stranger.known, false);

// staff is held back, and the reason is not "it might be stale". Restoring a deleted staff row
// re-links the ghost account it belonged to: the revoker matches a user document to a staff record
// by staffId, uid OR lowercased email, and refuses to revoke anyone who matches one. So restoring
// staff disarms the tool built to remove those accounts, for exactly the accounts it was built
// for. And since this tool only creates what is MISSING, the rows it would restore are precisely
// the ones somebody deleted — the people who were offboarded.
assert.equal(collectionVerdict("staff").mode, "hold");
assert.match(collectionVerdict("staff").reason, /ghost account|revok/i);

// --- documents refused inside a restorable collection --------------------------------------------
//
// `settings` is not a table, it is a bag of about ten unrelated singletons, two of which are the
// most dangerous documents in the clinic. Collection-level policy cannot express that.

// The legacy WhatsApp credential, and a PLATFORM-WIDE one. `settings` is readable by every clinic
// member; the migration moved this document to clinic_secrets for exactly that reason. It is
// ABSENT from live in the clinics the migration cleaned, so an additive restore would put it back
// with no overwrite flag involved at all.
assert.ok(documentDenied("settings", "wapilot"));
assert.match(documentDenied("settings", "wapilot"), /clinic_secrets|platform/i);

// The transactional generator behind patient file numbers. Rewind it and the next patients
// registered are stamped with numbers already printed on existing records; nothing checks fileId
// for uniqueness, and no re-run undoes it.
assert.ok(documentDenied("settings", "counters"));
assert.match(documentDenied("settings", "counters"), /file number|counter/i);

assert.equal(documentDenied("settings", "clinic_info"), null, "ordinary settings still restore");
assert.equal(documentDenied("patients", "wapilot"), null, "the deny is per document, not per id");

// --- order ----------------------------------------------------------------------------------------
//
// Alphabetical puts `ledger` before `patients` and `prescriptions` before `services`, so the
// obvious ordering is close to the worst one available — and deterministically so, every run.
// Nothing can make a restore atomic; parents-first makes the incoherent window as short as the
// tool can make it and puts it at the start.
const ordered = restoreOrder(["ledger", "prescriptions", "patients", "appointments", "services"]);
assert.ok(ordered.indexOf("patients") < ordered.indexOf("ledger"), "patients before the rows that name them");
assert.ok(ordered.indexOf("services") < ordered.indexOf("prescriptions"));
assert.ok(ordered.indexOf("patients") < ordered.indexOf("appointments"));

// Deterministic: a resumed run must visit the same collections in the same order, or the state
// file's "completed" list means nothing.
assert.deepEqual(restoreOrder(["b", "a", "c"]), restoreOrder(["c", "b", "a"]));
assert.deepEqual(restoreOrder(["b", "a"]), ["a", "b"], "the rest stay alphabetical");

// A nested path inherits its parent collection's rank rather than being sorted as a stranger.
const nested = restoreOrder(["ledger", "patients/x/notes", "patients"]);
assert.equal(nested[0], "patients");
assert.equal(nested[1], "patients/x/notes");

// --- the guards -------------------------------------------------------------------------------

const ok = checkRestoreRequest({ clinicId: "c1", sourceDatabase: "snap-2026-08-20", targetDatabase: "default" });
assert.equal(ok.ok, true);

// Reading and writing the same database means the "snapshot" IS the live data: at best a no-op,
// at worst it resurrects documents inside the database being repaired, with nothing left to try
// again from.
const selfCopy = checkRestoreRequest({ clinicId: "c1", sourceDatabase: "snap", targetDatabase: "snap" });
assert.equal(selfCopy.ok, false);
assert.match(selfCopy.error, /never be the same/i);

// Transposing --from and --to leaves the SNAPSHOT as the write target, and the read-only guard
// follows --from, so it ends up guarding the live database instead. Every live document absent
// from the snapshot — including the ones the incident corrupted — would be created inside the
// backup; run it the right way round afterwards and that corruption returns as "restored" data.
// Naming the flags does not prevent this. Only refusing the value does.
const transposed = checkRestoreRequest({ clinicId: "c1", sourceDatabase: "default", targetDatabase: "snap-2026-08-20" });
assert.equal(transposed.ok, false);
assert.match(transposed.error, /wrong way round|live database/i);

// Both wrong at once is still refused, and by the more specific message.
assert.equal(checkRestoreRequest({ clinicId: "c1", sourceDatabase: "default", targetDatabase: "default" }).ok, false);

// A slash makes an id a multi-segment path, which escapes the tenant — the same escape the
// recycle bin refuses on document ids.
for (const bad of ["a/b", "../other", ".", ".."]) {
  const verdict = checkRestoreRequest({ clinicId: bad, sourceDatabase: "snap", targetDatabase: "default" });
  assert.equal(verdict.ok, false, `${bad} must be refused`);
  assert.match(verdict.error, /cannot contain a path|must name exactly one/i);
}

for (const missing of [
  { clinicId: "", sourceDatabase: "snap", targetDatabase: "default" },
  { clinicId: "c1", sourceDatabase: "", targetDatabase: "default" },
  { clinicId: "c1", sourceDatabase: "snap", targetDatabase: "" },
]) {
  assert.equal(checkRestoreRequest(missing).ok, false);
}

// --- the per-document decision ------------------------------------------------------------------

// Additive by default. A restore happens after damage nobody has fully mapped, and there is no
// snapshot of the present: reverting a document the clinic legitimately changed since would
// destroy the only copy of that change, silently.
assert.equal(decideDocument({ existsLive: false, identical: false, overwrite: false }).action, "create");
assert.equal(decideDocument({ existsLive: true, identical: true, overwrite: false }).action, "identical");
assert.equal(decideDocument({ existsLive: true, identical: false, overwrite: false }).action, "skip-differs");
assert.equal(decideDocument({ existsLive: true, identical: false, overwrite: true }).action, "overwrite");

// --overwrite must never resurrect something deliberately deleted after the snapshot... except it
// cannot tell the difference, which is exactly why the default creates rather than overwrites and
// why the skip message says so.
assert.match(
  decideDocument({ existsLive: true, identical: false, overwrite: false }).reason,
  /legitimate change|only copy/i
);

// Overwrite changes nothing about a document that is already identical — no pointless write, and
// no pointless entry in the report.
assert.equal(decideDocument({ existsLive: true, identical: true, overwrite: true }).action, "identical");

// Running the script twice must be as safe as running it once: the second pass sees everything it
// wrote as identical and does nothing.
const secondPass = decideDocument({ existsLive: true, identical: true, overwrite: false });
assert.equal(secondPass.action, "identical");

// --- what the operator is told they are NOT getting ------------------------------------------------

// Printed every run. The failure this prevents is someone believing they are more recovered than
// they are, and finding out months later.
assert.ok(NOT_COVERED.length >= 4);
assert.ok(NOT_COVERED.some((l) => /Storage|photograph|X-ray/i.test(l)), "must warn that images are not covered");
assert.ok(NOT_COVERED.some((l) => /login|permission|clinicRoles/i.test(l)), "must warn that logins are not restored");

// --- telling "already restored" from "changed since" ---------------------------------------------
//
// This decides whether a document is skipped silently or listed for a human to look at. Too lax
// and a real difference is hidden; too strict and the report lists thousands of identical
// documents, which is the same as having no report.

assert.equal(sameValue(1, 1), true);
assert.equal(sameValue("a", "a"), true);
assert.equal(sameValue(null, null), true);
assert.equal(sameValue(null, undefined), false, "a null field and a missing one are not the same");
assert.equal(sameValue(0, false), false, "no type coercion");
assert.equal(sameValue("1", 1), false);

assert.equal(sameValue({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } }), true);
assert.equal(sameValue({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [2, 1] } }), false, "array order matters");
assert.equal(sameValue({ a: 1 }, { a: 1, b: 2 }), false, "an added field is a difference");
assert.equal(sameValue({ a: 1, b: undefined }, { a: 1 }), false);
assert.equal(sameValue([1, 2], [1, 2, 3]), false);
assert.equal(sameValue([], {}), false);

// Class instances — Timestamp, GeoPoint, Bytes — carry their own isEqual, and that is what must
// be called. Walking into their private fields as if they were maps is how a copy tool turns a
// GeoPoint into `{_latitude, _longitude}`; that exact bug exists in recycleBinStore's
// stripUndefined today and is only harmless because nothing stores a GeoPoint yet.
class FakeTimestamp {
  constructor(seconds) { this.seconds = seconds; }
  isEqual(other) { return other instanceof FakeTimestamp && other.seconds === this.seconds; }
}
assert.equal(sameValue(new FakeTimestamp(5), new FakeTimestamp(5)), true);
assert.equal(sameValue(new FakeTimestamp(5), new FakeTimestamp(6)), false);
assert.equal(sameValue({ at: new FakeTimestamp(5) }, { at: new FakeTimestamp(5) }), true);

// A class instance must never be compared field-by-field against a plain map that happens to have
// the same shape — that is precisely the confusion the prototype test exists to prevent.
assert.equal(sameValue(new FakeTimestamp(5), { seconds: 5 }), false);

assert.equal(sameValue(new Date("2026-08-24"), new Date("2026-08-24")), true);
assert.equal(sameValue(new Date("2026-08-24"), new Date("2026-08-25")), false);

// Two documents both holding NaN in the same field are not a difference anybody wants listed.
assert.equal(sameValue(Number.NaN, Number.NaN), true);
assert.equal(sameValue({ x: Number.NaN }, { x: Number.NaN }), true);

// A document unchanged by the restore must compare equal on the second run, or every re-run
// would report the entire clinic as differing and the report would be worthless.
const doc = { name: "Sara", teeth: { 11: { status: ["caries"] } }, at: new FakeTimestamp(1), n: 3.5 };
assert.equal(sameValue(doc, JSON.parse(JSON.stringify({ ...doc, at: null })) ), false);
assert.equal(sameValue(doc, { ...doc }), true);

// --- the differs report must not become a medical record ------------------------------------------
//
// The report lands in the working directory during an incident, gets opened in a spreadsheet,
// mailed to somebody and forgotten about. Key NAMES tell the operator whether a row deserves
// attention, which is all the report is for. Values do not belong in it.

const snapshot = {
  name: "Sara Ahmed",
  diagnosis: "irreversible pulpitis, tooth 26",
  phone: "+201001234567",
  balance: 1200,
  updatedAt: "2026-08-20T10:00:00Z",
};
const live = { ...snapshot, diagnosis: "necrotic pulp, tooth 26", balance: 900 };

const keys = differingKeys(snapshot, live);
assert.deepEqual(keys, ["balance", "diagnosis"]);

const rendered = keys.join(" ");
for (const secret of ["Sara", "pulpitis", "necrotic", "201001234567", "1200", "900"]) {
  assert.ok(!rendered.includes(secret), `the differs report leaked "${secret}"`);
}

// A field present on one side only is a difference, not a crash.
assert.deepEqual(differingKeys({ a: 1 }, { a: 1, b: 2 }), ["b"]);
assert.deepEqual(differingKeys({ a: 1, b: 2 }, { a: 1 }), ["b"]);
assert.deepEqual(differingKeys(null, null), []);
assert.deepEqual(differingKeys({ a: 1 }, { a: 1 }), []);
// Only top-level names, never a nested path — a nested key can itself be identifying.
assert.deepEqual(differingKeys({ teeth: { 26: { note: "abscess" } } }, { teeth: { 26: { note: "x" } } }), ["teeth"]);

// --- the label ------------------------------------------------------------------------------------

// The label places a row without naming anybody. It used to return the patient's name straight
// into a CSV that lands in the working directory during an incident — which .gitignore did not
// cover — so one `git add -A` while recovering would have committed a patient list.
for (const identifying of ["Sara Ahmed", "Omar", "Root canal"]) {
  const rendered = labelOf({ name: identifying, patientName: identifying, displayProcedure: identifying });
  assert.ok(!rendered.includes(identifying), `labelOf leaked "${identifying}"`);
}
assert.equal(labelOf({ name: "Sara", date: "2026-08-20" }), "2026-08-20, 2 fields");
assert.equal(labelOf({ a: 1, b: 2, c: 3 }), "3 fields");
assert.equal(labelOf(null), "");
// A date is not identifying on its own and is what tells a routine row from the odd one.
assert.match(labelOf({ date: "2026-08-20T09:00:00Z" }), /^2026-08-20/);

// --- when it changed --------------------------------------------------------------------------------

assert.equal(whenOf({ updatedAt: "2026-08-20T10:00:00Z" }), "2026-08-20T10:00:00Z");
assert.equal(whenOf({ createdAt: new Date("2026-08-20T10:00:00Z") }), "2026-08-20T10:00:00.000Z");
assert.equal(whenOf({ at: { toDate: () => new Date("2026-08-20T10:00:00Z") } }), "2026-08-20T10:00:00.000Z");
assert.equal(whenOf({}), "");
assert.equal(whenOf(null), "");
// A broken timestamp must not take the run down mid-restore.
assert.equal(whenOf({ updatedAt: { toDate: () => { throw new Error("boom"); } } }), "");

// --- the root list must match firestore.rules -------------------------------------------------
//
// This check exists because writing ROOT_COLLECTIONS by hand got it wrong the first time: it named
// seven, and firestore.rules has eleven. The five that were missed — the Meta integration trio and
// the retired root pairing collections — are exactly the ones nobody thinks about, because they
// are not clinic subcollections and never appear on a screen.
//
// A root-level match block in the rules is indented four spaces; a clinic subcollection is
// indented six. That is the whole distinction, and it is load-bearing here: `sms_devices` exists
// at BOTH levels, and only the clinic one is a thing a restore may write.
// fileURLToPath, not `.pathname`. On Windows a file URL's pathname is "/C:/Users/…", and joining
// that produced "C:\C:\Users\…" — so this whole check threw ENOENT before reaching an assertion,
// and the drift it exists to catch went unguarded on every Windows machine.
const REPO = fileURLToPath(new URL("..", import.meta.url));
const rulesText = readFileSync(join(REPO, "firestore.rules"), "utf8");

const rootMatches = new Set(
  [...rulesText.matchAll(/^ {4}match \/([a-z_]+)\//gm)].map((m) => m[1])
);
const clinicMatches = new Set(
  [...rulesText.matchAll(/^ {6}match \/([a-z_]+)\//gm)].map((m) => m[1])
);
// A name can exist at BOTH levels, and sms_devices does: the root one is the retired WebView
// pairing store, denied outright, and the clinic one is a real subcollection holding the
// handsets paired to that clinic. Only names that exist ONLY at the root may be refused —
// refusing one that is also a clinic subcollection would silently drop that clinic's data
// in the middle of a recovery, which is the worst possible moment to lose something quietly.
const rootOnly = new Set([...rootMatches].filter((name) => !clinicMatches.has(name)));
// `clinics` is the parent of the subtree being restored, not a peer; the script writes documents
// underneath it and never the collection itself. It is in ROOT_COLLECTIONS all the same, because
// a collection NAMED "clinics" nested under a clinic would be a path-escape waiting to happen.
const declared = new Set(ROOT_COLLECTIONS);
const missing = [...rootOnly].filter((name) => !declared.has(name));

assert.deepEqual(
  missing.sort(),
  [],
  `firestore.rules has root collections that restorePlan does not refuse: ${missing.join(", ")}. ` +
    `A per-clinic restore must never write outside the clinic subtree.`
);

// And nothing may be refused that is not actually a root collection — otherwise a clinic
// subcollection of the same name would be silently skipped during a real recovery.
const notInRules = [...declared].filter((name) => !rootOnly.has(name));
assert.deepEqual(
  notInRules.sort(),
  [],
  `restorePlan refuses ${notInRules.join(", ")}, which firestore.rules does not declare at the ` +
    `root. If these are clinic subcollections, refusing them loses the clinic's data.`
);

// sms_devices is the trap: root AND clinic-level. The clinic one must remain restorable.
assert.ok(/^ {6}match \/sms_devices\//m.test(rulesText), "sms_devices should exist as a clinic subcollection");
assert.notEqual(collectionVerdict("sms_devices").mode, "never", "the clinic-level sms_devices must not be refused");

console.log(
  `✓ restorePlan: ${ROOT_COLLECTIONS.length} collections never restored, ` +
    `${Object.keys(SIDE_EFFECTING).length} held back, ${NOT_COVERED.length} stated limits`
);
