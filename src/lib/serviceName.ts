/**
 * A treatment's two names.
 *
 * `name` is the row's key: the importer merges on it, reports group by the ids it resolves to,
 * and an insurer's sheet prints it. `nameAr` is what an Arabic-speaking clinic reads and picks.
 * A treatment saved under its Arabic name is still the same catalogue row — the pricing match
 * accepts either — so a clinic set up in English can read its own list without renaming
 * anything (owner's request, 2026-10-08).
 */
export type NamedService = { name?: string | null; nameAr?: string | null };

/** The name to show: Arabic when the UI is Arabic and the row has one, else the English. */
export function serviceDisplayName(s: NamedService, isAr: boolean): string {
  const ar = typeof s.nameAr === "string" ? s.nameAr.trim() : "";
  if (isAr && ar) return ar;
  return String(s.name ?? "").trim();
}

/** Does this typed or stored name refer to this row, by either of its names? */
export function serviceMatchesName(s: NamedService, name: string): boolean {
  const wanted = String(name ?? "").trim();
  if (!wanted) return false;
  const en = String(s.name ?? "").trim();
  const ar = typeof s.nameAr === "string" ? s.nameAr.trim() : "";
  return wanted === en || (!!ar && wanted === ar);
}
