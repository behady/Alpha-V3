"use client";

/**
 * Unsaved work, and the promise not to throw it away silently.
 *
 * Phase 1 of the settings rebuild. Every settings panel kept its own edits in its own state and
 * was destroyed the moment another tab was clicked — type a recall interval, glance at Prices,
 * come back, and it is gone with no warning at any point. Nothing anywhere in the app tracked
 * unsaved work, so there was nothing to borrow.
 *
 * Two ways out of a half-finished form, so both are covered:
 *
 *   - Leaving the page entirely (close the tab, reload, follow a link out of the app). Only
 *     `beforeunload` can catch that, and browsers deliberately ignore any custom wording — the
 *     visitor gets the browser's own generic prompt. That is the whole of what is possible here.
 *
 *   - Moving to another settings section. That goes through the sidebar and the mobile picker,
 *     both of which are ours, so they can ask properly, in the clinic's language, using the app's
 *     own confirm dialog.
 *
 * Panels register through `useUnsavedChanges()`. Nothing registers yet — the panels move across
 * unchanged in Phase 1 and adopt the save contract in Phase 3 — so today this guards only the
 * clinic profile form. It is here now so that a panel converted later has something to report to,
 * rather than each one inventing its own.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useUI } from "@/context/UIContext";
import { useLanguage } from "@/context/LanguageContext";

interface UnsavedChangesContextValue {
  /** Is anything on screen unsaved right now? */
  isDirty: boolean;
  /**
   * Report whether one section has unsaved edits. Keyed so two panels on screen at once cannot
   * clear each other's flag — the last one to unmount used to win, which reported "saved" while
   * work was still pending.
   */
  setDirty: (key: string, dirty: boolean) => void;
  /** Drop a section's flag entirely. Call on unmount so a closed panel stops blocking navigation. */
  clearDirty: (key: string) => void;
  /**
   * Ask before leaving. Resolves true when it is safe to go — either nothing is unsaved, or the
   * person chose to discard. Callers must await this BEFORE navigating.
   */
  confirmLeave: () => Promise<boolean>;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | undefined>(undefined);

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const { confirm } = useUI();
  const { language } = useLanguage();
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]);

  // Read inside the beforeunload handler, which is registered once. Reading `dirtyKeys` there
  // instead would capture the value from the render that attached it and go stale immediately.
  // Mirrored in an effect rather than assigned during render: a ref written while rendering is
  // not guaranteed to survive a discarded render pass.
  const dirtyRef = useRef<string[]>([]);
  useEffect(() => {
    dirtyRef.current = dirtyKeys;
  }, [dirtyKeys]);

  const setDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((prev) => {
      const has = prev.includes(key);
      if (dirty === has) return prev; // no change — do not re-render every keystroke
      return dirty ? [...prev, key] : prev.filter((k) => k !== key);
    });
  }, []);

  const clearDirty = useCallback((key: string) => {
    setDirtyKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : prev));
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current.length === 0) return;
      // Both forms: `preventDefault` is the modern one, `returnValue` is what older browsers read.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const confirmLeave = useCallback(async () => {
    // State, not the ref: this runs from a click handler, where the current render's value is the
    // right one and the ref may not have been mirrored yet on the very first change.
    if (dirtyKeys.length === 0) return true;
    const ar = language === "ar";
    return confirm(
      ar
        ? "لديك تعديلات لم تُحفظ. إذا خرجت الآن ستفقدها."
        : "You have changes that have not been saved. Leaving now will lose them.",
      {
        title: ar ? "تعديلات لم تُحفظ" : "Unsaved changes",
        confirmLabel: ar ? "اخرج دون حفظ" : "Leave without saving",
        cancelLabel: ar ? "ابقَ هنا" : "Stay here",
        tone: "danger",
      }
    );
  }, [confirm, dirtyKeys, language]);

  const value = useMemo(
    () => ({ isDirty: dirtyKeys.length > 0, setDirty, clearDirty, confirmLeave }),
    [dirtyKeys, setDirty, clearDirty, confirmLeave]
  );

  return (
    <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>
  );
}

/**
 * Outside the provider this returns a no-op rather than throwing.
 *
 * A settings panel is also rendered from places that have no settings shell around them (the
 * tutorial mounts a couple directly), and a hook that throws would turn "no unsaved-changes
 * guard here" into a blank screen.
 */
export function useUnsavedChanges(): UnsavedChangesContextValue {
  const context = useContext(UnsavedChangesContext);
  return (
    context ?? {
      isDirty: false,
      setDirty: () => {},
      clearDirty: () => {},
      confirmLeave: async () => true,
    }
  );
}

/**
 * Report this section's unsaved state for as long as the panel is mounted, and withdraw it on the
 * way out. The withdrawal is the part that matters: a panel that unmounts while still flagged
 * blocks every later navigation with a prompt about work that no longer exists.
 */
export function useDirtyFlag(key: string, dirty: boolean) {
  const { setDirty, clearDirty } = useUnsavedChanges();

  useEffect(() => {
    setDirty(key, dirty);
  }, [key, dirty, setDirty]);

  useEffect(() => () => clearDirty(key), [key, clearDirty]);
}
