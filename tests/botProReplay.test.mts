/**
 * The publish test (replay): built-in + saved conversations through Pro with the draft layer.
 * Fake models and an injected `answer`; nothing here reads Firestore, the network or any key.
 *
 * Run: npm run test:pro-replay
 */
import assert from "node:assert/strict";
import { runReplay, builtinReplayCases, savedReplayCases, actionOf, type ReplayCase } from "../src/lib/botPro/replay";
import { CONVERSATIONS } from "../src/lib/botPro/replayCases";
import type { ProArgs, ProContext } from "../src/lib/botPro/proContext";
import type { ProModel, ProReplyResult } from "../src/lib/botPro/answerWithPro";
import { EMPTY_LAYER, type ClinicLayer } from "../src/lib/botPro/layer";
import { PRO_STRANGER } from "../src/lib/botPro/replay";

async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  console.log(`ok - ${name}`);
}

const TODAY = "2026-11-02";

function context(): ProContext {
  return {
    todayKey: TODAY,
    person: PRO_STRANGER,
    reloadPerson: async () => PRO_STRANGER,
    thread: [],
    prices: [{ name: "تنضيف", price: 500 }],
    priceLines: "تنضيف: يبدأ من 500 ج.م",
    doctors: ["Mohamed Ehab"],
    openDays: () => [],
    freeTimes: async () => [],
    dayLabel: (d) => d,
    patientFile: async () => "",
    layer: null,
  };
}

const baseArgs: ProArgs = { clinicId: "c1", clinicName: "Alpha", question: "", history: [], mode: "sales", canBook: true, chatId: "replay" };

const sayModel = (text: string): ProModel => ({
  async send() {
    return { functionCall: { name: "reply", args: { action: "answer", reply: text } } };
  },
});

const throwingModel: ProModel = {
  async send() {
    throw new Error("model down");
  },
};

const CASES: ReplayCase[] = [
  { id: "a", clinical: false, known: false, turns: [{ q: "ايه الاسعار", expect: ["answer"] }] },
  { id: "b", clinical: false, known: true, turns: [{ q: "عايزة احجز", expect: ["answer"] }, { q: "تمام", expect: ["answer"] }] },
  { id: "c", clinical: true, known: false, turns: [{ q: "سني بتوجعني", expect: ["handoff_medical"] }] },
];
const TOTAL_TURNS = 4;

await test("a harmless model passes; turns are the sum of all turns", async () => {
  const s = await runReplay({ cases: CASES, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("أهلاً بحضرتك") });
  assert.equal(s.passed, true);
  assert.equal(s.turns, TOTAL_TURNS);
  assert.equal(s.unavailable, 0);
  assert.deepEqual(s.breaks, []);
  assert.ok(s.ms >= 0);
  // the clinical case expected a medical handoff and got an answer: reported, never blocking
  assert.equal(s.actionMisses, 1);
});

await test("a model that breaks the never-say list is caught by Pro's own check: handoff, no break, not unavailable", async () => {
  const layer: ClinicLayer = { ...EMPTY_LAYER, neverSay: ["ارخص عيادة"] };
  const s = await runReplay({ cases: CASES, layer, baseArgs, context: context(), model: () => sayModel("احنا ارخص عيادة") });
  assert.deepEqual(s.breaks, []);
  assert.equal(s.unavailable, 0);
  assert.equal(s.passed, true);
});

await test("the independent re-check catches a delivered never-say phrase", async () => {
  const layer: ClinicLayer = { ...EMPTY_LAYER, neverSay: ["ارخص عيادة"] };
  const answer = async (): Promise<ProReplyResult> => ({ kind: "answer", text: "احنا ارخص عيادة" });
  const s = await runReplay({ cases: CASES, layer, baseArgs, context: context(), model: () => sayModel("x"), answer });
  assert.equal(s.passed, false);
  assert.equal(s.breaks.length, TOTAL_TURNS);
  assert.ok(s.breaks[0].rules.includes("never_say"));
  assert.equal(s.breaks[0].reply, "احنا ارخص عيادة");
  assert.ok(CASES.some((c) => c.id === s.breaks[0].caseId));
});

await test("a model that throws makes every turn unavailable and fails the run", async () => {
  const s = await runReplay({ cases: CASES, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => throwingModel });
  assert.equal(s.unavailable, TOTAL_TURNS);
  assert.equal(s.passed, false);
  assert.deepEqual(s.breaks, []);
});

await test("unavailable up to a quarter of the turns is tolerated", async () => {
  let n = 0;
  const answer = async (): Promise<ProReplyResult> => (n++ === 0 ? { kind: "unavailable", reason: "x" } : { kind: "answer", text: "أهلاً بحضرتك" });
  const s = await runReplay({ cases: CASES, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer, concurrency: 1 });
  assert.equal(s.unavailable, 1);
  assert.equal(s.passed, true);
  n = 0;
  const two = async (): Promise<ProReplyResult> => (n++ < 2 ? { kind: "unavailable", reason: "x" } : { kind: "answer", text: "أهلاً بحضرتك" });
  const s2 = await runReplay({ cases: CASES, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer: two, concurrency: 1 });
  assert.equal(s2.passed, false);
});

await test("each turn gets its own question, the carried thread, the layer, a no-op sink and no charge", async () => {
  const layer: ClinicLayer = { ...EMPTY_LAYER, rules: ["اقفل بعرض كشف"] };
  const seen: Array<{ q: string; thread: string[]; ctxLayer: ClinicLayer | null; patientKnown: boolean | undefined; charge: unknown; record: unknown }> = [];
  const answer = (async (args: ProArgs, deps: { context?: ProContext; sink?: { charge(c: number, u: never): Promise<void> }; charge?: boolean; record?: boolean }): Promise<ProReplyResult> => {
    seen.push({ q: args.question, thread: (args.thread || []).map((l) => `${l.author}:${l.text}`), ctxLayer: deps.context?.layer ?? null, patientKnown: args.patient?.known, charge: deps.charge, record: deps.record });
    await deps.sink?.charge(3, {} as never); // must be harmless
    return { kind: "answer", text: `رد على ${args.question}` };
  }) as never;
  await runReplay({ cases: [CASES[1]], layer, baseArgs, context: context(), model: () => sayModel("x"), answer });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].q, "عايزة احجز");
  assert.deepEqual(seen[0].thread, []);
  assert.deepEqual(seen[1].thread, ["patient:عايزة احجز", "bot:رد على عايزة احجز"]);
  assert.deepEqual(seen[0].ctxLayer, layer);
  assert.equal(seen[0].patientKnown, true);
  assert.equal(seen[0].charge, false);
  assert.equal(seen[0].record, false);
});

await test("cases run up to `concurrency` at a time (default 6)", async () => {
  const many: ReplayCase[] = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, clinical: false, known: false, turns: [{ q: "سؤال", expect: ["answer"] }] }));
  let live = 0;
  let peak = 0;
  const answer = async (): Promise<ProReplyResult> => {
    live += 1;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live -= 1;
    return { kind: "answer", text: "أهلاً بحضرتك" };
  };
  const base = { cases: many, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer };
  const s = await runReplay(base);
  assert.equal(s.turns, 20);
  assert.equal(peak, 6);
  peak = 0;
  await runReplay({ ...base, concurrency: 2 });
  assert.equal(peak, 2);
});

await test("builtinReplayCases mirrors CONVERSATIONS", () => {
  const b = builtinReplayCases();
  assert.equal(b.length, CONVERSATIONS.length);
  assert.equal(b[0].id, `builtin:${CONVERSATIONS[0].id}`);
  for (const [i, c] of CONVERSATIONS.entries()) {
    assert.equal(b[i].known, c.patient?.known !== false);
    assert.equal(b[i].turns.length, c.turns.length);
  }
  assert.ok(b.some((c) => c.known) && b.some((c) => !c.known));
});

await test("savedReplayCases maps bot_test_cases docs, skips empty ones, honours max and the reviewer's expect", () => {
  const raw: Array<Record<string, unknown>> = [
    { id: "doc1", clinical: true, turns: [{ q: " الاول ", a: "x", kind: "ai_answer" }, { q: "وجع", a: "", kind: "ai_handoff_medical" }] },
    { id: "doc2", turns: [{ q: "   ", a: "", kind: "" }] },
    { id: "doc3", turns: [{ q: "حجز", kind: "book" }], expect: ["book_slot"] },
    { turns: [{ q: "سؤال", kind: "" }] },
  ];
  const out = savedReplayCases(raw);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { id: "doc1", clinical: true, known: false, turns: [{ q: "الاول", expect: ["answer"] }, { q: "وجع", expect: ["handoff_medical"] }] });
  assert.deepEqual(out[1].turns[0].expect, ["book_slot"]);
  assert.equal(out[2].id, "saved-4");
  assert.equal(savedReplayCases(raw, 1).length, 1);
});

await test("actionOf names the action the way the expectations do", () => {
  assert.equal(actionOf({ kind: "unavailable", reason: "x" }), "unavailable");
  assert.equal(actionOf({ kind: "handoff", topic: "medical" }), "handoff_medical");
  assert.equal(actionOf({ kind: "answer", text: "x", bookSlot: "k" }), "book_slot");
  assert.equal(actionOf({ kind: "answer", text: "x" }), "answer");
});
