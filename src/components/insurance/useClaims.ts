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
 * By finish date a second, equally index-free question is asked: the approvals whose sheet month
 * the clinic PICKED (`sheetMonth`) falls in the range. They join the list, and an approval finished
 * in the range but picked onto another month leaves it — so the list is exactly the sheet.
 *
 * Newest first by the date asked for, which is the order the desk looks for "the one I just saved".
 */

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where, type DocumentData, type QuerySnapshot } from "firebase/firestore";
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
    const read = (s: QuerySnapshot<DocumentData>) =>
      s.docs.map((d) => parseClaim(d.id, d.data())).filter((c): c is InsuranceClaim => c !== null && c.payerId === payerId);
    const failed = (err: unknown) => {
      console.error("Insurance claims subscription failed", err);
      setSnap({ key, claims: [], failed: true });
    };

    if (field === "approvalDate") {
      return onSnapshot(
        query(claimsRef, where("payerId", "==", payerId), where("approvalDate", ">=", from), where("approvalDate", "<=", to)),
        (s) => setSnap({ key, claims: read(s).sort(byNewest(field)), failed: false }),
        failed,
      );
    }

    // By finish date: finished in the range, plus picked onto a month the range touches.
    const fromMonth = from.slice(0, 7);
    const toMonth = to.slice(0, 7);
    let finished: InsuranceClaim[] | null = null;
    let picked: InsuranceClaim[] | null = null;
    const publish = () => {
      if (finished === null || picked === null) return; // not until both have answered once
      const byId = new Map<string, InsuranceClaim>();
      for (const c of [...finished, ...picked]) byId.set(c.id, c);
      const claims = [...byId.values()]
        .filter((c) => !c.sheetMonth || (c.sheetMonth >= fromMonth && c.sheetMonth <= toMonth))
        .sort(byNewest(field));
      setSnap({ key, claims, failed: false });
    };
    const stops = [
      onSnapshot(
        query(claimsRef, where("finishedDate", ">=", from), where("finishedDate", "<=", to)),
        (s) => {
          finished = read(s);
          publish();
        },
        failed,
      ),
      onSnapshot(
        query(claimsRef, where("sheetMonth", ">=", fromMonth), where("sheetMonth", "<=", toMonth)),
        (s) => {
          picked = read(s);
          publish();
        },
        failed,
      ),
    ];
    return () => stops.forEach((stop) => stop());
  }, [key, clinicId, payerId, from, to, field]);

  const current = snap.key === key;
  return { claims: key && current ? snap.claims : [], loading: !!key && !current, failed: !!key && current && snap.failed };
}
