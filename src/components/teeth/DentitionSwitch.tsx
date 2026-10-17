"use client";

import { Baby, User } from "lucide-react";

/**
 * Adult / Child: which set of teeth the chart draws.
 *
 * The same two pills the Diagnosis page has carried since it was built, so a dentist who has
 * switched a child's chart there finds the identical control when recording the treatment. The
 * tooth picker never had it, which meant a filling on a milk tooth could only be recorded against
 * an adult number, or as a general procedure.
 */
export default function DentitionSwitch({
  primary,
  onChange,
  isAr,
}: {
  primary: boolean;
  onChange: (primary: boolean) => void;
  isAr: boolean;
}) {
  const pill = (on: boolean) =>
    `inline-flex h-7 max-lg:h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold transition-all ${
      on ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink-body"
    }`;
  return (
    <div role="group" aria-label={isAr ? "نوع الأسنان" : "Teeth"} className="inline-flex rounded-full bg-surface-muted p-0.5">
      <button type="button" aria-pressed={!primary} onClick={() => onChange(false)} className={pill(!primary)}>
        <User size={12} /> {isAr ? "بالغ" : "Adult"}
      </button>
      <button type="button" aria-pressed={primary} onClick={() => onChange(true)} className={pill(primary)}>
        <Baby size={12} /> {isAr ? "أطفال" : "Child"}
      </button>
    </div>
  );
}
