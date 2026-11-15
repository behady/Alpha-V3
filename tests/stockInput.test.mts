// What a person types is not always what a number box expects. These tests pin the slips a senior
// user made in the 2026-11-12 walkthrough: an Arabic keyboard, an emptied box, a half box, and a
// count interrupted halfway — none of them may quietly become a zero or a lost count.
import assert from "node:assert/strict";
import { parseCount, toAsciiDigits, readDraft, writeDraft, clearDraft, draftKey, deliveryWarnings, type DraftStore } from "../src/lib/stock/input";

// Arabic-Indic and Persian digits are numbers
assert.equal(toAsciiDigits("٥"), "5");
assert.equal(toAsciiDigits("١٢٣٤٥٦٧٨٩٠"), "1234567890");
assert.equal(toAsciiDigits("۱۲"), "12");
assert.equal(parseCount("٥"), 5);
assert.equal(parseCount("١٢"), 12);
assert.equal(parseCount("12"), 12);
assert.equal(parseCount(" 7 "), 7);

// an empty or unreadable box is "no answer", never zero
assert.equal(parseCount(""), null);
assert.equal(parseCount("   "), null);
assert.equal(parseCount("abc"), null);
assert.equal(parseCount("-"), null);
// a typed zero is a real zero
assert.equal(parseCount("0"), 0);
assert.equal(parseCount("٠"), 0);

// counts are whole boxes: a half box rounds down, in either script, with either decimal mark
assert.equal(parseCount("2.5"), 2);
assert.equal(parseCount("٢٫٥"), 2);
assert.equal(parseCount("2,5"), 2);
// prices keep their piastres
assert.equal(parseCount("650.50", { decimal: true }), 650.5);
assert.equal(parseCount("٦٥٠٫٥", { decimal: true }), 650.5);
// thousands typed with a separator still read as one number
assert.equal(parseCount("1,250", { decimal: true }), 1250);
assert.equal(parseCount("١٬٢٥٠", { decimal: true }), 1250);

// limits clamp instead of rejecting
assert.equal(parseCount("-3"), 0);
assert.equal(parseCount("0", { min: 1 }), 1);
assert.equal(parseCount("99", { max: 60 }), 60);

// --- unsaved counts survive leaving the page ---------------------------------------------------
function memoryStore(): DraftStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k), keys: () => [...map.keys()] };
}
const store = memoryStore();
const key = draftKey("clinicA", "walk");
assert.equal(readDraft(store, key, "2026-11-12"), null);
writeDraft(store, key, "2026-11-12", { values: { l1: 3, l2: 0 }, step: 4 });
assert.deepEqual(readDraft(store, key, "2026-11-12"), { values: { l1: 3, l2: 0 }, step: 4 });
// yesterday's half-finished count is not today's
assert.equal(readDraft(store, key, "2026-11-13"), null);
assert.equal(store.map.has(key), false, "a stale draft is removed when it is read");
// rows that no longer exist are dropped on the way back in
writeDraft(store, key, "2026-11-12", { values: { l1: 3, gone: 9 }, step: 2 });
assert.deepEqual(readDraft(store, key, "2026-11-12", new Set(["l1"])), { values: { l1: 3 }, step: 2 });
// nothing typed means nothing kept
writeDraft(store, key, "2026-11-12", { values: {}, step: 0 });
assert.equal(store.map.has(key), false);
// but a walk that has moved on with nothing changed is still remembered
writeDraft(store, key, "2026-11-12", { values: {}, step: 5 });
assert.deepEqual(readDraft(store, key, "2026-11-12"), { values: {}, step: 5 });
clearDraft(store, key);
assert.equal(readDraft(store, key, "2026-11-12"), null);
// another clinic, another drawer: separate drafts
assert.notEqual(draftKey("clinicA", "walk"), draftKey("clinicB", "walk"));
assert.notEqual(draftKey("clinicA", "drawer:d1"), draftKey("clinicA", "drawer:d2"));
// garbage in storage is not a draft
store.setItem(key, "{not json");
assert.equal(readDraft(store, key, "2026-11-12"), null);
// a broken store (private mode) never throws
const broken: DraftStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); }, keys: () => { throw new Error("blocked"); } };
assert.equal(readDraft(broken, key, "2026-11-12"), null);
assert.doesNotThrow(() => writeDraft(broken, key, "2026-11-12", { values: { l1: 1 }, step: 0 }));
assert.doesNotThrow(() => clearDraft(broken, key));

// --- what to say before a delivery is received ---------------------------------------------------
assert.deepEqual(deliveryWarnings([{ qty: 2, price: 100 }, { qty: 1, price: 50 }], "DentaCarts"), { noPrice: 0, noSupplier: false, total: 250, units: 3 });
assert.deepEqual(deliveryWarnings([{ qty: 2, price: 0 }, { qty: 1, price: 50 }], "  "), { noPrice: 1, noSupplier: true, total: 50, units: 3 });

console.log("stockInput: all assertions passed");
