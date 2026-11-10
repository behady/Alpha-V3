// Usage is arithmetic, not memory: previous count + deliveries − this count. These tests pin the
// three places that arithmetic can go wrong — a delivery on count day, a line that did not exist
// at the earlier count, and a count that finds MORE than expected.
import assert from "node:assert/strict";
import { lineUsage, usageByItem, paceByItem, shoppingList, variance, matches, normaliseBarcode } from "../src/lib/stock/math";
import type { StockCount, StockDelivery, StockItem, StockLine, StockVariant } from "../src/lib/stock/types";

const item: StockItem = { id: "flow", nameEn: "Flowable", nameAr: "فلو", unit: "syringe", per: "2 g", shape: "syringe", tracked: false, catalogKey: "flow", photoUrl: null };
const v1: StockVariant = { id: "v1", itemId: "flow", brand: "3M", product: "Filtek Flow", spec: "A2", barcode: null, photoUrl: null, supplier: "DentaCarts", lastPrice: 600, isGeneric: false };
const v2: StockVariant = { id: "v2", itemId: "flow", brand: "Ivoclar", product: "Tetric Flow", spec: "A2", barcode: null, photoUrl: null, supplier: "Nile Dental", lastPrice: 550, isGeneric: false };
const l1: StockLine = { id: "v1__d1", variantId: "v1", itemId: "flow", drawerId: "d1", qty: 1 };
const l2: StockLine = { id: "v2__d1", variantId: "v2", itemId: "flow", drawerId: "d1", qty: 2 };
const count = (date: string, snap: Record<string, number>): StockCount => ({ id: date, date, byName: "A", snapshot: snap, changed: 0 });
const deliv = (date: string, variantId: string, qty: number, price: number): StockDelivery => ({ id: date + variantId, date, supplier: "DentaCarts", invoiceUrl: null, lines: [{ variantId, drawerId: "d1", qty, price }], total: qty * price, ledgerId: null, byName: "A" });

// 3 last week, 2 delivered, 1 now → 4 used
assert.equal(lineUsage(count("2026-11-05", { v1__d1: 3 }), count("2026-11-12", { v1__d1: 1 }), l1, [deliv("2026-11-09", "v1", 2, 620)]), 4);
// delivery ON count day belongs to that week
assert.equal(lineUsage(count("2026-11-05", { v1__d1: 3 }), count("2026-11-12", { v1__d1: 3 }), l1, [deliv("2026-11-12", "v1", 2, 620)]), 2);
// delivery on the EARLIER count day belongs to the previous week, not this one
assert.equal(lineUsage(count("2026-11-05", { v1__d1: 3 }), count("2026-11-12", { v1__d1: 3 }), l1, [deliv("2026-11-05", "v1", 2, 620)]), 0);
// a line absent from the earlier snapshot starts at zero
assert.equal(lineUsage(count("2026-11-05", {}), count("2026-11-12", { v1__d1: 1 }), l1, [deliv("2026-11-09", "v1", 3, 620)]), 2);
// more found than expected reads as zero, never negative
assert.equal(lineUsage(count("2026-11-05", { v1__d1: 1 }), count("2026-11-12", { v1__d1: 4 }), l1, []), 0);

// usage rolls up across brands and prices each brand at its own last delivery price
const counts = [count("2026-10-29", { v1__d1: 3, v2__d1: 3 }), count("2026-11-05", { v1__d1: 2, v2__d1: 2 }), count("2026-11-12", { v1__d1: 1, v2__d1: 2 })];
const rows = usageByItem({ items: [item], variants: [v1, v2], lines: [l1, l2], counts, deliveries: [deliv("2026-11-02", "v2", 1, 500)], weeks: 2 });
assert.equal(rows.length, 1);
assert.deepEqual(rows[0].perWeek, [3, 1]); // week 1: v1 1 + v2 (3+1−2)=2 → 3; week 2: v1 1 + v2 0
assert.equal(rows[0].used, 4);
assert.equal(rows[0].cost, 2 * 600 + 2 * 500); // v1 at its lastPrice (never delivered), v2 at delivered 500

// pace = average of last three intervals; days left from on hand
const pace = paceByItem({ items: [item], lines: [l1, l2], counts, deliveries: [deliv("2026-11-02", "v2", 1, 500)] });
assert.equal(pace[0].onHand, 3);
assert.equal(pace[0].pace, 2); // (3 + 1) / 2 intervals
assert.equal(Math.round(pace[0].daysLeft!), 11); // 3 / (2/7) = 10.5

// shopping list: under 14 days → order four weeks minus on hand, from the last-bought brand
const shop = shoppingList({ pace, variants: [v1, v2], lines: [l1, l2], deliveries: [deliv("2026-11-02", "v2", 1, 500)] });
assert.equal(shop.length, 1);
assert.equal(shop[0].variant?.id, "v2");
assert.equal(shop[0].need, 5); // ceil(2*4 − 3)
assert.equal(shop[0].supplier, "Nile Dental");

// tracked items that are not used by anyone → no pace, no shopping line
const tracked: StockItem = { ...item, id: "imp", tracked: true };
assert.equal(paceByItem({ items: [tracked], lines: [], counts, deliveries: [] }).length, 0);

// variance: start 6, delivered 4, now 5 → 5 gone; 4 on patients → gap 1
const lineImp: StockLine = { id: "vi__d2", variantId: "vi", itemId: "imp", drawerId: "d2", qty: 5 };
const vr = variance({
  lines: [lineImp],
  counts: [count("2026-09-17", { vi__d2: 6 }), count("2026-11-05", { vi__d2: 5 })],
  deliveries: [{ id: "x", date: "2026-10-05", supplier: "Alldent", invoiceUrl: null, lines: [{ variantId: "vi", drawerId: "d2", qty: 4, price: 3200 }], total: 12800, ledgerId: null, byName: "A" }],
  uses: ["2026-09-21", "2026-10-06", "2026-10-13", "2026-10-27"].map((d, i) => ({ id: String(i), date: d, variantId: "vi", drawerId: "d2", patientId: null, patientName: "P", lot: "L", byName: "A" })),
  trackedItemIds: new Set(["imp"]),
});
assert.equal(vr[0].gone, 5);
assert.equal(vr[0].usedOnPatients, 4);
assert.equal(vr[0].gap, 1);

// search: Arabic hamza/taa-marbuta forms and multi-word queries
assert.ok(matches(["Articaine carpules", "بنج أرتيكايين"], "ارتيك"));
assert.ok(matches(["Flowable composite", "فلو", "شرم فلو flow"], "شرم فلو"));
assert.ok(!matches(["Gloves", "جلافز"], "بنج"));

// barcodes: the striped code and the square GS1 code on one box must find the same product
assert.equal(normaliseBarcode(" 4046719000036 "), "4046719000036");
assert.equal(normaliseBarcode("010404671900003617251231" + "10ABC123"), "4046719000036");
assert.equal(normaliseBarcode("]d2010404671900003617251231" + String.fromCharCode(29) + "10LOT9"), "4046719000036");
assert.equal(normaliseBarcode("(01)04046719000036(17)251231(10)ABC"), "4046719000036");
assert.equal(normaliseBarcode("0110885403123456"), "10885403123456"); // a true 14-digit GTIN keeps all 14
assert.equal(normaliseBarcode("0123456789012"), "0123456789012"); // a 13-digit code that merely starts with 01
assert.equal(normaliseBarcode("https://example.com/p/1"), "https://example.com/p/1");

console.log("stockMath: all assertions passed");
