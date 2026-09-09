import assert from "node:assert/strict";
import {
  AI_OVERAGE_EGP_PER_CREDIT,
  LEGACY_TIERS,
  PLAN_PRICES_EGP,
  SELLABLE_TIERS,
  TIER_LIMITS,
  canAddStaff,
  evaluateAiQuota,
  getAiCreditLimit,
  getAiHardLimit,
  hasFeature,
  isLegacyTier,
  monthlyRevenueEgp,
  tierDisplayName,
} from "../src/lib/subscriptions";
import type { Clinic } from "../src/types/saas";

/**
 * The plans, and the one rule every metered AI feature shares.
 *
 * The assertions that matter are about the failure the pricing was rebuilt to remove: the bot
 * going quiet on the tenth of the month. A clinic past its allowance keeps working on overage,
 * the charge that crosses the line is flagged once so the owner can be told once, and only the
 * plan's overage ceiling stops it. The rest pins the plan table — what each tier includes, what
 * it costs, what a grandfathered clinic keeps — so a casual edit cannot quietly change a deal.
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

const clinic = (over: Partial<Clinic> = {}): Clinic =>
  ({
    id: "c1",
    name: "Alpha Dental",
    ownerId: "u1",
    subscriptionTier: "Clinic",
    status: "Active",
    expiresAt: null,
    createdAt: null,
    ...over,
  }) as Clinic;

/* ---------------------------------------------------------------- the plan table */

run("four plans are sold, cheapest first, and each costs more than the last", () => {
  assert.deepEqual([...SELLABLE_TIERS], ["Starter", "Plus", "Clinic", "Group"]);
  for (let i = 1; i < SELLABLE_TIERS.length; i++) {
    const a = PLAN_PRICES_EGP[SELLABLE_TIERS[i - 1]];
    const b = PLAN_PRICES_EGP[SELLABLE_TIERS[i]];
    assert.ok(b.annual > a.annual && b.monthly > a.monthly, `${SELLABLE_TIERS[i]} must cost more than ${SELLABLE_TIERS[i - 1]}`);
  }
});

run("monthly billing carries roughly a 25% premium over annual", () => {
  for (const t of SELLABLE_TIERS) {
    const { annual, monthly } = PLAN_PRICES_EGP[t];
    const premium = monthly / (annual / 12);
    assert.ok(premium > 1.2 && premium < 1.3, `${t}: ${premium.toFixed(2)}x`);
  }
});

run("AI replies step 0 → 500 → 1,000 → 2,000 and the overage ceiling matches the allowance", () => {
  assert.deepEqual(SELLABLE_TIERS.map((t) => TIER_LIMITS[t].aiMonthlyCredits), [0, 500, 1_000, 2_000]);
  for (const t of SELLABLE_TIERS) {
    const l = TIER_LIMITS[t];
    assert.equal(l.aiOverageCredits, l.aiMonthlyCredits, `${t}: overage room equals the allowance`);
    assert.equal(l.features.aiChat, l.aiMonthlyCredits > 0, `${t}: the assistant is on exactly when there are replies to spend`);
  }
});

run("each step up adds something an owner can point at, not only replies", () => {
  const f = (t: (typeof SELLABLE_TIERS)[number]) => TIER_LIMITS[t].features;
  // Starter: the web system, messages sent by hand.
  assert.equal(f("Starter").whatsappIntegration, false);
  assert.equal(f("Starter").androidApp, false);
  // Plus: automatic sending, the phone, SMS from it, lab tracking, the assistant.
  assert.ok(f("Plus").whatsappIntegration && f("Plus").androidApp && f("Plus").smsAutoSend && f("Plus").lab);
  assert.equal(f("Plus").aiProactive, false, "the ledger-reading scans are the Clinic plan's reason");
  assert.equal(f("Plus").attendance, false);
  // Clinic: every module and every kind of AI.
  for (const k of ["inventory", "attendance", "ortho", "leads", "aiProactive", "aiEmbedded", "aiVoice"] as const) {
    assert.equal(f("Clinic")[k], true, `Clinic includes ${k}`);
  }
  assert.equal(f("Clinic").multiBranch, false);
  // Group: branches and the marketing studio, no staff ceiling.
  assert.ok(f("Group").multiBranch && f("Group").marketingText && f("Group").marketingDesign);
  assert.equal(TIER_LIMITS.Group.maxStaff, 0);
  // Nothing is ever taken away by going up a plan.
  for (let i = 1; i < SELLABLE_TIERS.length; i++) {
    const lo = f(SELLABLE_TIERS[i - 1]);
    const hi = f(SELLABLE_TIERS[i]);
    for (const k of Object.keys(lo) as (keyof typeof lo)[]) {
      assert.ok(!lo[k] || hi[k], `${SELLABLE_TIERS[i]} must keep ${String(k)} from ${SELLABLE_TIERS[i - 1]}`);
    }
  }
});

run("the trial is the Clinic plan for two weeks, with no overage to invoice", () => {
  const t = TIER_LIMITS["Free Trial"];
  assert.deepEqual(t.features, TIER_LIMITS.Clinic.features);
  assert.equal(t.aiMonthlyCredits, 500);
  assert.equal(t.aiOverageCredits, 0);
});

run("grandfathered plans keep what they bought and gain the new allowance", () => {
  assert.deepEqual([...LEGACY_TIERS], ["Basic", "Pro", "Premium"]);
  assert.ok(isLegacyTier("Pro") && !isLegacyTier("Clinic") && !isLegacyTier(undefined));
  assert.equal(tierDisplayName("Premium"), "Premium (legacy)");
  assert.equal(tierDisplayName("Clinic"), "Clinic");
  // Pro and Premium both had inventory and attendance; only Clinic carries those now.
  assert.equal(TIER_LIMITS.Pro.aiMonthlyCredits, 1_000, "a Pro clinic's bot stops dying on the tenth, today");
  assert.ok(TIER_LIMITS.Pro.features.inventory && TIER_LIMITS.Pro.features.attendance);
  assert.equal(TIER_LIMITS.Premium.maxStaff, 0, "Premium bought unlimited staff and keeps it");
  assert.equal(TIER_LIMITS.Basic.aiMonthlyCredits, 0);
  // And they are still counted at the price they agreed to.
  assert.equal(monthlyRevenueEgp(clinic({ subscriptionTier: "Pro", billingCycle: "Yearly" })), 5_000 / 12);
});

/* ---------------------------------------------------------------- revenue */

run("what a clinic pays comes from one place: customPrice wins, then the list, and only when Active", () => {
  assert.equal(monthlyRevenueEgp(clinic({ subscriptionTier: "Clinic", billingCycle: "Yearly" })), 21_600 / 12);
  assert.equal(monthlyRevenueEgp(clinic({ subscriptionTier: "Clinic", billingCycle: "Monthly" })), 2_250);
  assert.equal(monthlyRevenueEgp(clinic({ subscriptionTier: "Clinic" })), 2_250, "no cycle means monthly");
  assert.equal(monthlyRevenueEgp(clinic({ subscriptionTier: "Clinic", billingCycle: "Yearly", customPrice: 18_000 })), 1_500);
  assert.equal(monthlyRevenueEgp(clinic({ subscriptionTier: "Clinic", billingCycle: "2-Yearly", customPrice: 24_000 })), 1_000);
  assert.equal(monthlyRevenueEgp(clinic({ subscriptionTier: "Clinic", status: "Suspended" })), 0);
  assert.equal(monthlyRevenueEgp(clinic({ subscriptionTier: "Free Trial" })), 0);
});

/* ---------------------------------------------------------------- the quota rule */

run("a Starter clinic has no assistant, whatever it has used", () => {
  const v = evaluateAiQuota(clinic({ subscriptionTier: "Starter" }), 0, 1);
  assert.equal(v.allowed, false);
  assert.equal(v.reason, "plan");
});

run("inside the allowance a charge is plain, and nothing is overage", () => {
  const c = clinic({ subscriptionTier: "Plus" });
  const v = evaluateAiQuota(c, 499, 1);
  assert.deepEqual([v.allowed, v.overageCredits, v.entersOverage], [true, 0, false]);
  assert.equal(v.included, 500);
  assert.equal(v.hardLimit, 1_000);
});

run("the charge that crosses the allowance is allowed, flagged once, and its overage share is counted", () => {
  const c = clinic({ subscriptionTier: "Plus" });
  const cross = evaluateAiQuota(c, 500, 1);
  assert.deepEqual([cross.allowed, cross.overageCredits, cross.entersOverage], [true, 1, true], "the 501st reply is not refused");

  const straddle = evaluateAiQuota(c, 498, 3);
  assert.deepEqual([straddle.allowed, straddle.overageCredits, straddle.entersOverage], [true, 1, true], "only the part past the line is overage");

  const later = evaluateAiQuota(c, 700, 1);
  assert.deepEqual([later.allowed, later.overageCredits, later.entersOverage], [true, 1, false], "deep in overage: charged, not re-announced");
});

run("only the plan's overage ceiling stops the assistant", () => {
  const c = clinic({ subscriptionTier: "Plus" });
  assert.equal(evaluateAiQuota(c, 999, 1).allowed, true);
  const stop = evaluateAiQuota(c, 1_000, 1);
  assert.equal(stop.allowed, false);
  assert.equal(stop.reason, "no_credits");
  assert.equal(evaluateAiQuota(c, 998, 3).allowed, false, "a charge that would overshoot the ceiling is refused whole");
});

run("the trial stops at its allowance because it has no overage", () => {
  const c = clinic({ subscriptionTier: "Free Trial" });
  assert.equal(getAiHardLimit(c), 500);
  assert.equal(evaluateAiQuota(c, 500, 1).allowed, false);
});

run("per-clinic overrides move the allowance, the overage room, and the bonus", () => {
  const c = clinic({ subscriptionTier: "Plus", features: { aiMonthlyCredits: 800, extraAiCredits: 200, aiOverageCredits: 0 } });
  assert.equal(getAiCreditLimit(c), 1_000);
  assert.equal(getAiHardLimit(c), 1_000, "overage room set to 0 means a hard stop at the allowance");
  assert.equal(evaluateAiQuota(c, 1_000, 1).allowed, false);
});

run("an allowance of zero on a plan with the assistant has always meant no ceiling", () => {
  const c = clinic({ subscriptionTier: "Clinic", features: { aiMonthlyCredits: 0 } });
  assert.equal(getAiHardLimit(c), Number.POSITIVE_INFINITY);
  const v = evaluateAiQuota(c, 50_000, 3);
  assert.deepEqual([v.allowed, v.overageCredits], [true, 0]);
});

run("overage is priced at about twice what a credit costs us", () => {
  // A credit costs $0.0076–0.0103 ≈ 0.36–0.49 EGP at 48/USD.
  assert.equal(AI_OVERAGE_EGP_PER_CREDIT, 1);
});

/* ---------------------------------------------------------------- staff and features */

run("staff ceilings step up and Group has none", () => {
  assert.deepEqual(SELLABLE_TIERS.map((t) => TIER_LIMITS[t].maxStaff), [5, 8, 15, 0]);
  assert.equal(canAddStaff(clinic({ subscriptionTier: "Starter" }), 5), false);
  assert.equal(canAddStaff(clinic({ subscriptionTier: "Group" }), 500), true);
  assert.equal(canAddStaff(clinic({ subscriptionTier: "Starter", features: { maxStaff: 6 } }), 5), true);
});

run("a feature override on the clinic document beats the plan, in both directions", () => {
  assert.equal(hasFeature(clinic({ subscriptionTier: "Starter", features: { lab: true } }), "lab"), true);
  assert.equal(hasFeature(clinic({ subscriptionTier: "Group", features: { multiBranch: false } }), "multiBranch"), false);
  assert.equal(hasFeature(null, "lab"), false);
});
