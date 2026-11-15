import type { StockCount, StockDelivery, StockItem, StockLine, StockUse, StockVariant } from "./types";

/**
 * Everything the owner wants to know, computed from three logs.
 *
 * The rule the whole module rests on: usage is never typed. Between two counts,
 *
 *     used = quantity at the earlier count + delivered in between − quantity at the later count
 *
 * per stock line, summed up to the item. A line that did not exist at the earlier count is
 * treated as zero then. Deliveries are matched by their date falling after the earlier count's
 * date and on or before the later one's, so a delivery on count day counts toward that week.
 *
 * Pure functions, no Firestore, so tests/stockMath.test.mts can pin them down.
 */

export interface UsageRow {
  itemId: string;
  used: number;
  cost: number;
  perWeek: number[];
}

export interface PaceRow {
  itemId: string;
  onHand: number;
  pace: number;
  /** null when nothing has been used yet — no pace, no prediction. */
  daysLeft: number | null;
}

export function sortCounts(counts: StockCount[]): StockCount[] {
  return [...counts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function deliveredBetween(
  deliveries: StockDelivery[],
  variantId: string,
  drawerId: string,
  fromExclusive: string,
  toInclusive: string
): number {
  let n = 0;
  for (const d of deliveries) {
    if (d.date <= fromExclusive || d.date > toInclusive) continue;
    for (const l of d.lines) if (l.variantId === variantId && l.drawerId === drawerId) n += l.qty;
  }
  return n;
}

export function lineKey(variantId: string, drawerId: string): string {
  return `${variantId}__${drawerId}`;
}

/** Quantity of a line after a given count (0 if the line did not exist yet). */
export function qtyAt(count: StockCount, lineId: string): number {
  const v = count.snapshot[lineId];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Usage of one line between two consecutive counts. Never negative: a count that finds more
 * than arithmetic expects (an unlogged delivery, a miscount) reads as zero used, not as
 * negative consumption, and the gap shows up in the next week instead.
 */
export function lineUsage(prev: StockCount, next: StockCount, line: StockLine, deliveries: StockDelivery[]): number {
  const before = qtyAt(prev, line.id);
  const after = qtyAt(next, line.id);
  const delivered = deliveredBetween(deliveries, line.variantId, line.drawerId, prev.date, next.date);
  return Math.max(0, before + delivered - after);
}

/**
 * Usage of one brand between two counts, across every drawer it sits in.
 *
 * This, not the per-drawer figure, is what the reports add up. A box carried from the Store to
 * a chair lowers one drawer and raises another; counted drawer by drawer, the Store's drop would
 * read as "used" and the chair's rise as nothing, and the clinic would appear to burn through a
 * box it merely moved. Summed over the brand, the move cancels itself. For the same reason a row
 * that was moved or deleted since the earlier count still contributes what it held then: the
 * count's own record is read, not today's list of rows.
 */
export function variantUsage(prev: StockCount, next: StockCount, variantId: string, deliveries: StockDelivery[]): number {
  const prefix = `${variantId}__`;
  const total = (c: StockCount) => {
    let n = 0;
    for (const [key, v] of Object.entries(c.snapshot)) if (key.startsWith(prefix) && Number.isFinite(v)) n += v;
    return n;
  };
  let delivered = 0;
  for (const d of deliveries) {
    if (d.date <= prev.date || d.date > next.date) continue;
    for (const l of d.lines) if (l.variantId === variantId) delivered += l.qty;
  }
  return Math.max(0, total(prev) + delivered - total(next));
}

export function lastPrice(variant: StockVariant | undefined, deliveries: StockDelivery[]): number {
  if (!variant) return 0;
  for (let i = deliveries.length - 1; i >= 0; i--) {
    const l = deliveries[i].lines.find((x) => x.variantId === variant.id);
    if (l && l.price > 0) return l.price;
  }
  return variant.lastPrice ?? 0;
}

/**
 * Usage per item over the last `weeks` count intervals.
 *
 * `perWeek[k]` is the usage between count k and count k+1 of the window, so with N counts in
 * the window there are N−1 figures. Cost uses each variant's last purchase price, which is what
 * the next box will cost, not what this one did — the number the owner needs for deciding.
 */
export function usageByItem(args: {
  items: StockItem[];
  variants: StockVariant[];
  lines: StockLine[];
  counts: StockCount[];
  deliveries: StockDelivery[];
  weeks: number;
}): UsageRow[] {
  const counts = sortCounts(args.counts);
  const window = counts.slice(-(args.weeks + 1));
  const sortedDeliv = [...args.deliveries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const byVariant = new Map(args.variants.map((v) => [v.id, v]));
  const rows: UsageRow[] = [];
  for (const item of args.items) {
    if (item.tracked) continue;
    const variants = args.variants.filter((v) => v.itemId === item.id);
    const perWeek: number[] = [];
    let used = 0;
    let cost = 0;
    for (let k = 1; k < window.length; k++) {
      let u = 0;
      for (const v of variants) {
        const x = variantUsage(window[k - 1], window[k], v.id, sortedDeliv);
        u += x;
        cost += x * lastPrice(byVariant.get(v.id), sortedDeliv);
      }
      perWeek.push(u);
      used += u;
    }
    rows.push({ itemId: item.id, used, cost, perWeek });
  }
  return rows.sort((a, b) => b.cost - a.cost);
}

/** Pace over the last four counts (per calendar week) and days left at that pace. */
export function paceByItem(args: {
  items: StockItem[];
  variants: StockVariant[];
  lines: StockLine[];
  counts: StockCount[];
  deliveries: StockDelivery[];
}): PaceRow[] {
  const counts = sortCounts(args.counts);
  const window = counts.slice(-4);
  const sortedDeliv = [...args.deliveries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const rows: PaceRow[] = [];
  for (const item of args.items) {
    if (item.tracked) continue;
    const lines = args.lines.filter((l) => l.itemId === item.id);
    const onHand = lines.reduce((a, l) => a + l.qty, 0);
    const variants = args.variants.filter((v) => v.itemId === item.id);
    let total = 0;
    for (let k = 1; k < window.length; k++) for (const v of variants) total += variantUsage(window[k - 1], window[k], v.id, sortedDeliv);
    // Per week of calendar time, not per count: a clinic that counts twice in one week, or
    // skips one, must not see its pace double or halve.
    const days = window.length > 1 ? daysApart(window[0].date, window[window.length - 1].date) : 0;
    const pace = days > 0 ? total / (days / 7) : 0;
    const daysLeft = pace > 0 ? onHand / (pace / 7) : null;
    rows.push({ itemId: item.id, onHand, pace, daysLeft });
  }
  return rows.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
}

export interface ShoppingLine {
  itemId: string;
  variant: StockVariant | null;
  supplier: string;
  need: number;
  onHand: number;
  daysLeft: number | null;
}

/**
 * What to order: anything under `horizonDays` of stock, enough for four weeks, from whichever
 * brand was bought last. The brand is a default the person ordering can change, not a rule.
 */
export function shoppingList(args: {
  pace: PaceRow[];
  variants: StockVariant[];
  lines: StockLine[];
  deliveries: StockDelivery[];
  horizonDays?: number;
}): ShoppingLine[] {
  const horizon = args.horizonDays ?? 14;
  const sortedDeliv = [...args.deliveries].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: ShoppingLine[] = [];
  for (const p of args.pace) {
    if (p.daysLeft == null || p.daysLeft >= horizon) continue;
    const itemVariants = args.variants.filter((v) => args.lines.some((l) => l.variantId === v.id && l.itemId === p.itemId));
    let preferred: StockVariant | null = null;
    for (let i = sortedDeliv.length - 1; i >= 0 && !preferred; i--) {
      const l = sortedDeliv[i].lines.find((x) => itemVariants.some((v) => v.id === x.variantId));
      if (l) preferred = itemVariants.find((v) => v.id === l.variantId) ?? null;
    }
    preferred = preferred ?? itemVariants[0] ?? null;
    const need = Math.max(1, Math.ceil(p.pace * 4 - p.onHand));
    out.push({ itemId: p.itemId, variant: preferred, supplier: preferred?.supplier || "Other", need, onHand: p.onHand, daysLeft: p.daysLeft });
  }
  return out;
}

export interface VarianceRow {
  variantId: string;
  drawerId: string;
  start: number;
  delivered: number;
  gone: number;
  usedOnPatients: number;
  gap: number;
}

/**
 * Tracked items: what left the drawer versus what was recorded on a patient, since the first
 * count. A positive gap is a fixture nobody can account for. The report says which drawer and
 * since when; it never says who.
 */
export function variance(args: { lines: StockLine[]; counts: StockCount[]; deliveries: StockDelivery[]; uses: StockUse[]; trackedItemIds: Set<string> }): VarianceRow[] {
  const counts = sortCounts(args.counts);
  const first = counts[0];
  const rows: VarianceRow[] = [];
  for (const line of args.lines) {
    if (!args.trackedItemIds.has(line.itemId)) continue;
    const start = first ? qtyAt(first, line.id) : line.qty;
    const since = first ? first.date : "0000-00-00";
    const delivered = deliveredBetween(args.deliveries, line.variantId, line.drawerId, since, "9999-99-99");
    const gone = start + delivered - line.qty;
    const usedOnPatients = args.uses.filter((u) => u.variantId === line.variantId && u.drawerId === line.drawerId && u.date > since).length;
    rows.push({ variantId: line.variantId, drawerId: line.drawerId, start, delivered, gone, usedOnPatients, gap: gone - usedOnPatients });
  }
  return rows;
}

/** Days until the item runs out, as a short label. */
export function daysLabel(days: number | null, ar: boolean): string {
  if (days == null) return "—";
  if (days < 1) return ar ? "خلص" : "out";
  return ar ? `~${Math.round(days)} يوم` : `~${Math.round(days)} d`;
}

export function daysApart(a: string, b: string): number {
  return Math.round((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayKey(): string {
  const d = new Date();
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

/** Arabic-aware, accent-insensitive contains, for the search box. */
export function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ً-ْ]/g, "");
}

export function matches(haystack: string[], q: string): boolean {
  const n = norm(q).trim();
  if (!n) return true;
  const h = norm(haystack.join(" "));
  return n.split(/\s+/).every((t) => h.includes(t));
}

/**
 * What the scanner read, reduced to the product's own number.
 *
 * A plain EAN/UPC comes through as its digits. The square GS1 DataMatrix on dental and medical
 * boxes carries more than the product: "(01) product (17) expiry (10) lot", read as one run
 * such as `010404671900003617251231 10ABC`. Looked up whole, it would be a different "barcode"
 * for every batch and never match. So the product part (the 14 digits after `01`) is taken, and
 * its padding zero dropped when the product is an ordinary 13-digit EAN, so that the square code
 * and the striped one on the same box find the same product.
 */
export function normaliseBarcode(raw: string): string {
  let s = (raw || "").trim();
  s = s.replace(/^\][A-Za-z]\d/, ""); // symbology identifier some readers prepend, e.g. "]d2"
  s = s.replace(/[\u001d\u001e\u0004]/g, ""); // GS1 separators
  s = s.replace(/\s+/g, "");
  const gs1 = /^\(?01\)?(\d{14})/.exec(s);
  if (gs1 && s.replace(/[()]/g, "").length >= 16) {
    const gtin = gs1[1];
    return gtin.startsWith("0") ? gtin.slice(1) : gtin;
  }
  return s;
}
