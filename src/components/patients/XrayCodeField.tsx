"use client";

import { useEffect, useRef, useState } from "react";
import { updateDoc } from "firebase/firestore";
import { Check, Pencil, Plus, X } from "lucide-react";
import { getClinicDoc } from "@/lib/db-utils";
import { useLanguage } from "@/context/LanguageContext";
import { useUI } from "@/context/UIContext";
import Protect from "@/components/Protect";

/**
 * Where the field sits, which decides only how it looks:
 * - `page`: the patient file's info line, which prints its own label beside it.
 * - `card`: an appointment card on the day schedule. Small, labelled, and when there is no code yet
 *   the "add" link appears only while the card is hovered, so empty cards stay quiet.
 * - `band`: the booking pop-up's dark header band.
 */
type Variant = "page" | "card" | "band";

const LOOK: Record<Variant, {
  text: string;
  label: string;
  input: string;
  save: string;
  cancel: string;
  edit: string;
  add: string;
}> = {
  page: {
    text: "",
    label: "",
    input: "w-36 px-2 py-1 text-sm text-ink bg-surface-subtle border border-line focus:border-line-strong",
    save: "text-emerald-700 hover:bg-emerald-50",
    cancel: "text-ink-muted hover:bg-surface-muted",
    edit: "text-ink-faint hover:text-ink hover:bg-surface-muted",
    add: "text-sm text-ink-muted hover:text-ink",
  },
  card: {
    text: "text-[12px] font-bold text-ink-body",
    label: "font-semibold text-ink-muted",
    input: "w-28 px-1.5 py-0.5 text-xs text-ink bg-white border border-line focus:border-line-strong",
    save: "text-emerald-700 hover:bg-emerald-50",
    cancel: "text-ink-muted hover:bg-white/70",
    edit: "text-ink-faint hover:text-ink hover:bg-white/70",
    add: "text-[12px] text-ink-muted hover:text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
  },
  band: {
    text: "text-sm text-white/70",
    label: "",
    input: "w-36 px-2 py-1 text-sm text-white bg-white/10 border border-white/20 focus:border-white/50 placeholder:text-white/40",
    save: "text-emerald-300 hover:bg-white/10",
    cancel: "text-white/70 hover:bg-white/10",
    edit: "text-white/60 hover:text-white hover:bg-white/10",
    add: "text-sm text-white/70 hover:text-white",
  },
};

/**
 * The patient's file name or code on the x-ray machine's own software.
 *
 * Panoramic and CBCT units keep their own patient list, named however the radiographer typed it.
 * Writing that name here is what lets the desk find the scan on the x-ray PC without guessing.
 * Edited in place, so recording it is one tap and a few keystrokes rather than the full edit form —
 * on the patient file, on the appointment card and in the booking pop-up alike, all writing the same
 * `xrayCode` on the patient.
 */
export default function XrayCodeField({
  patientId,
  value,
  variant = "page",
  onSaved,
}: {
  patientId: string;
  value?: string | null;
  variant?: Variant;
  /** For a caller that read the patient once instead of listening, so it can show the new code. */
  onSaved?: (code: string) => void;
}) {
  const { language } = useLanguage();
  const { showToast } = useUI();
  const ar = language === "ar";
  const current = String(value || "").trim();
  const look = LOOK[variant];
  // The patient file prints its own label; the card and the pop-up name the field themselves.
  const label = variant === "page" ? "" : ar ? "أشعة" : "X-ray";

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
      onSaved?.(next);
      showToast(ar ? "تم حفظ كود الأشعة" : "X-ray code saved", "success");
    } catch {
      showToast(ar ? "تعذر الحفظ — حاول مرة أخرى" : "Could not save — try again", "error");
    } finally {
      setSaving(false);
    }
  };

  const labelEl = label ? <span className={look.label}>{label}</span> : null;

  if (editing) {
    return (
      <span className={`inline-flex items-center gap-1 ${look.text}`}>
        {labelEl}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Kept here: inside the booking pop-up an Enter would otherwise reach the booking itself.
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          dir="ltr"
          maxLength={80}
          placeholder={ar ? "مثال: PAN-1043" : "e.g. PAN-1043"}
          className={`font-bold rounded-lg outline-none font-figure ${look.input}`}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          title={ar ? "حفظ" : "Save"}
          aria-label={ar ? "حفظ" : "Save"}
          className={`p-1 rounded-md disabled:opacity-40 ${look.save}`}
        >
          <Check size={15} />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          title={ar ? "إلغاء" : "Cancel"}
          aria-label={ar ? "إلغاء" : "Cancel"}
          className={`p-1 rounded-md disabled:opacity-40 ${look.cancel}`}
        >
          <X size={15} />
        </button>
      </span>
    );
  }

  if (!current) {
    // Nothing to read, and on a card nothing worth a dash either.
    const fallback = variant === "card" ? null : <span className={`text-sm font-semibold ${variant === "band" ? "text-white/50" : "text-ink-faint"}`}>—</span>;
    return (
      <Protect permission="patients.edit" fallback={fallback}>
        <button
          type="button"
          onClick={open}
          className={`inline-flex items-center gap-1 font-bold underline-offset-4 hover:underline transition-opacity ${look.add}`}
        >
          <Plus size={variant === "card" ? 12 : 14} />
          {variant === "page" ? (ar ? "أضف" : "Add") : ar ? "رقم الأشعة" : "X-ray no."}
        </button>
      </Protect>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${look.text}`}>
      {labelEl}
      <bdi dir="ltr" className={`font-figure ${variant === "band" ? "font-semibold text-white" : ""}`}>{current}</bdi>
      <Protect permission="patients.edit">
        <button
          type="button"
          onClick={open}
          title={ar ? "تعديل" : "Edit"}
          aria-label={ar ? "تعديل كود الأشعة" : "Edit x-ray code"}
          className={`p-1 rounded-md ${look.edit}`}
        >
          <Pencil size={12} />
        </button>
      </Protect>
    </span>
  );
}
