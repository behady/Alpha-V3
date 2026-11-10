"use client";

/**
 * The claims of one insurer whose approval date — or finish date — falls in [from, to], live.
 *
 * Reads `clinics/{clinicId}/insurance_claims` directly (clinic members may read it; only the
 * server writes it) with the `payerId + approvalDate` index, or `payerId + finishedDate` when the
 * page shows approvals by the day they were finished (the server stores that day on every write). Each document goes through
 * `parseClaim`, so a malformed one is dropped rather than rendered half-empty. The clinic id is
 * passed in, never taken from the global pointer, so a clinic switch re-subscribes.
 *
 * Newest first by the date asked for, which is the order the desk looks for "the one I just saved".
 */

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { CLAIMS_COLLECTION, isIsoDate, parseClaim, type InsuranceClaim } from "@/lib/insurance/claims";

export type ClaimDateField = "approvalDate" | "finishedDate";

const byNewest = (field: ClaimDateField) => (a: InsuranceClaim, b: InsuranceClaim): number => {
  const x = a[field] ?? "";
  const y = b[field] ?? "";
  if (x !== y) return x < y ? 1 : -1;
  return a.approvalNumber < b.approvalNumber ? 1 : a.approvalNumber > b.approvalNumber ? -1 : 0;
};

export function useClaims(
  clinicId: string | null,
  payerId: string,
  from: string,
  to: string,
  field: ClaimDateField = "approvalDate",
): { claims: InsuranceClaim[]; loading: boolean; failed: boolean } {
  // An inverted or half-typed range asks for nothing rather than for everything.
  const key = clinicId && payerId && isIsoDate(from) && isIsoDate(to) && from <= to ? `${clinicId}|${payerId}|${field}|${from}|${to}` : "";
  const [snap, setSnap] = useState<{ key: string; claims: InsuranceClaim[]; failed: boolean }>({ key: "", claims: [], failed: false });

  useEffect(() => {
    if (!key || !clinicId) return;
    const q = query(
      collection(db, "clinics", clinicId, CLAIMS_COLLECTION),
      where("payerId", "==", payerId),
      where(field, ">=", from),
      where(field, "<=", to),
    );
    return onSnapshot(
      q,
      (s) => {
        const claims = s.docs
          .map((d) => parseClaim(d.id, d.data()))
          .filter((c): c is InsuranceClaim => c !== null)
          .sort(byNewest(field));
        setSnap({ key, claims, failed: false });
      },
      (err) => {
        console.error("Insurance claims subscription failed", err);
        setSnap({ key, claims: [], failed: true });
      },
    );
  }, [key, clinicId, payerId, from, to, field]);

  const current = snap.key === key;
  return { claims: key && current ? snap.claims : [], loading: !!key && !current, failed: !!key && current && snap.failed };
}
