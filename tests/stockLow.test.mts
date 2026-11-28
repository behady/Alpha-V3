// The low-stock rule: a brand is low when everything the clinic holds of it, across all drawers,
// is at or under its warning level — 1 unless somebody chose another number. The alert goes out
// once, on the save that takes it from above the level to at or under it.
import assert from "node:assert/strict";
import { DEFAULT_WARN_AT, lowAlertText, lowCrossings, lowRows, warnAtOf } from "../src/lib/stock/low";
import type { StockLine, StockVariant } from "../src/lib/stock/types";

const variant = (id: string, itemId: string, extra: Partial<StockVariant> = {}): StockVariant => ({ id, itemId, brand: "", product: "", spec: "", barcode: null, photoUrl: null, supplier: null, lastPrice: null, isGeneric: true, ...extra });
const line = (variantId: string, itemId: string, drawerId: string, qty: number): StockLine => ({ id: `${variantId}__${drawerId}`, variantId, itemId, drawerId, qty });

// --- the level ---------------------------------------------------------------------------------
assert.equal(DEFAULT_WARN_AT, 1);
assert.equal(warnAtOf(undefined), 1);
assert.equal(warnAtOf(variant("v", "i")), 1, "a record saved before this existed warns at 1");
assert.equal(warnAtOf(variant("v", "i", { warnAt: null })), 1);
assert.equal(warnAtOf(variant("v", "i", { warnAt: 5 })), 5);
assert.equal(warnAtOf(variant("v", "i", { warnAt: 0 })), 0, "0 is a real answer: warn only when it is finished");
assert.equal(warnAtOf(variant("v", "i", { warnAt: -3 })), 1);
assert.equal(warnAtOf(variant("v", "i", { warnAt: Number.NaN })), 1);

// --- what is low now -----------------------------------------------------------------------------
{
  const variants = [variant("paper", "paper"), variant("gloves", "gloves"), variant("masks", "masks", { warnAt: 4 })];
  const lines = [line("paper", "paper", "d1", 1), line("gloves", "gloves", "d1", 2), line("masks", "masks", "d1", 4)];
  const low = lowRows({ variants, lines });
  assert.deepEqual(low.map((r) => r.variantId).sort(), ["masks", "paper"]);
  assert.equal(low.find((r) => r.variantId === "masks")?.warnAt, 4);
  assert.equal(low.find((r) => r.variantId === "paper")?.onHand, 1);
}
// one in the chair drawer and five in the store is six: not low
{
  const variants = [variant("gloves", "gloves")];
  const lines = [line("gloves", "gloves", "chair", 1), line("gloves", "gloves", "store", 5)];
  assert.equal(lowRows({ variants, lines }).length, 0);
  const one = lowRows({ variants, lines: [line("gloves", "gloves", "chair", 1), line("gloves", "gloves", "store", 0)] });
  assert.equal(one.length, 1);
  assert.deepEqual(one[0].drawerIds.sort(), ["chair", "store"]);
}
// a brand with no row in any drawer has no home, so there is nothing to warn about
assert.equal(lowRows({ variants: [variant("ghost", "ghost")], lines: [] }).length, 0);
// each shade is its own level: A2 finished while A3 is full still warns
{
  const variants = [variant("a2", "comp", { isGeneric: false, brand: "3M", spec: "A2" }), variant("a3", "comp", { isGeneric: false, brand: "3M", spec: "A3" })];
  const lines = [line("a2", "comp", "d1", 0), line("a3", "comp", "d1", 6)];
  assert.deepEqual(lowRows({ variants, lines }).map((r) => r.variantId), ["a2"]);
}
// the brandless placeholder row, empty, beside a real brand of the same item: not a warning
{
  const variants = [variant("generic", "comp"), variant("a2", "comp", { isGeneric: false, brand: "3M", spec: "A2" })];
  const lines = [line("generic", "comp", "d1", 0), line("a2", "comp", "d1", 6)];
  assert.equal(lowRows({ variants, lines }).length, 0);
  // …but the placeholder alone, empty, is the item itself being finished
  assert.equal(lowRows({ variants: [variants[0]], lines: [lines[0]] }).length, 1);
  // …and a placeholder that still holds something is counted like any row
  assert.equal(lowRows({ variants, lines: [line("generic", "comp", "d1", 1), lines[1]] }).length, 1);
}

// --- the moment it becomes low ---------------------------------------------------------------
{
  const variants = [variant("paper", "paper"), variant("gloves", "gloves")];
  const before = { variants, lines: [line("paper", "paper", "d1", 3), line("gloves", "gloves", "d1", 1)] };
  // 3 → 1 crosses; gloves were already low and stay quiet
  const after = { variants, lines: [line("paper", "paper", "d1", 1), line("gloves", "gloves", "d1", 0)] };
  assert.deepEqual(lowCrossings(before, after).map((r) => r.variantId), ["paper"]);
  // 3 → 2 is not low yet
  assert.equal(lowCrossings(before, { variants, lines: [line("paper", "paper", "d1", 2), line("gloves", "gloves", "d1", 1)] }).length, 0);
  // topped up and dipped again: warns again
  const topped = { variants, lines: [line("paper", "paper", "d1", 6), line("gloves", "gloves", "d1", 6)] };
  assert.equal(lowCrossings(topped, after).length, 2);
}
// a row added empty during setup was never above its level: no alert
{
  const variants = [variant("new", "new")];
  assert.equal(lowCrossings({ variants: [], lines: [] }, { variants, lines: [line("new", "new", "d1", 0)] }).length, 0);
  assert.equal(lowCrossings({ variants, lines: [] }, { variants, lines: [line("new", "new", "d1", 1)] }).length, 0);
}
// carrying a box to another drawer changes nothing in total: no alert
{
  const variants = [variant("gloves", "gloves")];
  const before = { variants, lines: [line("gloves", "gloves", "store", 3)] };
  const after = { variants, lines: [line("gloves", "gloves", "chair", 3)] };
  assert.equal(lowCrossings(before, after).length, 0);
}
// raising the level on a brand does not send an alert by itself: the person is looking at it
{
  const before = { variants: [variant("gloves", "gloves")], lines: [line("gloves", "gloves", "d1", 3)] };
  const after = { variants: [variant("gloves", "gloves", { warnAt: 5 })], lines: [line("gloves", "gloves", "d1", 3)] };
  assert.equal(lowCrossings(before, after).length, 0);
  assert.equal(lowRows(after).length, 1, "it is shown as low on the screen all the same");
}
// a row deleted from its only drawer leaves nothing to warn about
{
  const variants = [variant("gloves", "gloves")];
  assert.equal(lowCrossings({ variants, lines: [line("gloves", "gloves", "d1", 3)] }, { variants, lines: [] }).length, 0);
}

// --- the words ---------------------------------------------------------------------------------
{
  const one = lowAlertText([{ name: "ورق عضة", onHand: 1, unit: "علبة", codes: ["R1-A2"] }], "ar");
  assert.equal(one.title, "حاجة قربت تخلص");
  assert.ok(one.body.includes("ورق عضة") && one.body.includes("1") && one.body.includes("R1-A2"));
  assert.ok(one.whatsappText.startsWith("*"), "the WhatsApp message opens with a bold heading");

  const en = lowAlertText([{ name: "Gloves", onHand: 0, unit: "boxes", codes: ["C1-A1", "ST-A2"] }], "en");
  assert.equal(en.title, "Running low");
  assert.ok(/finished/i.test(en.body), "nothing left reads as finished, not as 0 left");
  assert.ok(en.body.includes("C1-A1") && en.body.includes("ST-A2"));

  // several at once are one message, and a long list is cut with a count of the rest
  const many = lowAlertText(Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i + 1}`, onHand: 1, unit: "box", codes: ["A1"] })), "en");
  assert.ok(many.body.startsWith("25 "));
  assert.equal(many.whatsappText.split("\n").filter((l) => l.startsWith("•")).length, 20);
  assert.ok(many.whatsappText.includes("5 more"));
  assert.ok(many.body.length <= 400);
}

console.log("stock low: ok");
