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
  /** Used when a patient has no list of their own. Exactly one list is the default. */
  isDefault: boolean;
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
      generalDiscountPercent: clampPercent(entry?.generalDiscountPercent),
      active: entry?.active !== false,
      isDefault: entry?.isDefault === true,
    }))
    .filter((list) => list.id && list.name);

  if (lists.length === 0) return [DEFAULT_PRICE_LIST];

  // Exactly one default, always. Two would make "which price?" ambiguous at the chair; none would
  // leave a new patient with no list at all.
  if (!lists.some((l) => l.isDefault && l.active)) {
    const fallback = lists.find((l) => l.active) || lists[0];
    return lists.map((l) => ({ ...l, isDefault: l.id === fallback.id }));
  }
  let seenDefault = false;
  return lists.map((l) => {
    if (l.isDefault && l.active && !seenDefault) {
      seenDefault = true;
      return l;
    }
    return { ...l, isDefault: false };
  });
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
  patientDefaultListId?: string | null
): string {
  const usable = (id: string | null | undefined) =>
    id && lists.some((l) => l.id === id && l.active) ? id : null;

  return (
    usable(storedListId) ||
    usable(patientDefaultListId) ||
    lists.find((l) => l.isDefault && l.active)?.id ||
    lists.find((l) => l.active)?.id ||
    STANDARD_LIST_ID
  );
}

export function findPriceList(lists: PriceList[], id?: string | null): PriceList | null {
  if (!id) return null;
  return lists.find((l) => l.id === id) || null;
}
