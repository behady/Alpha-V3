"use client";

import { useEffect, useMemo, useState } from "react";
import { documentId, onSnapshot, query, where } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { shareMayBeOpen, shareStillOpen, type InsuranceClaim } from "@/lib/insurance/claims";
import type { InsurerRowLite } from "@/lib/ledgerInsurer";

/** Firestore's ceiling on an `in` filter. */
const IN_LIMIT = 30;

/**
 * The patient's share still unpaid on each approval, read live from its treatment rows.
 *
 * Only the claims whose share is not stamped collected are looked at, so a clinic's settled
 * approvals cost no reads. Returns a lookup: the open amount, 0 when paid (by the Collect button or
 * by ordinary payments against the treatments), or null while the rows are still loading.
 */
export function useOpenShares(claims: InsuranceClaim[]): (claim: InsuranceClaim) => number | null {
  const ids = useMemo(
    () =>
      [...new Set(claims.filter(shareMayBeOpen).flatMap((c) => Object.values(c.ledgerIds).map((l) => l.ledgerId)))].sort(),
    [claims],
  );
  const idsKey = ids.join(",");
  const [rows, setRows] = useState<ReadonlyMap<string, InsurerRowLite | null>>(new Map());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!idsKey) return;
    const wanted = idsKey.split(",");
    const chunks: string[][] = [];
    for (let i = 0; i < wanted.length; i += IN_LIMIT) chunks.push(wanted.slice(i, i + IN_LIMIT));
    const stops = chunks.map((chunk) =>
      onSnapshot(
        query(getClinicCollection("ledger"), where(documentId(), "in", chunk)),
        (snap) => {
          setRows((prev) => {
            const next = new Map(prev);
            // An id the query no longer returns is a row that was deleted: null, skipped like the route skips it.
            for (const id of chunk) next.set(id, null);
            for (const d of snap.docs) next.set(d.id, d.data() as InsurerRowLite);
            return next;
          });
        },
        // Unreadable: the claim's own figure stands, as it did before the rows were read.
        () => setFailed(true),
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [idsKey]);

  return (claim) => (failed ? (shareMayBeOpen(claim) ? claim.totals.patientShare : 0) : shareStillOpen(claim, rows));
}
