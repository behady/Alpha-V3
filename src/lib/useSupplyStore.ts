"use client";

import { useCallback, useEffect, useState } from "react";
import { auth } from "@/lib/firebase";

/**
 * Whether there is a partner supply shop to show, and what it is called.
 *
 * Asked by the sidebar before it draws the Store item and by the store page itself. A rail link
 * to a shop nobody has connected reads as a broken feature rather than an unconfigured one, so
 * the item is absent until the platform has actually wired a shop up.
 *
 * Starts as not-connected and only ever becomes connected on a successful answer: every failure
 * mode — signed out, offline, a 500 — leaves the item hidden, which is the harmless direction.
 */
export interface SupplyStoreStatus {
  loading: boolean;
  connected: boolean;
  storeName: string;
  currency: string;
  deliveryNote: string;
  /** A partner discount applies to every order. The code itself never reaches the browser. */
  membersDiscount: boolean;
}

const IDLE: SupplyStoreStatus = {
  loading: true,
  connected: false,
  storeName: "",
  currency: "EGP",
  deliveryNote: "",
  membersDiscount: false,
};

export function useSupplyStoreStatus(): SupplyStoreStatus {
  const [status, setStatus] = useState<SupplyStoreStatus>(IDLE);

  const load = useCallback(async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        setStatus({ ...IDLE, loading: false });
        return;
      }
      const res = await fetch("/api/store/status", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setStatus({ ...IDLE, loading: false });
        return;
      }
      setStatus({
        loading: false,
        connected: json.connected === true,
        storeName: typeof json.storeName === "string" ? json.storeName : "",
        currency: typeof json.currency === "string" && json.currency ? json.currency : "EGP",
        deliveryNote: typeof json.deliveryNote === "string" ? json.deliveryNote : "",
        membersDiscount: json.membersDiscount === true,
      });
    } catch {
      setStatus({ ...IDLE, loading: false });
    }
  }, []);

  useEffect(() => {
    // The layout mounts before Firebase has restored the session, and asking then gets a 401 that
    // would hide the item for the whole visit. Waiting for the auth state means one extra tick
    // and a rail that is right.
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) void load();
      else setStatus({ ...IDLE, loading: false });
    });
    return () => unsubscribe();
  }, [load]);

  return status;
}
