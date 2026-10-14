/**
 * What really changed between a record before and after an edit, as the `changes` list of an
 * activity event. Both sides are normalised first so that a re-typed but identical value ("1500"
 * vs 1500, "" vs null, a Timestamp vs the same day as text) is not reported as an edit.
 */

import { clinicTimeZone, ymdInTimeZone } from "../clinicDate";
import type { Change, Scalar } from "./types";

/** The calendar day on the clinic's clock: 01:00 in Cairo is still yesterday in UTC. */
const isoDay = (d: Date): string | null => (Number.isNaN(d.getTime()) ? null : ymdInTimeZone(clinicTimeZone(), d));

/** Firestore Timestamps expose toDate(); the rest of the world uses Date. */
function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    const d = (value as { toDate: () => unknown }).toDate();
    return d instanceof Date ? d : null;
  }
  return null;
}

type Norm = { kind: "scalar"; value: Scalar } | { kind: "complex"; key: string };

function normalise(value: unknown): Norm {
  if (value === undefined || value === null) return { kind: "scalar", value: null };
  const date = asDate(value);
  if (date) return { kind: "scalar", value: isoDay(date) };
  if (typeof value === "string") {
    const t = value.trim();
    if (t === "") return { kind: "scalar", value: null };
    // A phone or code ("01012345678", 9+ digits) is an identifier, not a quantity: keep it as text.
    if (/^-?\d+(\.\d+)?$/.test(t) && !/^0\d/.test(t) && !/^-?\d{9,}/.test(t)) return { kind: "scalar", value: Number(t) };
    return { kind: "scalar", value: t };
  }
  if (typeof value === "number") return { kind: "scalar", value: Number.isFinite(value) ? value : null };
  if (typeof value === "boolean") return { kind: "scalar", value };
  return { kind: "complex", key: JSON.stringify(value) ?? "" };
}

export function diffChanges(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly string[],
): Change[] {
  const out: Change[] = [];
  for (const field of fields) {
    const a = normalise(prev?.[field]);
    const b = normalise(next?.[field]);
    if (a.kind === "complex" || b.kind === "complex") {
      // Arrays and objects: compare as JSON, report the label alone (no value to print).
      const ja = a.kind === "complex" ? a.key : JSON.stringify(a.value);
      const jb = b.kind === "complex" ? b.key : JSON.stringify(b.value);
      if (ja !== jb) out.push({ field, from: null, to: null });
      continue;
    }
    if (a.value !== b.value) out.push({ field, from: a.value, to: b.value });
  }
  return out;
}

/**
 * Any value as a comparable key: scalars as diffChanges sees them (trimmed, "" = null, dates on
 * the clinic clock), objects with their keys sorted and blank entries dropped, and an empty list
 * or object the same as nothing. So a map read back from Firestore in another key order, or an
 * absent field against an empty one, is not a change.
 */
function keyOf(value: unknown): string {
  if (Array.isArray(value)) return value.length ? `[${value.map(keyOf).join(",")}]` : "null";
  if (value && typeof value === "object" && !asDate(value)) {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => keyOf(o[k]) !== "null").sort();
    return keys.length ? `{${keys.map((k) => `${JSON.stringify(k)}:${keyOf(o[k])}`).join(",")}}` : "null";
  }
  const n = normalise(value);
  return n.kind === "scalar" ? JSON.stringify(n.value) : n.key;
}

/**
 * A change reported by its label alone, for values that must not or cannot be printed (medical
 * text, maps, slugs): one `{field, from: null, to: null}` when the two sides differ, else none.
 */
export function labelOnlyChange(field: string, prev: unknown, next: unknown): Change[] {
  return keyOf(prev) === keyOf(next) ? [] : [{ field, from: null, to: null }];
}

/**
 * The details of the items of a named list that are on both sides (matched by id): `valueFields`
 * as from → to, `labelFields` by label alone. `names` lists the items that changed, by name, so
 * the event can say which branch, lab or insurer it was about. Added, removed and renamed items
 * are branchListChanges' job, not this one's.
 */
export function namedItemChanges<T extends { id: string; name?: string | null }>(
  prev: ReadonlyArray<T>,
  next: ReadonlyArray<T>,
  valueFields: readonly string[],
  labelFields: readonly string[] = [],
): { changes: Change[]; names: string[] } {
  const changes: Change[] = [];
  const names: string[] = [];
  for (const item of next) {
    const old = prev.find((p) => p.id === item.id);
    if (!old) continue;
    const a = old as unknown as Record<string, unknown>;
    const b = item as unknown as Record<string, unknown>;
    const mine = [
      ...diffChanges(a, b, valueFields),
      ...labelFields.flatMap((f) => labelOnlyChange(f, a[f], b[f])),
    ];
    if (!mine.length) continue;
    changes.push(...mine);
    const name = String(item.name ?? old.name ?? "").trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return { changes, names };
}

/**
 * What changed in a settings list of named items (branches, labs, insurers), matched by id: one
 * change per removed item (`name → null`), renamed item (`old → new`) and added item (`null →
 * name`), in that order. Only names are ever reported, never the ids. `field` is the label the
 * changes are shown under ("branch", "lab", "payer").
 */
export function branchListChanges(
  prev: ReadonlyArray<{ id: string; name?: string | null }>,
  next: ReadonlyArray<{ id: string; name?: string | null }>,
  field = "branch",
): Change[] {
  const nameOf = (n: string | null | undefined): string | null => {
    const t = typeof n === "string" ? n.trim() : "";
    return t === "" ? null : t;
  };
  const before = new Map(prev.map((p) => [p.id, nameOf(p.name)]));
  const after = new Map(next.map((n) => [n.id, nameOf(n.name)]));
  const out: Change[] = [];
  for (const [id, name] of before) {
    if (!after.has(id)) {
      if (name !== null) out.push({ field, from: name, to: null });
    } else if (after.get(id) !== name) {
      out.push({ field, from: name, to: after.get(id) ?? null });
    }
  }
  for (const [id, name] of after) {
    if (!before.has(id) && name !== null) out.push({ field, from: null, to: name });
  }
  return out;
}

/**
 * Which discount event a treatment's discount moving from `old` to `neu` is, and the figure the
 * line shows: the new discount when one is given, the old one when it is taken off, and the
 * difference when it is changed. No change is no event.
 */
export function discountEvent(
  old: number,
  neu: number,
): { event: "discount.given" | "discount.changed" | "discount.removed"; amount: number } | null {
  if (old === neu) return null;
  if (old === 0 && neu > 0) return { event: "discount.given", amount: neu };
  if (neu === 0 && old > 0) return { event: "discount.removed", amount: old };
  // Rounded to the piastre: 0.3 - 0.1 is 0.19999999999999998 in floating point.
  return { event: "discount.changed", amount: Math.round((neu - old) * 100) / 100 };
}
