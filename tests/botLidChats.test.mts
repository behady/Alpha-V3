/**
 * Hidden-number (`@lid`) senders are answered: the old "cannot be answered" gates are gone from the
 * bot, the reply route and the chat page, and a typed number binds the thread to a patient.
 *
 * Source assertions — respond.ts has no unit harness. Run: npm run test:bot-lid
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const respond = src("src/lib/bot/respond.ts");
const reply = src("src/app/api/whatsapp/reply/route.ts");
const panel = src("src/components/ai/ChatsPanel.tsx");
const conversation = src("src/lib/bot/conversation.ts");

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

test("the bot no longer hands a lid sender off without answering", () => {
  assert.ok(!respond.includes('skip("lid_unidentified")'), "the early return is gone");
  assert.ok(!respond.includes('markHandoff(clinicId, conversationKey(chatId), "lid_unidentified")'));
  assert.ok(respond.includes("ctx.phoneHidden = isLidChat && !phone;"), "the engine and the prompts learn the number is hidden");
  assert.ok(respond.includes("phoneHidden: ctx.phoneHidden === true,"), "both brains get the flag");
});

test("a typed number on a lid thread is kept, and a patient registered from it carries the lid", () => {
  assert.ok(respond.includes('.set({ claimedPhone: claimed, claimedPhoneAt: now }, { merge: true })'));
  assert.ok(respond.includes("conversation.claimedPhone"), "read back on the next turn");
  assert.ok(conversation.includes("claimedPhone?: string;") && conversation.includes("claimedPhone: typeof d.claimedPhone === \"string\""));
  assert.ok(respond.includes('...(isLidChat ? { whatsappLid: chatId, whatsappLidLearnedAt: FieldValue.serverTimestamp(), whatsappLidSource: "self_claimed" } : {}),'));
  // Replies keep going to the lid thread: replyTo is settled before the claimed number is applied.
  assert.ok(respond.indexOf("const replyTo = phone || chatId;") < respond.indexOf("const claimedPhone = claimedNow ||"));
  // Booking still needs a phone: canRegister is unchanged.
  assert.ok(respond.includes("ctx.canRegister = Boolean(profile?.schedule.isConfigured && !patient && phone);"));
});

test("staff can answer a lid chat from the web page on the gateway, not on the official channel", () => {
  assert.ok(reply.includes('/^\\d{6,20}@lid$/i.test(rawTo) ? rawTo.toLowerCase() : normalizeToE164AssumingCountry(rawTo)'));
  assert.ok(panel.includes("((isLid && officialChannel) || (windowClosed && officialChannel) || chat.optedOut === true)"));
  assert.ok(!panel.includes("(isLid || (windowClosed && officialChannel)"), "the blanket lid block is gone");
});
