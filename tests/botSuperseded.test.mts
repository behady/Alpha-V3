/**
 * Several patient messages in quick succession: an AI answer composed for an older message is
 * dropped unsent when the patient has written again, because the newer turn answers everything.
 *
 * Run: npm run test:bot-superseded
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isNewerPatientLine } from "../src/lib/bot/thread";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

const T0 = 1_700_000_000_000;
const current = { text: "العرض متاح", messageId: "3A111" };

test("a later message from the patient counts", () => {
  assert.equal(isNewerPatientLine({ direction: "in", author: "patient", text: "ومواعيد العياده ؟", at: T0 + 9_000, messageId: "3A222" }, current, T0), true);
  // Without an id on the current message, text still tells them apart.
  assert.equal(isNewerPatientLine({ direction: "in", author: "patient", text: "ومواعيد العياده ؟", at: T0 + 9_000 }, { text: "العرض متاح" }, T0), true);
});

test("a redelivered copy of the same message does not count (same id, or same text)", () => {
  assert.equal(isNewerPatientLine({ direction: "in", author: "patient", text: "العرض متاح", at: T0 + 15_000, messageId: "3A111" }, current, T0), false);
  assert.equal(isNewerPatientLine({ direction: "in", author: "patient", text: "  العرض   متاح ", at: T0 + 15_000 }, { text: "العرض متاح" }, T0), false);
});

test("older lines, the bot's own lines and system lines never count", () => {
  assert.equal(isNewerPatientLine({ direction: "in", author: "patient", text: "x", at: T0 - 1, messageId: "3A000" }, current, T0), false);
  assert.equal(isNewerPatientLine({ direction: "in", author: "patient", text: "x", at: T0, messageId: "3A000" }, current, T0), false, "strictly after");
  assert.equal(isNewerPatientLine({ direction: "out", author: "bot", text: "x", at: T0 + 5_000 }, current, T0), false);
  assert.equal(isNewerPatientLine({ direction: "in", author: "system", text: "📣 جاي من إعلان", at: T0 + 5_000, kind: "ad_referral" }, current, T0), false);
  assert.equal(isNewerPatientLine({ direction: "out", author: "staff", text: "x", at: T0 + 5_000, kind: "from_phone" }, current, T0), false);
});

test("respond.ts drops only a plain AI answer, after the pacing pause and before the send", () => {
  const src = readFileSync(new URL("../src/lib/bot/respond.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const gate = 'if (!args.dryRun && reason === "ai_answer" && (await patientWroteAfter(clinicId, chatId, now, { text, messageId: args.messageId }))) {\n      return skip("superseded");';
  assert.ok(src.includes(gate), "the gate is there, on ai_answer only");
  const i = src.indexOf(gate);
  assert.ok(i > src.indexOf("if (target > elapsed) await new Promise((r) => setTimeout(r, target - elapsed));"), "after the pause");
  assert.ok(i < src.indexOf('claimKey("out", conversationKey(replyTo), body)'), "before the send");
  assert.ok(i < src.indexOf("aiExchange, medicineScreened },"), "before the turn is saved, so the dropped answer never enters the history");
  for (const f of ["src/app/api/webhooks/whatsapp-inbound/route.ts", "src/app/api/webhooks/meta-whatsapp/route.ts"]) {
    const r = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(/messageId: (inboundId|msg\.messageId) \|\| undefined,/.test(r), `${f} passes the message id`);
  }
});
