"use client";

/**
 * How the Insurance page picks the approvals of a date range: by approval date, or by the day
 * the approval was finished (lib/insurance/billingMonth.ts).
 *
 * It opens "By approval date" (the clinic owner's choice, 2026-11-11) and remembers the last
 * choice in this browser. Storage can be missing or blocked (a private window), so every read and
 * write is guarded and the page works without it.
 */

import { useCallback, useState } from "react";
import type { SheetDateMode } from "@/lib/insurance/billingMonth";

const KEY = "insurance.sheetDateMode";

function stored(): SheetDateMode {
  if (typeof window === "undefined") return "approval";
  try {
    return window.localStorage.getItem(KEY) === "finish" ? "finish" : "approval";
  } catch {
    return "approval";
  }
}

export function useSheetDateMode(): [SheetDateMode, (mode: SheetDateMode) => void] {
  const [mode, setModeState] = useState<SheetDateMode>(stored);
  const setMode = useCallback((next: SheetDateMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Not remembered; the page still switches.
    }
  }, []);
  return [mode, setMode];
}
