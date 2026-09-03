"use client";

/**
 * Prices, as one screen instead of two stacked ones.
 *
 * This page used to render the price-list admin and then, far below it, the treatment catalogue —
 * so the thing staff open Prices for (adding a treatment, changing a price) sat under three
 * sections of list administration they touch about twice a year. The catalogue leads now, and
 * lists and discounts are tabs beside it rather than a scroll below it.
 *
 * The host owns the data and the panels only render and write it. That is not tidiness: the two
 * panels each used to open their own listener on `services` and on `settings/price_lists`, so
 * opening this page read the whole treatment catalogue twice. One listener each, here.
 */

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, orderBy, query } from "firebase/firestore";
import { Tag } from "lucide-react";
import PriceListSettings from "@/components/settings/PriceListSettings";
import PriceListWorkspace from "@/components/settings/PriceListWorkspace";
import PricingSettings, { type ServiceRow } from "@/components/settings/PricingSettings";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { countedNoun } from "@/lib/arabicCount";
import { isPricingMode } from "@/components/clinical-notes/utils";
import { useLanguage } from "@/context/LanguageContext";
import { useSettingsText } from "@/lib/useSettingsText";
import {
  DISCOUNTS_DOC,
  PRICE_LISTS_DOC,
  parseDiscountSettings,
  parsePriceLists,
  type DiscountSettings,
  type PriceList,
} from "@/lib/priceLists";

const PRICE_TABS = ["treatments", "lists", "discounts"] as const;
type PriceTab = (typeof PRICE_TABS)[number];

export default function PricesHost() {
  const { language, isRTL } = useLanguage();
  const ar = language === "ar";
  const txt = useSettingsText("pricesPage");

  const [tab, setTab] = useState<PriceTab>("treatments");
  const [currency, setCurrency] = useState("EGP");
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [lists, setLists] = useState<PriceList[]>(() => parsePriceLists(null));
  const [discounts, setDiscounts] = useState<DiscountSettings>(() => parseDiscountSettings(null));
  /** Which list is open for pricing. null = the tabs. Owned here so the workspace gets the screen. */
  const [openListId, setOpenListId] = useState<string | null>(null);

  useEffect(() => {
    const unsubClinic = onSnapshot(getClinicDoc("settings", "clinic_info"), (snap) => {
      const value = snap.exists() ? (snap.data() as Record<string, unknown>).currency : null;
      if (typeof value === "string" && value.trim()) setCurrency(value.trim());
    });
    const unsubServices = onSnapshot(query(getClinicCollection("services"), orderBy("name")), (snap) =>
      setServices(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ServiceRow, "id">) })))
    );
    const unsubLists = onSnapshot(getClinicDoc("settings", PRICE_LISTS_DOC), (snap) =>
      setLists(parsePriceLists(snap.exists() ? snap.data() : null))
    );
    const unsubDiscounts = onSnapshot(getClinicDoc("settings", DISCOUNTS_DOC), (snap) =>
      setDiscounts(parseDiscountSettings(snap.exists() ? snap.data() : null))
    );
    return () => {
      unsubClinic();
      unsubServices();
      unsubLists();
      unsubDiscounts();
    };
  }, []);

  /**
   * A treatment with no billing rule is charged per tooth by default — nobody decided that, and a
   * flat-fee treatment priced per tooth overcharges silently on every multi-tooth note. It is the
   * one thing on this screen that can be quietly wrong, so it is the one thing the rail warns about.
   */
  const unsetRules = useMemo(
    () => services.filter((s) => !isPricingMode(s.pricingMode)).length,
    [services]
  );

  const activeLists = useMemo(() => lists.filter((l) => l.active), [lists]);
  const defaultList = useMemo(
    () => activeLists.find((l) => l.isDefault && !l.branchId) || activeLists.find((l) => l.isDefault),
    [activeLists]
  );

  const headline = defaultList
    ? ar
      ? `اللي مش متسعّر على قائمة تانية بيتحاسب بـ"${defaultList.name}".`
      : `Anything not priced on another list is charged from “${defaultList.name}”.`
    : ar
      ? "مفيش قائمة افتراضية — العلاج بيتحاسب بالسعر الأساسي."
      : "No list is marked default, so treatments are charged at their standard price.";

  const ceiling =
    discounts.maxDiscountPercentNonAdmin === null
      ? txt.noCeiling
      : `${txt.ceilingUpTo} ${discounts.maxDiscountPercentNonAdmin}%`;

  const facts = [
    countedNoun(services.length, ar, {
      one: txt.treatmentOne,
      two: txt.treatmentTwo,
      few: txt.treatmentFew,
      many: txt.treatmentMany,
    }),
    countedNoun(activeLists.length, ar, {
      one: txt.listOne,
      two: txt.listTwo,
      few: txt.listFew,
      many: txt.listMany,
    }),
    ceiling,
  ].join(" · ");

  const openList = openListId ? lists.find((l) => l.id === openListId) : null;
  if (openList) {
    return <PriceListWorkspace list={openList} currency={currency} onBack={() => setOpenListId(null)} />;
  }

  return (
    <div className="w-full space-y-8 pb-4" dir={isRTL ? "rtl" : "ltr"}>
      {/* What this screen says, said once at the top: what a treatment costs when nobody chose a
          list, how much of the catalogue exists, and how far staff may discount it. */}
      <div className="rounded-[1.75rem] bg-ink-slab px-6 py-6 text-white shadow-lg shadow-ink-slab/15 sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="flex items-center gap-2 font-display text-[10px] font-black uppercase tracking-[0.22em] text-white/45">
              <Tag size={12} />
              {txt.title}
            </p>
            <p className="font-display text-lg font-bold leading-snug text-white sm:text-xl">{headline}</p>
            <p className="font-figure text-[15px] tracking-tight text-white/70">{facts}</p>
          </div>

          <div className="shrink-0">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${
                unsetRules > 0 ? "bg-amber-400/20 text-amber-200" : "bg-white/12 text-white"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${unsetRules > 0 ? "bg-amber-400" : "bg-emerald-400"}`}
              />
              {unsetRules > 0 ? `${unsetRules} ${txt.rulesUnset}` : txt.rulesAllSet}
            </span>
          </div>
        </div>
      </div>

      <div className="border-b border-line">
        <div className="-mb-px flex gap-6 overflow-x-auto no-scrollbar">
          {PRICE_TABS.map((id) => (
            <button
              key={id}
              type="button"
              data-tour={id === "lists" ? "price-lists-tab" : undefined}
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 pb-3 text-[13px] font-bold transition-colors ${
                tab === id
                  ? "border-accent text-ink"
                  : "border-transparent text-ink-muted hover:text-ink-body"
              }`}
            >
              {txt[`tab_${id}` as keyof typeof txt]}
            </button>
          ))}
        </div>
      </div>

      {tab === "treatments" && (
        <PricingSettings currency={currency} services={services} priceLists={lists} />
      )}

      {(tab === "lists" || tab === "discounts") && (
        <PriceListSettings
          currency={currency}
          view={tab}
          services={services}
          lists={lists}
          settings={discounts}
          onOpenList={setOpenListId}
        />
      )}
    </div>
  );
}
