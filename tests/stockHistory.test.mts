// The stock history is derived from "the cupboard before" and "the cupboard after". These tests
// pin what each kind of action turns into, and that every line carries the names as they were.
import assert from "node:assert/strict";
import { deriveEvents, describeEvent, EVENT_GROUP } from "../src/lib/stock/history";
import type { StockDrawer, StockEvent, StockEventDraft, StockItem, StockLine, StockSnapshot, StockVariant } from "../src/lib/stock/types";

const drawer = (id: string, code: string, over: Partial<StockDrawer> = {}): StockDrawer => ({
  id, code, roomCode: code.split("-")[0], roomEn: "Room 1", roomAr: "غرفة 1", cabinetLetter: "A", cabinetWhere: "", kind: "drawer", number: 1,
  nameEn: `Drawer ${code}`, nameAr: `درج ${code}`, photoUrl: null, tracked: false, order: 1, ...over,
});
const item: StockItem = { id: "flow", nameEn: "Flowable composite", nameAr: "فلو", unit: "syringe", per: "2 g", shape: "syringe", tracked: false, catalogKey: "flow", photoUrl: null };
const generic: StockVariant = { id: "g", itemId: "flow", brand: "", product: "Flowable composite", spec: "", barcode: null, photoUrl: null, supplier: null, lastPrice: null, isGeneric: true };
const brand3m: StockVariant = { id: "v3m", itemId: "flow", brand: "3M", product: "Filtek Flow", spec: "A2", barcode: "4046719000036", photoUrl: null, supplier: "DentaCarts", lastPrice: 620, isGeneric: false };
const line = (variantId: string, drawerId: string, qty: number): StockLine => ({ id: `${variantId}__${drawerId}`, variantId, itemId: "flow", drawerId, qty });
const snap = (over: Partial<StockSnapshot>): StockSnapshot => ({ drawers: [drawer("d1", "R1-A1"), drawer("d2", "R1-A2")], items: [item], variants: [generic, brand3m], lines: [], counts: [], deliveries: [], uses: [], suppliers: [], ...over });
const full = (d: StockEventDraft): StockEvent => ({ id: "x", atMs: 0, date: "2026-11-10", byUid: "u", byName: "Mona", byRole: "Assistant", ...d });

// --- a count: one line per row that changed, with before and after, and a summary -------------
let ev = deriveEvents("save-count", { date: "2026-11-12" }, snap({ lines: [line("v3m", "d1", 3), line("g", "d1", 2)] }), snap({ lines: [line("v3m", "d1", 1), line("g", "d1", 2)] }));
assert.equal(ev.length, 2);
assert.deepEqual([ev[0].type, ev[0].qtyBefore, ev[0].qtyAfter, ev[0].drawerCode, ev[0].brand, ev[0].itemAr], ["count", 3, 1, "R1-A1", "3M Filtek Flow A2", "فلو"]);
assert.deepEqual([ev[1].type, ev[1].n1, ev[1].n2], ["count-saved", 2, 1]);
assert.equal(describeEvent(full(ev[0]), false), "Counted Flowable composite · 3M Filtek Flow A2 in R1-A1: 3 → 1");
assert.equal(describeEvent(full(ev[0]), true), "عدّ فلو · 3M Filtek Flow A2 في R1-A1: 3 ← 1");

// a count where nothing moved still leaves the summary: "checked, nothing changed" is a fact too
ev = deriveEvents("save-count", {}, snap({ lines: [line("g", "d1", 2)] }), snap({ lines: [line("g", "d1", 2)] }));
assert.deepEqual(ev.map((e) => [e.type, e.n2]), [["count-saved", 0]]);

// --- a delivery: quantity, price and supplier per line, and the total --------------------------
const delivered = snap({ lines: [line("v3m", "d2", 5)], deliveries: [{ id: "D1", date: "2026-11-09", supplier: "DentaCarts", invoiceUrl: null, lines: [{ variantId: "v3m", drawerId: "d2", qty: 2, price: 640 }], total: 1280, ledgerId: "L", byName: "Mona" }] });
ev = deriveEvents("receive-delivery", {}, snap({ lines: [line("v3m", "d2", 3)] }), delivered, { deliveryId: "D1" });
assert.deepEqual([ev[0].type, ev[0].qty, ev[0].price, ev[0].supplier, ev[0].qtyAfter, ev[0].drawerCode], ["delivery", 2, 640, "DentaCarts", 5, "R1-A2"]);
assert.deepEqual([ev[1].type, ev[1].n1, ev[1].n2], ["delivery-received", 1, 1280]);
assert.match(describeEvent(full(ev[0]), false), /^Received 2 syringes of Flowable composite · 3M Filtek Flow A2 into R1-A2 at 640 EGP from DentaCarts$/);

// --- used on a patient: who, and the lot --------------------------------------------------------
ev = deriveEvents("use-on-patient", { variantId: "v3m", drawerId: "d1", patientName: "Mariam Hassan", lot: "L-77" }, snap({ lines: [line("v3m", "d1", 3)] }), snap({ lines: [line("v3m", "d1", 2)] }));
assert.deepEqual([ev[0].type, ev[0].patientName, ev[0].lot, ev[0].qtyBefore, ev[0].qtyAfter], ["used", "Mariam Hassan", "L-77", 3, 2]);

// --- delete: with stock it is a write-off, and says how much; empty, it is just removed ---------
ev = deriveEvents("remove-line", { lineId: "v3m__d1" }, snap({ lines: [line("v3m", "d1", 3)] }), snap({ lines: [] }));
assert.deepEqual([ev[0].type, ev[0].qty, ev[0].drawerCode], ["write-off", 3, "R1-A1"]);
assert.equal(EVENT_GROUP[ev[0].type], "losses");
ev = deriveEvents("remove-line", { lineId: "v3m__d1" }, snap({ lines: [line("v3m", "d1", 0)] }), snap({ lines: [] }));
assert.equal(ev[0].type, "row-removed");
// a delete the server refused changes nothing, so nothing is recorded
assert.equal(deriveEvents("remove-line", { lineId: "v3m__d1" }, snap({ lines: [line("v3m", "d1", 3)] }), snap({ lines: [line("v3m", "d1", 3)] })).length, 0);

// --- move: from, to, and how many ----------------------------------------------------------------
ev = deriveEvents("move-line", { lineId: "v3m__d1", toDrawerId: "d2" }, snap({ lines: [line("v3m", "d1", 4)] }), snap({ lines: [line("v3m", "d2", 4)] }));
assert.deepEqual([ev[0].type, ev[0].qty, ev[0].drawerCode, ev[0].toDrawerCode], ["moved", 4, "R1-A1", "R1-A2"]);

// --- edits list exactly which fields changed, old value and new ---------------------------------
ev = deriveEvents("update-item", { id: "flow" }, snap({}), snap({ items: [{ ...item, nameAr: "فلو كومبوزيت", per: "2 g x2" }] }));
assert.deepEqual(ev[0].changes, [{ field: "nameAr", from: "فلو", to: "فلو كومبوزيت" }, { field: "packSize", from: "2 g", to: "2 g x2" }]);
ev = deriveEvents("update-variant", { id: "v3m" }, snap({}), snap({ variants: [generic, { ...brand3m, lastPrice: 700, supplier: "Nile Dental" }] }));
assert.deepEqual(ev[0].changes, [{ field: "supplier", from: "DentaCarts", to: "Nile Dental" }, { field: "price", from: "620", to: "700" }]);
assert.equal(describeEvent(full(ev[0]), false), "Edited the brand Flowable composite · 3M Filtek Flow A2 — supplier: DentaCarts → Nile Dental · price: 620 → 700");
// saving an edit that changed nothing records nothing
assert.equal(deriveEvents("update-item", { id: "flow" }, snap({}), snap({})).length, 0);

// --- layout: a cabinet of drawers and shelves, a rename, a delete -------------------------------
const twenty = Array.from({ length: 20 }, (_, k) => drawer(`n${k}`, `R2-A${k + 1}`, { roomEn: "Room 2", number: k + 1 }));
const shelf = drawer("s1", "R2-AS1", { roomEn: "Room 2", kind: "shelf" });
ev = deriveEvents("add-cabinet", { roomCode: "R2" }, snap({}), snap({ drawers: [drawer("d1", "R1-A1"), drawer("d2", "R1-A2"), ...twenty, shelf] }));
assert.deepEqual([ev[0].type, ev[0].text, ev[0].n1, ev[0].n2], ["cabinet-added", "R2-A", 20, 1]);
assert.equal(describeEvent(full(ev[0]), false), "Added to cabinet R2-A: 20 drawers and 1 shelf");
ev = deriveEvents("rename-drawer", { id: "d1", name: "Anaesthesia" }, snap({}), snap({ drawers: [drawer("d1", "R1-A1", { nameEn: "Anaesthesia", nameAr: "Anaesthesia" }), drawer("d2", "R1-A2")] }));
assert.deepEqual(ev[0].changes, [{ field: "name", from: "Drawer R1-A1", to: "Anaesthesia" }]); // one name in both languages is one change
ev = deriveEvents("delete-drawer", { id: "d2" }, snap({}), snap({ drawers: [drawer("d1", "R1-A1")] }));
assert.deepEqual([ev[0].type, ev[0].drawerCode, ev[0].drawerName], ["drawer-deleted", "R1-A2", "Drawer R1-A2"]); // the name survives the delete

// --- every type has a group and a sentence in both languages ------------------------------------
for (const type of Object.keys(EVENT_GROUP) as StockEvent["type"][]) {
  const e = full({ type, itemEn: "Item", itemAr: "صنف", drawerCode: "R1-A1", unit: "box", qty: 1, n1: 1, n2: 1, text: "drawer", changes: [{ field: "name", from: "a", to: "b" }] });
  assert.ok(describeEvent(e, false).length > 5 && describeEvent(e, false) !== type, `no English sentence for ${type}`);
  assert.ok(describeEvent(e, true).length > 5 && describeEvent(e, true) !== type, `no Arabic sentence for ${type}`);
}

console.log("stockHistory: all assertions passed");
