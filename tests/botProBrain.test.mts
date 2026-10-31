/**
 * The WhatsApp Pro AI switch: a clinic's replies go to the Pro brain only when it chose "pro",
 * the whatsappPro add-on is unlocked for it, and the clinic is in AI-first mode. Everything else
 * is the standard brain. The add-on itself is off on every tier.
 *
 * Run: npm run test:pro-brain
 */
import assert from "node:assert/strict";
import { aiBrainOf } from "../src/lib/botPro/brain";
import { TIER_LIMITS } from "../src/lib/subscriptions";

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok - ${name}`);
}

test("pro only when chosen, unlocked and AI-first", () => {
  assert.equal(aiBrainOf({ botAiBrain: "pro", botMode: "ai_first" }, true), "pro");
  assert.equal(aiBrainOf({ botAiBrain: "pro", botMode: "ai_first" }, false), "standard");
  assert.equal(aiBrainOf({ botAiBrain: "pro", botMode: "assisted" }, true), "standard");
  assert.equal(aiBrainOf({ botMode: "ai_first" }, true), "standard");
  assert.equal(aiBrainOf({ botAiBrain: "PRO", botMode: "ai_first" }, true), "standard");
});

test("whatsappPro is off on every tier", () => {
  for (const tier of Object.values(TIER_LIMITS)) assert.equal(tier.features.whatsappPro, false);
});
