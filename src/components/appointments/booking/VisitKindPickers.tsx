"use client";

import type { PatientKind, WorkKind } from "@/lib/visitKind";

/**
 * The two answers beside the appointment's status in the booking pop-up: new or old patient, new
 * work or a follow-up (lib/visitKind). The dentist's home shows them as tags.
 *
 * Two-button switches rather than drop-downs: both choices stay on screen and one tap answers.
 * Tapping the chosen one again clears it — an answer given by mistake must be removable, and
 * "no answer" is a real state (every booking made before these existed has none).
 */
export default function VisitKindPickers({
  patientKind,
  workKind,
  onPatientKind,
  onWorkKind,
  isAr,
  isPhone = false,
}: {
  patientKind: PatientKind | "";
  workKind: WorkKind | "";
  onPatientKind: (next: PatientKind | "") => void;
  onWorkKind: (next: WorkKind | "") => void;
  isAr: boolean;
  isPhone?: boolean;
}) {
  const label = isPhone ? "text-sm font-semibold text-ink-body" : "text-base font-semibold text-ink-body";
  return (
    <>
      <div className="flex items-center gap-3">
        <span className={label}>{isAr ? "المريض" : "Patient"}</span>
        <Switch
          value={patientKind}
          onChange={onPatientKind}
          options={[
            { id: "new", label: isAr ? "جديد" : "New" },
            { id: "old", label: isAr ? "قديم" : "Old" },
          ]}
          groupLabel={isAr ? "المريض جديد ولا قديم" : "New or old patient"}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className={label}>{isAr ? "الشغل" : "Work"}</span>
        <Switch
          value={workKind}
          onChange={onWorkKind}
          options={[
            { id: "new", label: isAr ? "جديد" : "New" },
            { id: "followup", label: isAr ? "متابعة" : "Follow-up" },
          ]}
          groupLabel={isAr ? "شغل جديد ولا متابعة" : "New work or follow-up"}
        />
      </div>
    </>
  );
}

function Switch<T extends string>({
  value,
  onChange,
  options,
  groupLabel,
}: {
  value: T | "";
  onChange: (next: T | "") => void;
  options: { id: T; label: string }[];
  groupLabel: string;
}) {
  return (
    <div role="group" aria-label={groupLabel} className="flex gap-1 rounded-full bg-surface-muted p-1">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? "" : o.id)}
            className={`h-9 rounded-full px-4 text-sm font-bold transition-colors ${
              on ? "bg-ink-slab text-white" : "text-ink-body hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
