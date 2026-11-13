/**
 * The Pro brain's plumbing at the live reply path: the draft layer reaches it only from the test
 * chat, and the clinic layer is read live or draft as asked. (The brain switch was retired in
 * November 2026: the Pro brain is the one brain.)
 *
 * Run: npm run test:pro-wiring
 */
import assert from "node:assert/strict";
import { loadClinicLayerWith, type LayerReader } from "../src/lib/botPro/proContext";
import { readFileSync } from "node:fs";

async function test(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`ok - ${name}`);
}

const source = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

await test("the draft layer reaches the brain only in a dry run, and only when the test chat asks", async () => {
  const respond = source("src/lib/bot/respond.ts");
  assert.ok(respond.includes("args.dryRun && args.proLayer"), "respond.ts gates proLayer on dryRun");
  const route = source("src/app/api/admin/bot-playground/route.ts");
  assert.match(route, /body\.proLayer\s*===\s*"draft"/);
  assert.match(route, /proLayer:\s*"draft"\s*as const/);
  const ui = source("src/components/settings/BotPlayground.tsx");
  assert.match(ui, /proLayer:\s*"draft"/);
  assert.match(ui, /useDraft\s*\?/);
  assert.ok(ui.includes("Use the draft layer") && ui.includes("جرّب القواعد الجديدة (المسودة)"));
  // Production code never asks for the draft.
  const answer = source("src/lib/botPro/proContext.ts");
  assert.match(answer, /args\.proLayer === "draft" \? "draft" : "live"/);
});

const layerDoc = { rules: ["اقفل بعرض كشف"], neverSay: ["ارخص عيادة"] };

function reader(docs: { state?: unknown; versions?: Record<string, unknown> }, spy: { asked: string[] } = { asked: [] }): LayerReader {
  return {
    async state() {
      spy.asked.push("state");
      return docs.state;
    },
    async version(id) {
      spy.asked.push(`version:${id}`);
      return docs.versions?.[id];
    },
  };
}

await test("loadClinicLayer: live reads the live version's layer, draft reads the state's draft, both sanitised", async () => {
  const spy = { asked: [] as string[] };
  const docs = { state: { liveVersion: "v1", draft: { rules: ["مسودة"] } }, versions: { v1: { layer: layerDoc } } };
  const live = await loadClinicLayerWith(reader(docs, spy), "live");
  assert.deepEqual(live?.rules, ["اقفل بعرض كشف"]);
  assert.deepEqual(live?.neverSay, ["ارخص عيادة"]);
  assert.deepEqual(spy.asked, ["state", "version:v1"]);
  const draft = await loadClinicLayerWith(reader(docs), "draft");
  assert.deepEqual(draft?.rules, ["مسودة"]);
  // A price sneaked into a hand-edited doc is dropped on the way in.
  const dirty = await loadClinicLayerWith(reader({ state: { liveVersion: "v1" }, versions: { v1: { layer: { rules: ["الكشف بـ 300 جنيه", "كن ودودا"] } } } }), "live");
  assert.deepEqual(dirty?.rules, ["كن ودودا"]);
});

await test("loadClinicLayer: nothing live, a missing doc or a thrown read gives null (the reply is unchanged)", async () => {
  assert.equal(await loadClinicLayerWith(reader({ state: { liveVersion: null } }), "live"), null);
  assert.equal(await loadClinicLayerWith(reader({ state: undefined }), "live"), null);
  assert.equal(await loadClinicLayerWith(reader({ state: undefined }), "draft"), null);
  assert.equal(await loadClinicLayerWith(reader({ state: { liveVersion: "v9" }, versions: {} }), "live"), null);
  assert.equal(await loadClinicLayerWith(reader({ state: { liveVersion: "v1" }, versions: { v1: { layer: "garbage" } } }), "live"), null);
  const boom: LayerReader = {
    async state() {
      throw new Error("firestore down");
    },
    async version() {
      throw new Error("firestore down");
    },
  };
  assert.equal(await loadClinicLayerWith(boom, "live"), null);
  assert.equal(await loadClinicLayerWith(boom, "draft"), null);
  const boomVersion: LayerReader = { state: async () => ({ liveVersion: "v1" }), version: async () => { throw new Error("x"); } };
  assert.equal(await loadClinicLayerWith(boomVersion, "live"), null);
});
