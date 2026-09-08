import assert from "node:assert/strict";
import { costOf, ratesFor, cacheStorageCost } from "../src/lib/gemini/pricing";

/**
 * The arithmetic behind every cost figure the platform shows itself. Cached tokens sit INSIDE
 * Google's prompt count, and getting that subtraction wrong would report the caching change as
 * having saved nothing — or as having doubled the bill.
 */

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
}

const close = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ""} expected ${b}, got ${a}`);

run("a WhatsApp reply today, uncached, costs what the meter measured", () => {
  // The measured real reply: 6,076 in, 125 out, nothing cached — $0.00503, the 0.25 EGP figure.
  const c = costOf("gemini-flash-latest", { inputTokens: 6076, cachedTokens: 0, outputTokens: 125 }, new Date("2026-09-07"));
  close(c.usd, (6076 / 1e6) * 0.75 + (125 / 1e6) * 3.75);
  close(c.cachedInputUsd, 0);
});

run("cached tokens are priced at a tenth, and subtracted from the full-rate count", () => {
  const c = costOf("gemini-flash-latest", { inputTokens: 6076, cachedTokens: 4462, outputTokens: 125 }, new Date("2026-09-07"));
  close(c.uncachedInputUsd, ((6076 - 4462) / 1e6) * 0.75, "only the remainder is full price");
  close(c.cachedInputUsd, (4462 / 1e6) * 0.075, "the rulebook at a tenth");
  // The promised saving: about 60% off the same reply.
  const before = costOf("gemini-flash-latest", { inputTokens: 6076, cachedTokens: 0, outputTokens: 125 }, new Date("2026-09-07")).usd;
  assert.ok(c.usd < before * 0.45, `cached reply ${c.usd} should be well under half of ${before}`);
});

run("the January price rise applies by the day the call happened", () => {
  const dec = ratesFor("gemini-flash-latest", new Date("2026-12-31T23:59:59Z"));
  const jan = ratesFor("gemini-flash-latest", new Date("2027-01-01T00:00:00Z"));
  assert.equal(dec.input, 0.75);
  assert.equal(jan.input, 1.5);
  assert.equal(jan.cachedInput, 0.15);
});

run("thinking tokens bill as output", () => {
  const withThinking = costOf("gemini-flash-latest", { inputTokens: 1000, cachedTokens: 0, outputTokens: 100, thoughtTokens: 400 }, new Date("2026-09-07"));
  const without = costOf("gemini-flash-latest", { inputTokens: 1000, cachedTokens: 0, outputTokens: 100 }, new Date("2026-09-07"));
  close(withThinking.usd - without.usd, (400 / 1e6) * 3.75);
});

run("keeping one shared rulebook warm is cheap, and a cache per clinic is not", () => {
  const month = 24 * 30;
  const shared = cacheStorageCost("gemini-flash-latest", 4462, month, new Date("2026-09-07"));
  assert.ok(shared < 2, `one shared cache ≈ $${shared.toFixed(2)}/month`);
  // Fifty clinics each caching their own 5,200-token prompt would cost fifty times that.
  const perClinic = cacheStorageCost("gemini-flash-latest", 5200, month, new Date("2026-09-07")) * 50;
  assert.ok(perClinic > 90);
});

run("garbage in the counts cannot go negative or NaN", () => {
  const c = costOf("gemini-flash-latest", { inputTokens: 100, cachedTokens: 500, outputTokens: -5 }, new Date("2026-09-07"));
  assert.ok(c.usd >= 0 && Number.isFinite(c.usd));
});

console.log("geminiPricing: all suites passed");
