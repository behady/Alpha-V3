"use client";

/**
 * The clinic's price lists, discount reasons and discount ceiling, for whichever screen needs them.
 *
 * Both settings documents are seeded on first read rather than at onboarding, so a clinic that has
 * never opened the pricing screen still gets one list at full price and the standard reasons —
 * the same lesson as `clinicSchedule`, where nothing seeds the hours and every caller had to cope.
 *
 * The ceiling returned here is for display: it lets the editor warn before someone types a
 * discount that will be refused. The refusal itself happens server-side, which is the only place
 * a limit means anything.
 */

import { useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { getClinicDoc } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import {
  DISCOUNTS_DOC,
  PRICE_LISTS_DOC,
  parseDiscountSettings,
  parsePriceLists,
  type DiscountSettings,
  type PriceList,
} from "@/lib/priceLists";
import { allowedDiscount } from "@/lib/discountMath";

export type PricingPolicy = {
  priceLists: PriceList[];
  discountSettings: DiscountSettings;
  /** null = no ceiling (an Admin). */
  maxDiscountPercent: number | null;
  loading: boolean;
};

export function usePricingPolicy(): PricingPolicy {
  const { user } = useAuth();
  const [priceLists, setPriceLists] = useState<PriceList[]>(() => parsePriceLists(null));
  const [discountSettings, setDiscountSettings] = useState<DiscountSettings>(() => parseDiscountSettings(null));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let settled = 0;
    const done = () => {
      settled += 1;
      if (settled >= 2) setLoading(false);
    };

    const unsubLists = onSnapshot(
      getClinicDoc("settings", PRICE_LISTS_DOC),
      (snap) => {
        setPriceLists(parsePriceLists(snap.exists() ? snap.data() : null));
        done();
      },
      () => done()
    );
    const unsubDiscounts = onSnapshot(
      getClinicDoc("settings", DISCOUNTS_DOC),
      (snap) => {
        setDiscountSettings(parseDiscountSettings(snap.exists() ? snap.data() : null));
        done();
      },
      () => done()
    );

    return () => {
      unsubLists();
      unsubDiscounts();
    };
  }, [user]);

  const maxDiscountPercent = useMemo(
    () => allowedDiscount(user?.role, user?.permissions, discountSettings).maxPercent,
    [user?.role, user?.permissions, discountSettings]
  );

  return { priceLists, discountSettings, maxDiscountPercent, loading };
}
