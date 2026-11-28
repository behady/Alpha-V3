/**
 * Username-only senders on the official (Meta) line.
 *
 * Since WhatsApp usernames, Meta can deliver a message with NO phone number: `from` is omitted and
 * the sender is named only by a business-scoped user id (`from_user_id`, e.g. "EG.1349…"). The
 * webhook demanded `from`, so those people never reached the Chats page at all.
 *
 * Pure checks on lib/waUserId plus source assertions for the wiring. Run: npm run test:wa-username
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isHiddenSender, isWaUserId, metaInboundSender, metaRecipient, waUserIdKey } from "../src/lib/waUserId";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const BSUID = "EG.13491208655302741918";

test("a business-scoped user id is recognised, a phone and a lid are not", () => {
  assert.equal(isWaUserId(BSUID), true);
  assert.equal(isWaUserId("US.ENT.11815799212886844830"), true);
  assert.equal(isWaUserId("201551552440"), false);
  assert.equal(isWaUserId("+201551552440"), false);
  assert.equal(isWaUserId("172357054414966@lid"), false);
  assert.equal(isWaUserId(""), false);
  assert.equal(isHiddenSender(BSUID), true);
  assert.equal(isHiddenSender("172357054414966@lid"), true);
  assert.equal(isHiddenSender("201551552440"), false);
});

test("its chat key keeps every character and cannot collide with a phone's", () => {
  assert.equal(waUserIdKey(BSUID), "uid_EG_13491208655302741918");
  assert.equal(waUserIdKey("201551552440"), "");
});

test("Meta's username-only payload yields the user id as the address", () => {
  // The documented example: no `from`, no `wa_id`.
  const contacts = [{ profile: { name: "Sheena Nelson", username: "realsheenanelson" }, user_id: BSUID }];
  const s = metaInboundSender({ from_user_id: BSUID, id: "wamid.X", type: "text", text: { body: "hi" } }, contacts);
  assert.deepEqual(s, { address: BSUID, phone: "", userId: BSUID, username: "realsheenanelson", name: "Sheena Nelson" });
});

test("a sender with a visible phone still arrives under the phone, with the user id alongside", () => {
  const contacts = [{ profile: { name: "Mona" }, wa_id: "201551552440", user_id: BSUID }];
  const s = metaInboundSender({ from: "201551552440", from_user_id: BSUID }, contacts);
  assert.equal(s.address, "201551552440");
  assert.equal(s.phone, "201551552440");
  assert.equal(s.userId, BSUID);
  assert.equal(s.username, "");
});

test("an old payload with neither field has no address", () => {
  assert.equal(metaInboundSender({}, []).address, "");
});

test("a send goes to `recipient` for a user id and `to` for a phone", () => {
  assert.deepEqual(metaRecipient(BSUID), { recipient: BSUID });
  assert.deepEqual(metaRecipient("+20 155 155 2440"), { to: "201551552440" });
  assert.equal(metaRecipient(""), null);
});

test("the webhook no longer demands a phone, and files the hidden sender's name", () => {
  const route = src("src/app/api/webhooks/meta-whatsapp/route.ts");
  assert.ok(route.includes("metaInboundSender(m, value?.contacts)"));
  assert.ok(!route.includes('const from = String(m?.from || "").trim();'), "the phone-only read is gone");
  assert.ok(route.includes("st?.recipient_id || st?.recipient_user_id"), "ticks move on a user-id send too");
});

test("every Meta send addresses through metaRecipient", () => {
  const meta = src("src/lib/metaWhatsapp.ts");
  assert.ok(!meta.includes("to: digits"), "no send strips a user id down to its digits");
  assert.equal(meta.split("metaRecipient(args.to)").length - 1, 4, "text, media, interactive, template");
});

test("the key, the bot, the reply route and the opt-out check all know a hidden sender", () => {
  assert.ok(src("src/lib/bot/conversation.ts").includes("waUserIdKey(raw)"));
  assert.ok(src("src/lib/bot/respond.ts").includes("const isLidChat = isHiddenSender(chatId);"));
  assert.ok(src("src/app/api/whatsapp/reply/route.ts").includes("isWaUserId(rawTo)"));
  assert.ok(src("src/lib/messagingConsent.ts").includes("isHiddenSender(raw)"));
  assert.ok(src("src/lib/bot/thread.ts").includes('!key.startsWith("uid_")'), "a user id's digits are never matched against patient phones");
});

console.log("waUsernameSenders: all passed");
