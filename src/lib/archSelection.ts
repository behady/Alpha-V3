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

/** The milk teeth, same order: 55…51, 61…65 and 85…81, 71…75. */
export const PRIMARY_UPPER_ARCH = ["55", "54", "53", "52", "51", "61", "62", "63", "64", "65"];
export const PRIMARY_LOWER_ARCH = ["85", "84", "83", "82", "81", "71", "72", "73", "74", "75"];

/** FDI quadrants 5–8 are the milk teeth. */
export function isPrimaryTooth(code: string): boolean {
  return /^[5-8][1-5]$/.test(String(code).trim());
}

/**
 * Which chart a selection belongs on: "primary" when every tooth picked is a milk tooth,
 * "permanent" when every one is an adult tooth, null when nothing is picked or it is mixed.
 * The picker follows this when a saved treatment is reopened, so a child's filling on 75 opens
 * on the child chart instead of an adult chart where the picked tooth is not even drawn.
 */
export function dentitionOf(selected: readonly string[]): "primary" | "permanent" | null {
  if (selected.length === 0) return null;
  if (selected.every(isPrimaryTooth)) return "primary";
  if (selected.some(isPrimaryTooth)) return null;
  return "permanent";
}

export function archTeeth(pick: ArchPick, primary = false): string[] {
  const upper = primary ? PRIMARY_UPPER_ARCH : UPPER_ARCH;
  const lower = primary ? PRIMARY_LOWER_ARCH : LOWER_ARCH;
  if (pick === "upper") return upper;
  if (pick === "lower") return lower;
  return [...upper, ...lower];
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
export function isArchPicked(selected: readonly string[], pick: ArchPick, missing: ReadonlySet<string>, primary = false): boolean {
  const have = new Set(selected);
  const present = archTeeth(pick, primary).filter((t) => !missing.has(t));
  const wanted = present.length > 0 ? present : archTeeth(pick, primary);
  return wanted.every((t) => have.has(t));
}

/** The arch's missing teeth, in chart order: what the dentist is asked about. */
export function missingInArch(pick: ArchPick, missing: ReadonlySet<string>, primary = false): string[] {
  return archTeeth(pick, primary).filter((t) => missing.has(t));
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
  includeMissing: boolean,
  primary = false
): string[] {
  const teeth = archTeeth(pick, primary);
  if (isArchPicked(selected, pick, missing, primary)) return selected.filter((t) => !teeth.includes(t));
  const add = teeth.filter((t) => includeMissing || !missing.has(t));
  const kept = includeMissing ? selected : selected.filter((t) => !(teeth.includes(t) && missing.has(t)));
  return Array.from(new Set([...kept, ...add]));
}
