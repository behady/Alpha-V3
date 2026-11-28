/**
 * How much raw data one question may pull into the model.
 *
 * Every tool result is re-sent on every later round of the same turn, so a read of 100 full
 * patient files (each carrying a tooth chart) was paid for up to five times over. On 2026-11-28
 * one question cost 696,000 input tokens that way and still produced no answer. Three limits now
 * hold, all here so they can be tested without the route:
 *
 *  - a read returns few rows by default and never more than a cap;
 *  - each row loses the fields that are large and that no spoken answer needs;
 *  - the whole turn has a ceiling on returned characters, after which a read is refused.
 *
 * A deep search (Owner/Admin, confirmed, 10 credits) raises all three. It does not remove them.
 */

export type ReadLimits = {
  /** Rows when the model asks for no particular number. */
  defaultRows: number;
  maxRows: number;
  /** Characters of read results across the whole turn. */
  ceilingChars: number;
  /** Tool rounds before the turn must answer. */
  maxRounds: number;
};

export const NORMAL_LIMITS: ReadLimits = { defaultRows: 20, maxRows: 50, ceilingChars: 24_000, maxRounds: 5 };
export const DEEP_LIMITS: ReadLimits = { defaultRows: 100, maxRows: 200, ceilingChars: 150_000, maxRounds: 8 };

export const DEEP_SEARCH_CREDITS = 10;

export function rowsFor(requested: unknown, limits: ReadLimits): number {
  const n = Math.floor(Number(requested));
  if (!Number.isFinite(n) || n <= 0) return limits.defaultRows;
  return Math.min(n, limits.maxRows);
}

/** Fields that are large and never part of a spoken answer. */
const HEAVY_KEYS = new Set([
  "teethData",
  "photos",
  "images",
  "image",
  "attachments",
  "signature",
  "thumbnail",
  "base64",
  "embedding",
  "fcmTokens",
  "deviceTokens",
  "history",
  "xrays",
  "files",
]);

const MAX_STRING = 400;
const MAX_ARRAY = 20;
const MAX_NESTED = 1_500;

function slimValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) return undefined;
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((v) => slimValue(v, depth + 1)).filter((v) => v !== undefined);
    return value.length > MAX_ARRAY ? [...items, `… ${value.length - MAX_ARRAY} more`] : items;
  }
  if (value && typeof value === "object") {
    // Firestore timestamps and the like: keep them as they are, they are tiny.
    if (typeof (value as { toDate?: unknown }).toDate === "function") return value;
    const slim = slimDoc(value as Record<string, unknown>, depth + 1);
    if (depth >= 1 && JSON.stringify(slim).length > MAX_NESTED) return "[left out: too large]";
    return slim;
  }
  return value;
}

/** One record with the heavy fields removed and long values cut. */
export function slimDoc(doc: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (HEAVY_KEYS.has(key)) continue;
    const slim = slimValue(value, depth);
    if (slim !== undefined) out[key] = slim;
  }
  return out;
}

export type Fitted = { docs: Record<string, unknown>[]; leftOut: number };

/**
 * The turn's running total of read results.
 *
 * `fit` takes what a read found and returns the rows that still fit under the ceiling. The
 * moment anything is left out, `hit` is set: the route then stops offering reads and, for an
 * Owner or Admin, offers the deeper search.
 */
export class ReadBudget {
  used = 0;
  hit = false;

  constructor(readonly limits: ReadLimits) {}

  get remaining(): number {
    return Math.max(0, this.limits.ceilingChars - this.used);
  }

  fit(docs: Record<string, unknown>[]): Fitted {
    const kept: Record<string, unknown>[] = [];
    for (const doc of docs) {
      const size = JSON.stringify(doc).length;
      if (this.used + size > this.limits.ceilingChars) break;
      this.used += size;
      kept.push(doc);
    }
    const leftOut = docs.length - kept.length;
    if (leftOut > 0) this.hit = true;
    return { docs: kept, leftOut };
  }
}

/** What a read tool tells the model once the ceiling is reached. */
export const CEILING_MESSAGE =
  "The reading limit for this question is reached. Do not read more. Answer from what you already have, " +
  "and if that is not enough say plainly that you cannot work this out yet.";
