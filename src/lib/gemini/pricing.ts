/**
 * What Google charges us, per token, on a given day.
 *
 * The usage log stores raw token counts and never a money figure, because the price moves on
 * Google's schedule and a cost baked into a document at write time quietly becomes wrong. This is
 * the one place the rate lives, so a report can price any row by the day it happened — including
 * the rows from before the caching change, which is the whole point of a before-and-after.
 *
 * Rates are USD per million tokens, from https://ai.google.dev/gemini-api/docs/pricing, read
 * 2026-09-07. The intro pricing on 3.x Flash ends 31 Dec 2026 and doubles; both periods are here
 * so a month that straddles the change is priced correctly on each side of it.
 */

export interface TokenRates {
  /** Uncached input tokens. */
  input: number;
  /** Input tokens served from an explicit or implicit cache. */
  cachedInput: number;
  /** Output, including thinking tokens, which bill as output. */
  output: number;
  /** Keeping an explicit cache alive: per million tokens, per hour. */
  cacheStoragePerHour: number;
}

interface RatePeriod {
  /** ISO date (UTC) this period starts; the last one is open-ended. */
  from: string;
  rates: TokenRates;
}

/** `gemini-flash-latest` resolves to the 3.x Flash line; the Pro alias is priced separately. */
const FLASH: RatePeriod[] = [
  { from: "2026-01-01", rates: { input: 0.75, cachedInput: 0.075, output: 3.75, cacheStoragePerHour: 0.5 } },
  { from: "2027-01-01", rates: { input: 1.5, cachedInput: 0.15, output: 7.5, cacheStoragePerHour: 1.0 } },
];

/** gemini-pro-latest (Gemini 3.1 Pro), the super-mode model. Not cached anywhere yet. */
const PRO: RatePeriod[] = [{ from: "2026-01-01", rates: { input: 2.0, cachedInput: 0.2, output: 12.0, cacheStoragePerHour: 4.5 } }];

function periodsFor(model: string): RatePeriod[] {
  return /pro/i.test(model) ? PRO : FLASH;
}

/** The rates in force on a given day. Days before the first period use the first period. */
export function ratesFor(model: string, at: Date): TokenRates {
  const day = at.toISOString().slice(0, 10);
  const periods = periodsFor(model);
  let current = periods[0];
  for (const p of periods) if (p.from <= day) current = p;
  return current.rates;
}

export interface TokenCounts {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thoughtTokens?: number;
}

export interface CostBreakdown {
  usd: number;
  /** The three lines the total is made of, so a report can show where the money went. */
  uncachedInputUsd: number;
  cachedInputUsd: number;
  outputUsd: number;
}

/**
 * Price one call, or one aggregate of calls, at the rate of the day it happened.
 *
 * Google counts cached tokens INSIDE promptTokenCount, so the uncached part is the difference —
 * a row with input 6,000 and cached 4,400 has 1,600 tokens at the full rate, not 6,000.
 */
export function costOf(model: string, usage: TokenCounts, at: Date): CostBreakdown {
  const r = ratesFor(model, at);
  const cached = Math.max(0, usage.cachedTokens || 0);
  const uncached = Math.max(0, (usage.inputTokens || 0) - cached);
  const output = Math.max(0, (usage.outputTokens || 0) + (usage.thoughtTokens || 0));
  const uncachedInputUsd = (uncached / 1_000_000) * r.input;
  const cachedInputUsd = (cached / 1_000_000) * r.cachedInput;
  const outputUsd = (output / 1_000_000) * r.output;
  return { usd: uncachedInputUsd + cachedInputUsd + outputUsd, uncachedInputUsd, cachedInputUsd, outputUsd };
}

/** What one warm cache costs to keep for `hours`, at the rate of the day. */
export function cacheStorageCost(model: string, tokens: number, hours: number, at: Date): number {
  return (Math.max(0, tokens) / 1_000_000) * ratesFor(model, at).cacheStoragePerHour * Math.max(0, hours);
}

/** The exchange rate the rest of the app's cost notes already assume. Display only. */
export const EGP_PER_USD = 50;
