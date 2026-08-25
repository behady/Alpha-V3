"use client";

/**
 * Which branch you are working at, shared by every screen that cares.
 *
 * A clinic with two branches was showing both branches' appointments in one column of the day —
 * a receptionist at the seaside desk reading names of people who were never going to walk through
 * their door. The fix is not a filter on one screen: it is a single answer to "where am I today?"
 * that the dashboard, the schedule, booking and the price lists all read, so a patient booked at
 * the branch you are standing in is priced at that branch's rates without anyone re-picking it.
 *
 * Three decisions worth stating:
 *
 *   - The choice is remembered per clinic, in localStorage. It is a preference about where the
 *     person is sitting, not clinic data, and writing it to Firestore would mean one member of
 *     staff changing desks moved everybody.
 *   - It defaults to the FIRST branch, never to "all". Showing every branch at once is the thing
 *     being fixed; "All branches" stays available, but somebody has to ask for it.
 *   - A clinic with no branches configured gets `activeBranchId === ""` and every consumer
 *     behaves exactly as it did before branches existed. The feature stays invisible until the
 *     Branches screen is opened, which is the same bargain `parseClinicBranches` makes.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { onSnapshot } from "firebase/firestore";
import { getClinicDoc } from "@/lib/db-utils";
import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { LOCATIONS_DOC, parseClinicBranches, type ClinicBranch } from "@/lib/clinicLocations";

/** Explicitly every branch at once. Distinct from "" (this clinic has no branches). */
export const ALL_BRANCHES = "__all__";

const storageKey = (clinicId: string | null) => `alpha.activeBranch.${clinicId || "none"}`;

/**
 * The remembered choice, read as an external store rather than copied into state by an effect.
 *
 * localStorage is exactly what `useSyncExternalStore` is for: it cannot be read during SSR, so it
 * needs a server snapshot, and copying it into state on mount would be a render-then-correct that
 * flashes the wrong branch. Subscribing also means the browser's own `storage` event reaches us,
 * so switching branch in one tab moves the other tab with it instead of leaving them disagreeing
 * about where the person is sitting.
 */
const listeners = new Set<() => void>();

/**
 * Where the choice lives when localStorage refuses it (private mode, storage disabled).
 *
 * Without this the selector would appear to do nothing at all in those browsers: the write throws,
 * the read returns null, and the derived branch snaps straight back to the first one. Losing the
 * choice when the tab closes is a fair price; losing it the instant it is made is not.
 */
const memoryChoice = new Map<string, string>();

function subscribeToChoice(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readChoice(clinicId: string | null): string | null {
  const key = storageKey(clinicId);
  try {
    return window.localStorage.getItem(key) ?? memoryChoice.get(key) ?? null;
  } catch {
    return memoryChoice.get(key) ?? null;
  }
}

export type ActiveBranch = {
  branches: ClinicBranch[];
  /** "" when the clinic has no branches; ALL_BRANCHES when every branch is wanted. */
  activeBranchId: string;
  setActiveBranchId: (id: string) => void;
  /** The branch object, or null for "" and ALL_BRANCHES. */
  activeBranch: ClinicBranch | null;
  /** True once the branch list has been read, so callers can avoid a flash of the wrong branch. */
  ready: boolean;
  /**
   * The branch id to stamp on something being created right now, or "" when there is none to
   * stamp. Never ALL_BRANCHES — "every branch" is a way of looking, not a place a booking happens.
   */
  scopeBranchId: string;
  /** Does this record belong in the current view? Records with no branch always show. */
  matches: (branchId?: string | null) => boolean;
};

export function useActiveBranch(): ActiveBranch {
  const { user } = useAuth();
  const { clinicId } = useClinic();
  const [branches, setBranches] = useState<ClinicBranch[]>([]);
  const [ready, setReady] = useState(false);
  /**
   * What was explicitly chosen — by this person now, or by them last time.
   *
   * Deliberately NOT the effective branch. Storing the resolved id would mean state derived from
   * `branches`, which goes stale the moment a branch is renamed or deleted. Keeping only the
   * choice and deriving the rest below means a stored id that no longer exists simply stops
   * matching, and the first branch takes over.
   */
  const chosen = useSyncExternalStore(
    subscribeToChoice,
    () => readChoice(clinicId),
    () => null
  );

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      getClinicDoc("settings", LOCATIONS_DOC),
      (snap) => {
        setBranches(parseClinicBranches(snap.exists() ? snap.data() : null));
        setReady(true);
      },
      () => setReady(true)
    );
    return () => unsub();
  }, [user]);

  const setActiveBranchId = useCallback(
    (id: string) => {
      const key = storageKey(clinicId);
      memoryChoice.set(key, id);
      try {
        window.localStorage.setItem(key, id);
      } catch {
        // Not being able to REMEMBER the choice past this tab is not a reason to refuse it —
        // memoryChoice above still carries it for the rest of the session.
      }
      // `storage` only fires in OTHER tabs, so this tab has to be told by hand.
      listeners.forEach((l) => l());
    },
    [clinicId]
  );

  /**
   * The branch actually in force: the remembered choice if it still exists, else the first branch.
   *
   * Derived rather than stored, so deleting or renaming a branch can never leave the app filtering
   * against an id nothing matches — which would empty the schedule with no way to tell why.
   */
  const selected = useMemo(() => {
    if (branches.length === 0) return "";
    if (chosen === ALL_BRANCHES) return ALL_BRANCHES;
    if (chosen && branches.some((b) => b.id === chosen)) return chosen;
    return branches[0].id;
  }, [branches, chosen]);

  const activeBranch = useMemo(
    () => branches.find((b) => b.id === selected) || null,
    [branches, selected]
  );

  const scopeBranchId = selected === ALL_BRANCHES ? "" : selected;

  const matches = useCallback(
    (branchId?: string | null) => {
      if (!selected || selected === ALL_BRANCHES) return true;
      // Records created before branches existed carry no branchId. Hiding them under every branch
      // would make them vanish from the app entirely, so they show everywhere instead — the same
      // rule the appointments screen already applies.
      if (!branchId) return true;
      return branchId === selected;
    },
    [selected]
  );

  return { branches, activeBranchId: selected, setActiveBranchId, activeBranch, ready, scopeBranchId, matches };
}
