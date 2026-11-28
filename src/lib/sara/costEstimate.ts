/**
 * What one question cost in Gemini fees, estimated from its token counts.
 *
 * Rates are Gemini Flash's list prices per million tokens as recorded on 2026-09-08: the intro
 * price until 2026-12-31, double from 2027-01-01. Cached input is billed at a tenth. Hidden
 * reasoning tokens are billed as output, so callers pass output and thoughts added together.
 * An estimate for the superadmin's eyes, never shown to a clinic and never used for billing.
 */

const INTRO = { input: 0.75, cached: 0.075, output: 3.75 };
const FULL = { input: 1.5, cached: 0.15, output: 7.5 };

export function estimateUsd(tokens: { inputTokens: number; cachedTokens: number; outputTokens: number }, day: string): number {
  const rate = day >= "2027-01-01" ? FULL : INTRO;
  const cached = Math.min(tokens.cachedTokens || 0, tokens.inputTokens || 0);
  const fresh = (tokens.inputTokens || 0) - cached;
  const usd = (fresh * rate.input + cached * rate.cached + (tokens.outputTokens || 0) * rate.output) / 1_000_000;
  return Number(usd.toFixed(4));
}
