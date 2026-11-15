"use client";

/**
 * The lab order a treatment raised, shown on that treatment's card.
 *
 * One glance says the crown is at the lab or back; one tap moves it to the step that normally
 * comes next — the same move the Lab page makes, through the same write. Anything rarer (cancel,
 * remake, a try-in loop by hand) stays on the Lab page or the patient's Lab tab.
 */

import { Check, ChevronRight, FlaskConical, Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { quickLabStep, statusFor, statusLabel, type LabCase, type LabCaseStatus } from "@/lib/labCases";

export default function NoteLabStrip({
  labCase,
  busy,
  onAdvance,
  onOpen,
  compact = false,
  readOnly = false,
}: {
  labCase: LabCase;
  busy: boolean;
  onAdvance: (labCase: LabCase, next: LabCaseStatus) => void;
  /** Opens the patient's Lab tab; absent where there is no tab to open. */
  onOpen?: () => void;
  compact?: boolean;
  /** Chair mode, another dentist's treatment: the stage shows, the button does not. */
  readOnly?: boolean;
}) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const status = statusFor(labCase.status);
  const next = readOnly ? null : quickLabStep(labCase.status, labCase.needsTryIn);

  const badge = (
    <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap">
      <FlaskConical size={compact ? 13 : 15} className="shrink-0 text-ink" aria-hidden="true" />
      <span className="text-[12px] font-black tabular-nums text-ink" dir="ltr">{labCase.code}</span>
      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-black ${status.pill}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
        {isAr ? status.ar : status.en}
      </span>
    </span>
  );

  return (
    <div
      /* On a phone the code, the stage and the button do not fit on one line: the button drops under them, centred like the rest of the card, instead of covering the stage. */
      className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-line bg-surface-subtle max-md:justify-center ${compact ? "w-fit max-w-full px-2 py-1" : "w-full px-3 py-2 md:justify-between"}`}
      data-tour="note-lab-strip"
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 rounded-md hover:opacity-70"
          title={isAr ? "افتح شغل المعمل" : "Open the lab work"}
        >
          {badge}
        </button>
      ) : (
        badge
      )}
      {next &&
        (busy ? (
          <Loader2 size={16} className="mx-2 shrink-0 animate-spin text-ink-muted" />
        ) : (
          <button
            type="button"
            onClick={() => onAdvance(labCase, next)}
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg bg-ink-slab font-black text-white transition-colors hover:bg-ink ${compact ? "h-7 px-2 text-[11px]" : "h-8 px-2.5 text-[12px]"}`}
          >
            {next === "back" || next === "fitted" ? <Check size={13} /> : <ChevronRight size={13} className={isAr ? "rotate-180" : ""} />}
            {statusLabel(next, language)}
          </button>
        ))}
    </div>
  );
}
