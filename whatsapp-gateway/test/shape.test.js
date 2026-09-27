import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ackFromStatus,
  buildAckEvent,
  buildMessageEvent,
  isSilentMessage,
  messageMedia,
  messageText,
  randomGap,
  toChatId,
  toWaJid,
} from "../src/shape.js";

test("chat ids: every spelling the web app uses reaches the same jid", () => {
  assert.equal(toWaJid("201012345678"), "201012345678@s.whatsapp.net");
  assert.equal(toWaJid("201012345678@c.us"), "201012345678@s.whatsapp.net");
  assert.equal(toWaJid("+20 101 234 5678"), "201012345678@s.whatsapp.net");
  assert.equal(toWaJid("172357054414966@lid"), "172357054414966@lid");
  assert.equal(toWaJid("1234-5678@g.us"), "1234-5678@g.us");
  assert.equal(toWaJid(""), "");
  assert.equal(toWaJid("abc"), "");
});

test("jids: the web app gets @c.us back, device suffix dropped, lids untouched", () => {
  assert.equal(toChatId("201012345678@s.whatsapp.net"), "201012345678@c.us");
  assert.equal(toChatId("201012345678:12@s.whatsapp.net"), "201012345678@c.us");
  assert.equal(toChatId("172357054414966@lid"), "172357054414966@lid");
});

test("text: found wherever WhatsApp put it, including inside disappearing-message envelopes", () => {
  assert.equal(messageText({ conversation: "hi" }), "hi");
  assert.equal(messageText({ extendedTextMessage: { text: "hello" } }), "hello");
  assert.equal(messageText({ imageMessage: { caption: "my tooth" } }), "my tooth");
  assert.equal(messageText({ ephemeralMessage: { message: { conversation: "ok" } } }), "ok");
  assert.equal(messageText({ audioMessage: { ptt: true } }), "");
});

test("media: a voice note is ptt, a photo is image, words are nothing", () => {
  assert.deepEqual(messageMedia({ audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus" } }), {
    type: "ptt",
    mimetype: "audio/ogg; codecs=opus",
    field: "audioMessage",
  });
  assert.equal(messageMedia({ imageMessage: {} })?.type, "image");
  assert.equal(messageMedia({ conversation: "x" }), null);
});

test("silent messages are skipped: reactions, protocol, empty", () => {
  assert.equal(isSilentMessage({ reactionMessage: {} }), true);
  assert.equal(isSilentMessage({ protocolMessage: {} }), true);
  assert.equal(isSilentMessage(null), true);
  assert.equal(isSilentMessage({ conversation: "hi", messageContextInfo: {} }), false);
});

test("acks: Baileys' ladder lands on the numbers the web app's parser reads", () => {
  assert.deepEqual(ackFromStatus(2), { ack: 1, ackName: "SERVER" });
  assert.deepEqual(ackFromStatus(3), { ack: 2, ackName: "DEVICE" });
  assert.deepEqual(ackFromStatus(4), { ack: 3, ackName: "READ" });
  assert.deepEqual(ackFromStatus(5), { ack: 4, ackName: "PLAYED" });
  assert.deepEqual(ackFromStatus(0), { ack: -1, ackName: "ERROR" });
  assert.equal(ackFromStatus(1), null);
  assert.equal(ackFromStatus("nope"), null);
});

test("message event: WAHA layout, phone as `from` when WhatsApp paired the lid", () => {
  const ev = buildMessageEvent({
    instanceId: "clinic_a",
    key: { id: "ABC123", remoteJid: "172357054414966@lid", fromMe: false },
    timestamp: 1700000000,
    text: "عايز اعمل حجز",
    media: null,
    mediaUrl: null,
    pushName: "Ahmed",
    phoneJid: "201012345678@s.whatsapp.net",
  });
  assert.equal(ev.event, "message");
  assert.equal(ev.payload.from, "201012345678@c.us");
  assert.equal(ev.payload._data.lid, "172357054414966@lid");
  assert.equal(ev.payload.body, "عايز اعمل حجز");
  assert.equal(ev.payload.type, "chat");
  assert.equal(ev.payload.fromMe, false);
});

test("message event: a voice note carries its mimetype and a fetchable url", () => {
  const ev = buildMessageEvent({
    instanceId: "clinic_a",
    key: { id: "V1", remoteJid: "201012345678@s.whatsapp.net", fromMe: false },
    timestamp: 1,
    text: "",
    media: { type: "ptt", mimetype: "audio/ogg" },
    mediaUrl: "https://wa.example/api/v2/clinic_a/media/V1",
  });
  assert.equal(ev.payload.type, "ptt");
  assert.equal(ev.payload.mimetype, "audio/ogg");
  assert.equal(ev.payload.media.url, "https://wa.example/api/v2/clinic_a/media/V1");
  assert.equal(ev.payload.from, "201012345678@c.us");
});

test("ack event: same id the send returned, chat in @c.us form, fromMe", () => {
  const ev = buildAckEvent({ instanceId: "x", key: { id: "ABC", remoteJid: "2010@s.whatsapp.net", fromMe: true }, status: 4 });
  assert.deepEqual(ev.payload, { id: "ABC", from: "2010@c.us", fromMe: true, ack: 3, ackName: "READ" });
  assert.equal(buildAckEvent({ instanceId: "x", key: { id: "ABC", remoteJid: "2010@s.whatsapp.net" }, status: 1 }), null);
});

test("random gap stays inside its bounds", () => {
  for (let i = 0; i < 200; i++) {
    const g = randomGap(1500, 4000);
    assert.ok(g >= 1500 && g <= 4000);
  }
  assert.equal(randomGap(0, 0), 0);
});
