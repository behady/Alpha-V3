import assert from "node:assert/strict";
import {
  historyAddress,
  historyLine,
  historyLineId,
  isAlreadyInThread,
  readHistoryItems,
} from "../src/lib/bot/threadHistoryPlan";

/**
 * Old chats and phone-typed messages on the QR-linked gateway.
 *
 * The danger is doubling: the clinic's own sends through the system are already on the thread,
 * and patient messages received live are too. A copy of old chats that re-filed them would show
 * every message twice, which is worse than the gap it was meant to close.
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

const T = 1793000000; // seconds

run("reads only usable items; voice notes and photos count, empty words do not", () => {
  const items = readHistoryItems([
    { id: "A", from: "201012345678@c.us", fromMe: false, body: "hi", type: "chat", timestamp: T },
    { id: "B", from: "201012345678@c.us", fromMe: true, body: "", type: "audio", timestamp: T + 1 },
    { id: "C", from: "201012345678@c.us", body: "", type: "chat", timestamp: T },
    { id: "", from: "201012345678@c.us", body: "no id", timestamp: T },
    { id: "D", from: "", body: "no chat", timestamp: T },
    { id: "E", from: "201012345678@c.us", body: "no time" },
    "junk",
  ]);
  assert.deepEqual(
    items.map((i) => i.id),
    ["A", "B"]
  );
  assert.equal(items[1].fromMe, true);
  assert.deepEqual(readHistoryItems(null), []);
});

run("thread address matches the live path: +E.164 for phones, lid kept as-is", () => {
  assert.equal(historyAddress("201012345678@c.us"), "+201012345678");
  assert.equal(historyAddress("172357054414966@lid"), "172357054414966@lid");
});

run("the same message filed twice is one document", () => {
  assert.equal(historyLineId("3EB0ABC/12+x"), "wa_3EB0ABC12x");
  assert.equal(historyLineId("3EB0ABC/12+x"), historyLineId("3EB0ABC/12+x"));
});

run("a system send recorded under its gateway id is recognised", () => {
  const item = { id: "3EB0X", from: "201012345678@c.us", fromMe: true, body: "Your booking is confirmed", type: "chat", timestamp: T };
  assert.equal(isAlreadyInThread(item, [{ waMessageId: "3EB0X", direction: "out", text: "anything", at: 0 }]), true);
});

run("a patient message received live (no id) is recognised by words and time", () => {
  const item = { id: "IN1", from: "201012345678@c.us", fromMe: false, body: "عايز احجز  بكرة", type: "chat", timestamp: T };
  assert.equal(isAlreadyInThread(item, [{ direction: "in", text: "عايز احجز بكرة", at: T * 1000 + 2000 }]), true);
  // Same words a day later is a different message.
  assert.equal(isAlreadyInThread(item, [{ direction: "in", text: "عايز احجز بكرة", at: T * 1000 + 86400000 }]), false);
  // Same words in the other direction is a different message.
  assert.equal(isAlreadyInThread(item, [{ direction: "out", text: "عايز احجز بكرة", at: T * 1000 }]), false);
});

run("a system send recorded with a footer the phone copy lacks is still one message", () => {
  const item = { id: "S1", from: "201012345678@c.us", fromMe: true, body: "تم تأكيد حجزك يوم الخميس الساعة 5", type: "chat", timestamp: T };
  const recorded = { direction: "out", text: "تم تأكيد حجزك يوم الخميس الساعة 5\n\nللإلغاء ارسل 0", at: T * 1000 - 1000 };
  assert.equal(isAlreadyInThread(item, [recorded]), true);
  // A short "ok" is not matched on a shared opening — too many messages start the same way.
  const ok = { id: "S2", from: "201012345678@c.us", fromMe: true, body: "تمام", type: "chat", timestamp: T };
  assert.equal(isAlreadyInThread(ok, [{ direction: "out", text: "تمام يا فندم نستناك", at: T * 1000 }]), false);
});

run("a bare voice note matches its [audio] line", () => {
  const item = { id: "V1", from: "201012345678@c.us", fromMe: false, body: "", type: "audio", timestamp: T };
  assert.equal(isAlreadyInThread(item, [{ direction: "in", text: "[audio]", at: T * 1000 + 500 }]), true);
  assert.equal(isAlreadyInThread(item, [{ direction: "in", text: "[image]", at: T * 1000 + 500 }]), false);
});

run("lines: phone-typed messages are a person's, old patient messages are marked history", () => {
  const out = historyLine({ id: "P1", from: "201012345678@c.us", fromMe: true, body: "اهلا", type: "chat", timestamp: T });
  assert.equal(out.direction, "out");
  assert.equal(out.author, "staff");
  assert.equal(out.kind, "from_phone");
  assert.equal(out.at, T * 1000);
  assert.equal(out.messageId, "P1");
  assert.equal("media" in out, false);
  const voice = historyLine({ id: "P2", from: "201012345678@c.us", fromMe: false, body: "", type: "audio", timestamp: T });
  assert.equal(voice.author, "patient");
  assert.equal(voice.kind, "history");
  assert.equal(voice.text, "[audio]");
  assert.equal(voice.media, "audio");
});
