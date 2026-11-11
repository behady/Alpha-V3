"use client";

/**
 * The claims of one insurer whose approval date — or finish date — falls in [from, to], live.
 *
 * Reads `clinics/{clinicId}/insurance_claims` directly (clinic members may read it; only the
 * server writes it) with the `payerId + approvalDate` index. By finish date (the day the server
 * stores on every write) it asks for the clinic's approvals finished in the range and keeps this
 * insurer's here: a month of one clinic's approvals is a small list, and it needs no new index —
 * so the page cannot be broken by a deploy that has not built one yet. Each document goes through
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
    const claimsRef = collection(db, "clinics", clinicId, CLAIMS_COLLECTION);
    const q =
      field === "approvalDate"
        ? query(claimsRef, where("payerId", "==", payerId), where("approvalDate", ">=", from), where("approvalDate", "<=", to))
        : query(claimsRef, where("finishedDate", ">=", from), where("finishedDate", "<=", to));
    return onSnapshot(
      q,
      (s) => {
        const claims = s.docs
          .map((d) => parseClaim(d.id, d.data()))
          .filter((c): c is InsuranceClaim => c !== null && c.payerId === payerId)
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
