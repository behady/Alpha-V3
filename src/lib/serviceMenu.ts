/**
 * Which treatments a price list offers — its menu.
 *
 * A list used to change only PRICES: every list showed the same treatments, and the only way to
 * take one off a list was to make the list an insurer and untick it there. Two things a clinic
 * wants were impossible: a treatment that exists on one list alone (an insurer's own tariff
 * item, a package sold only to a partner), and a normal treatment simply not offered on a list.
 *
 * Two fields carry that, and this module is the one place they are read together:
 *
 *   - `listId` on a SERVICE: this treatment belongs to that list and is offered nowhere else.
 *     Absent = shared, offered on every list. Held on the service, not copied into the list,
 *     because the service is what a note, a plan and the reports point at.
 *   - `hiddenServiceIds` on a LIST: shared treatments this list does not offer. Held on the
 *     list, because it is the list's decision and the treatment itself is unchanged.
 *
 * The insurer's coverage (`payerCoverageFilter`) still applies on top, exactly as before, so a
 * clinic that never uses either field sees no change at all.
 *
 * Pure: no database, no imports from the app. Every chair-side picker runs this ONE filter, so
 * a treatment can never be on the menu in one screen and off it in another.
 */

import { findPriceList, type PriceList } from "./priceLists";
import { payerCoverageFilter, type Payer } from "./payers";

/** The two fields this module reads off a treatment. Everything else on the record is ignored. */
export type MenuService = { id: string | number; listId?: string | null };

/**
 * True when the treatment belongs to a list other than the one in hand.
 *
 * "No list in hand" (null) means the standard menu, which never shows another list's own
 * treatments — a screen that has not yet chosen a list must not leak an insurer's tariff items.
 */
export function ownedByAnotherList(service: MenuService, listId: string | null | undefined): boolean {
  const owner = typeof service.listId === "string" ? service.listId.trim() : "";
  if (!owner) return false;
  return owner !== (listId || "");
}

/**
 * The one filter every picker runs: is this treatment on the menu of this list?
 *
 * Order matters only for what it says about intent: a list's OWN treatment needs no coverage
 * tick (creating it on the list was the tick); a shared treatment is subject to the list's hide
 * and to the insurer's coverage. A treatment with no id cannot be judged and is offered rather
 * than silently dropped — the same choice `payerCoverageFilter` makes, kept here so the two never
 * disagree.
 */
export function serviceMenuFilter(
  lists: readonly PriceList[],
  payers: readonly Payer[],
  listId: string | null | undefined,
): (service: MenuService) => boolean {
  const hidden = new Set(findPriceList(lists as PriceList[], listId)?.hiddenServiceIds ?? []);
  const covers = payerCoverageFilter(payers, listId);
  return (service) => {
    const id = String(service.id ?? "");
    if (!id) return true;
    if (ownedByAnotherList(service, listId)) return false;
    const own = typeof service.listId === "string" && service.listId.trim() !== "";
    if (own) return true;
    if (hidden.has(id)) return false;
    return covers(id);
  };
}
