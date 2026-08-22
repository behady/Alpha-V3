// Fixture test for price lists and discounts. Run with tsx so the TS modules load directly.
//
// Two arithmetic rules are the reason this file exists, and both are easy to get wrong in a way
// nobody notices for months: the lab fee is never discounted, and commission is calculated on the
// net. Getting either backwards pays a dentist out of money that never arrived, or bills the lab
// for a discount the clinic chose to give.
import assert from "node:assert/strict";
import {
  allowedDiscount,
  applyDiscount,
  checkDiscountAllowed,
  effectiveDiscountPercent,
  resolveListPrice,
} from "../src/lib/discountMath.ts";
import {
  DEFAULT_MAX_DISCOUNT_PERCENT_NON_ADMIN,
  parseDiscountSettings,
  parsePriceLists,
  resolveActiveListId,
  STANDARD_LIST_ID,
} from "../src/lib/priceLists.ts";
import { computeProcedurePricing } from "../src/lib/procedurePricing.ts";

// --- price lists ---------------------------------------------------------------------------------

// A clinic that has never opened the settings screen still has exactly one usable list.
const seeded = parsePriceLists(null);
assert.equal(seeded.length, 1);
assert.equal(seeded[0].id, STANDARD_LIST_ID);
assert.equal(seeded[0].isDefault, true);
assert.equal(seeded[0].generalDiscountPercent, 0);

// Exactly one default, always. Two would make "which price?" ambiguous at the chair.
const twoDefaults = parsePriceLists({
  lists: [
    { id: "a", name: "A", isDefault: true, active: true },
    { id: "b", name: "B", isDefault: true, active: true },
  ],
});
assert.equal(twoDefaults.filter((l) => l.isDefault).length, 1);

// None marked default → the first active one is promoted rather than leaving a patient listless.
const noDefault = parsePriceLists({
  lists: [
    { id: "a", name: "A", active: false },
    { id: "b", name: "B", active: true },
  ],
});
assert.equal(noDefault.find((l) => l.isDefault)?.id, "b");

// A default that has been deactivated must not stay the default.
const deadDefault = parsePriceLists({
  lists: [
    { id: "a", name: "A", active: false, isDefault: true },
    { id: "b", name: "B", active: true },
  ],
});
assert.equal(deadDefault.find((l) => l.isDefault)?.id, "b");

const lists = parsePriceLists({
  lists: [
    { id: "standard", name: "Standard", active: true, isDefault: true, generalDiscountPercent: 0 },
    { id: "insurance", name: "Insurance A", active: true, generalDiscountPercent: 10 },
    { id: "old", name: "Retired", active: false, generalDiscountPercent: 50 },
  ],
});

// Resolution order: the note's own list, then the patient's, then the clinic default.
assert.equal(resolveActiveListId(lists, "insurance", "standard"), "insurance");
assert.equal(resolveActiveListId(lists, null, "insurance"), "insurance");
assert.equal(resolveActiveListId(lists, null, null), "standard");
// A deactivated or unknown list must never be silently used to price something.
assert.equal(resolveActiveListId(lists, "old", null), "standard");
assert.equal(resolveActiveListId(lists, "nonsense", null), "standard");

// --- per-list prices ------------------------------------------------------------------------------

const crown = { id: "S1", name: "Crown", price: 3000, prices: { insurance: 2400 } };
assert.equal(resolveListPrice(crown, "insurance"), 2400);
// No entry for this list → the standard price. This is why adding lists needed no migration.
assert.equal(resolveListPrice(crown, "family"), 3000);
assert.equal(resolveListPrice(crown, null), 3000);
assert.equal(resolveListPrice({ price: 500 }, "insurance"), 500);

// --- the discount arithmetic -----------------------------------------------------------------------

const tenPercent = applyDiscount(1000, "percent", 10);
assert.equal(tenPercent.discountAmount, 100);
assert.equal(tenPercent.net, 900);
assert.equal(tenPercent.listPrice, 1000);

const fixed = applyDiscount(1000, "fixed", 250);
assert.equal(fixed.discountAmount, 250);
assert.equal(fixed.net, 750);

// "500 off" on a 400 line means "make it free" — clamped, never negative, because a negative
// charge reads as the clinic owing the patient.
const overshoot = applyDiscount(400, "fixed", 500);
assert.equal(overshoot.discountAmount, 400);
assert.equal(overshoot.net, 0);

assert.equal(applyDiscount(1000, "percent", 150).discountAmount, 1000, "a percentage is capped at 100");
assert.equal(applyDiscount(1000, "percent", -5).discountAmount, 0, "a negative discount is not a surcharge");
assert.equal(applyDiscount(1000, "none", 50).net, 1000, "mode none ignores any value");

assert.equal(effectiveDiscountPercent(1000, 250), 25);
assert.equal(effectiveDiscountPercent(0, 100), 0, "no list price means no meaningful percentage");

// --- authority --------------------------------------------------------------------------------------

const settings = parseDiscountSettings(null);
assert.equal(settings.maxDiscountPercentNonAdmin, DEFAULT_MAX_DISCOUNT_PERCENT_NON_ADMIN);
assert.ok(settings.reasons.includes("Insurance"));

// An explicit null means "no ceiling", and must not be replaced by the default.
assert.equal(parseDiscountSettings({ maxDiscountPercentNonAdmin: null }).maxDiscountPercentNonAdmin, null);
assert.equal(parseDiscountSettings({ maxDiscountPercentNonAdmin: 35 }).maxDiscountPercentNonAdmin, 35);

assert.equal(allowedDiscount("Admin", [], settings).maxPercent, null, "an Admin has no ceiling");
assert.equal(allowedDiscount("Receptionist", [], settings).maxPercent, 20);

const receptionist = allowedDiscount("Receptionist", [], settings);
const admin = allowedDiscount("Admin", [], settings);

// Within the cap, with a reason.
assert.deepEqual(
  checkDiscountAllowed({ listPrice: 1000, discountAmount: 150, reason: "Promotion", authority: receptionist, availableReasons: settings.reasons }),
  { ok: true }
);

// Over the cap.
const overCap = checkDiscountAllowed({ listPrice: 1000, discountAmount: 300, reason: "Promotion", authority: receptionist, availableReasons: settings.reasons });
assert.equal(overCap.ok, false);
assert.match(overCap.error, /Admin/);
assert.match(overCap.error, /30\.0%/, "the message must say how big the discount actually is");

// The same discount from an Admin goes through.
assert.equal(
  checkDiscountAllowed({ listPrice: 1000, discountAmount: 300, reason: "Promotion", authority: admin, availableReasons: settings.reasons }).ok,
  true
);

// A reason is required for ANY discount — without it, "we gave away 8,000, on what?" has no answer.
const noReason = checkDiscountAllowed({ listPrice: 1000, discountAmount: 100, reason: "", authority: admin, availableReasons: settings.reasons });
assert.equal(noReason.ok, false);
assert.match(noReason.error, /reason/i);

// An invented reason is refused, so the grouping stays meaningful.
assert.equal(
  checkDiscountAllowed({ listPrice: 1000, discountAmount: 100, reason: "because", authority: admin, availableReasons: settings.reasons }).ok,
  false
);

// No discount, no reason needed.
assert.deepEqual(
  checkDiscountAllowed({ listPrice: 1000, discountAmount: 0, reason: null, authority: receptionist, availableReasons: settings.reasons }),
  { ok: true }
);

// --- the two rules that matter, end to end -----------------------------------------------------------

const services = [
  { id: "S1", name: "Crown", price: 3000, prices: { insurance: 2400 }, requiresLab: true, estimatedLabFee: 400, pricingMode: "flat" },
];

const undiscounted = computeProcedurePricing({
  procedures: ["Crown"], services, selectedTeeth: ["11"], commissionPct: 30,
});
assert.equal(undiscounted.listPrice, 3000);
assert.equal(undiscounted.cost, 3000);
assert.equal(undiscounted.labFee, 400);
assert.equal(undiscounted.doctorCommissionAmount, 780, "(3000 - 400) * 30%");

const discounted = computeProcedurePricing({
  procedures: ["Crown"], services, selectedTeeth: ["11"], commissionPct: 30,
  discountMode: "percent", discountValue: 10, discountReason: "Promotion",
});
assert.equal(discounted.listPrice, 3000, "the list price is preserved, so the discount is reportable");
assert.equal(discounted.discountAmount, 300);
assert.equal(discounted.cost, 2700);
// RULE 1: the lab still charges 400. A discount comes out of the clinic's share, not the lab's.
assert.equal(discounted.labFee, 400, "the lab fee must never be discounted");
// RULE 2: commission is on the net, after the discount.
assert.equal(discounted.doctorCommissionAmount, 690, "(2700 - 400) * 30%");
assert.equal(discounted.clinicProfit, 1610, "2700 - 690 - 400");
assert.equal(discounted.discountReason, "Promotion");

// Priced from another list, then discounted on top of that list's price.
const onInsurance = computeProcedurePricing({
  procedures: ["Crown"], services, selectedTeeth: ["11"], commissionPct: 30,
  priceListId: "insurance", priceListName: "Insurance A",
  discountMode: "percent", discountValue: 10, discountReason: "Insurance",
});
assert.equal(onInsurance.listPrice, 2400, "the insurance rate is the list price here");
assert.equal(onInsurance.discountAmount, 240);
assert.equal(onInsurance.cost, 2160);
assert.equal(onInsurance.priceListId, "insurance");

// A discount of zero records no reason, so nothing has to be invented to satisfy the field.
assert.equal(
  computeProcedurePricing({ procedures: ["Crown"], services, selectedTeeth: ["11"], discountReason: "Promotion" }).discountReason,
  null
);

// A 100% discount: free treatment, dentist earns nothing, and the clinic still owes the lab.
const comped = computeProcedurePricing({
  procedures: ["Crown"], services, selectedTeeth: ["11"], commissionPct: 30,
  discountMode: "percent", discountValue: 100, discountReason: "Complaint resolution",
});
assert.equal(comped.cost, 0);
assert.equal(comped.doctorCommissionAmount, 0, "no commission on money that was never charged");
assert.equal(comped.clinicProfit, -400, "the lab fee is still owed — a comped case costs the clinic");

console.log("✓ discountMath: the lab fee is never discounted, and commission follows the net");
