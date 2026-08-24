// Does the server agree with firestore.rules about whether a clinic may still be written to?
//
// It has to, exactly, because the two answer for different doors into the same database. The rules
// govern what the browser writes directly; this module governs what the 37 Admin-SDK routes write,
// and the Admin SDK does not consult rules at all. When they disagree, the same action succeeds or
// fails depending on which path the code happened to take — which is how an expired clinic could
// still take payments after the money writes moved server-side.
//
// So several assertions below look like they are testing for a hole. They are testing that the
// hole is the SAME hole the rules have. A server that is stricter than the rules is not safer; it
// is a second, different answer.
import assert from "node:assert/strict";
import { clinicActivity, expiryDate, isClinicActive, CLINIC_INACTIVE_CODE } from "../src/lib/clinicStatus.ts";

const NOW = new Date("2026-08-24T12:00:00Z");
const past = new Date("2026-08-01T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");

// --- status ------------------------------------------------------------------------------------

assert.equal(isClinicActive({ status: "Active" }, NOW), true);
assert.equal(isClinicActive({ status: "Suspended" }, NOW), false);
assert.equal(isClinicActive({ status: "Expired" }, NOW), false);

// Rules default the field to 'Active' when absent (`clinic.get('status', 'Active')`). A clinic
// document written before the field existed must not be frozen.
assert.equal(isClinicActive({}, NOW), true);
assert.equal(isClinicActive({ status: 123 }, NOW), true, "a non-string status defaults like a missing one");

// The two inactive states are distinguishable, because "you are suspended" and "your subscription
// ended" are different conversations and the second one has an obvious next step.
const suspended = clinicActivity({ status: "Suspended" }, NOW);
assert.equal(suspended.active, false);
assert.equal(suspended.reason, "suspended");
const expiredByStatus = clinicActivity({ status: "Expired" }, NOW);
assert.equal(expiredByStatus.reason, "expired");

// Whatever the reason, the message has to say records are still readable — otherwise a receptionist
// reads "subscription ended" and assumes the patient history is gone.
for (const verdict of [suspended, expiredByStatus]) {
  assert.match(verdict.message, /readable/i);
}

// --- expiresAt ---------------------------------------------------------------------------------

// The whole reason isClinicActive stopped checking status alone: nothing ever flipped status, so a
// free trial with a past expiresAt ran forever.
assert.equal(isClinicActive({ status: "Active", expiresAt: past }, NOW), false);
assert.equal(isClinicActive({ status: "Active", expiresAt: future }, NOW), true);
assert.equal(clinicActivity({ status: "Active", expiresAt: past }, NOW).reason, "expired");

// Firestore Timestamps from either SDK arrive as an object with toDate().
const asTimestamp = (d) => ({ toDate: () => d });
assert.equal(isClinicActive({ expiresAt: asTimestamp(past) }, NOW), false);
assert.equal(isClinicActive({ expiresAt: asTimestamp(future) }, NOW), true);

// Millis, for anything that stored Date.now().
assert.equal(isClinicActive({ expiresAt: past.getTime() }, NOW), false);
assert.equal(isClinicActive({ expiresAt: future.getTime() }, NOW), true);

// Exactly at the boundary the clinic is out. `<=`, not `<`: a subscription that ended at noon has
// ended at noon.
assert.equal(isClinicActive({ expiresAt: new Date(NOW.getTime()) }, NOW), false);
assert.equal(isClinicActive({ expiresAt: new Date(NOW.getTime() + 1) }, NOW), true);

// --- the deliberate mirror of the rules' type guard ----------------------------------------------

// `!(expires is timestamp) || expires > request.time` — a value the rules cannot read as a
// timestamp does not expire the clinic there, so it must not expire it here either. An ISO string
// is the likely case, and this module could parse it. It deliberately does not: being stricter than
// the rules means the browser is allowed a write the route refuses, which is the split-brain this
// module exists to prevent. It is also the safer failure — a trial that overstays is a billing
// conversation, a clinic frozen out by a field type is an outage.
assert.equal(expiryDate("2020-01-01T00:00:00Z"), null);
assert.equal(isClinicActive({ expiresAt: "2020-01-01T00:00:00Z" }, NOW), true);
assert.equal(isClinicActive({ expiresAt: "nonsense" }, NOW), true);
assert.equal(isClinicActive({ expiresAt: true }, NOW), true);
assert.equal(isClinicActive({ expiresAt: {} }, NOW), true);

// Garbage that claims to be a Timestamp must not take the process down with it.
assert.equal(expiryDate({ toDate: () => { throw new Error("boom"); } }), null);
assert.equal(expiryDate({ toDate: () => "not a date" }), null);
assert.equal(expiryDate(new Date("nope")), null);
assert.equal(expiryDate(Number.NaN), null);
assert.equal(expiryDate(null), null);
assert.equal(expiryDate(undefined), null);

// --- a clinic document that could not be read ----------------------------------------------------

// Treated as active on purpose. By the time this is consulted the caller's role at the clinic is
// already established, so a missing document means the read failed, not that the clinic is over.
// Denying every write in response would convert a degraded read into a full outage for a paying
// clinic — and it would do it silently, at the worst possible moment.
assert.equal(isClinicActive(null, NOW), true);
assert.equal(isClinicActive(undefined, NOW), true);

// --- the wire code -------------------------------------------------------------------------------

// The browser has to tell "your subscription ended" apart from "you lack this permission", and it
// cannot do that by matching on prose. Pinned so a rename here breaks the test rather than the toast.
assert.equal(CLINIC_INACTIVE_CODE, "clinic_inactive");

console.log("clinicStatus: all assertions passed");
