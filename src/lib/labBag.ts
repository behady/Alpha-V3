/**
 * One visit, one bag.
 *
 * A dentist who does a crown and a veneer in one sitting sends one impression bag to one lab. In
 * the records those stay two orders, one per treatment, because the lab's money is counted through
 * the link between an order and the treatment that booked its fee. What is shared is everything a
 * person does by hand: the offers wait in a line instead of replacing each other, the second form
 * starts from the first one's answers, and the bag gets one sheet and one message.
 */

import type { LabCase, LabCaseSeed } from "@/lib/labCases";

/** Two offers are the same offer when they come from the same treatment. */
function sameOffer(a: LabCaseSeed, b: LabCaseSeed): boolean {
  return a === b || (Boolean(a.clinicalNoteId) && a.clinicalNoteId === b.clinicalNoteId);
}

/** Add an offer behind the ones already waiting. The same treatment offered again takes its own place. */
export function queueLabOffer(queue: LabCaseSeed[], seed: LabCaseSeed): LabCaseSeed[] {
  const at = queue.findIndex((q) => sameOffer(q, seed));
  if (at === -1) return [...queue, seed];
  return queue.map((q, i) => (i === at ? seed : q));
}

/**
 * Take an answered offer out of the line.
 *
 * By identity rather than "the first one": the form reports a save and a close in the same breath,
 * and dropping by position would throw away the next treatment's offer along with this one.
 */
export function dropLabOffer(queue: LabCaseSeed[], seed: LabCaseSeed | null | undefined): LabCaseSeed[] {
  if (!seed) return queue;
  return queue.filter((q) => !sameOffer(q, seed));
}

/** What the next order in the same bag starts from. */
export type LabCarry = {
  labName: string;
  dueDate: string;
  bodyShade: string;
  cervicalShade: string;
  /** Sent now, or kept as a draft: a bag leaves together. */
  sendNow: boolean;
};

/**
 * The answers that belong to the bag rather than to one piece of work in it.
 *
 * The lab, the day it comes back, and the patient's shade. Never the work, the teeth or the price:
 * those are what makes the second order a second order.
 */
export function carryFromOrder(made: LabCase): LabCarry {
  return {
    labName: made.labName || "",
    dueDate: made.dueDate || "",
    bodyShade: made.bodyShade || "",
    cervicalShade: made.cervicalShade || "",
    sendNow: made.status !== "draft",
  };
}

export type LabBagGroup = { labId: string; labName: string; cases: LabCase[] };

/**
 * The orders, one group per lab, in the order they were raised.
 *
 * A bag is what goes to one lab. Orders for two labs are two bags, with a sheet and a message each.
 */
export function bagByLab(cases: LabCase[]): LabBagGroup[] {
  const groups: LabBagGroup[] = [];
  const byKey = new Map<string, LabBagGroup>();
  for (const c of cases) {
    const key = c.labId ? `id:${c.labId}` : `name:${String(c.labName || "").trim().toLowerCase()}`;
    let group = byKey.get(key);
    if (!group) {
      group = { labId: c.labId || "", labName: String(c.labName || "").trim(), cases: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.cases.push(c);
  }
  return groups;
}
