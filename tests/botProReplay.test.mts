/**
 * The publish test (replay): built-in + saved conversations through Pro with the draft layer.
 * Fake models and an injected `answer`; nothing here reads Firestore, the network or any key.
 *
 * Run: npm run test:pro-replay
 */
import assert from "node:assert/strict";
import { runReplay, builtinReplayCases, savedReplayCases, actionOf, SAVED_TURNS_MAX, REPLAY_DEADLINE_MS, type ReplayCase } from "../src/lib/botPro/replay";
import { replayShortfalls } from "../src/lib/botPro/replayVerdict";
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

await test("a never-say phrase in every reply: Pro's own check hands off, no break, but the hand-offs fail the run", async () => {
  const layer: ClinicLayer = { ...EMPTY_LAYER, neverSay: ["ارخص عيادة"] };
  const s = await runReplay({ cases: CASES, layer, baseArgs, context: context(), model: () => sayModel("احنا ارخص عيادة") });
  assert.deepEqual(s.breaks, []);
  assert.equal(s.unavailable, 0);
  // The clinical case expected a medical hand-off, so it is not unexpected; the other three are.
  assert.equal(s.unexpectedHandoffs, 3);
  assert.equal(s.passed, false);
  assert.deepEqual(replayShortfalls(s), ["handoffs"]);
});

await test("a never-say phrase that folds into every reply (the old ال bug) would hand off everything: passed false", async () => {
  // A layer whose never-say stops normal replies: every turn becomes a guard hand-off with no text.
  const layer: ClinicLayer = { ...EMPTY_LAYER, neverSay: ["أهلاً بحضرتك"] };
  const s = await runReplay({ cases: CASES, layer, baseArgs, context: context(), model: () => sayModel("أهلاً بحضرتك") });
  assert.equal(s.unexpectedHandoffs, 3);
  assert.equal(s.passed, false);
});

await test("unexpected hand-offs up to a quarter of the turns are tolerated; expected ones never count", async () => {
  const eight: ReplayCase[] = Array.from({ length: 8 }, (_, i) => ({ id: `h${i}`, clinical: false, known: false, turns: [{ q: "سؤال", expect: i === 0 ? ["handoff_other"] : ["answer"] }] }));
  let n = 0;
  const two = async (): Promise<ProReplyResult> => (n++ < 3 ? { kind: "handoff", topic: "other" } : { kind: "answer", text: "أهلاً بحضرتك" });
  // turns 1-3 hand off: the first expected it, so 2 unexpected of 8 (limit 2): passes
  const s = await runReplay({ cases: eight, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer: two, concurrency: 1 });
  assert.equal(s.unexpectedHandoffs, 2);
  assert.equal(s.passed, true);
  n = 0;
  const three = async (): Promise<ProReplyResult> => (n++ < 4 ? { kind: "handoff", topic: "other" } : { kind: "answer", text: "أهلاً بحضرتك" });
  const s2 = await runReplay({ cases: eight, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer: three, concurrency: 1 });
  assert.equal(s2.unexpectedHandoffs, 3);
  assert.equal(s2.passed, false);
});

await test("replayShortfalls reads old summaries without unexpectedHandoffs", () => {
  assert.deepEqual(replayShortfalls({ turns: 4, unavailable: 0, breaks: [] }), []);
  assert.deepEqual(replayShortfalls({ turns: 0, unavailable: 0, breaks: [] }), ["no_turns"]);
  assert.deepEqual(replayShortfalls({ turns: 4, unavailable: 2, unexpectedHandoffs: 2, breaks: [{}] }), ["breaks", "unavailable", "handoffs"]);
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

const one: ReplayCase[] = [{ id: "p", clinical: false, known: false, turns: [{ q: "الكشف ب 200؟", expect: ["answer"] }] }];
const deliver = (text: string) => async (): Promise<ProReplyResult> => ({ kind: "answer", text });

await test("a price built from a number in the layer's own rule is still a price break", async () => {
  const layer: ClinicLayer = { ...EMPTY_LAYER, rules: ["جلسة التقويم بتاخد 30 دقيقة"] };
  const s = await runReplay({ cases: one, layer, baseArgs, context: context(), model: () => sayModel("x"), answer: deliver("التقويم ب 30 ألف جنيه") });
  assert.equal(s.passed, false);
  assert.equal(s.breaks.length, 1);
  assert.ok(s.breaks[0].rules.includes("price"));
});

await test("a price the patient typed (not in the price list) cannot be said back as a price", async () => {
  const s = await runReplay({ cases: one, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer: deliver("ايوه الكشف 200 جنيه") });
  assert.equal(s.passed, false);
  assert.ok(s.breaks[0].rules.includes("price"));
});

await test("today's date digits are not a price source", async () => {
  const s = await runReplay({ cases: one, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer: deliver("الكشف ب 2026 جنيه") });
  assert.equal(s.passed, false);
  assert.ok(s.breaks[0].rules.includes("price"));
});

await test("a price that is in the price list passes", async () => {
  const s = await runReplay({ cases: one, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer: deliver("التنضيف يبدأ من 500 جنيه") });
  assert.deepEqual(s.breaks, []);
  assert.equal(s.passed, true);
});

await test("an empty case list never passes", async () => {
  const s = await runReplay({ cases: [], layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x") });
  assert.equal(s.turns, 0);
  assert.equal(s.passed, false);
});

await test("saved case ids are not truncated", () => {
  const long = "abcdefghijklmnopqrstuvwxyz0123456789";
  assert.equal(savedReplayCases([{ id: long, turns: [{ q: "س", kind: "" }] }])[0].id, long);
});

await test("a saved chat is cut to its first SAVED_TURNS_MAX turns; the reviewer's expect only when its last turn is in", () => {
  const long = Array.from({ length: 20 }, (_, i) => ({ q: `سؤال ${i + 1}`, kind: "ai_answer" }));
  const [c] = savedReplayCases([{ id: "long", turns: long, expect: ["book_slot"] }]);
  assert.equal(SAVED_TURNS_MAX, 6);
  assert.equal(c.turns.length, 6);
  assert.equal(c.turns[0].q, "سؤال 1");
  assert.equal(c.turns[5].q, "سؤال 6");
  assert.deepEqual(c.turns[5].expect, ["answer"], "turn 20's expect is not pinned on turn 6");
  const [short] = savedReplayCases([{ id: "short", turns: long.slice(0, 6), expect: ["book_slot"] }]);
  assert.deepEqual(short.turns[5].expect, ["book_slot"]);
});

await test("the deadline: turns not reached count unavailable, timedOut is set, the counts decide (injected clock)", async () => {
  assert.equal(REPLAY_DEADLINE_MS, 240_000);
  let clock = 0;
  let calls = 0;
  const answer = async (): Promise<ProReplyResult> => {
    calls += 1;
    clock += 100_000; // every answer "takes" 100 s on the fake clock
    return { kind: "answer", text: "أهلاً بحضرتك" };
  };
  const s = await runReplay({ cases: CASES, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer, concurrency: 1, now: () => clock });
  // starts at 0: turn 1 (->100 s), turn 2 (->200 s), turn 3 (->300 s), then the deadline has passed
  assert.equal(calls, 3);
  assert.equal(s.turns, TOTAL_TURNS);
  assert.equal(s.unavailable, 1);
  assert.equal(s.timedOut, true);
  assert.equal(s.ms, 300_000);
  // 1 of 4 unavailable is within the limit: a timeout alone is not a failure, the counts decide
  assert.equal(s.passed, true);

  clock = 0;
  calls = 0;
  const s2 = await runReplay({ cases: CASES, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer, concurrency: 1, now: () => clock, deadlineMs: 50_000 });
  assert.equal(calls, 1);
  assert.equal(s2.unavailable, 3);
  assert.equal(s2.timedOut, true);
  assert.equal(s2.passed, false);
});

await test("a run inside its deadline has no timedOut key", async () => {
  const s = await runReplay({ cases: CASES, layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("أهلاً بحضرتك") });
  assert.equal("timedOut" in s, false);
  assert.equal(s.unexpectedHandoffs, 0);
});

await test("a turn still waiting at the deadline is given up, not waited for", async () => {
  const slow = async (): Promise<ProReplyResult> => {
    await new Promise((r) => setTimeout(r, 2_000));
    return { kind: "answer", text: "متأخر" };
  };
  const t0 = Date.now();
  const s = await runReplay({ cases: [CASES[0]], layer: EMPTY_LAYER, baseArgs, context: context(), model: () => sayModel("x"), answer: slow, deadlineMs: 30 });
  assert.ok(Date.now() - t0 < 1_500, "returned at the deadline, not after the slow answer");
  assert.equal(s.unavailable, 1);
  assert.equal(s.timedOut, true);
});
