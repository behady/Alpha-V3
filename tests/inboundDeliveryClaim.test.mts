// One delivery per message id on the gateway webhook.
//
// The gateway gives a webhook 15 seconds and then sends the same message again. A reply that takes
// longer than that (a slow model turn plus the human pause) was therefore received twice: the
// patient's line was written to the thread twice and, when the copy landed outside the 20-second
// same-words window, answered twice. Run with tsx.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inboundDeliveryKey } from "../src/lib/bot/replyClaims";

// Same id, same key; different id, different key; nothing Firestore refuses in a document id.
assert.equal(inboundDeliveryKey("3ACDA3B1FAAB120578F8"), inboundDeliveryKey("3ACDA3B1FAAB120578F8"));
assert.notEqual(inboundDeliveryKey("3ACDA3B1FAAB120578F8"), inboundDeliveryKey("3ACDA3B1FAAB120578F9"));
assert.match(inboundDeliveryKey("false_201012345678@c.us_3ACD/A3.B1"), /^msg_[A-Za-z0-9_-]+$/);
assert.notEqual(inboundDeliveryKey("false_201012345678@c.us_AAAA"), inboundDeliveryKey("false_201099999999@c.us_AAAA"), "the chat is part of a long id and must survive");
// A very long id keeps its tail, which is the part that differs between messages.
const long = "x".repeat(300);
assert.notEqual(inboundDeliveryKey(long + "A"), inboundDeliveryKey(long + "B"));
assert.ok(inboundDeliveryKey(long + "A").length <= 140);
// No id, no claim: the caller must fall through to the old behaviour rather than block everything.
assert.equal(inboundDeliveryKey(""), "");
assert.equal(inboundDeliveryKey("   "), "");

// The claim has to happen before anything is written or answered, or the copy still lands.
const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/webhooks/whatsapp-inbound/route.ts"), "utf8");
const claimAt = route.indexOf("inboundDeliveryKey(");
assert.ok(claimAt > 0, "the gateway webhook claims the delivery by message id");
const mustFollow = ["interceptStaffInbound({", "recordThreadMessage(clinicId, chatId, {", "applyInboundOptOut({", "respondToPatientMessage({"];
for (const marker of mustFollow) {
  const at = route.indexOf(marker);
  assert.ok(at > 0, `route still calls ${marker}`);
  assert.ok(claimAt < at, `the delivery claim comes before ${marker}`);
}

console.log("inboundDeliveryClaim: ok");
