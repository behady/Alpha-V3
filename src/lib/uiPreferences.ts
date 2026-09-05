/**
 * The workflow preferences under Settings → Interface, and where they are kept.
 *
 * Phase 3 of the settings rebuild. All eight lived in `localStorage` and nowhere else, so a
 * dentist who set up the app the way they like it on the desk computer opened it on a tablet and
 * got the defaults back, with nothing on screen to explain why. Clearing browser data did the
 * same thing. They are not device settings — they are how one person prefers to work — so they
 * belong on that person's own record.
 *
 * ## Two stores, and which one wins
 *
 * `users/{uid}.uiPreferences` is the truth. firestore.rules already lets someone write their own
 * user document (everything except isSuperAdmin, clinicRoles and clinicPermissions), so this
 * needed no rules change — worth knowing, because the staff record would have: its self-edit
 * carve-out names six fields and this is not one of them.
 *
 * `localStorage` stays as a local cache, written first on every change. It is what paints the
 * screen on the next load before the network answers, so the app does not flash the default
 * layout and then rearrange itself. Where the two disagree, the stored record wins — it is the
 * one that followed the person here.
 *
 * ## Migration happens by itself
 *
 * Someone signing in on the browser they have always used has preferences in localStorage and
 * none on their record. The first load uploads what it finds, once. Nobody loses a setting, and
 * there is no script to remember to run.
 */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  type ClinicalNoteDensity,
  type ClinicalNoteGrouping,
  type ClinicalNoteSort,
  isClinicalNoteDensity,
  isClinicalNoteGrouping,
  isClinicalNoteSort,
} from "@/components/clinical-notes/ordering";

/**
 * Re-declared here rather than imported from UIContext: that module is a React client component
 * and importing it would drag the whole provider into anything that only wants to read a
 * preference. The pair is pinned by tests/settingsRegistry.test.mts so they cannot drift.
 */
export type ClinicalEditorMode = "modal" | "drawer" | "inline";

export interface UiPreferences {
  clinicalEditorMode: ClinicalEditorMode;
  appointmentEditorMode: "modal" | "drawer";
  appointmentPanelMode: "editor" | "avatar";
  appointmentsVisibility: "all" | "desktop" | "hidden";
  latePatientTrackerEnabled: boolean;
  clinicalNoteSort: ClinicalNoteSort;
  clinicalNoteGrouping: ClinicalNoteGrouping;
  clinicalNoteDensity: ClinicalNoteDensity;
  /**
   * Which home screen an admin who is also a dentist lands on: the reception desk, or their own
   * chair (the dentist's home). Someone whose role is Dentist gets the chair regardless — this
   * only matters for the person who wears both hats.
   */
  homeView: "desk" | "chair" | "owner";
}

export const UI_PREFERENCE_DEFAULTS: UiPreferences = {
  clinicalEditorMode: "modal",
  appointmentEditorMode: "modal",
  appointmentPanelMode: "editor",
  appointmentsVisibility: "desktop",
  latePatientTrackerEnabled: true,
  clinicalNoteSort: "newest",
  clinicalNoteGrouping: "flat",
  clinicalNoteDensity: "detailed",
  homeView: "desk",
};

const oneOf =
  <T extends string>(...allowed: T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (allowed as string[]).includes(value);

/**
 * Every preference validated on read, never cast.
 *
 * Both stores are things a person can edit by hand, and an unrecognised value used to flow
 * straight into the clinical timeline and render nothing at all.
 */
const VALIDATORS: { [K in keyof UiPreferences]: (value: unknown) => value is UiPreferences[K] } = {
  clinicalEditorMode: oneOf("modal", "drawer", "inline"),
  appointmentEditorMode: oneOf("modal", "drawer"),
  appointmentPanelMode: oneOf("editor", "avatar"),
  appointmentsVisibility: oneOf("all", "desktop", "hidden"),
  latePatientTrackerEnabled: ((value: unknown) => typeof value === "boolean") as (
    value: unknown
  ) => value is boolean,
  clinicalNoteSort: isClinicalNoteSort as (value: unknown) => value is ClinicalNoteSort,
  clinicalNoteGrouping: isClinicalNoteGrouping as (value: unknown) => value is ClinicalNoteGrouping,
  clinicalNoteDensity: isClinicalNoteDensity as (value: unknown) => value is ClinicalNoteDensity,
  homeView: oneOf("desk", "chair", "owner"),
};

/** The localStorage key each preference has always used. Renaming one silently resets it. */
const LOCAL_KEYS: Record<keyof UiPreferences, string> = {
  clinicalEditorMode: "clinicalEditorMode",
  appointmentEditorMode: "appointmentEditorMode",
  appointmentPanelMode: "appointmentPanelMode",
  appointmentsVisibility: "appointmentsVisibility",
  latePatientTrackerEnabled: "latePatientTrackerEnabled",
  clinicalNoteSort: "clinicalNoteSort",
  clinicalNoteGrouping: "clinicalNoteGrouping",
  clinicalNoteDensity: "clinicalNoteDensity",
  homeView: "homeView",
};

/** An older key for the clinical editor, still on the machines of anyone who set it back then. */
const LEGACY_CLINICAL_EDITOR_KEY = "alpha_clinical_editor_mode";

export const UI_PREFERENCE_KEYS = Object.keys(LOCAL_KEYS) as (keyof UiPreferences)[];

function parse<K extends keyof UiPreferences>(key: K, raw: unknown): UiPreferences[K] | undefined {
  if (raw === undefined || raw === null) return undefined;
  // localStorage only holds strings, so a boolean arrives as "true" / "false".
  const value = key === "latePatientTrackerEnabled" && typeof raw === "string" ? raw === "true" : raw;
  return VALIDATORS[key](value) ? (value as UiPreferences[K]) : undefined;
}

/** Whatever this browser remembers. Never throws — private mode makes the whole store inaccessible. */
export function readLocalPreferences(): Partial<UiPreferences> {
  const found: Partial<UiPreferences> = {};
  if (typeof window === "undefined") return found;
  try {
    const legacy = parse("clinicalEditorMode", localStorage.getItem(LEGACY_CLINICAL_EDITOR_KEY));
    if (legacy) found.clinicalEditorMode = legacy;

    for (const key of UI_PREFERENCE_KEYS) {
      const parsed = parse(key, localStorage.getItem(LOCAL_KEYS[key]));
      if (parsed !== undefined) (found[key] as unknown) = parsed;
    }
  } catch {
    /* Private browsing, or site data blocked. The defaults are a fine place to start. */
  }
  return found;
}

export function writeLocalPreference<K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEYS[key], String(value));
  } catch {
    /* Nothing to do — the stored record is the truth, this was only the fast path. */
  }
}

/** What this person's record says. Null when they have never saved one. */
export async function loadRemotePreferences(uid: string): Promise<Partial<UiPreferences> | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const stored = (snap.data() as Record<string, unknown>).uiPreferences;
  if (!stored || typeof stored !== "object") return null;

  const found: Partial<UiPreferences> = {};
  for (const key of UI_PREFERENCE_KEYS) {
    const parsed = parse(key, (stored as Record<string, unknown>)[key]);
    if (parsed !== undefined) (found[key] as unknown) = parsed;
  }
  return found;
}

/**
 * Save some preferences onto the person's record.
 *
 * Merged, and nested under one key, so this can never touch `clinicRoles` or `clinicPermissions`
 * — the two fields firestore.rules refuses to let anyone edit on themselves, and the reason it
 * refuses is that a member who could clear them would grant themselves everything.
 */
export async function saveRemotePreferences(uid: string, patch: Partial<UiPreferences>) {
  await setDoc(doc(db, "users", uid), { uiPreferences: patch }, { merge: true });
}
