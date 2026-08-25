/**
 * Price lists — the clinic's several ways of charging for the same treatment.
 *
 * One clinic quotes an insurer differently from a walk-in, and a family rate differently again.
 * Until now there was exactly one `price` per service and every other rate was typed in by hand at
 * the chair, which is both slow and impossible to audit: a discount that arrives as a lower typed
 * number is indistinguishable from a mistake.
 *
 * A list holds a set of prices AND a blanket discount percentage. The blanket percentage is a
 * PREFILL, not a hidden price: picking a service from a list that runs at 10% off fills in a 10%
 * line discount which is then visible on the note, the receipt, the ledger and the finance report,
 * and can be changed per line. That distinction is the whole point — a clinic that quietly charges
 * less cannot tell you at the end of the month what its discounting cost it.
 *
 * Stored at `clinics/{id}/settings/price_lists`. Firebase-free so the server, the browser and the
 * tests all read it the same way.
 */

export const PRICE_LISTS_DOC = "price_lists";
export const DISCOUNTS_DOC = "discounts";

/** The list every clinic has, whether or not anyone has opened the Settings screen. */
export const STANDARD_LIST_ID = "standard";

export type PriceList = {
  id: string;
  name: string;
  nameAr?: string;
  /** Prefilled per-line discount for services picked from this list. 0–100. */
  generalDiscountPercent: number;
  active: boolean;
  /**
   * The default for its own SCOPE — the branch it belongs to, or the clinic when it has none.
   * So a two-branch clinic has up to three defaults: one per branch, plus the clinic-wide one
   * that covers a branch which has set none of its own.
   */
  isDefault: boolean;
  /**
   * The branch this list belongs to. Absent = clinic-wide, offered at every branch.
   *
   * A branch does not own a separate copy of the price structure — prices still live on the
   * service, keyed by list id. What a branch owns is WHICH lists apply there. That way the
   * downtown branch can run an insurance list the seaside branch has never heard of, while both
   * keep charging the same Standard list for everything else, and adding a branch does not mean
   * re-typing every price. Absent rather than null, because Firestore refuses undefined and an
   * empty string would be a branch id that matches nothing — see [[firestore-undefined-rejects-writes]].
   */
  branchId?: string;
};

export type DiscountSettings = {
  reasons: string[];
  /** Highest discount a non-Admin may apply. null = no ceiling. */
  maxDiscountPercentNonAdmin: number | null;
};

/**
 * Seeded on first read rather than at onboarding.
 *
 * Nothing seeds `settings/clinic_info` either, and the lesson from that (see clinicSchedule's
 * `isConfigured` flag) is that a clinic which never opened a settings screen must still behave
 * sensibly. A clinic with no lists configured has exactly one, at full price, and never sees the
 * feature until it wants it.
 */
export const DEFAULT_PRICE_LIST: PriceList = {
  id: STANDARD_LIST_ID,
  name: "Standard",
  nameAr: "الأساسي",
  generalDiscountPercent: 0,
  active: true,
  isDefault: true,
};

export const DEFAULT_DISCOUNT_REASONS = [
  "Promotion",
  "Family & friends",
  "Insurance",
  "Staff",
  "Complaint resolution",
  "Other",
];

/** The ceiling a non-Admin may discount to without an Admin. Configurable per clinic. */
export const DEFAULT_MAX_DISCOUNT_PERCENT_NON_ADMIN = 20;

function clampPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** Read the stored document into a usable set of lists. Always returns at least one. */
export function parsePriceLists(data: Record<string, unknown> | null | undefined): PriceList[] {
  const raw = Array.isArray(data?.lists) ? (data!.lists as Record<string, unknown>[]) : [];

  const lists: PriceList[] = raw
    .map((entry) => ({
      id: String(entry?.id || "").trim(),
      name: String(entry?.name || "").trim(),
      // Spread rather than assigned, so a list with no Arabic name has NO `nameAr` key at all.
      // Assigning `undefined` here was enough to brick the whole screen: what this function
      // returns is handed straight back to setDoc() when anything is saved, and Firestore
      // rejects an undefined value outright ("Unsupported field value: undefined") before the
      // write ever leaves the browser. The first list a clinic created saved fine — the seeded
      // Standard list carries an Arabic name — and every action after it failed, because by
      // then the re-read list did not. See `toStoredList` for the other half of the guard.
      ...(typeof entry?.nameAr === "string" && entry.nameAr.trim() ? { nameAr: entry.nameAr } : {}),
      // Same conditional-spread rule as nameAr, and for the same reason.
      ...(typeof entry?.branchId === "string" && entry.branchId.trim()
        ? { branchId: entry.branchId.trim() }
        : {}),
      generalDiscountPercent: clampPercent(entry?.generalDiscountPercent),
      active: entry?.active !== false,
      isDefault: entry?.isDefault === true,
    }))
    .filter((list) => list.id && list.name);

  if (lists.length === 0) return [DEFAULT_PRICE_LIST];

  /**
   * One default per SCOPE, not one per clinic.
   *
   * Scope is the branch a list belongs to, or the clinic for a list that belongs to none. Two
   * defaults in the same scope would make "which price?" ambiguous at the chair; none would leave
   * a new patient at that branch with no list at all. A branch with no default of its own is fine
   * — it falls back to the clinic-wide default, which is what `resolveActiveListId` does next.
   */
  const scopeOf = (l: PriceList) => l.branchId ?? "";
  const scopes = new Set(lists.map(scopeOf));
  const claimed = new Set<string>();
  const out = lists.map((l) => {
    const scope = scopeOf(l);
    if (l.isDefault && l.active && !claimed.has(scope)) {
      claimed.add(scope);
      return l;
    }
    return l.isDefault ? { ...l, isDefault: false } : l;
  });

  // A scope whose only default was deactivated (or which never had one) promotes its first
  // active list, so every scope that has any usable list has exactly one default.
  for (const scope of scopes) {
    if (claimed.has(scope)) continue;
    const idx = out.findIndex((l) => scopeOf(l) === scope && l.active);
    if (idx >= 0) out[idx] = { ...out[idx], isDefault: true };
  }
  return out;
}

/**
 * The one way a list is turned back into a document field.
 *
 * Every optional field is spread in only when it holds a real value, so the object handed to
 * Firestore can never carry `undefined` — a value it refuses, throwing before the write is even
 * attempted. `parsePriceLists` is careful about this too, but a single missed spread anywhere in
 * a `.map()` over lists is enough to make every save on the pricing screen fail with nothing but
 * "Could not save" to go on, so the guarantee is made here, at the only place that writes.
 */
export function toStoredList(list: PriceList): Record<string, unknown> {
  return {
    id: list.id,
    name: list.name,
    ...(typeof list.nameAr === "string" && list.nameAr.trim() ? { nameAr: list.nameAr } : {}),
    ...(typeof list.branchId === "string" && list.branchId.trim() ? { branchId: list.branchId.trim() } : {}),
    generalDiscountPercent: clampPercent(list.generalDiscountPercent),
    active: list.active !== false,
    isDefault: list.isDefault === true,
  };
}

/** The whole `lists` field, ready to hand to setDoc. */
export function toStoredLists(lists: PriceList[]): Record<string, unknown>[] {
  return lists.map(toStoredList);
}

export function parseDiscountSettings(data: Record<string, unknown> | null | undefined): DiscountSettings {
  const reasons = Array.isArray(data?.reasons)
    ? (data!.reasons as unknown[]).map((r) => String(r).trim()).filter(Boolean)
    : [];
  const rawMax = data?.maxDiscountPercentNonAdmin;
  return {
    reasons: reasons.length > 0 ? reasons : DEFAULT_DISCOUNT_REASONS,
    maxDiscountPercentNonAdmin:
      rawMax === null
        ? null
        : rawMax === undefined
          ? DEFAULT_MAX_DISCOUNT_PERCENT_NON_ADMIN
          : clampPercent(rawMax),
  };
}

/** The list to open a service picker on: the note's own, then the patient's, then the clinic default. */
export function resolveActiveListId(
  lists: PriceList[],
  storedListId?: string | null,
  patientDefaultListId?: string | null,
  branchId?: string | null
): string {
  const at = listsForBranch(lists, branchId);
  const usable = (id: string | null | undefined) =>
    id && at.some((l) => l.id === id && l.active) ? id : null;

  return (
    // What was already chosen wins, but only if it is still usable HERE. A note carried to
    // another branch — or a patient whose usual list belongs to the branch across town — falls
    // through to that branch's own default rather than quoting a price it does not offer.
    usable(storedListId) ||
    usable(patientDefaultListId) ||
    // The branch's own default, then the clinic-wide one. A branch that has set no list of its
    // own is not a branch with no prices; it is a branch that charges what the clinic charges.
    at.find((l) => l.isDefault && l.active && l.branchId === branchId && branchId)?.id ||
    at.find((l) => l.isDefault && l.active && !l.branchId)?.id ||
    at.find((l) => l.isDefault && l.active)?.id ||
    at.find((l) => l.active)?.id ||
    STANDARD_LIST_ID
  );
}

/**
 * The lists that may be charged at a branch: its own, plus every clinic-wide one.
 *
 * Called with no branch (a clinic that has never opened the Branches screen, or a screen with no
 * branch in hand) this returns everything — the feature stays invisible until it is used, which
 * is the same bargain `parseClinicBranches` makes.
 */
export function listsForBranch(lists: PriceList[], branchId?: string | null): PriceList[] {
  if (!branchId) return lists;
  return lists.filter((l) => !l.branchId || l.branchId === branchId);
}

export function findPriceList(lists: PriceList[], id?: string | null): PriceList | null {
  if (!id) return null;
  return lists.find((l) => l.id === id) || null;
}
