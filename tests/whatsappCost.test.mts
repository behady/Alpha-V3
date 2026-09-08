import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CATEGORY_FOR_TEMPLATE_KIND,
  EGYPT_RATES_USD,
  categoryForTemplateKind,
  estimateMessageCostUsd,
  estimateMonthUsd,
  usdToEgp,
} from "../src/lib/whatsappCost";

/**
 * The WhatsApp bill.
 *
 * Two things are worth a test here. The first is that the assistant's replies are free — the
 * whole reason this module exists is that everyone assumes the opposite, and a rate table that
 * quietly starts charging for bot replies would put an invented cost in front of a clinic.
 *
 * The second is that the category this code believes a template has still matches the category
 * it was REGISTERED with at Meta. Price follows Meta's approved category, not ours, and the two
 * drifting apart is silent: the bill changes, the code does not.
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

run("the assistant's replies are free, and so is every free-form message", () => {
  for (const kind of [null, undefined, "", "   "]) {
    assert.equal(estimateMessageCostUsd(kind), 0, `free-form should cost nothing, got ${estimateMessageCostUsd(kind)}`);
    assert.equal(categoryForTemplateKind(kind), "service");
  }
  assert.equal(EGYPT_RATES_USD.service, 0, "service messages have been free since Nov 2024");
});

run("a reminder is a utility message; a recall is marketing and costs ~18x more", () => {
  assert.equal(categoryForTemplateKind("reminder24h"), "utility");
  assert.equal(estimateMessageCostUsd("reminder24h"), 0.0036);
  assert.equal(categoryForTemplateKind("recall"), "marketing");
  assert.equal(estimateMessageCostUsd("recall"), 0.064);
  assert.ok(
    estimateMessageCostUsd("recall") / estimateMessageCostUsd("reminder24h") > 15,
    "the gap between the categories is the point: it must stay visible"
  );
});

run("an unknown template is priced as the expensive kind, never as free", () => {
  const cost = estimateMessageCostUsd("some_template_added_later");
  assert.equal(cost, EGYPT_RATES_USD.marketing, "overstate rather than hide a new template's cost");
  assert.ok(cost > 0);
});

run("every template kind the sender can use has a category", async () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/metaWhatsapp.ts"), "utf8");
  const block = src.slice(src.indexOf("export const META_TEMPLATE_FOR_KIND"));
  const kinds = [...block.slice(0, block.indexOf("};")).matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\{/gm)].map((m) => m[1]);
  assert.ok(kinds.length >= 8, `expected the sender's template map, found ${kinds.length} kinds`);
  for (const kind of kinds) {
    assert.ok(kind in CATEGORY_FOR_TEMPLATE_KIND, `template kind "${kind}" has no category — it would be billed as marketing`);
  }
});

run("our categories match what was actually registered with Meta", () => {
  const templates = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/meta-templates.json"), "utf8")) as Array<{ name: string; category: string }>;
  const registered = new Map(templates.map((t) => [t.name, String(t.category || "").toLowerCase()]));

  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/metaWhatsapp.ts"), "utf8");
  const block = src.slice(src.indexOf("export const META_TEMPLATE_FOR_KIND"));
  const pairs = [...block.slice(0, block.indexOf("};")).matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\{\s*name:\s*"([^"]+)"/gm)];
  assert.ok(pairs.length >= 8, "could not read the kind -> template name map");

  for (const [, kind, templateName] of pairs) {
    const metaCategory = registered.get(templateName);
    if (!metaCategory) continue; // registered elsewhere; nothing to compare against
    assert.equal(
      CATEGORY_FOR_TEMPLATE_KIND[kind],
      metaCategory,
      `"${kind}" (${templateName}) is ${metaCategory} at Meta but ${CATEGORY_FOR_TEMPLATE_KIND[kind]} here — the bill would be wrong`
    );
  }
});

run("a month adds up, and free traffic adds nothing", () => {
  // A realistic month: mostly bot replies, a few reminders, one recall campaign.
  const month = { service: 900, utility: 120, marketing: 30, authentication: 0 };
  const expected = 120 * 0.0036 + 30 * 0.064;
  assert.equal(estimateMonthUsd(month), Math.round(expected * 10000) / 10000);

  assert.equal(estimateMonthUsd({ service: 5000 }), 0, "five thousand bot replies cost nothing");
  assert.equal(estimateMonthUsd({}), 0);
  assert.equal(estimateMonthUsd({ nonsense: 10 } as never), 0, "an unknown category is ignored, not guessed");
});

run("money is rounded the way it is billed, not left as float noise", () => {
  assert.equal(estimateMonthUsd({ utility: 3 }), 0.0108);
  assert.equal(usdToEgp(0.0864), 4.15);
  assert.equal(usdToEgp(1, 50), 50);
});

run("the measured day reproduces: 39 free replies billed nothing", () => {
  // From the clinic's own pricing_analytics on 2026-09-07: 39 sent, $0.00 billed.
  assert.equal(estimateMonthUsd({ service: 39 }), 0);
});
