"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useClinic } from "@/context/ClinicContext";
import { DEFAULT_PRESET_ID, getPreset, type ThemePreset } from "@/lib/theme/presets";
import { replaceTokens, clearAppliedTokens, sanitizeTokens } from "@/lib/theme/tokens";
import { writeCache } from "@/lib/theme/themeCache";

/**
 * The clinic's theme.
 *
 * Replaces a version of this file that could not work: it wrote `--primary-500` while every
 * Tailwind utility reads `--color-primary-500`, and it persisted to localStorage, which is per
 * browser and so cannot express "each clinic picks". The bridge between those two names lived in
 * tailwind.config.js, which Tailwind v4 never loads without an `@config` directive.
 *
 * What replaces it: a theme stored per clinic in Firestore, applied as CSS custom properties on
 * <html>, and painted before first frame from a cache by the boot script in the root layout.
 */

interface ThemeContextType {
  /** The preset currently applied. Always a real id, never null. */
  presetId: string;
  preset: ThemePreset;
  /** True once the clinic's own choice has arrived; false while showing the cached guess. */
  resolved: boolean;
  saving: boolean;
  /** Owner and Admin only, and not while the clinic is read-only. Mirrors the Firestore rule. */
  canEdit: boolean;
  setPreset: (id: string) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/** Lives beside settings/clinicProfile. `settings` is admin-write in the rules already. */
const APPEARANCE_DOC = "appearance";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { clinicId, isAdmin, isReadOnly } = useClinic();

  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET_ID);
  const [resolved, setResolved] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * The clinic whose tokens are currently on <html>. A switch has to clear the previous clinic's
   * inline properties before writing the next ones, or the two sets merge and whichever tokens the
   * new preset happens not to define keep the old clinic's colours.
   */
  const paintedFor = useRef<string | null>(null);

  useEffect(() => {
    // No clinic yet — login, onboarding, superadmin console.
    if (!clinicId) {
      // Deliberately does NOT clear. The boot script has painted the last clinic this browser
      // saw, which is the best guess available on a login screen; removing it would replace a
      // correct guess with a visible flash to the default on every load. A different clinic's
      // tokens are replaced wholesale the moment one resolves.
      paintedFor.current = null;
      setResolved(false);
      return;
    }

    /**
     * The reference is built here rather than through getClinicDoc(). That helper reads a
     * module-global clinic id which ClinicContext updates in a parent effect — and parent effects
     * run after child effects, so a subscription opened through it would attach to the PREVIOUS
     * clinic and never re-run. Taking clinicId from the hook and building the path explicitly is
     * what makes the switch correct.
     */
    const ref = doc(db, "clinics", clinicId, "settings", APPEARANCE_DOC);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        const storedId = typeof data.presetId === "string" ? data.presetId : DEFAULT_PRESET_ID;
        const chosen = getPreset(storedId) ?? getPreset(DEFAULT_PRESET_ID)!;

        // An optional stored override, for a future bespoke palette. Sanitised on the way in:
        // these values reach style.setProperty and an admin can write them by hand.
        const custom = sanitizeTokens(data.tokens);
        const tokens = Object.keys(custom).length ? { ...chosen.tokens, ...custom } : chosen.tokens;

        replaceTokens(tokens);
        paintedFor.current = clinicId;
        setPresetId(chosen.id);
        setResolved(true);
        writeCache(clinicId, chosen.id, tokens);
      },
      (err) => {
        // A denied or offline read must not strip the UI of its colours; keep whatever the boot
        // script painted and let the stylesheet defaults stand behind it.
        console.error("Theme subscription failed:", err);
        setResolved(true);
      },
    );

    return () => {
      unsub();
      // Only clear if this effect is the one that painted. Without the guard, a re-render that
      // re-runs the effect for the SAME clinic would tear down the tokens it just applied.
      if (paintedFor.current === clinicId) {
        clearAppliedTokens();
        paintedFor.current = null;
      }
    };
  }, [clinicId]);

  const setPreset = useCallback(
    async (id: string) => {
      const chosen = getPreset(id);
      if (!clinicId || !chosen) return;
      setSaving(true);
      try {
        // Only the id is stored. Resolving tokens from code means improving a preset improves it
        // for every clinic already on it, instead of freezing whatever was current at save time.
        await setDoc(
          doc(db, "clinics", clinicId, "settings", APPEARANCE_DOC),
          { presetId: chosen.id, updatedAt: serverTimestamp() },
          { merge: true },
        );
        // The snapshot listener applies it; nothing is painted here, so a rejected write never
        // shows a colour the clinic did not actually get.
      } finally {
        setSaving(false);
      }
    },
    [clinicId],
  );

  const preset = getPreset(presetId) ?? getPreset(DEFAULT_PRESET_ID)!;

  return (
    <ThemeContext.Provider
      value={{ presetId, preset, resolved, saving, canEdit: isAdmin && !isReadOnly, setPreset }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};
