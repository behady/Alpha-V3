import type { CountCompareRow, StockSnapshot } from "./types";

/**
 * Every press of "Save count", kept on its own.
 *
 * The usage reports work on one count per day, which is right for a weekly walk. A clinic that
 * counts a drawer in the morning and again in the evening wants to see those two counts side by
 * side. So each save also leaves its own record: the time, the person, the cupboard as the
 * system believed it a moment before, and the cupboard as counted.
 *
 * Keeping "before" as well as "after" is what makes the comparison honest. Between two counts,
 *
 *     came in or went out = what the system held before this count − what the last count left
 *     used                = what the system held before this count − what was counted
 *
 * so a delivery, an item logged on a patient, a deleted row or a move between drawers is never
 * mistaken for consumption, and no dates have to be matched to work that out.
 *
 * Pure functions, no Firestore, so tests/stockCounts.test.mts can pin them down.
 */

export interface CountSaveRecord {
  before: Record<string, number>;
  snapshot: Record<string, number>;
  /** True when the whole cupboard was walked; then every row counts as counted. */
  whole: boolean;
  /** The rows that were counted, when it was not the whole cupboard. */
  countedIds: string[];
  /** The drawers those rows sit in, by the code printed on them. Empty for the whole cupboard. */
  drawerCodes: string[];
  counted: number;
  changed: number;
  /** No count of any kind existed before this one: it is the starting point, not a comparison. */
  firstEver: boolean;
}

/**
 * What one save leaves behind, from the cupboard before it and after it. `scope` is "all" for
 * the walk of every drawer, or a drawer's id when the count was saved from that drawer's page;
 * without either, only the rows that were sent a number count as counted. Returns null when
 * nothing was counted at all.
 */
export function buildCountSave(body: Record<string, unknown>, before: StockSnapshot, after: StockSnapshot): CountSaveRecord | null {
  const beforeQty: Record<string, number> = {};
  for (const l of before.lines) beforeQty[l.id] = l.qty;
  const afterQty: Record<string, number> = {};
  for (const l of after.lines) afterQty[l.id] = l.qty;

  const values = body.values && typeof body.values === "object" ? (body.values as Record<string, unknown>) : {};
  const scope = typeof body.scope === "string" ? body.scope : "";
  const whole = scope === "all";
  const counted = new Set<string>();
  if (whole) {
    for (const l of after.lines) counted.add(l.id);
  } else {
    if (scope && after.drawers.some((d) => d.id === scope)) for (const l of after.lines) if (l.drawerId === scope) counted.add(l.id);
    for (const id of Object.keys(values)) if (id in afterQty) counted.add(id);
  }
  if (!counted.size) return null;

  let changed = 0;
  for (const id of new Set([...Object.keys(beforeQty), ...Object.keys(afterQty)])) if ((beforeQty[id] ?? 0) !== (afterQty[id] ?? 0)) changed++;

  const drawerIds = new Set<string>();
  if (!whole) for (const l of after.lines) if (counted.has(l.id)) drawerIds.add(l.drawerId);
  const drawerCodes = after.drawers.filter((d) => drawerIds.has(d.id)).map((d) => d.code);

  return {
    before: beforeQty,
    snapshot: afterQty,
    whole,
    countedIds: whole ? [] : [...counted],
    drawerCodes,
    counted: counted.size,
    changed,
    firstEver: before.counts.length === 0,
  };
}

/** One count in the chain being compared. `before` is null only on a damaged record. */
export interface CountStep {
  before: Record<string, number> | null;
  snapshot: Record<string, number>;
  firstEver?: boolean;
  whole?: boolean;
  countedIds?: string[];
}

const variantOfLine = (lineId: string): string => {
  const i = lineId.indexOf("__");
  return i >= 0 ? lineId.slice(0, i) : lineId;
};
const drawerOfLine = (lineId: string): string => {
  const i = lineId.indexOf("__");
  return i >= 0 ? lineId.slice(i + 2) : "";
};

/** A brand's total across every drawer it sits in, so a box moved between drawers cancels out. */
function totals(quantities: Record<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [lineId, v] of Object.entries(quantities)) {
    if (!Number.isFinite(v)) continue;
    const id = variantOfLine(lineId);
    out.set(id, (out.get(id) || 0) + v);
  }
  return out;
}

/**
 * Compare a count with an earlier one.
 *
 * `baseline` is the earlier count; `steps` is every count after it up to and including the one
 * being looked at, oldest first. Passing every count in between (not only the two ends) is what
 * keeps "used" right across a long gap: each step's own before-and-after is added up.
 *
 * With no baseline the count is compared with what the system held just before it — unless it
 * was the first count ever, which is a starting point and has nothing used.
 *
 * For every brand: `last + moved − used = counted`.
 */
export function compareCounts(baseline: CountStep | null, steps: CountStep[]): CountCompareRow[] {
  if (!steps.length) return [];
  const target = steps[steps.length - 1];
  const acc = new Map<string, { last: number | null; moved: number; used: number }>();
  const row = (id: string, last: number | null) => {
    let r = acc.get(id);
    if (!r) {
      r = { last, moved: 0, used: 0 };
      acc.set(id, r);
    }
    return r;
  };

  let prev = baseline ? totals(baseline.snapshot) : null;
  if (prev) for (const [id, v] of prev) row(id, v);
  for (const step of steps) {
    const after = totals(step.snapshot);
    const before = step.before ? totals(step.before) : after;
    for (const id of new Set([...(prev ? prev.keys() : []), ...before.keys(), ...after.keys()])) {
      const r = row(id, baseline ? 0 : null);
      const b = before.get(id) || 0;
      if (prev) r.moved += b - (prev.get(id) || 0);
      const startingPoint = !prev && step.firstEver === true;
      if (!startingPoint) r.used += b - (after.get(id) || 0);
    }
    prev = after;
  }

  const counted = totals(target.snapshot);
  const countedVariants = new Set((target.countedIds || []).map(variantOfLine));
  const drawers = new Map<string, Set<string>>();
  for (const lineId of [...Object.keys(target.snapshot), ...Object.keys(target.before || {})]) {
    const id = variantOfLine(lineId);
    if (!drawers.has(id)) drawers.set(id, new Set());
    const d = drawerOfLine(lineId);
    if (d) drawers.get(id)!.add(d);
  }

  const rows: CountCompareRow[] = [];
  for (const [variantId, r] of acc) {
    const now = counted.get(variantId) || 0;
    rows.push({
      variantId,
      drawerIds: [...(drawers.get(variantId) || [])],
      last: r.last,
      moved: r.moved,
      expected: now + r.used,
      counted: now,
      used: r.used,
      inCount: target.whole === true || countedVariants.has(variantId),
    });
  }
  return rows;
}

/** "3 h 20 min", "2 days 4 h" — how far apart two counts are, for a person. */
export function gapLabel(fromMs: number, toMs: number, ar: boolean): string {
  if (toMs - fromMs < 60000) return ar ? "أقل من دقيقة" : "under a minute";
  const minutes = Math.round((toMs - fromMs) / 60000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (d) parts.push(ar ? `${d} يوم` : `${d} day${d === 1 ? "" : "s"}`);
  if (h) parts.push(ar ? `${h} ساعة` : `${h} h`);
  if (!d && (m || !h)) parts.push(ar ? `${m} دقيقة` : `${m} min`);
  return parts.join(ar ? " و" : " ");
}
