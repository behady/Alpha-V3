// Treatments added while booking, before the booking is confirmed.
//
// The price typed is the price for ONE unit; the service's own rule says how many units the picked
// teeth make (per tooth, per jaw, or flat). The server applies the same rule when the booking is
// saved (lib/procedurePricing), so what the popup shows is what gets charged.
import assert from "node:assert/strict";
import { stagedChargeTotal, stagedLineTotal, stagedUnits, toothListLabel } from "../src/lib/stagedProcedures";

const filling = { cost: 900, addToLedger: true, teeth: ["16", "17"], pricingMode: "per_tooth" as const };
assert.equal(stagedUnits(filling), 2);
assert.equal(stagedLineTotal(filling), 1800, "900 a tooth, two teeth");

assert.equal(stagedUnits({ cost: 900, addToLedger: true }), 1, "no teeth picked = a general treatment, one unit (as before)");
assert.equal(stagedLineTotal({ cost: 900, addToLedger: true }), 900);

const scaling = { cost: 550, addToLedger: true, teeth: ["11", "21", "31", "41"], pricingMode: "per_arch" as const };
assert.equal(stagedUnits(scaling), 2, "both jaws");
assert.equal(stagedLineTotal(scaling), 1100);

const consult = { cost: 300, addToLedger: true, teeth: ["16", "17", "26"], pricingMode: "flat" as const };
assert.equal(stagedLineTotal(consult), 300, "a flat price ignores the teeth");

assert.equal(stagedLineTotal({ cost: 700, addToLedger: true, teeth: ["16", "17"], pricingMode: "nonsense" }), 1400, "an unknown rule falls back to per tooth, like the server");
assert.equal(stagedLineTotal({ cost: 333.34, addToLedger: true, teeth: ["16", "17", "18"] }), 1000.02, "rounded to piastres, the way the server rounds");

assert.equal(
  stagedChargeTotal([filling, scaling, { cost: 999, addToLedger: false, teeth: ["11"] }]),
  2900,
  "a treatment kept off the books is not charged",
);

assert.equal(toothListLabel(["17", "16", "55"]), "16, 17, 55", "teeth listed in number order");
assert.equal(toothListLabel([]), "");

console.log("stagedProcedures: all checks passed");
