"use client";

import { useEffect, useState } from "react";
import { limit, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { getClinicCollection } from "@/lib/db-utils";
import { isDentistStaff } from "@/lib/staffRoles";

/**
 * Is the signed-in admin also one of the clinic's dentists?
 *
 * Read off their staff row — the "also works as dentist" tick on the team list — and never off
 * the user record, which was never given that flag for invited staff. In a solo practice the
 * person who runs the clinic is usually the one holding the handpiece, so this is common.
 *
 * Only admins are asked about: a plain dentist always gets the chair and is never offered a
 * choice, so the query is skipped for them and this returns false. Callers that need "can see
 * the chair at all" should check `role === "Dentist"` alongside this.
 */
export function useAlsoDentist(): boolean {
  const { user } = useAuth();
  const { clinicId, isAdmin } = useClinic();
  const [alsoDentist, setAlsoDentist] = useState(false);

  useEffect(() => {
    if (!user?.uid || !clinicId || !isAdmin) return;
    const q = query(getClinicCollection("staff"), where("uid", "==", user.uid), limit(1));
    const stop = onSnapshot(q, (snap) => {
      const row = snap.docs[0]?.data() as { role?: string; isDentist?: boolean } | undefined;
      setAlsoDentist(!!row && isDentistStaff(row));
    });
    // Clearing on the way out, not on the way in: React runs this before the next run of the
    // effect, so switching to a clinic where you are not a dentist cannot leave a stale `true`
    // behind — and it avoids setting state straight from an effect body, which cascades renders.
    return () => {
      stop();
      setAlsoDentist(false);
    };
  }, [user?.uid, clinicId, isAdmin]);

  return alsoDentist;
}
