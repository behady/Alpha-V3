"use client";

/**
 * The save contract every settings panel follows.
 *
 * Phase 3 of the settings rebuild. Each panel used to keep its edits in its own state and be
 * thrown away the moment another section was opened — type a recall interval, glance at Prices,
 * come back, and it was gone with no warning at any point.
 *
 * ## Draft over stored
 *
 * A panel holds two things: what the database says (`stored`), and what the person has typed on
 * top of it (the draft). Until they touch something the draft is null and the panel simply shows
 * what is stored — which means an update made on another device flows straight through. From the
 * first keystroke the draft exists and is what is shown, and incoming updates no longer overwrite
 * it. That second half matters: Phase 1 moved these panels onto live listeners, and a live
 * listener without this would wipe a half-typed form the moment a colleague saved anything.
 *
 * The difference between the two IS the unsaved state, so nothing has to be tracked separately
 * and nothing can get out of step with what is on screen.
 *
 * ## After a save
 *
 * `markSaved()` drops the draft rather than copying it over the stored value. The listener brings
 * the saved document back a moment later and the panel shows that — the version the database
 * actually accepted, not the one the browser hoped it had written.
 */

import { useCallback, useMemo, useState } from "react";
import { useDirtyFlag } from "@/context/UnsavedChangesContext";

export interface SettingsDraft<T> {
  /** What to render and edit: the draft if there is one, otherwise what is stored. */
  value: T;
  /** Accepts a value or an updater, like setState. Starts a draft on first use. */
  setValue: (next: T | ((current: T) => T)) => void;
  /** Are there unsaved edits? Drives the leave-confirmation and any "unsaved" badge. */
  isDirty: boolean;
  /** Throw the edits away and go back to what is stored. */
  discard: () => void;
  /** Call after the write succeeds. Drops the draft so the stored value takes over again. */
  markSaved: () => void;
}

/**
 * @param sectionId  The registry id of the section, so the shell can name what is unsaved.
 * @param stored     The current value from the database. `null` while it is still loading.
 * @param fallback   What to show before the first load, and for a document that does not exist.
 */
export function useSettingsDraft<T>(sectionId: string, stored: T | null, fallback: T): SettingsDraft<T> {
  const [draft, setDraft] = useState<T | null>(null);

  const base = stored ?? fallback;
  const value = draft ?? base;

  // Compared by value, not identity: `stored` is a fresh object on every snapshot, so an identity
  // check would report unsaved work on every listener tick, for everyone, permanently.
  const isDirty = useMemo(
    () => draft !== null && JSON.stringify(draft) !== JSON.stringify(base),
    [draft, base]
  );

  useDirtyFlag(sectionId, isDirty);

  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      setDraft((current) => {
        const startingPoint = current ?? base;
        return typeof next === "function" ? (next as (c: T) => T)(startingPoint) : next;
      });
    },
    [base]
  );

  const discard = useCallback(() => setDraft(null), []);
  const markSaved = useCallback(() => setDraft(null), []);

  return { value, setValue, isDirty, discard, markSaved };
}
