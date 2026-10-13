/**
 * Treatments added in the booking popup before the booking is confirmed.
 *
 * Each carries the price for ONE unit (`cost`), the teeth picked on the chart, and the service's
 * billing rule. The units — and so the line total — follow `pricingUnitsFor`, the same function the
 * server uses when the booking is saved (lib/procedurePricing), so the total on screen is the total
 * that lands in the books. No teeth picked means a general treatment: one unit, exactly as before
 * the chart existed.
 */
import { DEFAULT_PRICING_MODE, isPricingMode, pricingUnitsFor, type PricingMode } from "@/components/clinical-notes/utils";

export type StagedPricing = {
  cost: number;
  addToLedger: boolean;
  teeth?: string[];
  pricingMode?: string | null;
};

export function stagedMode(p: Pick<StagedPricing, "pricingMode">): PricingMode {
  return isPricingMode(p.pricingMode) ? p.pricingMode : DEFAULT_PRICING_MODE;
}

export function stagedUnits(p: StagedPricing): number {
  return pricingUnitsFor(stagedMode(p), p.teeth ?? []);
}

export function stagedLineTotal(p: StagedPricing): number {
  // toFixed(2), as lib/procedurePricing rounds, so the two can never differ by a piastre.
  return Number(((Number(p.cost) || 0) * stagedUnits(p)).toFixed(2));
}

/** What the booking will charge: every staged treatment that goes on the books. */
export function stagedChargeTotal(list: readonly StagedPricing[]): number {
  return Math.round(list.filter((p) => p.addToLedger).reduce((sum, p) => sum + stagedLineTotal(p), 0) * 100) / 100;
}

/** "16, 17, 55" — the picked teeth in number order. */
export function toothListLabel(teeth: readonly string[]): string {
  return [...teeth].sort((a, b) => Number(a) - Number(b)).join(", ");
}

/**
 * A staged treatment's id, and the request key its save is sent under.
 *
 * The server writes a create carrying a key once and answers every repeat with what it already
 * wrote (api/clinical/procedures), so the key must be unique to this one treatment: random, not
 * the clock — two receptionists staging in the same millisecond would otherwise share one.
 */
export function newStagedId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `stg_${c.randomUUID()}`;
  return `stg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
