"use client";

/**
 * Price lists and the prices on them.
 *
 * Lists first: which list a service is priced on is the question you answer before its price, and
 * the blanket discount ceiling belongs beside that decision.
 *
 * Both panels only need the currency symbol, which lives on `settings/clinic_info` and — as of
 * Phase 1 — still has no screen that can change it. Read here, never written.
 */

import { useEffect, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import PriceListSettings from "@/components/settings/PriceListSettings";
import PricingSettings from "@/components/settings/PricingSettings";
import { getClinicDoc } from "@/lib/db-utils";

export default function PricesHost() {
  const [currency, setCurrency] = useState("EGP");

  useEffect(() => {
    const unsub = onSnapshot(getClinicDoc("settings", "clinic_info"), (snap) => {
      const value = snap.exists() ? (snap.data() as Record<string, unknown>).currency : null;
      if (typeof value === "string" && value.trim()) setCurrency(value.trim());
    });
    return () => unsub();
  }, []);

  return (
    <div className="space-y-6">
      <PriceListSettings currency={currency} />
      <PricingSettings currency={currency} />
    </div>
  );
}
