/**
 * The add-on catalogue and the tier presets must describe the same set of switches.
 *
 * A key in TIER_LIMITS that the catalogue does not list cannot be switched on for any clinic from
 * the superadmin panel and has no name on the locked screen; a catalogue entry that TIER_LIMITS
 * does not know is a switch that does nothing. Both are silent in the browser, so they are
 * caught here.
 *
 * Run: npm run test:features
 */
import assert from "node:assert/strict";
import { FEATURE_CATALOG, isUnlocked, isAnyUnlocked, SUPPORT_WHATSAPP } from "../src/lib/featureCatalog";
import { TIER_LIMITS } from "../src/lib/subscriptions";
import type { Clinic } from "../src/types/saas";

const tierKeys = Object.keys(TIER_LIMITS.Basic.features).sort();
const catalogKeys = FEATURE_CATALOG.map((f) => f.key).sort();
assert.deepEqual(catalogKeys, tierKeys, "catalogue and TIER_LIMITS list different add-ons");

for (const tier of Object.keys(TIER_LIMITS) as (keyof typeof TIER_LIMITS)[]) {
  assert.deepEqual(Object.keys(TIER_LIMITS[tier].features).sort(), tierKeys, `${tier} preset is missing keys`);
}

for (const f of FEATURE_CATALOG) {
  assert.ok(f.labelEn && f.labelAr && f.descEn && f.descAr, `${f.key} needs both languages`);
  if (f.requires) assert.ok(tierKeys.includes(f.requires), `${f.key} requires unknown ${f.requires}`);
}

assert.match(SUPPORT_WHATSAPP, /^\+20\d{10}$/, "support number must be an Egyptian E.164 mobile");

const clinic = (tier: Clinic["subscriptionTier"], features?: Clinic["features"]): Clinic =>
  ({ id: "c", name: "c", ownerId: "o", subscriptionTier: tier, expiresAt: null, status: "Active", createdAt: null, features }) as Clinic;

// The two WhatsApp add-ons are independent: either one alone opens the inbox, neither implies the other.
assert.equal(isUnlocked(clinic("Basic", { whatsappBot: true }), "whatsappBot"), true);
assert.equal(isUnlocked(clinic("Basic", { whatsappBot: true }), "whatsappIntegration"), false);
assert.equal(isAnyUnlocked(clinic("Basic", { whatsappBot: true }), ["whatsappIntegration", "whatsappBot"]), true);
assert.equal(isAnyUnlocked(clinic("Basic"), ["whatsappIntegration", "whatsappBot"]), false);

// A dependent add-on is off while its parent is off, however its own switch is set.
assert.equal(isUnlocked(clinic("Basic", { marketingDesign: true }), "marketingDesign"), false);
assert.equal(isUnlocked(clinic("Basic", { marketingText: true, marketingDesign: true }), "marketingDesign"), true);

// An override wins over the tier in both directions.
assert.equal(isUnlocked(clinic("Premium", { lab: false }), "lab"), false);
assert.equal(isUnlocked(clinic("Basic", { lab: true }), "lab"), true);
assert.equal(isUnlocked(null, "lab"), false);

console.log("featureCatalog: ok");
