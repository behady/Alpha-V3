import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  COST_RATIO_CEILING,
  INTRO_PRICING_ENDS,
  costOfTokens,
  marginFor,
  overCeiling,
  platformTotals,
  rankByCost,
  ratesFor,
  type ClinicCostRow,
} from "../src/lib/platformCost";

/**
 * The platform's margin arithmetic — and the wall between it and a clinic's screen.
 *
 * Two things are being protected. The first is the money: these figures decide whether a plan is
 * priced right, and a double-counted cached token or a Pro turn priced as Flash moves them enough
 * to price a plan wrongly. The second is the SECRET: a clinic is sold credits, and the supplier
 * invoice behind them is the platform's business. The last test walks the source tree to make
 * sure nothing clinic-facing has quietly started importing this module.
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

const BEFORE = new Date("2026-09-07T00:00:00Z");
const AFTER = new Date("2027-02-01T00:00:00Z");

run("cached tokens are billed once, at the cheap rate — not twice", () => {
  // Google reports `input` INCLUDING the cached slice. Treating them as separate pools is the
  // classic double count, and it overstates every clinic that benefits from caching.
  const all = costOfTokens("gemini-flash-latest", { input: 1_000_000, output: 0, thoughts: 0, cached: 0 }, BEFORE);
  assert.equal(all, 0.75, "a million fresh input tokens at the Flash intro rate");

  const half = costOfTokens("gemini-flash-latest", { input: 1_000_000, output: 0, thoughts: 0, cached: 500_000 }, BEFORE);
  assert.equal(half, 0.75 * 0.5 + 0.075 * 0.5, "half cached costs half full price plus half cache price");
  assert.ok(half < all, "caching must always reduce the bill");
});

run("thinking tokens are billed as output, because they are", () => {
  const visible = costOfTokens("gemini-flash-latest", { input: 0, output: 1_000_000, thoughts: 0, cached: 0 }, BEFORE);
  const hidden = costOfTokens("gemini-flash-latest", { input: 0, output: 0, thoughts: 1_000_000, cached: 0 }, BEFORE);
  assert.equal(hidden, visible, "invisible is not free");
  assert.equal(visible, 3.75);
});

run("super mode is priced as Pro, not as Flash", () => {
  const bundle = { input: 1_000_000, output: 0, thoughts: 0, cached: 0 };
  const flash = costOfTokens("gemini-flash-latest", bundle, BEFORE);
  const pro = costOfTokens("gemini-pro-latest", bundle, BEFORE);
  assert.ok(pro > flash * 3, `Pro should cost several times Flash, got ${pro} vs ${flash}`);
  // Firestore keys cannot hold dots, so the stored key is "gemini-3_7-flash" — the route converts
  // back before pricing, and an unrecognised model must fall to Flash rather than to zero.
  assert.equal(costOfTokens("gemini-3.7-flash", bundle, BEFORE), flash);
  assert.equal(costOfTokens("something-new", bundle, BEFORE), flash, "unknown model is never free");
});

run("January 2027 doubles Google, and Flash-Lite is untouched", () => {
  assert.equal(ratesFor("gemini-flash-latest", BEFORE).input, 0.75);
  assert.equal(ratesFor("gemini-flash-latest", AFTER).input, 1.5, "intro pricing ends");
  assert.equal(ratesFor("gemini-pro-latest", AFTER).input, 5);
  assert.equal(ratesFor("gemini-3.1-flash-lite", BEFORE).input, ratesFor("gemini-3.1-flash-lite", AFTER).input, "no rise scheduled for Lite");
  assert.equal(INTRO_PRICING_ENDS.getUTCFullYear(), 2027);
});

const row = (over: Partial<ClinicCostRow> = {}): ClinicCostRow => ({
  clinicId: "c1",
  clinicName: "Alpha Dental",
  tier: "Premium",
  status: "Active",
  monthlyRevenueEgp: 833,
  creditsUsed: 800,
  creditLimit: 1800,
  aiCostUsd: 4,
  aiMeasuredCalls: 800,
  whatsappBilledUsd: 0.17,
  sentByCategory: { utility: 40, marketing: 0, authentication: 0, service: 900 },
  whatsappEstimateUsd: 0.144,
  ...over,
});

run("margin is revenue minus what both suppliers actually charged", () => {
  const m = marginFor(row(), 48);
  assert.equal(m.totalCostUsd, 4.17, "Meta's own figure wins over our estimate");
  assert.equal(m.totalCostEgp, 200.16);
  assert.equal(m.marginEgp, 632.84);
  assert.ok(m.costRatio !== null && Math.abs(m.costRatio - 200.16 / 833) < 1e-9);
});

run("our estimate is used only until Meta reports", () => {
  const m = marginFor(row({ whatsappBilledUsd: null }), 48);
  assert.equal(m.totalCostUsd, 4.144, "falls back to the estimate rather than to zero");
});

run("a clinic paying nothing has no ratio, and is not counted as over the ceiling", () => {
  const trial = marginFor(row({ monthlyRevenueEgp: 0, status: "Trial" }), 48);
  assert.equal(trial.costRatio, null, "dividing by nothing is not a 100% cost, it is unknown");
  assert.deepEqual(overCeiling([trial]), [], "a trial is not a mispriced plan");
});

run("the clinics that cost the most come first, and the ceiling is what flags them", () => {
  const cheap = marginFor(row({ clinicId: "a", clinicName: "Cheap", aiCostUsd: 0.5 }), 48);
  const dear = marginFor(row({ clinicId: "b", clinicName: "Dear", aiCostUsd: 9 }), 48);
  assert.deepEqual(rankByCost([cheap, dear]).map((r) => r.clinicName), ["Dear", "Cheap"]);

  assert.equal(COST_RATIO_CEILING, 0.15, "the stated rule for this product");
  assert.deepEqual(overCeiling([cheap, dear]).map((r) => r.clinicName), ["Dear"]);
  assert.ok(cheap.costRatio !== null && cheap.costRatio < COST_RATIO_CEILING);
});

run("platform totals add up and survive an empty platform", () => {
  const t = platformTotals([marginFor(row(), 48), marginFor(row({ clinicId: "b", monthlyRevenueEgp: 417, aiCostUsd: 1 }), 48)]);
  assert.equal(t.clinics, 2);
  assert.equal(t.revenueEgp, 1250);
  assert.equal(Math.round(t.marginEgp), Math.round(1250 - t.costEgp));

  const empty = platformTotals([]);
  assert.equal(empty.clinics, 0);
  assert.equal(empty.costRatio, null, "no clinics is not a zero-percent cost");
});

run("nothing a clinic can open imports the platform's cost model", () => {
  /*
   * The guard that matters. `platformCost` and the route that serves it are the margin; a clinic
   * is sold credits. This walks the source tree and fails if anything outside the superadmin area
   * imports either — which is how a leak would actually happen: a shared component, a helper
   * pulled in "just for the types".
   */
  const allowed = [
    path.join("src", "components", "superadmin"),
    path.join("src", "app", "superadmin"),
    path.join("src", "app", "api", "admin", "platform-costs"),
    path.join("src", "lib", "platformCost.ts"),
  ];
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const rel = path.relative(process.cwd(), full);
      if (allowed.some((a) => rel.startsWith(a))) continue;
      const src = fs.readFileSync(full, "utf8");
      if (/from ["']@\/lib\/platformCost["']/.test(src) || /platform-costs/.test(src)) offenders.push(rel);
    }
  };
  walk(path.join(process.cwd(), "src"));
  assert.deepEqual(offenders, [], `these reach the platform's cost data from outside superadmin: ${offenders.join(", ")}`);
});

run("and no clinic-facing screen shows a supplier price", () => {
  // The settings panel a clinic opens must talk in credits, never in dollars or pounds of cost.
  const settings = fs.readFileSync(path.join(process.cwd(), "src/components/settings/AiCreditsSettings.tsx"), "utf8");
  assert.ok(!/whatsappCost|WhatsappCostCard|platformCost/.test(settings), "the clinic's AI panel must not import a cost module");
});
