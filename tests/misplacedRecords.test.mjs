// Which records ended up in the wrong clinic's books, and — as much as it matters — which cannot
// be judged at all.
//
// The detector rests on one fact: Firestore ids are random, so a ledger row naming a patient who
// lives in a different clinic did not get there by coincidence. Everything below is about not
// overstating that, in either direction: a deleted patient is not a tenancy error, and a clinic
// expense that names nobody is not evidence of anything.
import assert from "node:assert/strict";
import {
  classifyRecord,
  countVerdict,
  emptySummary,
  verdictHeadline,
} from "../src/lib/misplacedRecords.ts";

const homes = new Map([
  ["p_alpha", ["clinicA"]],
  ["p_beta", ["clinicB"]],
  // The same id in two clinics: only reachable via a v2 migration that preserved ids. Rare, and
  // the row is fine wherever it sits, so it must not be flagged.
  ["p_shared", ["clinicA", "clinicB"]],
]);

const row = (over = {}) => ({
  clinicId: "clinicA", collection: "ledger", documentId: "L1",
  patientId: "p_alpha", type: "payment", ...over,
});

// --- the row is where it belongs ---------------------------------------------------------------

assert.equal(classifyRecord(row(), homes).kind, "ok");
assert.equal(classifyRecord(row({ patientId: "p_shared" }), homes).kind, "ok");
assert.equal(classifyRecord(row({ clinicId: "clinicB", patientId: "p_shared" }), homes).kind, "ok");

// --- the row is in the wrong books ---------------------------------------------------------------

// A payment on account, logged while looking at clinic B, that landed in clinic A. The row names
// clinic B's patient; clinic A has never heard of them.
const wrong = classifyRecord(row({ clinicId: "clinicA", patientId: "p_beta" }), homes);
assert.equal(wrong.kind, "misplaced");
assert.deepEqual(wrong.homeClinicIds, ["clinicB"], "the report must say where it should have gone");

// Notes are checked the same way, though a note should never reach this state — the procedures
// route verifies the patient inside its transaction, so a mismatched one is refused instead.
assert.equal(
  classifyRecord(row({ collection: "clinical_notes", patientId: "p_beta" }), homes).kind,
  "misplaced"
);

// --- a patient who exists nowhere ------------------------------------------------------------------

// Almost always a patient deleted since: the recycle bin removes the patient and leaves the ledger
// alone. Calling that a tenancy error would send somebody hunting a bug that is not there.
const gone = classifyRecord(row({ patientId: "p_deleted" }), homes);
assert.equal(gone.kind, "orphaned");
assert.ok(!("homeClinicIds" in gone), "an orphan has nowhere to point at");

// --- what cannot be judged --------------------------------------------------------------------------

// A clinic expense names no patient, so nothing on the row says which clinic it belongs to. This is
// the case the fallback could genuinely have misfiled with no evidence left behind, and the report
// has to admit that rather than count it as clean.
for (const type of ["income", "expense"]) {
  const v = classifyRecord(row({ patientId: null, type }), homes);
  assert.equal(v.kind, "unjudgeable");
  assert.match(v.reason, new RegExp(type));
  assert.match(v.reason, /which clinic/i);
}
assert.equal(classifyRecord(row({ patientId: "   " }), homes).kind, "unjudgeable");
assert.equal(classifyRecord(row({ patientId: undefined, type: null }), homes).kind, "unjudgeable");

// --- the headline must not overstate what the run knows -----------------------------------------------

const clean = emptySummary();
for (let i = 0; i < 40; i += 1) countVerdict(clean, { kind: "ok" });
assert.match(verdictHeadline(clean), /No misplaced records found across 40/);

// A run with unjudgeable rows must NOT read as "your books are clean" — two write paths leave no
// evidence either way, and a report that hides that is worse than no report.
const partly = emptySummary();
for (let i = 0; i < 30; i += 1) countVerdict(partly, { kind: "ok" });
for (let i = 0; i < 5; i += 1) countVerdict(partly, { kind: "unjudgeable", reason: "x" });
const headline = verdictHeadline(partly);
assert.match(headline, /30 that could be/, "it must say how many were actually checked");
assert.match(headline, /5 carry no patient/);
assert.ok(!/^No misplaced records found across 35/.test(headline), "35 were not checked; 30 were");

// Anything found leads with the finding.
const bad = emptySummary();
countVerdict(bad, { kind: "ok" });
countVerdict(bad, { kind: "misplaced", homeClinicIds: ["clinicB"] });
assert.match(verdictHeadline(bad), /^1 record\(s\) are in the wrong clinic/);

// The tally adds up, or the headline is arithmetic nobody can trust.
const tally = emptySummary();
countVerdict(tally, { kind: "ok" });
countVerdict(tally, { kind: "orphaned" });
countVerdict(tally, { kind: "misplaced", homeClinicIds: ["b"] });
countVerdict(tally, { kind: "unjudgeable", reason: "x" });
assert.equal(tally.checked, tally.ok + tally.orphaned + tally.misplaced + tally.unjudgeable);

console.log("✓ misplacedRecords: misplaced, orphaned and unjudgeable told apart");
