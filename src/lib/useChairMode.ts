"use client";

import { useEffect, useState } from "react";
import { limit, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { getClinicCollection } from "@/lib/db-utils";
import { isChairMode } from "@/lib/chairMode";

/**
 * The signed-in person's chair-mode answer, plus who they are on the staff list.
 *
 * `ready` is false until the staff row has been looked up once: a screen that hid money before
 * knowing would flash prices at a dentist, and one that showed the chair controls with an empty
 * `staffId` would treat every note as theirs (see `canTouch` in chairPopup.ts).
 */
export function useChairMode(): { chair: boolean; staffId: string; staffName: string; ready: boolean } {
  const { user } = useAuth();
  const { clinicId, role } = useClinic();
  const { homeView } = useUI();
  const [staff, setStaff] = useState<{ id: string; name: string; isDentist: boolean } | null | undefined>(undefined);

  useEffect(() => {
    if (!user?.uid || !clinicId) return;
    const q = query(getClinicCollection("staff"), where("uid", "==", user.uid), limit(1));
    return onSnapshot(
      q,
      (snap) => {
        const d = snap.docs[0];
        if (!d) return setStaff(null);
        const data = d.data();
        setStaff({ id: d.id, name: String(data.name || user.name || ""), isDentist: data.isDentist === true });
      },
      () => setStaff(null),
    );
  }, [user?.uid, user?.name, clinicId]);

  return {
    chair: isChairMode({ role, isDentist: staff?.isDentist, homeView }),
    staffId: staff?.id ?? "",
    staffName: staff?.name ?? "",
    ready: staff !== undefined,
  };
}
