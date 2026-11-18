// Finding a thing in the cupboard, and the order rows are listed in: by name, the way a person
// looks for them, in the language on the screen.
import assert from "node:assert/strict";
import { searchStock, sortItems, sortLines } from "../src/lib/stock/browse";
import type { StockDrawer, StockItem, StockLine, StockVariant } from "../src/lib/stock/types";

const item = (id: string, nameEn: string, nameAr: string): StockItem => ({ id, nameEn, nameAr, unit: "box", per: "", shape: "box", tracked: false, catalogKey: null, photoUrl: null });
const generic = (itemId: string): StockVariant => ({ id: `${itemId}-g`, itemId, brand: "", product: "", spec: "", barcode: null, photoUrl: null, supplier: null, lastPrice: null, isGeneric: true });
const brand = (id: string, itemId: string, b: string, product: string, spec: string, barcode: string | null = null): StockVariant => ({ id, itemId, brand: b, product, spec, barcode, photoUrl: null, supplier: null, lastPrice: null, isGeneric: false });
const line = (variantId: string, itemId: string, drawerId: string, qty = 1): StockLine => ({ id: `${variantId}__${drawerId}`, variantId, itemId, drawerId, qty });
const drawer = (id: string, code: string, nameEn: string, nameAr: string): StockDrawer => ({ id, code, roomCode: code.split("-")[0], roomEn: "Chair 1", roomAr: "غرفة الكشف", cabinetLetter: "A", cabinetWhere: "", kind: "drawer", number: 1, nameEn, nameAr, photoUrl: null, tracked: false, order: 0 });

const items = [item("gloves", "Gloves", "جوانتي"), item("bond", "Bond", "بوند"), item("comp", "Composite", "كومبوزيت"), item("masks", "Face masks", "ماسكات"), item("anes", "Articaine", "بنج أرتيكايين")];
const variants = [
  generic("gloves"),
  generic("bond"),
  generic("masks"),
  generic("anes"),
  generic("comp"),
  brand("z-a3", "comp", "3M", "Filtek Z350", "A3", "4035000000011"),
  brand("z-a2", "comp", "3M", "Filtek Z350", "A2"),
  brand("tetric", "comp", "Ivoclar", "Tetric", "A2"),
];
const drawers = [drawer("d1", "R1-A1", "Restorative", "حشو"), drawer("d2", "R1-A2", "Infection control", "تعقيم")];
const lines = [
  line("gloves-g", "gloves", "d2", 4),
  line("z-a3", "comp", "d1", 2),
  line("bond-g", "bond", "d1", 1),
  line("tetric", "comp", "d1", 3),
  line("masks-g", "masks", "d2", 0),
  line("z-a2", "comp", "d1", 5),
  line("comp-g", "comp", "d1", 0),
  line("anes-g", "anes", "d1", 6),
];
const snap = { items, variants, lines, drawers };
const names = (ls: StockLine[], ar: boolean) => ls.map((l) => { const i = items.find((x) => x.id === l.itemId)!; const v = variants.find((x) => x.id === l.variantId)!; return `${ar ? i.nameAr : i.nameEn}${v.isGeneric ? "" : ` ${v.brand} ${v.spec}`}`; });

// --- A to Z inside a drawer ----------------------------------------------------------------------
{
  const d1 = sortLines(lines.filter((l) => l.drawerId === "d1"), snap, false);
  assert.deepEqual(names(d1, false), ["Articaine", "Bond", "Composite", "Composite 3M A2", "Composite 3M A3", "Composite Ivoclar A2"]);
  // In Arabic the same drawer follows the Arabic names: ب (بنج، بوند) then ك.
  const d1ar = sortLines(lines.filter((l) => l.drawerId === "d1"), snap, true);
  assert.deepEqual(names(d1ar, true).map((n) => n.split(" ")[0]), ["بنج", "بوند", "كومبوزيت", "كومبوزيت", "كومبوزيت", "كومبوزيت"]);
  // the list handed in is left as it was
  assert.equal(lines[0].variantId, "gloves-g");
}
// capital letters, and a number inside a name, sort the way a person expects
{
  const its = [item("b", "bur 10", "ب"), item("a", "Bur 2", "ا"), item("c", "applicator", "ج")];
  const vs = its.map((i) => generic(i.id));
  const ls = its.map((i) => line(`${i.id}-g`, i.id, "d1"));
  assert.deepEqual(sortLines(ls, { items: its, variants: vs }, false).map((l) => l.itemId), ["c", "a", "b"]);
}

// the list to pick an item from is A to Z as well
assert.deepEqual(sortItems(items, false).map((i) => i.nameEn), ["Articaine", "Bond", "Composite", "Face masks", "Gloves"]);
assert.equal(items[0].id, "gloves");

// --- search --------------------------------------------------------------------------------------
{
  assert.equal(searchStock(snap, "", false).length, 0, "an empty box finds nothing; the cupboard is shown instead");
  assert.equal(searchStock(snap, "   ", false).length, 0);
  // by name, either language, whatever the screen is in
  assert.deepEqual(searchStock(snap, "glov", true).map((l) => l.id), ["gloves-g__d2"]);
  assert.deepEqual(searchStock(snap, "جوانتي", false).map((l) => l.id), ["gloves-g__d2"]);
  // Arabic typed the loose way still finds it (ة/ه, أ/ا)
  assert.deepEqual(searchStock(snap, "ارتيكايين", false).map((l) => l.itemId), ["anes"]);
  // by brand, product, shade and barcode
  assert.equal(searchStock(snap, "ivoclar", false).length, 1);
  assert.equal(searchStock(snap, "z350 a2", false)[0].variantId, "z-a2");
  assert.deepEqual(searchStock(snap, "4035000000011", false).map((l) => l.variantId), ["z-a3"]);
  // by where it lives: a drawer's code or name lists what is in it, A to Z
  assert.deepEqual(searchStock(snap, "r1-a2", false).map((l) => l.itemId), ["masks", "gloves"]);
  assert.deepEqual(searchStock(snap, "تعقيم", true).map((l) => l.itemId).sort(), ["gloves", "masks"]);
  // every word must match
  assert.equal(searchStock(snap, "composite ivoclar", false).length, 1);
  assert.equal(searchStock(snap, "composite gloves", false).length, 0);
  // the same brand in two drawers is two answers, because the question is "where is it"
  const two = searchStock({ ...snap, lines: [...lines, line("gloves-g", "gloves", "d1", 2)] }, "gloves", false);
  assert.deepEqual(two.map((l) => l.drawerId), ["d1", "d2"]);
  assert.equal(searchStock(snap, "nothing like this", false).length, 0);
}

console.log("stock browse: ok");
