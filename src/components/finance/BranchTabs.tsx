"use client";

/**
 * The owner's branch switch on the Finance page: one tab per branch, then "All branches".
 *
 * Bound to the SAME remembered branch as the dashboard switch (`useActiveBranch`), so moving
 * here moves there too — a tab is only a faster way of making the one choice the app already
 * keeps. It sits in the page's black band, which is why the chosen tab is the yellow fill and the
 * rest are white on black.
 *
 * Admins only: the page shows it when `canChooseAll` holds, and keeps the fixed branch pill for
 * everybody else. Fewer than two branches is no choice at all, so nothing is drawn.
 */

import { Layers } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { ALL_BRANCHES } from "@/lib/useActiveBranch";
import type { ClinicBranch } from "@/lib/clinicLocations";

export default function BranchTabs({
  branches,
  value,
  onChange,
}: {
  /** The branches this person may look at, in the clinic's order. */
  branches: ClinicBranch[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { language } = useLanguage();
  if (branches.length < 2) return null;
  const ar = language === "ar";
  const tabs = [...branches.map((b) => ({ id: b.id, label: b.name })), { id: ALL_BRANCHES, label: ar ? "كل الفروع" : "All branches" }];

  return (
    <div
      role="tablist"
      aria-label={ar ? "الفرع" : "Branch"}
      className="flex max-w-full items-center gap-1 overflow-x-auto no-scrollbar rounded-full border border-white/15 bg-white/5 p-1"
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-black transition-colors ${
              active ? "bg-accent text-ink-on-accent shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            {tab.id === ALL_BRANCHES ? <Layers size={12} /> : null}
            <span className="max-w-[10rem] truncate">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
