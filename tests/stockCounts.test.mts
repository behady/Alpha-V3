// Count by count: what one "Save count" leaves behind, and how two counts are compared.
import assert from "node:assert/strict";
import { buildCountSave, compareCounts, gapLabel, type CountStep } from "../src/lib/stock/counts";
import type { StockDrawer, StockLine, StockSnapshot } from "../src/lib/stock/types";

const drawer = (id: string, code: string): StockDrawer => ({
  id, code, roomCode: "R1", roomEn: "Room 1", roomAr: "غرفة 1", cabinetLetter: "A", cabinetWhere: "", kind: "drawer", number: 1, nameEn: code, nameAr: code, photoUrl: null, tracked: false, order: 1,
});
const line = (variantId: string, drawerId: string, qty: number): StockLine => ({ id: `${variantId}__${drawerId}`, variantId, itemId: "i", drawerId, qty });
const snap = (lines: StockLine[], counts = 1): StockSnapshot => ({
  drawers: [drawer("d1", "R1-A1"), drawer("d2", "R1-A2")], items: [], variants: [], lines,
  counts: Array.from({ length: counts }, (_, k) => ({ id: `c${k}`, date: "2026-11-01", byName: "", snapshot: {}, changed: 0 })),
  deliveries: [], uses: [], suppliers: [],
});
const row = (rows: ReturnType<typeof compareCounts>, id: string) => rows.find((r) => r.variantId === id)!;

// --- what one save records ---------------------------------------------------------------------
// A drawer saved from its own page: every row in that drawer was counted, touched or not.
let rec = buildCountSave({ scope: "d1", values: { a__d1: 2 } }, snap([line("a", "d1", 5), line("b", "d1", 4), line("a", "d2", 9)]), snap([line("a", "d1", 2), line("b", "d1", 4), line("a", "d2", 9)]))!;
assert.deepEqual([rec.whole, rec.counted, rec.changed, rec.drawerCodes, rec.firstEver], [false, 2, 1, ["R1-A1"], false]);
assert.deepEqual([rec.before["a__d1"], rec.snapshot["a__d1"], rec.snapshot["a__d2"]], [5, 2, 9]);
assert.deepEqual(rec.countedIds.sort(), ["a__d1", "b__d1"]);
// The walk of the whole cupboard.
rec = buildCountSave({ scope: "all", values: {} }, snap([line("a", "d1", 5), line("a", "d2", 9)], 0), snap([line("a", "d1", 5), line("a", "d2", 9)], 0))!;
assert.deepEqual([rec.whole, rec.counted, rec.changed, rec.drawerCodes, rec.firstEver], [true, 2, 0, [], true]);
// An older screen that sends no scope: only the rows it sent a number for.
rec = buildCountSave({ values: { a__d2: 7, ghost__d9: 1 } }, snap([line("a", "d1", 5), line("a", "d2", 9)]), snap([line("a", "d1", 5), line("a", "d2", 7)]))!;
assert.deepEqual([rec.counted, rec.drawerCodes], [1, ["R1-A2"]]);
// Nothing counted at all leaves nothing.
assert.equal(buildCountSave({ values: {} }, snap([line("a", "d1", 5)]), snap([line("a", "d1", 5)])), null);

// --- two counts side by side -------------------------------------------------------------------
const morning: CountStep = { before: { a__d1: 0, b__d1: 0 }, snapshot: { a__d1: 10, b__d1: 6 }, firstEver: true, whole: true };
// By the evening: 4 of A were delivered (system held 14), 9 were counted → 5 used. B untouched.
const evening: CountStep = { before: { a__d1: 14, b__d1: 6 }, snapshot: { a__d1: 9, b__d1: 6 }, countedIds: ["a__d1"] };
let rows = compareCounts(morning, [evening]);
assert.deepEqual([row(rows, "a").last, row(rows, "a").moved, row(rows, "a").expected, row(rows, "a").counted, row(rows, "a").used, row(rows, "a").inCount], [10, 4, 14, 9, 5, true]);
assert.deepEqual([row(rows, "b").moved, row(rows, "b").used, row(rows, "b").inCount], [0, 0, false]);
for (const r of rows) assert.equal((r.last ?? 0) + r.moved - r.used, r.counted); // the identity the screen prints

// The first count ever is a starting point: nothing "used", nothing "found".
rows = compareCounts(null, [morning]);
assert.deepEqual([row(rows, "a").last, row(rows, "a").used, row(rows, "a").counted, row(rows, "a").expected], [null, 0, 10, 10]);
// A first separate record at a clinic that had counted before: against what the system held.
rows = compareCounts(null, [{ before: { a__d1: 8 }, snapshot: { a__d1: 6 }, firstEver: false, whole: true }]);
assert.deepEqual([row(rows, "a").last, row(rows, "a").expected, row(rows, "a").used], [null, 8, 2]);

// A box moved from one drawer to another between two counts is not "used".
rows = compareCounts({ before: null, snapshot: { a__d1: 6, a__d2: 0 } }, [{ before: { a__d1: 2, a__d2: 4 }, snapshot: { a__d1: 2, a__d2: 4 }, whole: true }]);
assert.deepEqual([row(rows, "a").moved, row(rows, "a").used, row(rows, "a").drawerIds.sort()], [0, 0, ["d1", "d2"]]);

// A row deleted with stock in it (a write-off) shows as "out", not as used.
rows = compareCounts({ before: null, snapshot: { a__d1: 3 } }, [{ before: {}, snapshot: {}, whole: true }]);
assert.deepEqual([row(rows, "a").last, row(rows, "a").moved, row(rows, "a").used, row(rows, "a").counted], [3, -3, 0, 0]);

// More found than the records expected reads as negative use ("extra").
rows = compareCounts({ before: null, snapshot: { a__d1: 3 } }, [{ before: { a__d1: 3 }, snapshot: { a__d1: 5 }, whole: true }]);
assert.equal(row(rows, "a").used, -2);

// Across a long gap every count in between is added up: 10 → (−3) 7 → (+5 delivered, −4) 8.
rows = compareCounts(morning, [
  { before: { a__d1: 10, b__d1: 6 }, snapshot: { a__d1: 7, b__d1: 6 }, whole: true },
  { before: { a__d1: 12, b__d1: 6 }, snapshot: { a__d1: 8, b__d1: 5 }, whole: true },
]);
assert.deepEqual([row(rows, "a").last, row(rows, "a").moved, row(rows, "a").used, row(rows, "a").counted], [10, 5, 7, 8]);
assert.deepEqual([row(rows, "b").used, row(rows, "b").counted], [1, 5]);

// --- how far apart, in words ---------------------------------------------------------------------
const H = 3600000;
assert.equal(gapLabel(0, 20 * 60000, false), "20 min");
assert.equal(gapLabel(0, 3 * H + 20 * 60000, false), "3 h 20 min");
assert.equal(gapLabel(0, 7 * 24 * H, false), "7 days");
assert.equal(gapLabel(0, 26 * H, false), "1 day 2 h");
assert.equal(gapLabel(0, 20000, false), "under a minute");
assert.equal(gapLabel(0, 26 * H, true), "1 يوم و2 ساعة");

console.log("stockCounts: all assertions passed");
