/**
 * The token meter behind the AI usage log.
 *
 * What matters here is that one CREDIT and one API CALL are not the same thing: the chat route
 * loops up to five times per message, and the meter has to sum every round. The rest of these
 * cases are about tolerance — a response with no usage block, or a thinking model's extra field
 * that the SDK's own types do not know about, must never throw inside a billing path.
 *
 * No network, no emulator.
 */

import assert from "node:assert/strict";
import { createUsageMeter } from "../src/lib/aiCreditLog";

const response = (
  prompt: number,
  candidates: number,
  extra: Record<string, number> = {}
) => ({ usageMetadata: { promptTokenCount: prompt, candidatesTokenCount: candidates, ...extra } });

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log("  ok   " + name);
  } catch (e) {
    failures++;
    console.error("  FAIL " + name + "\n       " + (e as Error).message);
  }
}

console.log("AI token meter");

check("a fresh meter is empty and carries its model name", () => {
  const m = createUsageMeter("gemini-flash-latest");
  assert.equal(m.model, "gemini-flash-latest");
  assert.equal(m.apiCalls, 0);
  assert.equal(m.inputTokens, 0);
  assert.equal(m.outputTokens, 0);
});

check("one credit spanning six rounds sums every round", () => {
  const m = createUsageMeter("gemini-flash-latest");
  // The shape of a real tool-calling turn: the context grows with each round, so input climbs.
  for (const [inTok, outTok] of [[5800, 80], [7100, 90], [8300, 95], [9400, 110], [10200, 120], [11000, 150]]) {
    m.add(response(inTok, outTok));
  }
  assert.equal(m.apiCalls, 6, "six round trips");
  assert.equal(m.inputTokens, 51800);
  assert.equal(m.outputTokens, 645);
});

check("thinking tokens are counted even though the SDK does not type them", () => {
  const m = createUsageMeter("gemini-flash-latest");
  m.add(response(5800, 120, { thoughtsTokenCount: 640 }));
  assert.equal(m.thoughtTokens, 640);
  // Kept apart from the visible reply: they are billed at the output rate but are not the answer.
  assert.equal(m.outputTokens, 120);
});

check("cached input is recorded separately from total input", () => {
  const m = createUsageMeter("gemini-flash-latest");
  m.add(response(7000, 100, { cachedContentTokenCount: 5400 }));
  assert.equal(m.inputTokens, 7000, "Google counts cached tokens inside promptTokenCount");
  assert.equal(m.cachedTokens, 5400);
});

check("a response with no usage block still counts as a call", () => {
  const m = createUsageMeter("gemini-flash-latest");
  m.add({});
  m.add(undefined);
  m.add(null);
  assert.equal(m.apiCalls, 3, "the call happened and was billed even if we cannot see the size");
  assert.equal(m.inputTokens, 0);
});

check("junk counts read as zero rather than NaN", () => {
  const m = createUsageMeter("gemini-flash-latest");
  m.add({ usageMetadata: { promptTokenCount: "not a number", candidatesTokenCount: null } });
  assert.equal(m.inputTokens, 0);
  assert.equal(m.outputTokens, 0);
  assert.ok(!Number.isNaN(m.inputTokens), "a NaN here would poison a Firestore increment");
});

check("snapshot is a detached copy, not a live view", () => {
  const m = createUsageMeter("gemini-pro-latest");
  m.add(response(1000, 50));
  const snap = m.snapshot();
  m.add(response(2000, 60));
  assert.equal(snap.inputTokens, 1000, "the snapshot handed to the logger must not keep moving");
  assert.equal(m.inputTokens, 3000);
  assert.equal(snap.model, "gemini-pro-latest");
});

if (failures) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passing");
