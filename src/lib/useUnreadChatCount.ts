"use client";

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";

/**
 * How many patient WhatsApp messages nobody has opened yet, across every chat.
 *
 * Drives the count on the rail's WhatsApp icon, so it is mounted for the whole session. It reads
 * the same collection the Chats page does, and Firestore shares one listener between identical
 * queries, so having both open costs nothing extra. Keyed on the clinic as well as the user: a
 * super-admin switching tenants must not carry the previous clinic's count across.
 */
export function useUnreadChatCount(): number {
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user || !clinicId) return;
    let ref;
    try {
      ref = getClinicCollection("whatsapp_conversations");
    } catch {
      return; // the global clinic is not set yet; the next clinicId change re-runs this
    }
    const unsub = onSnapshot(
      ref,
      // play_<uid> rows are staff rehearsing the bot, not patients; they never count.
      (snap) =>
        setCount(
          snap.docs.filter((d) => !d.id.startsWith("play_")).reduce((n, d) => n + (Number(d.data().unreadCount) || 0), 0)
        ),
      () => setCount(0)
    );
    return () => unsub();
  }, [user, clinicId]);

  // Signed out or between clinics: nothing to count, whatever the last listener reported.
  return user && clinicId ? count : 0;
}
