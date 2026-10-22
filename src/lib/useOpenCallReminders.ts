"use client";

import { useEffect, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { useActiveBranch } from "@/lib/useActiveBranch";
import { CALL_REMINDERS_COLLECTION, reminderFromDoc, type CallReminder } from "@/lib/callReminders";

/**
 * Every open call reminder of the branch on screen, live. One equality on `status` — no composite
 * index — and the branch is filtered here (a reminder with no branch shows everywhere, as every
 * branch-scoped list does).
 */
export function useOpenCallReminders(): { rows: CallReminder[]; loading: boolean } {
  const { matches } = useActiveBranch();
  const [all, setAll] = useState<CallReminder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      query(getClinicCollection(CALL_REMINDERS_COLLECTION), where("status", "==", "open")),
      (snap) => {
        setAll(snap.docs.map((d) => reminderFromDoc(d.id, d.data())));
        setLoading(false);
      },
      () => {
        setAll([]);
        setLoading(false);
      },
    );
  }, []);

  return { rows: all.filter((r) => matches(r.branchId)), loading };
}
