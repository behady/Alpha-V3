"use client";

/**
 * "Which branch?" — asked once, just before money would be written under "All branches".
 *
 * Money has to belong to a branch (the server refuses it otherwise), and "All branches" is a way
 * of LOOKING, not a place a payment happens. So an admin looking at everything is asked where this
 * one belongs, instead of the write failing or landing on a guess.
 *
 * Portalled to the body at z-[300]: it is opened from inside the booking popup (z-200), and a
 * modal that opens underneath its caller looks exactly like a button that does nothing.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import type { ClinicBranch } from "@/lib/clinicLocations";

export default function BranchPickModal({
  branches,
  onPick,
  onCancel,
}: {
  /** Only the branches this person may work in. */
  branches: ClinicBranch[];
  onPick: (branchId: string) => void;
  onCancel: () => void;
}) {
  const { language } = useLanguage();
  const ar = language === "ar";
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (!mounted) return null;

  const txt = {
    title: ar ? "أي فرع؟" : "Which branch?",
    hint: ar ? "الفلوس دي هتتسجل على الفرع اللي تختاره." : "This money will be recorded under the branch you pick.",
    cancel: ar ? "إلغاء" : "Cancel",
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      dir={ar ? "rtl" : "ltr"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={txt.title} className="w-full max-w-sm overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-black text-slate-800">{txt.title}</h2>
            <p className="mt-0.5 text-xs font-medium text-ink-muted">{txt.hint}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={txt.cancel}
            className="rounded-full p-2 text-slate-400 transition hover:bg-surface-muted hover:text-ink-body"
          >
            <X size={18} />
          </button>
        </div>
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto px-5 py-4">
          {branches.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onPick(b.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-start text-sm font-bold text-ink transition hover:bg-surface-muted"
              >
                <Building2 size={16} className="shrink-0 text-ink-muted" />
                <span className="min-w-0 truncate">{b.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-bold text-ink-body transition hover:bg-surface-muted"
          >
            {txt.cancel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
