"use client";

import { Check, Lock, Pencil, Trash2 } from "lucide-react";
import Protect from "@/components/Protect";
import type { Note } from "@/components/clinical-notes/types";

export type NoteStatus = "Planned" | "Ongoing" | "Completed";

export const STATUS_OPTIONS: Array<{ value: NoteStatus; ar: string; en: string }> = [
  { value: "Planned", ar: "مخطط", en: "Planned" },
  { value: "Ongoing", ar: "جاري", en: "Ongoing" },
  { value: "Completed", ar: "اتعمل", en: "Done" },
];

/** The three status buttons, shared by the chair popup and the dentist home. */
export function StatusSwitch({
  value,
  busy,
  onChange,
  isAr,
  dark = false,
}: {
  value: NoteStatus;
  busy: boolean;
  onChange: (next: NoteStatus) => void;
  isAr: boolean;
  /** On the black slab the buttons invert: white on dark. */
  dark?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={isAr ? "الحالة" : "Status"}>
      {STATUS_OPTIONS.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={busy}
            onClick={() => !on && onChange(o.value)}
            className={`flex h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-[14px] font-bold transition-colors disabled:opacity-60 ${
              on
                ? dark ? "border-white bg-white text-ink" : "border-ink-slab bg-ink-slab text-white"
                : dark ? "border-white/25 bg-white/5 text-white hover:border-white" : "border-line-strong bg-surface text-ink hover:border-ink"
            }`}
          >
            {on && o.value === "Completed" && <Check size={15} strokeWidth={3} className={dark ? "text-ink" : "text-[#FACC15]"} />}
            {isAr ? o.ar : o.en}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One treatment on the patient, as the chair sees it: no money. Mine → the status switch, edit
 * and delete; someone else's → a lock and their name, nothing to press.
 */
export default function ChairNoteCard({
  note,
  mine,
  busy,
  dentistName,
  onStatus,
  onEdit,
  onDelete,
  isAr,
}: {
  note: Note;
  mine: boolean;
  busy: boolean;
  dentistName: string;
  onStatus: (next: NoteStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  isAr: boolean;
}) {
  const status = (note.status || "Planned") as NoteStatus;
  const statusLabel = STATUS_OPTIONS.find((o) => o.value === status);
  const teeth = note.tooth && note.tooth !== "Gen" ? note.tooth : "";
  const fromApproval = !!(note as { claimId?: string }).claimId;
  return (
    <article className={`rounded-2xl border p-4 ${mine ? "border-line bg-surface" : "border-line bg-surface-subtle"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-black leading-tight text-ink">{note.procedure}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-bold text-ink-body">
            {teeth && (
              <span>
                {isAr ? "الأسنان" : "Teeth"} <bdi dir="ltr" className="font-figure text-ink">{teeth}</bdi>
              </span>
            )}
            {note.date && <bdi dir="ltr" className="font-figure text-ink-muted">{note.date}</bdi>}
            {fromApproval && <span className="rounded-md bg-accent-tint px-1.5 py-0.5 text-[12px] text-accent-ink">{isAr ? "من موافقة تأمين" : "Insurance approval"}</span>}
            {!mine && (
              <span className="inline-flex items-center gap-1 text-ink-muted">
                <Lock size={12} /> {dentistName ? `د. ${dentistName}` : isAr ? "العيادة" : "The clinic"}
              </span>
            )}
          </p>
          {note.note && <p className="mt-1.5 text-[14px] font-semibold text-ink-body line-clamp-2">{note.note}</p>}
        </div>
        {!mine && statusLabel && (
          <span className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-black ${status === "Completed" ? "bg-emerald-100 text-emerald-800" : status === "Ongoing" ? "bg-amber-100 text-amber-800" : "bg-surface-muted text-ink-body"}`}>
            {isAr ? statusLabel.ar : statusLabel.en}
          </span>
        )}
      </div>
      {mine && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="min-w-[240px] flex-1">
            <StatusSwitch value={status} busy={busy} onChange={onStatus} isAr={isAr} />
          </div>
          <button type="button" onClick={onEdit} className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3 text-[14px] font-bold text-ink hover:border-ink">
            <Pencil size={14} /> {isAr ? "عدّل" : "Edit"}
          </button>
          {/* Only for those who may delete; an approval row is deleted from the Insurance tab, by the desk. */}
          {!fromApproval && (
            <Protect permission="clinical.delete">
              <button type="button" onClick={onDelete} disabled={busy} className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 text-[14px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                <Trash2 size={14} /> {isAr ? "احذف" : "Delete"}
              </button>
            </Protect>
          )}
        </div>
      )}
    </article>
  );
}
