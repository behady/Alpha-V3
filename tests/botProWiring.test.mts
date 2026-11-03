/**
 * The switch at the live reply path: which brain answers a turn, and what happens when Pro fails.
 *
 * The standard brain never even starts a Pro turn. A Pro turn that is unavailable, or that throws,
 * is answered by the standard brain exactly as today — the patient never sees the failure.
 *
 * Run: npm run test:pro-wiring
 */
import assert from "node:assert/strict";
import { dryRunBrainTag, pickReply } from "../src/lib/botPro/brain";
import type { AiReplyResult } from "../src/lib/bot/aiReply";
import type { ProReplyResult } from "../src/lib/botPro/answerWithPro";
import { loadClinicLayerWith, type LayerReader } from "../src/lib/botPro/proContext";
import { readFileSync } from "node:fs";

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

await test("the test chat is told which brain answered; a live reply is not", async () => {
  assert.deepEqual(dryRunBrainTag(true, "pro"), { brain: "pro" });
  assert.deepEqual(dryRunBrainTag(true, "standard"), { brain: "standard" });
  // The AI branch never ran: nothing, not an undefined field.
  assert.deepEqual(dryRunBrainTag(true, undefined), {});
  assert.equal("brain" in dryRunBrainTag(true, undefined), false);
  // A live turn carries nothing new.
  assert.deepEqual(dryRunBrainTag(false, "pro"), {});
  assert.deepEqual(dryRunBrainTag(undefined, "pro"), {});
});

const source = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

await test("the draft layer reaches Pro only in a dry run, and the route only forwards it when Pro is tried", async () => {
  const respond = source("src/lib/bot/respond.ts");
  assert.ok(respond.includes("args.dryRun && args.proLayer"), "respond.ts gates proLayer on dryRun");
  const route = source("src/app/api/admin/bot-playground/route.ts");
  assert.match(route, /tryPro\s*&&\s*body\.proLayer\s*===\s*"draft"/);
  assert.match(route, /proLayer:\s*"draft"\s*as const/);
  const ui = source("src/components/settings/BotPlayground.tsx");
  assert.match(ui, /proLayer:\s*"draft"/);
  assert.match(ui, /proUnlocked\s*&&\s*tryPro\s*&&\s*useDraft/);
  assert.ok(ui.includes("Use the draft layer") && ui.includes("جرّب القواعد الجديدة (المسودة)"));
  // Production code never asks for the draft.
  const answer = source("src/lib/botPro/proContext.ts");
  assert.match(answer, /args\.proLayer === "draft" \? "draft" : "live"/);
});

const layerDoc = { rules: ["اقفل بعرض كشف"], neverSay: ["ارخص عيادة"] };

function reader(docs: { state?: unknown; versions?: Record<string, unknown> }, spy: { asked: string[] } = { asked: [] }): LayerReader {
  return {
    async state() {
      spy.asked.push("state");
      return docs.state;
    },
    async version(id) {
      spy.asked.push(`version:${id}`);
      return docs.versions?.[id];
    },
  };
}

await test("loadClinicLayer: live reads the live version's layer, draft reads the state's draft, both sanitised", async () => {
  const spy = { asked: [] as string[] };
  const docs = { state: { liveVersion: "v1", draft: { rules: ["مسودة"] } }, versions: { v1: { layer: layerDoc } } };
  const live = await loadClinicLayerWith(reader(docs, spy), "live");
  assert.deepEqual(live?.rules, ["اقفل بعرض كشف"]);
  assert.deepEqual(live?.neverSay, ["ارخص عيادة"]);
  assert.deepEqual(spy.asked, ["state", "version:v1"]);
  const draft = await loadClinicLayerWith(reader(docs), "draft");
  assert.deepEqual(draft?.rules, ["مسودة"]);
  // A price sneaked into a hand-edited doc is dropped on the way in.
  const dirty = await loadClinicLayerWith(reader({ state: { liveVersion: "v1" }, versions: { v1: { layer: { rules: ["الكشف بـ 300 جنيه", "كن ودودا"] } } } }), "live");
  assert.deepEqual(dirty?.rules, ["كن ودودا"]);
});

await test("loadClinicLayer: nothing live, a missing doc or a thrown read gives null (the reply is unchanged)", async () => {
  assert.equal(await loadClinicLayerWith(reader({ state: { liveVersion: null } }), "live"), null);
  assert.equal(await loadClinicLayerWith(reader({ state: undefined }), "live"), null);
  assert.equal(await loadClinicLayerWith(reader({ state: undefined }), "draft"), null);
  assert.equal(await loadClinicLayerWith(reader({ state: { liveVersion: "v9" }, versions: {} }), "live"), null);
  assert.equal(await loadClinicLayerWith(reader({ state: { liveVersion: "v1" }, versions: { v1: { layer: "garbage" } } }), "live"), null);
  const boom: LayerReader = {
    async state() {
      throw new Error("firestore down");
    },
    async version() {
      throw new Error("firestore down");
    },
  };
  assert.equal(await loadClinicLayerWith(boom, "live"), null);
  assert.equal(await loadClinicLayerWith(boom, "draft"), null);
  const boomVersion: LayerReader = { state: async () => ({ liveVersion: "v1" }), version: async () => { throw new Error("x"); } };
  assert.equal(await loadClinicLayerWith(boomVersion, "live"), null);
});
