// Who must never get "you asked and have not booked yet". Run with tsx.
//
// Three real cases from one clinic, all sent the day after the lead was opened:
//   - booked through the assistant on the 5th, attended on the 7th, wrote "باذن الله" that morning
//     (which opened a fresh lead) and was told on the 8th she had not booked. She replied "Stop".
//   - an existing patient seen three days earlier, appointment made at the desk.
//   - an existing patient with a desk appointment ten days earlier.
// The old check looked only for an UPCOMING appointment, and only by the phone string stored on
// the appointment, which desk-made appointments do not carry.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { followupBlockedBy } from "../src/lib/leads/followupGuard";

const today = "2026-11-08";

// Nothing on the calendar: the follow-up may go.
assert.equal(followupBlockedBy([], today), "");
assert.equal(followupBlockedBy([{ date: "2026-08-01", status: "Completed" }], today), "", "a visit months ago does not block");

// Coming up and still standing: already booked.
assert.equal(followupBlockedBy([{ date: "2026-11-08", status: "Confirmed" }], today), "already_booked", "today counts as upcoming");
assert.equal(followupBlockedBy([{ date: "2026-11-12", status: "Scheduled" }], today), "already_booked");
assert.equal(followupBlockedBy([{ date: "2026-11-12", status: "Pending" }], today), "already_booked", "legacy status spelling");
// A cancelled or missed future slot is not a booking — the person is fair game again.
assert.equal(followupBlockedBy([{ date: "2026-11-12", status: "Cancelled" }], today), "");

// The three real cases.
assert.equal(followupBlockedBy([{ date: "2026-11-07", status: "Checking Out" }], today), "recent_visit", "attended yesterday");
assert.equal(followupBlockedBy([{ date: "2026-10-26", status: "Checking Out" }], "2026-10-29"), "recent_visit", "seen three days ago");
assert.equal(followupBlockedBy([{ date: "2026-10-31", status: "Scheduled" }], "2026-11-10"), "recent_visit", "a desk appointment ten days ago, never marked");
// Someone who missed last week's slot booked too: "you have not booked" is still untrue, and the
// no-show message is the one that speaks to them.
assert.equal(followupBlockedBy([{ date: "2026-11-05", status: "No Show" }], today), "recent_visit");

// The window is thirty days, counted on the calendar and across a month boundary.
assert.equal(followupBlockedBy([{ date: "2026-10-09", status: "Completed" }], today), "recent_visit", "30 days back is inside");
assert.equal(followupBlockedBy([{ date: "2026-10-08", status: "Completed" }], today), "", "31 days back is outside");
// Upcoming wins when both are true, because that is the reason that marks the lead booked.
assert.equal(followupBlockedBy([{ date: "2026-11-01", status: "Completed" }, { date: "2026-11-20", status: "Confirmed" }], today), "already_booked");
// Junk rows never throw and never block.
assert.equal(followupBlockedBy([{ date: undefined, status: undefined }, { date: "", status: "Completed" }], today), "");

// The route has to look the person up by patient id as well: 51 of 61 recent appointments at that
// clinic carried no phone at all, so a phone-only search saw none of them.
const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/automation/lead-followup/route.ts"), "utf8");
assert.match(route, /where\("patientId", "==",/, "appointments are also found by patient id");
assert.match(route, /followupBlockedBy\(/, "the route asks the guard");
assert.ok(route.indexOf("followupBlockedBy(") < route.indexOf("deliverWhatsAppMessage({"), "the guard runs before the send");

console.log("leadFollowupGuard: ok");
