"use client";

import React from "react";
import {
  BarChart3, Building2, Compass, Globe2, HardDriveDownload, Megaphone, Receipt, Search,
  ShoppingBag, SlidersHorizontal, Users,
} from "lucide-react";
import { useSuperAdminText, type SAKey } from "./i18n";

export type SuperAdminTab =
  | "clinics" | "analytics" | "costs" | "users" | "meta" | "migrate" | "misplaced" | "platform" | "supply" | "tour";

const GROUPS: { label: SAKey; items: { tab: SuperAdminTab; label: SAKey; icon: React.ElementType }[] }[] = [
  {
    label: "groupClients",
    items: [
      { tab: "clinics", label: "navClinics", icon: Building2 },
      { tab: "users", label: "navUsers", icon: Users },
    ],
  },
  { label: "groupMoney", items: [{ tab: "costs", label: "navCosts", icon: Receipt }] },
  {
    label: "groupGrowth",
    items: [
      { tab: "analytics", label: "navAnalytics", icon: BarChart3 },
      { tab: "meta", label: "navMeta", icon: Megaphone },
      { tab: "supply", label: "navSupply", icon: ShoppingBag },
    ],
  },
  {
    label: "groupSystem",
    items: [
      { tab: "platform", label: "navPlatform", icon: SlidersHorizontal },
      { tab: "migrate", label: "navMigrate", icon: HardDriveDownload },
      { tab: "misplaced", label: "navAudit", icon: Search },
      { tab: "tour", label: "navTour", icon: Compass },
    ],
  },
];

interface Props {
  active: SuperAdminTab;
  onPick: (tab: SuperAdminTab) => void;
  counts: Partial<Record<SuperAdminTab, number>>;
  email?: string | null;
}

/**
 * The console's side menu. On a phone it folds into one scrolling row under the brand, so the
 * page keeps its full width for the table.
 */
export function SuperAdminNav({ active, onPick, counts, email }: Props) {
  const { t, num, toggleLanguage } = useSuperAdminText();

  return (
    <aside className="bg-ink-slab text-white lg:w-64 lg:shrink-0 lg:h-[100dvh] lg:sticky lg:top-0 lg:overflow-y-auto flex flex-col gap-4 lg:gap-6 p-4 lg:px-4 lg:py-6">
      <div className="flex items-center gap-3 px-2">
        <div className="w-9 h-9 rounded-xl bg-accent text-ink-on-accent flex items-center justify-center font-display font-bold text-lg">α</div>
        <div className="flex flex-col leading-tight min-w-0">
          <span className="font-display font-bold text-sm">{t("brand")}</span>
          <span className="text-xs text-white/60">{t("role")}</span>
        </div>
        <button
          type="button"
          onClick={toggleLanguage}
          className="ms-auto lg:hidden inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-white/15 text-sm font-semibold hover:bg-white/10"
        >
          <Globe2 size={15} aria-hidden /> {t("language")}
        </button>
      </div>

      <nav aria-label={t("role")} className="flex lg:flex-col gap-1 lg:gap-5 overflow-x-auto lg:overflow-visible -mx-4 px-4 lg:mx-0 lg:px-0 pb-1 lg:pb-0">
        {GROUPS.map((g) => (
          <div key={g.label} className="flex lg:flex-col gap-1 lg:gap-0.5 shrink-0">
            <span className="hidden lg:block text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50 px-3 pb-1.5">{t(g.label)}</span>
            {g.items.map((it) => {
              const on = active === it.tab;
              const Icon = it.icon;
              const count = counts[it.tab];
              return (
                <button
                  key={it.tab}
                  type="button"
                  onClick={() => onPick(it.tab)}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center gap-2.5 min-h-[40px] px-3 rounded-lg text-sm whitespace-nowrap text-start transition-colors ${
                    on ? "bg-accent text-ink-on-accent font-semibold" : "text-white/80 hover:bg-white/10 hover:text-white font-medium"
                  }`}
                >
                  <Icon size={16} aria-hidden className="shrink-0" />
                  <span className="flex-1">{t(it.label)}</span>
                  {count !== undefined && (
                    <span className={`text-xs font-figure ${on ? "text-ink-on-accent/70" : "text-white/50"}`}>{num(count)}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="hidden lg:flex mt-auto flex-col gap-2">
        <button
          type="button"
          onClick={toggleLanguage}
          className="flex items-center gap-2.5 min-h-[40px] px-3 rounded-lg text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white"
        >
          <Globe2 size={16} aria-hidden /> {t("language")}
        </button>
        {email && (
          <div className="rounded-xl bg-white/5 p-3 flex flex-col gap-0.5 min-w-0">
            <span className="text-xs text-white/60">{t("signedInAs")}</span>
            <span className="text-[13px] font-semibold truncate" dir="ltr">{email}</span>
          </div>
        )}
      </div>
    </aside>
  );
}
