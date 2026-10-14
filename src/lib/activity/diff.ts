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
