import { EGYPT_RATES_USD, type MessageCategory } from "@/lib/whatsappCost";

/**
 * What a clinic costs the platform to run, against what it pays.
 *
 * PLATFORM-ONLY. Nothing in here may reach a clinic's screen: a clinic is sold credits and a plan
 * price, and showing it the supplier invoice behind them hands over the margin. The whole module
 * is imported by the superadmin dashboard and by nothing else, and the API that serves it is
 * behind `requireSuperAdmin`.
 *
 * One supplier we pay — Google, for the assistant — billed in USD against a subscription priced
 * in EGP. Everything below is computed in dollars and converted once at the end, because the
 * exchange rate is the one number here that is a guess.
 *
 * WhatsApp is NOT our cost. Since 2026-09-09 every clinic connects its own Meta Business account
 * and Meta bills the clinic directly. The WhatsApp figures stay on the row because the dashboard
 * still shows them — a clinic's Meta bill is worth knowing when they ask why recalls cost money —
 * but they are the CLINIC's spend and never enter our margin.
 */

/* -------------------------------------------------------------------------------------------- */
/* Google — what the assistant costs to think.                                                   */
/* -------------------------------------------------------------------------------------------- */

/**
 * Per-million-token rates, USD.
 *
 * Validated 2026-08-27 against the AI Studio spend meter: a battery predicted at $0.2548 from
 * these rates moved the meter by $0.25. `gemini-flash-latest` resolves to Gemini 3.7 Flash and
 * `gemini-pro-latest` to 3.1 Pro; both are MOVING aliases Google can repoint, so a model that
 * appears here unrecognised is priced as Flash rather than as free.
 *
 * Thinking tokens bill at the OUTPUT rate — they are not free, they are simply invisible, and on
 * tool-calling turns they routinely exceed the visible reply.
 *
 * INTRO PRICING ENDS 31 DEC 2026. From 1 Jan 2027 Flash doubles to $1.50 / $7.50. `ratesFor`
 * takes the date so a projection past the cliff is honest rather than optimistic.
 */
type ModelRate = { input: number; output: number; cachedInput: number };

const FLASH_INTRO: ModelRate = { input: 0.75, output: 3.75, cachedInput: 0.075 };
const FLASH_2027: ModelRate = { input: 1.5, output: 7.5, cachedInput: 0.15 };
const PRO_INTRO: ModelRate = { input: 2.5, output: 15, cachedInput: 0.25 };
const PRO_2027: ModelRate = { input: 5, output: 30, cachedInput: 0.5 };
const FLASH_LITE: ModelRate = { input: 0.25, output: 1.5, cachedInput: 0.025 };

/** The day Google's introductory pricing stops. */
export const INTRO_PRICING_ENDS = new Date("2027-01-01T00:00:00Z");

export function ratesFor(model: string, when = new Date()): ModelRate {
  const intro = when < INTRO_PRICING_ENDS;
  const name = String(model || "").toLowerCase();
  if (name.includes("lite")) return FLASH_LITE; // no scheduled rise
  if (name.includes("pro")) return intro ? PRO_INTRO : PRO_2027;
  return intro ? FLASH_INTRO : FLASH_2027;
}

/** Token counts as `ai_usage` stores them, per model. */
export type TokenBundle = { input: number; output: number; thoughts: number; cached: number };

/**
 * What one model's tokens cost.
 *
 * `input` from Google already INCLUDES the cached slice, so the cached tokens are subtracted back
 * out and re-added at the cheaper rate. Getting that wrong double-counts the cheapest tokens in
 * the bundle and quietly overstates every clinic's cost.
 */
export function costOfTokens(model: string, tokens: TokenBundle, when = new Date()): number {
  const rate = ratesFor(model, when);
  const cached = Math.max(0, tokens.cached || 0);
  const freshInput = Math.max(0, (tokens.input || 0) - cached);
  const billedOutput = (tokens.output || 0) + (tokens.thoughts || 0);
  const usd =
    (freshInput * rate.input + cached * rate.cachedInput + billedOutput * rate.output) / 1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/* -------------------------------------------------------------------------------------------- */
/* The clinic's line.                                                                            */
/* -------------------------------------------------------------------------------------------- */

export type ClinicCostRow = {
  clinicId: string;
  clinicName: string;
  tier: string;
  status: string;
  /** What the clinic pays us, per month, in EGP. */
  monthlyRevenueEgp: number;
  /** AI credits charged to the clinic this month, and the allowance they came out of. */
  creditsUsed: number;
  creditLimit: number;
  /** Google's fees for those credits, in USD. */
  aiCostUsd: number;
  /**
   * The same Google figure split by feature — "whatsapp_bot", "treatment_plan", "bot_playbook"…
   * Sums to `aiCostUsd` for charges made after per-feature token logging shipped (2026-09-09);
   * earlier months carry less here than in the total.
   */
  aiCostByFeatureUsd: Record<string, number>;
  /**
   * API calls the token log actually measured this month.
   *
   * Token logging shipped 2026-08-26, and the WhatsApp assistant only began feeding it on
   * 2026-09-06 — before that a clinic could burn 800 credits and record seven calls. So a month
   * where this is far below `creditsUsed` has a Google figure that is real but INCOMPLETE, and
   * saying so is the difference between an honest number and a wrong one.
   */
  aiMeasuredCalls: number;
  /**
   * The clinic's own Meta bill for the month, USD — billed to the clinic, not to us. Null when the
   * clinic has no official channel.
   */
  whatsappBilledUsd: number | null;
  /** What was sent on the clinic's behalf, by category — the shape of THEIR WhatsApp bill. */
  sentByCategory: Record<MessageCategory, number>;
  /** Our estimate of the clinic's bill, used when Meta has not reported. */
  whatsappEstimateUsd: number;
};

export type ClinicMargin = ClinicCostRow & {
  /** What WE paid to run this clinic: Google only. */
  totalCostUsd: number;
  totalCostEgp: number;
  marginEgp: number;
  /** Our supplier cost as a share of what the clinic pays. Null when the clinic pays nothing. */
  costRatio: number | null;
  /** The clinic's own WhatsApp spend, USD, for display beside the margin — not part of it. */
  clinicWhatsappUsd: number;
};

/**
 * The margin on one clinic.
 *
 * `costRatio` is the number to run the business on: the share of a clinic's subscription that goes
 * straight back out to Google. The rule for this product is that it stays under 35% — an AI-heavy
 * product runs healthily there, and the old 15% was set when the allowance was a tenth of what it
 * is now. A clinic above the ceiling is either on the wrong plan or using the assistant far harder
 * than the plan assumed, and this is the only place that becomes visible.
 */
export function marginFor(row: ClinicCostRow, usdToEgp: number): ClinicMargin {
  const totalCostUsd = Math.round(row.aiCostUsd * 1_000_000) / 1_000_000;
  const totalCostEgp = Math.round(totalCostUsd * usdToEgp * 100) / 100;
  return {
    ...row,
    totalCostUsd,
    totalCostEgp,
    marginEgp: Math.round((row.monthlyRevenueEgp - totalCostEgp) * 100) / 100,
    costRatio: row.monthlyRevenueEgp > 0 ? totalCostEgp / row.monthlyRevenueEgp : null,
    clinicWhatsappUsd: row.whatsappBilledUsd ?? row.whatsappEstimateUsd,
  };
}

/**
 * The share of revenue this product is willing to spend on Google before a plan is mispriced.
 * Worst-case use of every plan's full allowance lands near 27%; the median clinic near 10%.
 */
export const COST_RATIO_CEILING = 0.35;

/** Rank by what they cost us, worst first — the question the dashboard exists to answer. */
export function rankByCost(rows: ClinicMargin[]): ClinicMargin[] {
  return [...rows].sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

/** Every clinic whose supplier cost has outgrown its plan. */
export function overCeiling(rows: ClinicMargin[], ceiling = COST_RATIO_CEILING): ClinicMargin[] {
  return rows.filter((r) => r.costRatio !== null && r.costRatio > ceiling);
}

/** Google's bill by feature across every clinic — the answer to "what does the treatment planner cost us". */
export function costByFeature(rows: Pick<ClinicCostRow, "aiCostByFeatureUsd">[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    for (const [feature, usd] of Object.entries(r.aiCostByFeatureUsd || {})) {
      out[feature] = Math.round(((out[feature] || 0) + usd) * 1_000_000) / 1_000_000;
    }
  }
  return out;
}

/** Totals across the platform, for the strip at the top. */
export function platformTotals(rows: ClinicMargin[]) {
  const revenueEgp = rows.reduce((n, r) => n + r.monthlyRevenueEgp, 0);
  const costEgp = rows.reduce((n, r) => n + r.totalCostEgp, 0);
  return {
    clinics: rows.length,
    revenueEgp: Math.round(revenueEgp * 100) / 100,
    costEgp: Math.round(costEgp * 100) / 100,
    marginEgp: Math.round((revenueEgp - costEgp) * 100) / 100,
    costRatio: revenueEgp > 0 ? costEgp / revenueEgp : null,
    aiCostUsd: Math.round(rows.reduce((n, r) => n + r.aiCostUsd, 0) * 10000) / 10000,
    aiCostByFeatureUsd: costByFeature(rows),
    /** What the clinics, between them, paid Meta. Informational; not in `costEgp`. */
    clinicsWhatsappUsd: Math.round(rows.reduce((n, r) => n + r.clinicWhatsappUsd, 0) * 10000) / 10000,
  };
}

/** Re-exported so the dashboard can show what a category costs without importing two modules. */
export { EGYPT_RATES_USD };
