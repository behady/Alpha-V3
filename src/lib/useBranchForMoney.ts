"use client";

/**
 * Settle "which branch does this money belong to?" before a payment, charge or payout is written.
 *
 *   const { requireBranchForMoney, picker } = useBranchForMoney();
 *   const branchId = await requireBranchForMoney();
 *   if (branchId === null) return;            // the person cancelled
 *   await createPayment({ ..., ...(branchId ? { branchId } : {}) });
 *   ...
 *   return <>{...}{picker}</>;
 *
 * Resolves at once with the on-screen branch, or "" when the clinic has no branches (nothing to
 * ask). Only under "All branches" does it open the "Which branch?" pick and wait for it — an admin
 * looking at everything has to say where this one belongs, because the server refuses money with no
 * branch on a branched clinic. Resolves `null` if they cancel; callers must then write nothing.
 *
 * One pick at a time: a second call while the pick is open resolves `null` (a double-tap on Save
 * must not queue two payments).
 */

import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useActiveBranch } from "@/lib/useActiveBranch";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import BranchPickModal from "@/components/shared/BranchPickModal";

export function useBranchForMoney(): { requireBranchForMoney: () => Promise<string | null>; picker: ReactNode } {
  const { branches, allowedBranches, scopeBranchId } = useActiveBranch();
  const { showToast } = useUI();
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const pending = useRef<((id: string | null) => void) | null>(null);

  // Read through a ref so the returned function keeps its identity while branches load.
  const latest = useRef({ branches, allowedBranches, scopeBranchId });
  latest.current = { branches, allowedBranches, scopeBranchId };
  const ar = language === "ar";
  const toastRef = useRef({ showToast, ar });
  toastRef.current = { showToast, ar };

  const settle = useCallback((id: string | null) => {
    const resolve = pending.current;
    pending.current = null;
    setOpen(false);
    resolve?.(id);
  }, []);

  // A screen that unmounts with the pick open must not leave its caller waiting forever.
  useEffect(() => () => {
    pending.current?.(null);
    pending.current = null;
  }, []);

  const requireBranchForMoney = useCallback((): Promise<string | null> => {
    const { branches: all, allowedBranches: allowed, scopeBranchId: scope } = latest.current;
    if (all.length === 0) return Promise.resolve("");
    if (scope) return Promise.resolve(scope);
    if (pending.current) return Promise.resolve(null);
    // Nothing to choose between (still loading, or no branch granted): a single allowed branch is
    // that branch; none means refuse rather than guess.
    if (allowed.length === 1) return Promise.resolve(allowed[0].id);
    if (allowed.length === 0) {
      const { showToast: toast, ar: isAr } = toastRef.current;
      toast(isAr ? "مفيش فرع متاح ليك — اسأل صاحب العيادة." : "No branch available to you — ask the owner.", "error");
      return Promise.resolve(null);
    }
    return new Promise<string | null>((resolve) => {
      pending.current = resolve;
      setOpen(true);
    });
  }, []);

  // Stable, so the modal's keyboard listener is not re-registered on every render.
  const onPick = useCallback((id: string) => settle(id), [settle]);
  const onCancel = useCallback(() => settle(null), [settle]);

  const picker: ReactNode = open ? createElement(BranchPickModal, { branches: allowedBranches, onPick, onCancel }) : null;

  return { requireBranchForMoney, picker };
}
