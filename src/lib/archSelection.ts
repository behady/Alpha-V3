/**
 * Picking a whole arch, or the whole mouth, on the teeth chart — and what to do about the teeth
 * that are no longer there.
 *
 * A per-tooth price picked over a full arch multiplies by the teeth in it, so "the arch" has to
 * mean the teeth the patient actually has: a lower arch with 36 and 46 out is 14 teeth, not 16.
 * The chart knows a tooth is gone two ways — a "missing / extracted" (or congenitally missing)
 * diagnosis on the patient's chart, or a completed extraction in the treatment history that
 * nothing replaced since. Either counts. Whether to leave them out is still the dentist's call
 * (a full denture is quoted on the arch, not the teeth), so the chart asks rather than decides.
 *
 * Pure: no React, no Firestore. `tests/archSelection.test.mts`.
 */

import { isMissingStatus, normalizeToothData, type ToothData } from "@/lib/diagnosisCatalog";
import { resolveTreatments, type ToothTreatment } from "@/lib/toothTreatments";

export type ArchPick = "upper" | "lower" | "full";

/** FDI order, patient's right to left: 18…11, 21…28 and 48…41, 31…38. */
export const UPPER_ARCH = ["18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28"];
export const LOWER_ARCH = ["48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38"];

export function archTeeth(pick: ArchPick): string[] {
  if (pick === "upper") return UPPER_ARCH;
  if (pick === "lower") return LOWER_ARCH;
  return [...UPPER_ARCH, ...LOWER_ARCH];
}

/** Teeth the chart records as gone: a missing diagnosis, or an extraction nothing has replaced. */
export function missingTeeth(
  teethData: Record<string, ToothData | string | undefined> | null | undefined,
  treatments: Record<string, ToothTreatment[] | undefined> | null | undefined
): Set<string> {
  const out = new Set<string>();
  for (const [tooth, raw] of Object.entries(teethData ?? {})) {
    if (isMissingStatus(normalizeToothData(raw).statuses ?? [])) out.add(tooth);
  }
  for (const [tooth, entries] of Object.entries(treatments ?? {})) {
    if (resolveTreatments(entries).form?.state === "extracted") out.add(tooth);
  }
  return out;
}

/**
 * Is this arch "ticked"? Every tooth of it the patient still has is selected — so an arch picked
 * without its missing teeth still shows as picked, and so does one picked with them.
 */
export function isArchPicked(selected: readonly string[], pick: ArchPick, missing: ReadonlySet<string>): boolean {
  const have = new Set(selected);
  const present = archTeeth(pick).filter((t) => !missing.has(t));
  const wanted = present.length > 0 ? present : archTeeth(pick);
  return wanted.every((t) => have.has(t));
}

/** The arch's missing teeth, in chart order: what the dentist is asked about. */
export function missingInArch(pick: ArchPick, missing: ReadonlySet<string>): string[] {
  return archTeeth(pick).filter((t) => missing.has(t));
}

/**
 * The selection after ticking or unticking an arch. Unticking takes every tooth of the arch off
 * (missing ones included, in case they had been counted). Ticking adds the arch's teeth, leaving
 * the missing ones out unless `includeMissing`.
 */
export function toggleArch(
  selected: readonly string[],
  pick: ArchPick,
  missing: ReadonlySet<string>,
  includeMissing: boolean
): string[] {
  const teeth = archTeeth(pick);
  if (isArchPicked(selected, pick, missing)) return selected.filter((t) => !teeth.includes(t));
  const add = teeth.filter((t) => includeMissing || !missing.has(t));
  const kept = includeMissing ? selected : selected.filter((t) => !(teeth.includes(t) && missing.has(t)));
  return Array.from(new Set([...kept, ...add]));
}
