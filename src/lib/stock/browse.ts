import { matches } from "./math";
import type { StockDrawer, StockItem, StockLine, StockVariant } from "./types";

/**
 * Finding a thing in the cupboard, and the order its rows are listed in.
 *
 * Both only read: nothing here changes what is stored, so the order a clinic sees can change
 * without a single record being touched. Pure functions, pinned by tests/stockBrowse.test.mts.
 */

type Names = { items: StockItem[]; variants: StockVariant[] };

const collators = {
  ar: new Intl.Collator("ar", { numeric: true, sensitivity: "base" }),
  en: new Intl.Collator("en", { numeric: true, sensitivity: "base" }),
};

/**
 * Rows A to Z: by the item's name in the language on screen, then the brandless row first, then
 * brand, product and shade. Numbers inside a name sort as numbers ("Bur 2" before "Bur 10").
 * Returns a new list; the one handed in is left alone.
 */
export function sortLines(lines: StockLine[], names: Names, ar: boolean): StockLine[] {
  const items = new Map(names.items.map((i) => [i.id, i]));
  const variants = new Map(names.variants.map((v) => [v.id, v]));
  const cmp = ar ? collators.ar : collators.en;
  const itemName = (l: StockLine) => {
    const i = items.get(l.itemId);
    return i ? (ar ? i.nameAr || i.nameEn : i.nameEn || i.nameAr) : "";
  };
  const brandName = (l: StockLine) => {
    const v = variants.get(l.variantId);
    return !v || v.isGeneric ? "" : [v.brand, v.product, v.spec].filter(Boolean).join(" ");
  };
  return [...lines].sort((a, b) => cmp.compare(itemName(a), itemName(b)) || collators.en.compare(brandName(a), brandName(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * What the search box finds: rows whose item, brand, shade, barcode, supplier or home (drawer
 * code, drawer name, room) holds every word typed, in either language. One answer per row, so a
 * brand kept in two drawers is two answers — the question being asked is "where is it".
 */
export function searchStock(snap: Names & { lines: StockLine[]; drawers: StockDrawer[] }, q: string, ar: boolean): StockLine[] {
  if (!q.trim()) return [];
  const items = new Map(snap.items.map((i) => [i.id, i]));
  const variants = new Map(snap.variants.map((v) => [v.id, v]));
  const drawers = new Map(snap.drawers.map((d) => [d.id, d]));
  const hits = snap.lines.filter((l) => {
    const i = items.get(l.itemId);
    const v = variants.get(l.variantId);
    const d = drawers.get(l.drawerId);
    return matches(
      [i?.nameEn || "", i?.nameAr || "", i?.per || "", v?.isGeneric ? "" : v?.brand || "", v?.isGeneric ? "" : v?.product || "", v?.spec || "", v?.barcode || "", v?.supplier || "", d?.code || "", d?.nameEn || "", d?.nameAr || "", d?.roomEn || "", d?.roomAr || ""],
      q
    );
  });
  // A to Z by name; the same brand in two drawers follows the drawers' codes.
  const rank = new Map<string, number>();
  sortLines(hits, snap, ar).forEach((l, k) => {
    if (!rank.has(l.variantId)) rank.set(l.variantId, k);
  });
  const code = (l: StockLine) => drawers.get(l.drawerId)?.code || "";
  return [...hits].sort((a, b) => (rank.get(a.variantId) ?? 0) - (rank.get(b.variantId) ?? 0) || collators.en.compare(code(a), code(b)));
}
