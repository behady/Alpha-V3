"use client";

import { useEffect, useState } from "react";
import { limit, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicCollection } from "@/lib/db-utils";

/** The parts of the signed-in person's own staff row that the app's screens branch on. */
export type OwnStaffRow = {
  id: string;
  branchIds?: string[];
  isDentist?: boolean;
  role?: string;
};

/**
 * The signed-in person's own row in the clinic's staff list.
 *
 * One listener on `staff where uid == me`, shared in spirit by everything that needs it: the "also
 * works as dentist" tick (useAlsoDentist) and the branches this person may work in
 * (useActiveBranch). The user record never carries either, so the staff row is the only source.
 *
 * `enabled` lets a caller who has no use for the answer (an admin asking about branches) skip the
 * read altogether; a disabled hook reports `ready: true` with no row, so nobody waits on it.
 */
export function useOwnStaffRow(enabled = true): { row: OwnStaffRow | null; ready: boolean } {
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const [row, setRow] = useState<OwnStaffRow | null>(null);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (!enabled || !user?.uid || !clinicId) return;
    const q = query(getClinicCollection("staff"), where("uid", "==", user.uid), limit(1));
    const stop = onSnapshot(
      q,
      (snap) => {
        const doc = snap.docs[0];
        if (!doc) {
          setRow(null);
        } else {
          const d = doc.data() as { branchIds?: unknown; isDentist?: unknown; role?: unknown };
          setRow({
            id: doc.id,
            branchIds: Array.isArray(d.branchIds) ? (d.branchIds as string[]) : undefined,
            isDentist: typeof d.isDentist === "boolean" ? d.isDentist : undefined,
            role: typeof d.role === "string" ? d.role : undefined,
          });
        }
        setAnswered(true);
      },
      () => setAnswered(true)
    );
    // Clearing on the way out, not on the way in: React runs this before the next run of the
    // effect, so switching to a clinic where you have no row cannot leave a stale row behind —
    // and it avoids setting state straight from an effect body, which cascades renders.
    return () => {
      stop();
      setRow(null);
      setAnswered(false);
    };
  }, [enabled, user?.uid, clinicId]);

  return { row, ready: !enabled || answered };
}
