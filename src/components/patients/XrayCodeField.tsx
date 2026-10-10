"use client";

import { useEffect, useRef, useState } from "react";
import { updateDoc } from "firebase/firestore";
import { Check, Pencil, Plus, X } from "lucide-react";
import { getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import Protect from "@/components/Protect";

/**
 * The patient's file name or code on the x-ray machine's own software.
 *
 * Panoramic and CBCT units keep their own patient list, named however the radiographer typed it.
 * Writing that name here is what lets the desk find the scan on the x-ray PC without guessing.
 * Edited in place, so recording it is one tap and a few keystrokes rather than the full edit form.
 */
export default function XrayCodeField({ patientId, value }: { patientId: string; value?: string | null }) {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const ar = language === "ar";
  const current = String(value || "").trim();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const open = () => {
    setDraft(current);
    setEditing(true);
  };

  const save = async () => {
    const next = draft.trim().slice(0, 80);
    if (next === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updateDoc(getClinicDoc("patients", patientId), { xrayCode: next });
      setEditing(false);
      showToast(ar ? "تم حفظ كود الأشعة" : "X-ray code saved", "success");
    } catch {
      showToast(ar ? "تعذر الحفظ — حاول مرة أخرى" : "Could not save — try again", "error");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(false);
          }}
          dir="ltr"
          maxLength={80}
          placeholder={ar ? "مثال: PAN-1043" : "e.g. PAN-1043"}
          className="w-36 px-2 py-1 text-sm font-bold text-ink bg-surface-subtle border border-line rounded-lg outline-none focus:border-line-strong font-figure"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          title={ar ? "حفظ" : "Save"}
          aria-label={ar ? "حفظ" : "Save"}
          className="p-1 rounded-md text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
        >
          <Check size={15} />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          title={ar ? "إلغاء" : "Cancel"}
          aria-label={ar ? "إلغاء" : "Cancel"}
          className="p-1 rounded-md text-ink-muted hover:bg-surface-muted disabled:opacity-40"
        >
          <X size={15} />
        </button>
      </span>
    );
  }

  if (!current) {
    return (
      <Protect permission="patients.edit" fallback={<span className="text-sm font-semibold text-ink-faint">—</span>}>
        <button
          type="button"
          onClick={open}
          className="inline-flex items-center gap-1 text-sm font-bold text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          <Plus size={14} /> {ar ? "أضف" : "Add"}
        </button>
      </Protect>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <bdi dir="ltr" className="font-figure">{current}</bdi>
      <Protect permission="patients.edit">
        <button
          type="button"
          onClick={open}
          title={ar ? "تعديل" : "Edit"}
          aria-label={ar ? "تعديل كود الأشعة" : "Edit x-ray code"}
          className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-surface-muted"
        >
          <Pencil size={12} />
        </button>
      </Protect>
    </span>
  );
}
