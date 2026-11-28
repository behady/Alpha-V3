"use client";

/**
 * The teeth of one approved service, as a small box the desk can type over: "44, 46".
 *
 * It shows what the monthly sheet will print for the service and saves when the box is left or
 * Enter is pressed. The caller decides what a change needs first (a warning before numbers already
 * there are replaced) and does the saving; a change that is refused or cancelled puts the old
 * numbers back.
 */

import { useState } from "react";

export default function LineTeethField({
  teeth,
  borrowed,
  disabled,
  label,
  placeholder,
  onCommit,
}: {
  /** The teeth on record (FDI codes). */
  teeth: string[];
  /**
   * The numbers shown are only borrowed from the paper's note, not saved on the service yet:
   * typing them again (unchanged) still saves, which puts the patient's file right.
   */
  borrowed?: boolean;
  disabled?: boolean;
  label: string;
  placeholder: string;
  /** Called with the text as typed when it differs from what was shown. */
  onCommit: (typed: string) => Promise<void>;
}) {
  const shown = teeth.join(", ");
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    if (draft === null || saving) return;
    if (draft.trim() === shown && !borrowed) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await onCommit(draft);
    } finally {
      setSaving(false);
      // Saved: the live record now shows the new teeth. Refused or cancelled: the old ones are back.
      setDraft(null);
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      dir="ltr"
      value={draft ?? shown}
      disabled={disabled || saving}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          // Swallowed, and the box left a moment later: the same key press must never reach the
          // warning that leaving opens and answer it "yes" before anyone has read it.
          e.preventDefault();
          const box = e.currentTarget;
          window.setTimeout(() => box.blur(), 0);
        }
        if (e.key === "Escape") setDraft(null);
      }}
      className="h-9 w-28 min-w-0 rounded-lg border border-line-strong bg-surface px-2 text-center font-figure text-[13px] font-bold tabular-nums text-ink outline-none placeholder:font-semibold placeholder:text-ink-faint focus:border-ink disabled:opacity-60 lg:w-full"
    />
  );
}
