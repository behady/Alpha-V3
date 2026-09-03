"use client";

/**
 * Loads `settings/clinic_info` for the three panels that read it, and saves back only the fields
 * the panel in front of you actually owns.
 *
 * The old settings page kept one `clinicData` object for the whole screen, read it once when the
 * page opened, and handed the same `handleSaveClinic` to Attendance, Schedule and Alerts. That
 * function wrote the ENTIRE object back on every save. So saving an attendance radius also
 * re-wrote the clinic's name, phone, address, currency and prescription header — with whatever
 * values had been loaded when the page opened. Change the clinic profile in another tab, save
 * attendance here, and the profile silently rolled back.
 *
 * Each panel gets its own host with its own `fields` list, so a save can only ever touch what
 * that screen shows. The panels themselves are unchanged — they still receive `clinicData`,
 * `setClinicData` and `handleSaveClinic` and cannot tell the difference.
 *
 * Live listener rather than a one-time read, so a value changed elsewhere shows up here instead
 * of being overwritten by a stale copy on the next save.
 */

import { useCallback, useEffect, useState } from "react";
import { onSnapshot, setDoc } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import { getClinicDoc } from "@/lib/db-utils";
import { logActivity } from "@/lib/logger";
import { useSettingsDraft } from "@/lib/settingsDraft";

export type ClinicInfoState = Record<string, unknown>;

/** Defaults for the whole document. A panel only ever saves the keys it names. */
const EMPTY: ClinicInfoState = {
  name: "",
  doctorName: "",
  phone: "",
  address: "",
  email: "",
  currency: "EGP",
  rxHeader: "",
  attendanceLat: "",
  attendanceLng: "",
  attendanceRadius: "50",
};

interface Props {
  /** Registry id of the section, so unsaved work can be named when someone tries to leave. */
  sectionId: string;
  /** The only keys this screen may write. Everything else in the document is left alone. */
  fields: string[];
  /** What the activity log should say. */
  activityLabel: string;
  canEdit: boolean;
  children: (bag: {
    clinicData: ClinicInfoState;
    setClinicData: React.Dispatch<React.SetStateAction<ClinicInfoState>>;
    handleSaveClinic: (event?: { preventDefault?: () => void }) => Promise<void>;
    /**
     * Save, optionally overriding some fields for this write only.
     *
     * Needed because a value computed at save time (the schedule's `configuredAt` stamp) cannot
     * be routed through `setClinicData` first: React state has not flushed by the time the save
     * reads it, so the stamp would always be one save behind.
     */
    save: (overrides?: Record<string, unknown>) => Promise<void>;
    saving: boolean;
    /** True while there are edits the person has not saved. */
    isDirty: boolean;
    discard: () => void;
  }) => React.ReactNode;
}

export default function ClinicInfoHost({ sectionId, fields, activityLabel, canEdit, children }: Props) {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const { user } = useAuth();
  const [stored, setStored] = useState<ClinicInfoState | null>(null);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      getClinicDoc("settings", "clinic_info"),
      (snap) => {
        // Merged over EMPTY rather than replacing: a document that has never been written carries
        // none of these keys, and a form bound to `undefined` flips from uncontrolled to
        // controlled on first keystroke and loses what was typed.
        setStored({ ...EMPTY, ...(snap.exists() ? snap.data() : {}) });
        setLoaded(true);
      },
      () => setLoaded(true)
    );
    return () => unsub();
  }, []);

  /**
   * Edits live on top of the stored document rather than replacing it.
   *
   * The listener above is live, so without this a colleague saving anything on another screen
   * would overwrite a half-filled form here mid-typing. Until the first keystroke there is no
   * draft and their change flows straight through, which is what should happen.
   */
  const {
    value: clinicData,
    setValue: setClinicData,
    isDirty,
    discard,
    markSaved,
  } = useSettingsDraft<ClinicInfoState>(sectionId, stored, EMPTY);

  const save = useCallback(
    async (overrides?: Record<string, unknown>) => {
      if (!canEdit) return;
      setSaving(true);
      try {
        const source = overrides ? { ...clinicData, ...overrides } : clinicData;
        const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        for (const field of fields) {
          const value = source[field];
          // Firestore rejects the whole write if any value is undefined, and the error reads
          // exactly like a permissions failure. A field nobody has filled in is simply not sent.
          if (value !== undefined) payload[field] = value;
        }
        await setDoc(getClinicDoc("settings", "clinic_info"), payload, { merge: true });
        await logActivity(
          { uid: user?.uid, name: user?.name, role: user?.role },
          "Settings Updated",
          activityLabel
        );
        markSaved();
        showToast(language === "ar" ? "تم الحفظ" : "Saved", "success");
      } catch {
        showToast(language === "ar" ? "فشل الحفظ" : "Save failed", "error");
      } finally {
        setSaving(false);
      }
    },
    [activityLabel, canEdit, clinicData, fields, language, markSaved, showToast, user]
  );

  const handleSaveClinic = useCallback(
    async (event?: { preventDefault?: () => void }) => {
      event?.preventDefault?.();
      await save();
    },
    [save]
  );

  if (!loaded) {
    return <div className="h-40 rounded-3xl bg-surface-muted animate-pulse" aria-hidden="true" />;
  }

  return <>{children({ clinicData, setClinicData, handleSaveClinic, save, saving, isDirty, discard })}</>;
}

/**
 * The schedule is stored as one nested object, so it is spliced out of the document here and
 * folded back in on save. `configuredAt` is what lets the booking and availability code tell a
 * real setting from the built-in default — nothing seeds this document at signup, so without the
 * stamp a clinic that never opened this screen looks identical to one that set 9-to-9 on purpose.
 */
export const SCHEDULE_DEFAULT = {
  start: "09:00",
  end: "21:00",
  slotDuration: "30",
  offDays: [] as string[],
};

export function readSchedule(clinicData: ClinicInfoState) {
  const stored = clinicData.schedule;
  return { ...SCHEDULE_DEFAULT, ...(typeof stored === "object" && stored ? stored : {}) };
}
