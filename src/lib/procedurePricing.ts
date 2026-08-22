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
  /** unitCost × pricingUnits — what the patient is charged. */
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

  const catalogueTotal = matchedServices.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
  const typed = Number(input.typedUnitCost);
  // A typed cost wins, but only when it is a real number — `0` means "free", and `Number("")`
  // is NaN, which must fall through to the catalogue rather than poisoning the total.
  const unitCost = Number.isFinite(typed) && typed !== 0 ? typed : catalogueTotal;

  const pricingMode = isPricingMode(input.pricingModeOverride)
    ? (input.pricingModeOverride as PricingMode)
    : modeFor(matchedServices);
  const pricingUnits = pricingUnitsFor(pricingMode, input.selectedTeeth);
  const cost = money(unitCost * pricingUnits);

  const { labFee, labFeePerUnit, reqLab } = computeProcedureLabFee({
    // computeProcedureLabFee only reads requiresLab and estimatedLabFee.
    matchedServices: matchedServices as never,
    pricingUnits,
  });

  const commissionPct = Number(input.commissionPct) || 0;
  // The lab is paid before the dentist's share is worked out — the fee leaves the clinic either
  // way, so a percentage of it was never the dentist's to take.
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
    cost,
    labFee: money(labFee),
    labFeePerUnit: money(labFeePerUnit),
    requiresLab: reqLab,
    commissionPct,
    doctorCommissionAmount,
    clinicProfit,
  };
}
