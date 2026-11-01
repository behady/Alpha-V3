/**
 * The switch at the live reply path: which brain answers a turn, and what happens when Pro fails.
 *
 * The standard brain never even starts a Pro turn. A Pro turn that is unavailable, or that throws,
 * is answered by the standard brain exactly as today — the patient never sees the failure.
 *
 * Run: npm run test:pro-wiring
 */
import assert from "node:assert/strict";
import { pickReply } from "../src/lib/botPro/brain";
import type { AiReplyResult } from "../src/lib/bot/aiReply";
import type { ProReplyResult } from "../src/lib/botPro/answerWithPro";

async function test(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`ok - ${name}`);
}

const STANDARD: AiReplyResult = { kind: "answer", text: "standard reply" };
const SLOTS = [{ key: "2026-11-02|17:00|", label: "الإثنين 2/11 الساعة 5:00 م" }];

function counted<T>(value: () => Promise<T>) {
  const fn = async () => {
    fn.calls++;
    return value();
  };
  fn.calls = 0;
  return fn;
}

await test("standard brain never starts a Pro turn", async () => {
  const pro = counted<ProReplyResult>(async () => ({ kind: "answer", text: "pro reply" }));
  const standard = counted<AiReplyResult>(async () => STANDARD);
  const out = await pickReply("standard", pro, standard);
  assert.equal(pro.calls, 0);
  assert.equal(standard.calls, 1);
  assert.equal(out.brainUsed, "standard");
  assert.deepEqual(out.ai, STANDARD);
  assert.equal(out.slotsShown, undefined);
});

await test("a Pro answer is returned with the slots it showed", async () => {
  const pro = counted<ProReplyResult>(async () => ({ kind: "answer", text: "pro reply", bookSlot: SLOTS[0].key, slotsShown: SLOTS }));
  const standard = counted<AiReplyResult>(async () => STANDARD);
  const out = await pickReply("pro", pro, standard);
  assert.equal(pro.calls, 1);
  assert.equal(standard.calls, 0);
  assert.equal(out.brainUsed, "pro");
  assert.equal(out.ai.kind, "answer");
  assert.equal(out.ai.kind === "answer" ? out.ai.text : "", "pro reply");
  assert.equal(out.ai.kind === "answer" ? out.ai.bookSlot : "", SLOTS[0].key);
  assert.deepEqual(out.slotsShown, SLOTS);
  // The slots ride beside the answer, not inside it: downstream code sees a plain AiReplyResult.
  assert.equal("slotsShown" in out.ai, false);
});

await test("a Pro hand-off is the Pro answer (no fall back)", async () => {
  const pro = counted<ProReplyResult>(async () => ({ kind: "handoff", topic: "complaint", text: "حد من الاستقبال هيرد" } as ProReplyResult));
  const standard = counted<AiReplyResult>(async () => STANDARD);
  const out = await pickReply("pro", pro, standard);
  assert.equal(standard.calls, 0);
  assert.equal(out.brainUsed, "pro");
  assert.equal(out.ai.kind, "handoff");
});

await test("Pro unavailable falls back to the standard brain", async () => {
  const pro = counted<ProReplyResult>(async () => ({ kind: "unavailable", reason: "ai_timeout" }));
  const standard = counted<AiReplyResult>(async () => STANDARD);
  const out = await pickReply("pro", pro, standard);
  assert.equal(pro.calls, 1);
  assert.equal(standard.calls, 1);
  assert.equal(out.brainUsed, "standard");
  assert.deepEqual(out.ai, STANDARD);
  assert.equal(out.slotsShown, undefined);
});

await test("Pro throwing falls back to the standard brain", async () => {
  const pro = counted<ProReplyResult>(async () => {
    throw new Error("boom");
  });
  const standard = counted<AiReplyResult>(async () => STANDARD);
  const out = await pickReply("pro", pro, standard);
  assert.equal(standard.calls, 1);
  assert.equal(out.brainUsed, "standard");
  assert.deepEqual(out.ai, STANDARD);
});

await test("Pro with no slots shown leaves slotsShown empty-handed", async () => {
  const pro = counted<ProReplyResult>(async () => ({ kind: "answer", text: "pro reply", slotsShown: [] }));
  const out = await pickReply("pro", pro, async () => STANDARD);
  assert.equal(out.brainUsed, "pro");
  assert.deepEqual(out.slotsShown, []);
});
