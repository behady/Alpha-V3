// The WhatsApp to-send list: what stays in it, and what has gone off.
//
// Worth testing because a stale entry here is not a harmless leftover. These are messages a human
// reads out of a list and sends by hand, so a reminder that outlived its appointment gets sent to
// a real patient telling them to come in for a day that has already been and gone.
import assert from "node:assert/strict";
import { isStale } from "../src/lib/whatsapp/outbox.ts";

const now = Date.parse("2026-08-14T12:00:00Z");
const hoursAgo = (h) => new Date(now - h * 60 * 60 * 1000).toISOString();

// --- what is still worth sending ---------------------------------------------------------------

assert.equal(isStale({ createdAt: hoursAgo(1) }, now), false, "queued an hour ago");
assert.equal(isStale({ createdAt: hoursAgo(24) }, now), false, "yesterday's is still the reminder");
assert.equal(isStale({ createdAt: hoursAgo(71) }, now), false, "just inside three days");

// --- what has gone off -------------------------------------------------------------------------

assert.equal(isStale({ createdAt: hoursAgo(73) }, now), true, "past three days, the visit has been");
assert.equal(isStale({ createdAt: hoursAgo(24 * 30) }, now), true, "a month in a drawer");

// --- nonsense must not silently bin a message ----------------------------------------------------

// Failing towards "keep it" is deliberate. A message wrongly kept is a message a person can look
// at and decide about; a message wrongly dropped is a patient nobody told anything.
assert.equal(isStale({ createdAt: "" }, now), false, "no timestamp is not evidence of age");
assert.equal(isStale({ createdAt: "not a date" }, now), false, "an unreadable timestamp keeps the message");

// --- the boundary matches the Android side --------------------------------------------------------

// Repository.isWhatsappStale on the phone uses the same three days. If these two ever disagree, one
// side shows a message the other refuses to send, and the list stops making sense to whoever is
// holding the phone.
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
assert.equal(isStale({ createdAt: new Date(now - THREE_DAYS_MS - 1000).toISOString() }, now), true);
assert.equal(isStale({ createdAt: new Date(now - THREE_DAYS_MS + 1000).toISOString() }, now), false);

console.log("whatsappOutbox: all assertions passed");
