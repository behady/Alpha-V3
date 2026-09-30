/**
 * Every document in a collection, however many there are.
 *
 * The briefing loader caps its scans because a brief is a summary and a 4,000-row sample is
 * enough for one. A backup that quietly stopped at row 4,000 would be worse than none, because the
 * owner would trust it. So this pages: ordered by document id (a total order that needs no index),
 * `startAfter` the last document of each page, until a page comes back short.
 *
 * Typed against the few methods it calls rather than firebase-admin's classes, so a test can hand
 * it a fake collection and count the reads.
 */

import { FieldPath } from "firebase-admin/firestore";

export type PageDoc = { id: string; data(): Record<string, unknown> | undefined };
export type PageableQuery = {
  limit(n: number): PageableQuery;
  startAfter(cursor: PageDoc): PageableQuery;
  get(): Promise<{ docs: PageDoc[] }>;
};
export type PageableCollection = { orderBy(field: FieldPath): PageableQuery };

export type ReadDoc = { id: string; data: Record<string, unknown> };

/** Page size per read: one round trip each, small enough that a page never strains a route's memory. */
export const DEFAULT_PAGE = 1000;

export async function readAllDocs(ref: PageableCollection, pageSize = DEFAULT_PAGE): Promise<ReadDoc[]> {
  const out: ReadDoc[] = [];
  let last: PageDoc | null = null;
  for (;;) {
    let q = ref.orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    for (const doc of snap.docs) out.push({ id: doc.id, data: doc.data() || {} });
    if (snap.docs.length < pageSize) return out;
    last = snap.docs[snap.docs.length - 1];
  }
}
