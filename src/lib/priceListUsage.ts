"use client";

/**
 * Whether a price list can be deleted, and the tidying up if it can.
 *
 * The screen used to refuse on the wrong question. It asked "does this list have prices typed on
 * it?", and a list with prices could only ever be deactivated — which meant a clinic that set up
 * an insurer, priced sixty treatments, and then decided not to work with them was left with a dead
 * row it could never clear. That is the case this exists for: the insurer was deleted, its list
 * outlived it, and the bin was greyed out with no way forward.
 *
 * The question that actually matters is whether any RECORDED WORK points at the list. A treatment
 * carries its `priceListId` for ever, and deleting the list underneath it would leave a charge
 * referring to a tariff nobody can look up — that is worth refusing. Prices nobody has charged
 * anything at are just a draft, and a draft can be thrown away.
 *
 * Both collections are checked because they are written together: `/api/clinical/procedures`
 * stamps the list on the clinical note AND on the ledger row, and a note recorded without being
 * billed would otherwise be missed.
 */

import { deleteField, getCountFromServer, query, where, writeBatch, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getGlobalClinicId } from "@/lib/db-utils";

/** Firestore caps a batch at 500 operations; stay under it with room to spare. */
const BATCH_LIMIT = 400;

export type ListUsage = {
  /** Charges recorded on this list. */
  ledger: number;
  /** Treatments recorded on it, billed or not. */
  notes: number;
  /** What the message should quote: any recorded work at all. */
  total: number;
};

/**
 * How much recorded work names this list.
 *
 * Counted on the server rather than downloaded — a clinic with a year of history should not pay
 * for a full read to answer a yes/no question. A count that fails is treated as "in use", because
 * refusing a delete we cannot justify is recoverable and deleting one we should not is not.
 */
export async function countListUsage(listId: string): Promise<ListUsage> {
  if (!listId) return { ledger: 0, notes: 0, total: 0 };
  const countIn = async (collectionName: string) => {
    const snap = await getCountFromServer(
      query(getClinicCollection(collectionName), where("priceListId", "==", listId)),
    );
    return snap.data().count;
  };
  const [ledger, notes] = await Promise.all([countIn("ledger"), countIn("clinical_notes")]);
  return { ledger, notes, total: ledger + notes };
}

/**
 * Take this list's prices off every treatment that carries one.
 *
 * `prices` is a map on the service keyed by list id, so removing a list means removing its key
 * from each service that has one — not clearing the map, which would wipe every other list's
 * prices with it. Written as a real deletion rather than a zero: a stored 0 means "free", and this
 * list charging nothing is exactly what it must not come to mean.
 */
export async function clearListPrices(listId: string, serviceIds: readonly string[]): Promise<void> {
  const clinicId = getGlobalClinicId();
  if (!clinicId || !listId || serviceIds.length === 0) return;

  for (let i = 0; i < serviceIds.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const id of serviceIds.slice(i, i + BATCH_LIMIT)) {
      batch.update(doc(db, `clinics/${clinicId}/services`, id), { [`prices.${listId}`]: deleteField() });
    }
    await batch.commit();
  }
}
