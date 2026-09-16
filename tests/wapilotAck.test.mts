import assert from "node:assert/strict";
import { ackToStatus, extractDeliveryAck } from "../src/lib/bot/wapilotAck";
import { wapilotMessageId } from "../src/lib/whatsapp";

/**
 * Ticks on the gateway channel.
 *
 * "The API accepted it" and "the patient read it" are different facts, and until these two pieces
 * existed the gateway could only ever report the first — every message sat on one tick forever,
 * so a receptionist could not tell a message that had been read from one that never arrived.
 *
 * Two things had to be true: the send has to remember the gateway's id for the message, and an
 * ack event has to be recognised as a report rather than as a patient writing in. The second is
 * the dangerous one — reading a patient's message as a receipt would consume it, and the patient
 * would never be answered.
 */

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const one = (m: Record<string, unknown>) => [m];

run("WhatsApp's ack ladder maps onto the four states the thread stores", () => {
  assert.equal(ackToStatus(-1, ""), "failed");
  assert.equal(ackToStatus(1, ""), "sent");
  assert.equal(ackToStatus(2, ""), "delivered");
  assert.equal(ackToStatus(3, ""), "read");
  // PLAYED, which a voice note gets instead of READ — the same fact for our purposes.
  assert.equal(ackToStatus(4, ""), "read");
});

run("PENDING is not a report, and neither is a missing ack", () => {
  // 0 means "not sent yet". Reporting it would be noise at best.
  assert.equal(ackToStatus(0, ""), null);
  assert.equal(ackToStatus(undefined, undefined), null);
  assert.equal(ackToStatus(null, null), null);
  // The trap: Number("") is 0, so an empty string must be refused before the number path.
  assert.equal(ackToStatus("", ""), null);
  assert.equal(ackToStatus("abc", ""), null);
});

run("the word is read when the number is missing, and vice versa", () => {
  assert.equal(ackToStatus(undefined, "READ"), "read");
  assert.equal(ackToStatus(undefined, "DEVICE"), "delivered");
  assert.equal(ackToStatus(undefined, "SERVER"), "sent");
  assert.equal(ackToStatus(undefined, "ERROR"), "failed");
  assert.equal(ackToStatus(undefined, "delivered"), "delivered");
  assert.equal(ackToStatus(undefined, "PENDING"), null);
});

run("a WAHA message.ack event is a delivery report", () => {
  const got = extractDeliveryAck(
    { event: "message.ack", session: "default" },
    one({ id: "true_201551552440@c.us_3EB0ABC", from: "201551552440@c.us", fromMe: true, ack: 3, ackName: "READ" })
  );
  assert.equal(got?.status, "read");
  assert.equal(got?.messageId, "true_201551552440@c.us_3EB0ABC");
  assert.equal(got?.chatId, "201551552440@c.us");
});

run("a serialised id object is unwrapped", () => {
  const got = extractDeliveryAck(
    { event: "message.ack" },
    one({ id: { _serialized: "true_201@c.us_X" }, from: "201@c.us", ack: 2 })
  );
  assert.equal(got?.messageId, "true_201@c.us_X");
  assert.equal(got?.status, "delivered");
});

run("a patient's own message is never consumed as a receipt", () => {
  /*
   * This is the failure that would matter. An inbound message can carry an ack of its own, and
   * reading it as a report would return early — the patient's words would reach nobody and the
   * assistant would never reply. Without the event naming itself a report, fromMe has to.
   */
  const inbound = { event: "message", payload: {} };
  const got = extractDeliveryAck(inbound, one({ id: "false_201@c.us_Y", from: "201@c.us", fromMe: false, ack: 2, body: "عايز أحجز" }));
  assert.equal(got, null);
});

run("an id beginning true_ is ours even when fromMe is absent", () => {
  // whatsapp-web.js encodes direction in the id; some builds forget the flag.
  const got = extractDeliveryAck({ event: "message" }, one({ id: "true_201@c.us_Z", from: "201@c.us", ack: 3 }));
  assert.equal(got?.status, "read");
});

run("an ordinary message with no ack is not a report", () => {
  assert.equal(extractDeliveryAck({ event: "message" }, one({ id: "false_201@c.us_A", from: "201@c.us", body: "تمام" })), null);
  assert.equal(extractDeliveryAck({}, []), null);
});

run("a report with nothing to match on is dropped rather than half-applied", () => {
  // No id: updateThreadStatus would have nothing to look up.
  assert.equal(extractDeliveryAck({ event: "message.ack" }, one({ from: "201@c.us", ack: 3 })), null);
  // No chat: the thread is keyed on the address, so there is no document to reach.
  assert.equal(extractDeliveryAck({ event: "message.ack" }, one({ id: "true_x", ack: 3 })), null);
});

run("the gateway's id for a message it accepted is found in the shapes it uses", () => {
  assert.equal(wapilotMessageId({ id: "true_201@c.us_AAA" }), "true_201@c.us_AAA");
  assert.equal(wapilotMessageId({ data: { id: { _serialized: "true_201@c.us_BBB" } } }), "true_201@c.us_BBB");
  assert.equal(wapilotMessageId({ message: { messageId: "MID.CCC" } }), "MID.CCC");
  assert.equal(wapilotMessageId({ result: { key: { id: "DDD" } } }), "DDD");
  assert.equal(wapilotMessageId({ message_id: "EEE" }), "EEE");
});

run("no id is a normal answer, not an error", () => {
  // The message still went. The ticks simply stay where they would have anyway.
  assert.equal(wapilotMessageId({ status: "success" }), undefined);
  assert.equal(wapilotMessageId({}), undefined);
  assert.equal(wapilotMessageId(null), undefined);
  assert.equal(wapilotMessageId("ok"), undefined);
});

run("a self-referencing response cannot hang the id search", () => {
  const loop: Record<string, unknown> = { status: "ok" };
  loop.data = loop;
  assert.equal(wapilotMessageId(loop), undefined);
});

console.log("\nwapilotAck: all cases pass");
