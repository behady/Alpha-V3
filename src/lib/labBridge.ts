/**
 * Bridges on a lab order.
 *
 * "Zirconia on 16, 15, 14" is three single crowns or one three-unit bridge, and a technician
 * cannot make the right one from a list of teeth. So an order can say that neighbouring teeth are
 * JOINED, and which of them are pontics: the teeth the bridge replaces rather than sits on.
 *
 * Two facts are stored, `bridge` and `pontics`. Everything else here is read off the picked teeth:
 * which of them are neighbours, and what to write for the lab. An order from before bridges has
 * neither field and reads as separate crowns, which is what it always meant.
 *
 * Permanent teeth only. Nobody bridges a child's teeth.
 */

import { FDI_LOWER, FDI_UPPER, toPalmer, workTypeFor } from "@/lib/labCases";

/** Both arches in chart order. Neighbours on the chart are neighbours here, across the midline too. */
const ARCHES: readonly number[][] = [FDI_UPPER, FDI_LOWER];

type BridgeFields = { teeth: number[]; bridge?: boolean; pontics?: number[] };

/** Whether this kind of work can be joined at all: crowns can, a denture or a guard cannot. */
export function bridgeWorkApplies(workType: string | null | undefined): boolean {
  const wt = workTypeFor(workType);
  return wt.units && !wt.guide;
}

/**
 * The picked teeth that stand next to each other, as groups of two or more, in chart order.
 *
 * A tooth on its own is in no group: it is a single crown whatever the rest of the order is.
 */
export function bridgeRuns(teeth: readonly number[]): number[][] {
  const picked = new Set(teeth.map(Number));
  const runs: number[][] = [];
  for (const arch of ARCHES) {
    let run: number[] = [];
    for (const tooth of arch) {
      if (picked.has(tooth)) {
        run.push(tooth);
        continue;
      }
      if (run.length >= 2) runs.push(run);
      run = [];
    }
    if (run.length >= 2) runs.push(run);
  }
  return runs;
}

/**
 * What the patient's chart says about the picked teeth.
 *
 * A group of neighbours that includes a tooth the patient no longer has is a bridge, and that
 * tooth is its pontic. A group with every tooth present is separate crowns until somebody says
 * otherwise, and a group with every tooth gone has nothing to sit on, so it is not a bridge.
 */
export function suggestBridge(
  teeth: readonly number[],
  missing: readonly number[]
): { bridge: boolean; pontics: number[] } {
  const gone = new Set(missing.map(Number));
  const pontics: number[] = [];
  for (const run of bridgeRuns(teeth)) {
    const replaced = run.filter((t) => gone.has(t));
    if (replaced.length > 0 && replaced.length < run.length) pontics.push(...replaced);
  }
  return { bridge: pontics.length > 0, pontics };
}

/**
 * Missing teeth that were NOT picked but sit between two teeth that were.
 *
 * The dentist picked the two supports and left the gap out. Offered, never added silently: the
 * same two teeth can also be two crowns either side of a space nobody is closing.
 */
export function bridgeGaps(teeth: readonly number[], missing: readonly number[]): number[] {
  const picked = new Set(teeth.map(Number));
  const gone = new Set(missing.map(Number));
  const gaps: number[] = [];
  for (const arch of ARCHES) {
    let between: number[] = [];
    let open = false;
    for (const tooth of arch) {
      if (picked.has(tooth)) {
        if (open) gaps.push(...between);
        between = [];
        open = true;
      } else if (open && gone.has(tooth)) {
        between.push(tooth);
      } else {
        // A tooth still in the mouth, and not part of this work: no bridge crosses it.
        between = [];
        open = false;
      }
    }
  }
  return gaps;
}

/** The pontics that are really part of a joined group, in chart order. */
export function cleanPontics(teeth: readonly number[], pontics: readonly number[] | undefined): number[] {
  const marked = new Set((pontics ?? []).map(Number));
  return bridgeRuns(teeth)
    .flat()
    .filter((t) => marked.has(t));
}

export type BridgeGroup = { teeth: number[]; supports: number[]; pontics: number[] };

/**
 * The joined groups of an order, and the teeth left on their own. Null when nothing is joined.
 *
 * The one reading of `bridge` and `pontics` that the message, the paper and the form all share,
 * so they cannot describe the same order three ways.
 */
export function bridgeGroups(labCase: BridgeFields): { groups: BridgeGroup[]; singles: number[] } | null {
  if (labCase.bridge !== true) return null;
  const runs = bridgeRuns(labCase.teeth);
  if (runs.length === 0) return null;
  const hanging = new Set(cleanPontics(labCase.teeth, labCase.pontics));
  const joined = new Set(runs.flat());
  return {
    groups: runs.map((run) => ({
      teeth: run,
      supports: run.filter((t) => !hanging.has(t)),
      pontics: run.filter((t) => hanging.has(t)),
    })),
    singles: labCase.teeth.map(Number).filter((t) => !joined.has(t)),
  };
}

/** `Bridge, 3 units` or, with no tooth replaced, `Joined crowns, 2 units`. */
export function bridgeTitle(group: BridgeGroup, language: "en" | "ar"): string {
  const n = group.teeth.length;
  if (group.pontics.length === 0) return language === "ar" ? `تيجان متصلة ${n} وحدات` : `Joined crowns, ${n} units`;
  return language === "ar" ? `كوبري ${n} وحدات` : `Bridge, ${n} units`;
}

/**
 * Teeth as typed marks, for plain text.
 *
 * In an Arabic line they are wrapped in a left-to-right island (U+2066 … U+2069). The bracket's
 * side IS the quadrant, and right-to-left layout would otherwise move it across its number and
 * name the opposite side of the mouth.
 */
function labels(teeth: number[], language: "en" | "ar"): string {
  const text = teeth
    .map((t) => toPalmer(t)?.label)
    .filter(Boolean)
    .join(" ");
  return language === "ar" ? `⁦${text}⁩` : text;
}

/**
 * What the lab reads in a message: one line per joined group, then the teeth left on their own.
 *
 * Empty for an order that is not joined, so separate crowns read exactly as they always have.
 */
export function bridgeLines(labCase: BridgeFields, language: "en" | "ar"): string[] {
  const found = bridgeGroups(labCase);
  if (!found) return [];
  const isAr = language === "ar";

  const lines = found.groups.map((group) => {
    const title = bridgeTitle(group, language);
    if (group.pontics.length === 0) return `${title}: ${labels(group.teeth, language)}`;
    return isAr
      ? `${title} · دعامات: ${labels(group.supports, language)} · بونتيك: ${labels(group.pontics, language)}`
      : `${title} · supports: ${labels(group.supports, language)} · pontic: ${labels(group.pontics, language)}`;
  });
  if (found.singles.length > 0) {
    lines.push(isAr ? `منفرد: ${labels(found.singles, language)}` : `Single: ${labels(found.singles, language)}`);
  }
  return lines;
}
