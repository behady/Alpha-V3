"use client";

/**
 * The "where am I today?" control.
 *
 * Renders nothing at all when the clinic has fewer than two branches — a single-site clinic should
 * never be asked a question with one answer, and that is what keeps this feature invisible until
 * somebody actually opens the Branches screen.
 */

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Layers } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { ALL_BRANCHES } from "@/lib/useActiveBranch";
import type { ClinicBranch } from "@/lib/clinicLocations";

export default function BranchSelector({
  branches,
  value,
  onChange,
  allowAll = true,
  compact = false,
  className = "",
}: {
  branches: ClinicBranch[];
  value: string;
  onChange: (id: string) => void;
  /** Offer "All branches". Off where a single branch has to be chosen, e.g. creating a record. */
  allowAll?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const { language, isRTL } = useLanguage();
  const ar = language === "ar";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (branches.length < 2) return null;

  const txt = {
    all: ar ? "كل الفروع" : "All branches",
    branch: ar ? "الفرع" : "Branch",
  };

  const selected = branches.find((b) => b.id === value) || null;
  const label = value === ALL_BRANCHES ? txt.all : selected?.name || txt.branch;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-full border border-line bg-surface font-bold text-slate-700 shadow-sm transition hover:border-line-strong hover:shadow ${
          compact ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-xs"
        }`}
      >
        {value === ALL_BRANCHES ? (
          <Layers size={compact ? 12 : 14} className="text-slate-400" />
        ) : (
          <Building2 size={compact ? 12 : 14} className="text-primary-600" />
        )}
        <span className="max-w-[10rem] truncate">{label}</span>
        <ChevronDown size={compact ? 11 : 13} className={`text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className={`absolute z-[120] mt-2 min-w-[13rem] overflow-hidden rounded-2xl border border-line bg-surface py-1 shadow-xl ${
            isRTL ? "left-0" : "right-0"
          }`}
        >
          {allowAll && (
            <>
              <button
                type="button"
                onClick={() => {
                  onChange(ALL_BRANCHES);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-xs font-bold text-ink-body transition hover:bg-surface-subtle"
              >
                <Layers size={14} className="shrink-0 text-slate-400" />
                <span className="flex-1 truncate">{txt.all}</span>
                {value === ALL_BRANCHES && <Check size={14} className="shrink-0 text-primary-600" />}
              </button>
              <div className="my-1 border-t border-slate-100" />
            </>
          )}
          {branches.map((b) => (
            <button
              type="button"
              key={b.id}
              onClick={() => {
                onChange(b.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-xs font-bold text-slate-700 transition hover:bg-surface-subtle"
            >
              <Building2 size={14} className="shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{b.name}</span>
                {b.address && <span className="block truncate text-[10px] font-medium text-slate-400">{b.address}</span>}
              </span>
              {value === b.id && <Check size={14} className="shrink-0 text-primary-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
