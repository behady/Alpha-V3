/**
 * What a recorded treatment costs, and what it pays out.
 *
 * The clinical-notes editor worked this out in the browser and sent the answer to Firestore. Once
 * the server owns the write it has to reach the same answer from the same inputs — otherwise the
 * number on screen and the number stored could differ, which is the one thing a price must never
 * do. So the calculation lives here, Firebase-free, and both sides call it.
 *
 * Deliberately: the CLIENT's figures are a preview. The server recomputes from the price list and
 * the staff records it reads itself, because a cost arriving in a request body is a number the
 * caller chose.
 */

import { applyDiscount, isDiscountMode, resolveListPrice, type DiscountMode } from "@/lib/discountMath";
import {
  DEFAULT_PRICING_MODE,
  computeProcedureLabFee,
  isPricingMode,
  pricingUnitsFor,
  type PricingMode,
} from "@/components/clinical-notes/utils";

export type PricedService = {
  id: string;
  name: string;
  price?: number | null;
  /** Per-price-list overrides. An absent entry charges `price`. */
  prices?: Record<string, number> | null;
  requiresLab?: boolean | null;
  estimatedLabFee?: number | null;
  pricingMode?: string | null;
};

export type ProcedurePricingInput = {
  /** Procedure names as typed or picked. Order matters: the first governs the billing rule. */
  procedures: string[];
  /** The clinic's price list. */
  services: PricedService[];
  /** Teeth selected on the chart. Drives the multiplier for per_tooth and per_arch services. */
  selectedTeeth: string[];
  /** A cost typed by hand. Overrides the catalogue price when non-zero. */
  typedUnitCost?: number | null;
  /** Manual override of the billing rule, for a note that mixes a flat and a per-tooth service. */
  pricingModeOverride?: string | null;
  /** The treating dentist's commission rate, from their staff record. */
  commissionPct?: number | null;
  /** Which price list to charge from. Falls back to each service's standard price. */
  priceListId?: string | null;
  priceListName?: string | null;
  discountMode?: string | null;
  /** The percentage or the fixed amount, as entered. */
  discountValue?: number | null;
  discountReason?: string | null;
};

export type ProcedurePricing = {
  procedures: string[];
  matchedServices: PricedService[];
  /** Ids of the price-list entries the names resolved to. */
  serviceIds: string[];
  /** Names that matched nothing, so a report can disclose what it could not classify. */
  unmatchedProcedures: string[];
  unitCost: number;
  pricingUnits: number;
  pricingMode: PricingMode;
  pricingFormula: string;
  /** unitCost × pricingUnits, before any discount. */
  listPrice: number;
  priceListId: string | null;
  priceListName: string | null;
  discountMode: DiscountMode;
  discountValue: number | null;
  discountAmount: number;
  discountReason: string | null;
  /** What the patient is charged: listPrice minus the discount. */
  cost: number;
  labFee: number;
  labFeePerUnit: number;
  requiresLab: boolean;
  commissionPct: number;
  doctorCommissionAmount: number;
  clinicProfit: number;
};

function money(value: number): number {
  return Number((Number(value) || 0).toFixed(2));
}

/** A service's own billing rule, taken from the main (first) procedure. */
function modeFor(matched: PricedService[]): PricingMode {
  const first = matched[0];
  return isPricingMode(first?.pricingMode) ? (first!.pricingMode as PricingMode) : DEFAULT_PRICING_MODE;
}

export function computeProcedurePricing(input: ProcedurePricingInput): ProcedurePricing {
  const procedures = Array.from(new Set(input.procedures.map((p) => String(p || "").trim()).filter(Boolean)));

  const byName = new Map(input.services.map((s) => [String(s.name || "").trim(), s]));
  const matchedServices = procedures
    .map((name) => byName.get(name))
    .filter((s): s is PricedService => Boolean(s));

  // Priced from the chosen list. `price` is the standard list's price, so a service with no entry
  // for this list simply charges its standard rate — which is why lists needed no migration.
  const priceListId = input.priceListId || null;
  const catalogueTotal = matchedServices.reduce((sum, s) => sum + resolveListPrice(s, priceListId), 0);
  const typed = Number(input.typedUnitCost);
  // A typed cost wins, but only when it is a real number — `0` means "free", and `Number("")`
  // is NaN, which must fall through to the catalogue rather than poisoning the total.
  const unitCost = Number.isFinite(typed) && typed !== 0 ? typed : catalogueTotal;

  const pricingMode = isPricingMode(input.pricingModeOverride)
    ? (input.pricingModeOverride as PricingMode)
    : modeFor(matchedServices);
  const pricingUnits = pricingUnitsFor(pricingMode, input.selectedTeeth);
  const listPrice = money(unitCost * pricingUnits);

  const discountMode: DiscountMode = isDiscountMode(input.discountMode) ? input.discountMode : "none";
  const discount = applyDiscount(listPrice, discountMode, input.discountValue);
  const cost = discount.net;

  const { labFee, labFeePerUnit, reqLab } = computeProcedureLabFee({
    // computeProcedureLabFee only reads requiresLab and estimatedLabFee.
    matchedServices: matchedServices as never,
    pricingUnits,
  });

  const commissionPct = Number(input.commissionPct) || 0;
  // Two rules, both easy to get wrong in a way nobody notices for months:
  //   - the lab fee is NOT discounted. The lab charges its full price whatever the patient pays,
  //     so a discount comes out of the clinic's and the dentist's share, never the lab's;
  //   - commission is on the NET. A dentist earning a percentage of a price the patient never paid
  //     would be paid out of money that never arrived.
  const net = cost - labFee;
  const doctorCommissionAmount = net > 0 ? money(net * (commissionPct / 100)) : 0;
  const clinicProfit = money(cost - doctorCommissionAmount - labFee);

  return {
    procedures,
    matchedServices,
    serviceIds: matchedServices.map((s) => String(s.id)),
    unmatchedProcedures: procedures.filter((name) => !byName.has(name)),
    unitCost: money(unitCost),
    pricingUnits,
    pricingMode,
    pricingFormula: `${money(unitCost)}*${pricingUnits}`,
    listPrice,
    priceListId,
    priceListName: input.priceListName || null,
    discountMode: discount.discountMode,
    discountValue: discount.discountValue,
    discountAmount: discount.discountAmount,
    discountReason: discount.discountAmount > 0 ? String(input.discountReason || "").trim() || null : null,
    cost,
    labFee: money(labFee),
    labFeePerUnit: money(labFeePerUnit),
    requiresLab: reqLab,
    commissionPct,
    doctorCommissionAmount,
    clinicProfit,
  };
}
