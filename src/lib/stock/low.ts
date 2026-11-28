import type { StockLine, StockVariant } from "./types";

/**
 * Running low, by a number a person can see and change.
 *
 * A brand is low when everything the clinic holds of it — every drawer and shelf added up — is
 * at or under its warning level. The level is 1 unless somebody set another, so a record saved
 * before this existed needs nothing done to it: no level stored reads as 1.
 *
 * This sits beside the "days left" guess in math.ts and does not replace it. That one needs two
 * counts and some usage before it can say anything; this one works from the first number typed.
 *
 * Pure functions, no Firestore, so tests/stockLow.test.mts can pin them down.
 */

export const DEFAULT_WARN_AT = 1;
export const MAX_WARN_AT = 9999;

export function warnAtOf(v: Pick<StockVariant, "warnAt"> | null | undefined): number {
  const n = v?.warnAt;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(MAX_WARN_AT, Math.floor(n)) : DEFAULT_WARN_AT;
}

type Cupboard = { variants: StockVariant[]; lines: StockLine[] };

export interface LowRow {
  variantId: string;
  itemId: string;
  /** Across every drawer the brand sits in. */
  onHand: number;
  warnAt: number;
  drawerIds: string[];
}

function totals(lines: StockLine[]): Map<string, { onHand: number; drawerIds: string[] }> {
  const map = new Map<string, { onHand: number; drawerIds: string[] }>();
  for (const l of lines) {
    const t = map.get(l.variantId) || { onHand: 0, drawerIds: [] };
    t.onHand += l.qty;
    if (!t.drawerIds.includes(l.drawerId)) t.drawerIds.push(l.drawerId);
    map.set(l.variantId, t);
  }
  return map;
}

/**
 * Every brand that is at or under its level now.
 *
 * A brand with no row in any drawer is skipped: it has no home, so there is nothing to refill.
 * So is the brandless row an item gets at setup once it is empty and a real brand of the same
 * item has a row — that row is a placeholder the real brands replaced, not stock that ran out.
 */
export function lowRows(c: Cupboard): LowRow[] {
  const held = totals(c.lines);
  const brandedItems = new Set<string>();
  for (const v of c.variants) if (!v.isGeneric && held.has(v.id)) brandedItems.add(v.itemId);
  const out: LowRow[] = [];
  for (const v of c.variants) {
    const t = held.get(v.id);
    if (!t) continue;
    if (v.isGeneric && t.onHand === 0 && brandedItems.has(v.itemId)) continue;
    const warnAt = warnAtOf(v);
    if (t.onHand <= warnAt) out.push({ variantId: v.id, itemId: v.itemId, onHand: t.onHand, warnAt, drawerIds: t.drawerIds });
  }
  return out;
}

/**
 * The brands one save took from above their level to at or under it — the only moment an alert
 * is sent. Topping up and dipping again warns again; sitting under the level does not nag on
 * every count. Both sides are judged by the level as it is after the save, so changing the level
 * itself never sends anything: the person changing it is looking at the row.
 */
export function lowCrossings(before: Cupboard, after: Cupboard): LowRow[] {
  const was = totals(before.lines);
  return lowRows(after).filter((r) => {
    const prev = was.get(r.variantId);
    return !!prev && prev.onHand > r.warnAt;
  });
}

export interface LowAlertLine {
  name: string;
  onHand: number;
  /** The count unit, already in the right language and number: "box", "علبة". */
  unit: string;
  /** Drawer codes it lives in. */
  codes: string[];
}

const MAX_LINES = 20;

/** The alert's words: a line for the bell and the phone, a list for WhatsApp. */
export function lowAlertText(rows: LowAlertLine[], language: "ar" | "en"): { title: string; body: string; whatsappText: string } {
  const ar = language === "ar";
  const title = ar ? "حاجة قربت تخلص" : "Running low";
  const left = (r: LowAlertLine) => (r.onHand <= 0 ? (ar ? "خلص" : "finished") : ar ? `باقي ${r.onHand} ${r.unit}` : `${r.onHand} ${r.unit} left`);
  const where = (r: LowAlertLine) => (r.codes.length ? ` (${r.codes.join(ar ? "، " : ", ")})` : "");
  const one = (r: LowAlertLine) => `${r.name} — ${left(r)}${where(r)}`;

  let body: string;
  if (rows.length === 1) body = one(rows[0]);
  else {
    const head = ar ? `${rows.length} أصناف قربت تخلص: ` : `${rows.length} items are running low: `;
    body = head + rows.map((r) => `${r.name} (${r.onHand})`).join(ar ? "، " : ", ");
  }
  if (body.length > 400) body = `${body.slice(0, 399)}…`;

  const shown = rows.slice(0, MAX_LINES);
  const rest = rows.length - shown.length;
  const list = shown.map((r) => `• ${one(r)}`);
  if (rest > 0) list.push(ar ? `… و${rest} كمان` : `… and ${rest} more`);
  const whatsappText = [`*📦 ${ar ? "مخزون قرب يخلص" : "Stock running low"}*`, ...list].join("\n");
  return { title, body, whatsappText };
}
