/**
 * Several patient messages in quick succession: an AI answer composed for an older message is
 * dropped unsent when the patient has written again, because the newer turn answers everything.
 *
 * Run: npm run test:bot-superseded
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isNewerPatientLine, newerLinesOf } from "../src/lib/bot/thread";
import { lineTakesOver } from "../src/lib/bot/supersede";
import type { BotContext, BotState } from "../src/lib/bot/engine";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

async function testAsync(name: string, fn: () => Promise<void>) {
  await fn();
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
  assert.equal(isNewerPatientLine({ direction: "in", author: "patient", text: "x", at: T0, messageId: "3A000" }, current, T0), false, "same ms: the larger id wins");
  assert.equal(isNewerPatientLine({ direction: "out", author: "bot", text: "x", at: T0 + 5_000 }, current, T0), false);
  assert.equal(isNewerPatientLine({ direction: "in", author: "system", text: "📣 جاي من إعلان", at: T0 + 5_000, kind: "ad_referral" }, current, T0), false);
  assert.equal(isNewerPatientLine({ direction: "out", author: "staff", text: "x", at: T0 + 5_000, kind: "from_phone" }, current, T0), false);
});

// ------------------------------------------------------------- 14/11/2026, the real timestamps --
const line = (text: string, at: number, messageId?: string, extra: Record<string, unknown> = {}) => ({
  direction: "in",
  author: "patient",
  text,
  at,
  ...(messageId ? { messageId } : {}),
  ...extra,
});

test("two messages 8 ms apart (chat …801531): exactly one turn gives way, measured from the lines", () => {
  const A = line("عياده اسنان", 1794643050261, "wamid.MEFFQ0UzQkIA");
  const B = line("السلام عليكم", 1794643050269, "wamid.ODBBMUUyRjkA");
  const AD = { direction: "in", author: "system", kind: "ad_referral", text: "📣 جاي من إعلان", at: 1794643050606 };
  assert.deepEqual(newerLinesOf([A, B, AD], { text: A.text, messageId: A.messageId }, A.at), [B], "A's turn sees B");
  assert.deepEqual(newerLinesOf([A, B, AD], { text: B.text, messageId: B.messageId }, B.at), [], "B's turn answers both");
  // What happened: measured from each turn's start (…370 and …475), neither saw the other.
  assert.equal(
    newerLinesOf([A, B], { text: A.text, messageId: A.messageId }, 1794643050370).length +
      newerLinesOf([A, B], { text: B.text, messageId: B.messageId }, 1794643050475).length,
    0
  );
  // The same millisecond: the ids decide, and exactly one of the two gives way.
  const A2 = { ...A, at: B.at };
  const seen =
    newerLinesOf([A2, B], { text: A2.text, messageId: A2.messageId }, A2.at).length +
    newerLinesOf([A2, B], { text: B.text, messageId: B.messageId }, B.at).length;
  assert.equal(seen, 1);
});

test("price, then 'السعر كام' (chat …054233): the older turn sees the newer question", () => {
  const Q1 = line("بتعملوا فينيس", 1794637517366, "wamid.MUIwQjBCMUEA");
  const Q2 = line("السعر كام", 1794637528927, "wamid.REZCNzQzNkUA");
  assert.deepEqual(newerLinesOf([Q1, Q2], { text: Q1.text, messageId: Q1.messageId }, Q1.at), [Q2]);
  assert.deepEqual(newerLinesOf([Q1, Q2], { text: Q2.text, messageId: Q2.messageId }, Q2.at), []);
});

test("lines that will never get an answer of their own never count", () => {
  const cur = { text: "بكام التقويم؟", messageId: "m1" };
  const own = line(cur.text, T0, "m1");
  // Filed from the phone's own history on the QR line: nobody answers it.
  assert.deepEqual(newerLinesOf([own, line("فيه حد؟", T0 + 2_000, "h1", { kind: "history" })], cur, T0), []);
  // The same words in another case: the inbound claim refuses the copy.
  assert.deepEqual(newerLinesOf([line("ok", T0, "m1"), line("OK", T0 + 2_000, "m2")], { text: "ok", messageId: "m1" }, T0), []);
  // "بكام" again 9 s after an earlier "بكام": refused as a duplicate, so it silences nothing.
  const lines = [line("بكام", T0 - 3_000, "m0"), line("؟", T0, "x2"), line("بكام", T0 + 6_000, "m3")];
  assert.deepEqual(newerLinesOf(lines, { text: "؟", messageId: "x2" }, T0), []);
  // Outside the 20 s window it is a message again.
  const later = [line("بكام", T0 - 30_000, "m0"), line("؟", T0, "x2"), line("بكام", T0 + 6_000, "m3")];
  assert.equal(newerLinesOf(later, { text: "؟", messageId: "x2" }, T0).length, 1);
});

test("a voice note is its words; two untranscribed voice notes are not one repeated message", () => {
  const cur = { text: "طب والزراعة بكام", messageId: "v1" };
  const copy = line("[audio]", T0 + 1_000, "v9", { media: "audio", transcript: "طب والزراعة بكام" });
  assert.equal(isNewerPatientLine(copy, cur, T0), false, "the same words, transcribed");
  const other = line("[audio]", T0 + 1_000, "v9", { media: "audio", transcript: "وبتاخدوا تأمين؟" });
  assert.equal(isNewerPatientLine(other, cur, T0), true);
  const typed = { text: "ممكن ميعاد؟", messageId: "t1" };
  const vn1 = line("[audio]", T0 - 5_000, "v1", { media: "audio" });
  const vn2 = line("[audio]", T0 + 2_000, "v2", { media: "audio" });
  assert.deepEqual(newerLinesOf([vn1, line(typed.text, T0, "t1"), vn2], typed, T0), [vn2]);
  // A voice note's own turn measures from its start (no receivedAt: the words came late). A line
  // typed while it was being transcribed was answered without it, so it must not silence it.
  const vn = line("[audio]", T0, "v5", { media: "audio", transcript: "عندي وجع في ضرسي" });
  const during = line("؟", T0 + 1_000, "t5");
  const after = line("؟؟", T0 + 4_000, "t6");
  assert.deepEqual(newerLinesOf([vn, during, after], { text: "عندي وجع في ضرسي", messageId: "v5" }, T0 + 3_000), [after]);
});

// --------------------------------------------------------------- who may take an answer's place --
const ctx: BotContext = {
  clinicName: "عيادة",
  aiFirst: true,
  aiAvailable: true,
  clinicalMode: "handoff",
  canOfferBooking: true,
  scripts: [{ id: "s1", triggers: ["العنوان"], reply: "عنواننا ٣٠٠أ" }],
};
let lookups = 0;
const takes = (l: Record<string, unknown>, o: { soon?: boolean; state?: BotState; ctx?: Partial<BotContext> } = {}) =>
  lineTakesOver(l, {
    state: o.state ?? "awaiting_choice",
    ctx: { ...ctx, ...(o.ctx ?? {}) },
    today: "2026-11-14",
    soonAppointment: async () => {
      lookups += 1;
      return Boolean(o.soon);
    },
  });

await testAsync("a newer message takes over only when its own turn goes to the model (or it is a stop)", async () => {
  for (const [what, l, o] of [
    ["a greeting", line("السلام عليكم", T0), {}],
    ["a price question", line("السعر كام", T0), {}],
    ["تمام with no appointment to confirm", line("تمام", T0), { soon: false }],
    ["a voice note still being transcribed", line("[audio]", T0, "v", { media: "audio" }), {}],
    ["a captioned photo", line("ده سني", T0, "p", { media: "image" }), {}],
    ["a stop request", line("stop", T0), {}],
    ["a digit with no menu on the screen", line("2", T0), {}],
    ["English", line("how much is cleaning", T0), {}],
  ] as const) {
    assert.equal(await takes(l, o), true, what);
  }
});

await testAsync("a fixed line, or no answer at all, keeps the older answer", async () => {
  for (const [what, l, o] of [
    ["thanks", line("شكرا", T0), {}],
    ["تمام confirming tomorrow's appointment", line("تمام", T0), { soon: true }],
    ["the clinic's own script", line("العنوان", T0), {}],
    ["an album photo", line("[image]", T0, "p", { media: "image" }), {}],
    ["a sticker", line("[sticker]", T0, "s", { media: "sticker" }), {}],
    ["a voice note that said thanks", line("[audio]", T0, "v", { media: "audio", transcript: "شكرا" }), {}],
    ["a name at the name step", line("محمد احمد", T0), { state: "booking_name" as BotState }],
    ["a day word at the day list", line("بكره", T0), { state: "booking_day" as BotState, ctx: { optionCount: 3 } }],
    ["a digit with the menu on the screen", line("2", T0), { ctx: { menuShown: true } }],
  ] as const) {
    assert.equal(await takes(l, o), false, what);
  }
});

await testAsync("the appointment is looked up only for an acknowledgement", async () => {
  lookups = 0;
  await takes(line("السعر كام", T0));
  await takes(line("شكرا", T0));
  assert.equal(lookups, 0);
  await takes(line("تمام", T0), { soon: true });
  assert.equal(lookups, 1);
});

// ------------------------------------------------------------------------------------ the wiring --
test("respond.ts drops only a sales-mode AI answer: before the first bubble, and before each later one", () => {
  const src = readFileSync(new URL("../src/lib/bot/respond.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(src.includes('const supersedable = !args.dryRun && reason === "ai_answer" && settings.aiFirst && !photoToModel;'), "never a photo reading, assisted mode or the playground");
  assert.ok(src.includes("const ownLineAt = args.receivedAt ?? now;"), "measured from the message's own line");
  assert.ok(src.includes("newerPatientLines(clinicId, chatId, ownLineAt, { text, messageId: args.messageId })"));
  assert.ok(src.includes("lineTakesOver(line, { state: engineState, ctx, today: clinicNow().dateKey, soonAppointment })"), "the engine decides who may take over");
  const gate = 'if (supersedable && (await wroteAgain())) {\n      return skip("superseded");';
  assert.ok(src.includes(gate), "the gate is there");
  const i = src.indexOf(gate);
  assert.ok(i > src.indexOf("if (target > elapsed) await new Promise((r) => setTimeout(r, target - elapsed));"), "after the pause");
  assert.ok(i < src.indexOf('claimKey("out", conversationKey(replyTo), body)'), "before the send");
  assert.ok(i < src.indexOf("aiExchange, medicineScreened },"), "before the turn is saved, so the dropped answer never enters the history");

  // The tail: checked again after each typing pause, before the bubble goes.
  const loop = src.indexOf("for (const bubble of extraBubbles.length");
  const tail = src.indexOf("if (supersedable && (await wroteAgain())) {\n        tailDropped = true;\n        break;\n      }", loop);
  assert.ok(loop > 0 && tail > loop, "inside the bubble loop");
  assert.ok(tail < src.indexOf("await sendPatientWhatsAppRich(clinicId, replyTo, bubble, undefined);", loop), "before the bubble is sent");
  assert.ok(src.includes("if (attach && !args.dryRun && !tailDropped) {"), "no attachment after a dropped tail");

  // The first bubble is on the thread the moment it went out, so the newer turn's model sees it.
  assert.equal(src.split("}, firstSentAt)").length - 1, 1, "written once");
  const write = src.indexOf("}, firstSentAt)");
  assert.ok(write > src.indexOf("firstSent = true;") && write < loop, "after the first send, before the tail");

  // A dropped tail does not save the older turn over the newer one, but its bubble is counted.
  const dropped = src.indexOf("if (tailDropped) {");
  assert.ok(dropped > 0 && dropped < src.lastIndexOf("await saveConversation("), "before the final save");
  assert.ok(src.slice(dropped, src.lastIndexOf("await saveConversation(")).includes("recentReplies: FieldValue.arrayUnion(now), repliesInWindow: FieldValue.increment(1)"));

  // The newer turn's model hears earlier voice notes.
  assert.ok(src.includes('text: String(m.transcript || m.text || "")'));

  for (const f of ["src/app/api/webhooks/whatsapp-inbound/route.ts", "src/app/api/webhooks/meta-whatsapp/route.ts"]) {
    const r = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(/messageId: (inboundId|msg\.messageId) \|\| undefined,/.test(r), `${f} passes the message id`);
  }
  // The line's own time, only when the line held the words from the start. A voice note's words
  // land just before its turn starts, so it keeps measuring from the turn's start: a message that
  // came during the transcription was answered by a model that never heard the voice note.
  const meta = readFileSync(new URL("../src/app/api/webhooks/meta-whatsapp/route.ts", import.meta.url), "utf8");
  assert.ok(meta.includes("await rememberInbound(clinicId, msg, receivedAt);"), "the Meta line is written at that time");
  assert.ok(meta.includes("receivedAt: lineId && msg.text ? receivedAt : undefined,"), "Meta passes it for words only");
  const qr = readFileSync(new URL("../src/app/api/webhooks/whatsapp-inbound/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(qr.includes("}, receivedAt).catch((e) => {"), "the QR line is written at that time");
  assert.ok(qr.includes("receivedAt: lineId && reply.text ? receivedAt : undefined,"), "the QR line passes it for words only");
});
