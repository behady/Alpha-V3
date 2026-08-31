"use client";

/**
 * Picking the teeth on a lab order.
 *
 * Deliberately the SAME grid the printed order draws — the Palmer cross, positions counting
 * outward from the midline, the chosen teeth filled dark. What you click here is literally what
 * the technician receives, so there is no translation step in anybody's head between the screen
 * and the paper.
 *
 * Not the app's `TeethChart`: that one renders each tooth through `next/image`, labels in FDI, and
 * is sized to be the whole page rather than one field in a form. This is a picker, and it has to
 * sit above a dozen other inputs without taking the modal over.
 *
 * FDI numbers go in and out; Palmer is what gets shown. That split is the same one the rest of the
 * lab module makes, and it is why the printed sheet and this picker can never disagree.
 */

import { useMemo } from "react";
import { Baby, Eraser } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { PalmerList } from "@/components/lab/PalmerMark";
import {
  FDI_LOWER,
  FDI_PRIMARY_LOWER,
  FDI_PRIMARY_UPPER,
  FDI_UPPER,
  formatPalmer,
  hasPrimaryTeeth,
  toPalmer,
} from "@/lib/labCases";

/**
 * One arch pair, drawn as the Palmer cross.
 *
 * Defined at module level, not inside the picker: a component created during render is a NEW
 * component type on every keystroke, so React unmounts and remounts the whole grid each time —
 * losing focus and throwing away any transition mid-flight.
 */
function PalmerGrid({
  upper,
  lower,
  selected,
  onToggle,
  labels,
}: {
  upper: number[];
  lower: number[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  labels: { right: string; left: string };
}) {
  const half = upper.length / 2;

  const cell = (id: number, isMidline: boolean, isUpperRow: boolean) => {
    const on = selected.has(id);
    return (
      <button
        key={id}
        type="button"
        onClick={() => onToggle(id)}
        aria-pressed={on}
        aria-label={toPalmer(id)?.label || String(id)}
        className={`w-7 h-7 sm:w-8 sm:h-8 text-[11px] font-black tabular-nums transition-colors ${
          on ? "bg-sky-700 text-white" : "bg-white text-slate-400 hover:bg-sky-50 hover:text-sky-700"
        } ${isMidline ? "border-e-2 border-e-slate-900" : ""} ${isUpperRow ? "border-b-2 border-b-slate-900" : ""}`}
      >
        {toPalmer(id)?.position ?? ""}
      </button>
    );
  };

  return (
    <div className="inline-block" dir="ltr">
      {/* Which side is which. The chart is drawn FACING the patient, so the left half of the page
          is the patient's right — the single thing about a dental chart that everyone has to be
          told once and nobody should have to remember. */}
      <div className="flex text-[9px] font-black uppercase tracking-widest text-slate-400 pb-1">
        <div className="flex-1 text-center">{labels.right}</div>
        <div className="flex-1 text-center">{labels.left}</div>
      </div>
      <div className="flex">{upper.map((id, i) => cell(id, i === half - 1, true))}</div>
      <div className="flex">{lower.map((id, i) => cell(id, i === half - 1, false))}</div>
    </div>
  );
}

export default function LabTeethPicker({
  teeth,
  onChange,
  showPrimary,
  onShowPrimaryChange,
}: {
  teeth: number[];
  onChange: (next: number[]) => void;
  showPrimary: boolean;
  onShowPrimaryChange: (next: boolean) => void;
}) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const selected = useMemo(() => new Set(teeth), [teeth]);

  const sideLabels = isAr
    ? { right: "يمين المريض", left: "شمال المريض" }
    : { right: "Patient's right", left: "Patient's left" };

  const toggle = (id: number) => {
    // Order is preserved on add rather than sorted, so the list reads back in the order the
    // dentist actually worked — which is how they describe the case out loud.
    onChange(selected.has(id) ? teeth.filter((t) => t !== id) : [...teeth, id]);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
          {isAr ? "اختار الأسنان" : "Pick the teeth"}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onShowPrimaryChange(!showPrimary)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide transition-colors ${
              showPrimary ? "bg-sky-100 text-sky-800" : "bg-white text-slate-500 hover:bg-slate-100 border border-slate-200"
            }`}
          >
            <Baby size={12} />
            {isAr ? "لبني" : "Primary"}
          </button>
          {teeth.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <Eraser size={12} />
              {isAr ? "مسح" : "Clear"}
            </button>
          )}
        </div>
      </div>

      {/* Scrolls on its own rather than widening the modal — sixteen teeth do not fit a phone —
          and centres within whatever room it has. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex flex-col items-center gap-3 w-max mx-auto">
          <PalmerGrid
            upper={FDI_UPPER}
            lower={FDI_LOWER}
            selected={selected}
            onToggle={toggle}
            labels={sideLabels}
          />
          {showPrimary && (
            <PalmerGrid
              upper={FDI_PRIMARY_UPPER}
              lower={FDI_PRIMARY_LOWER}
              selected={selected}
              onToggle={toggle}
              labels={sideLabels}
            />
          )}
        </div>
      </div>

      <div className="flex items-baseline gap-2 flex-wrap pt-1">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
          {isAr ? "المختار" : "Selected"}
        </span>
        {teeth.length ? (
          <PalmerList teeth={teeth} className="text-sm font-black text-sky-800" />
        ) : (
          <span className="text-sm font-bold text-slate-400">{isAr ? "لا شيء" : "none"}</span>
        )}
        {hasPrimaryTeeth(teeth) && !showPrimary && (
          // The selection contains a child's tooth the visible grid cannot show. Saying so beats
          // leaving somebody to wonder why the count and the diagram disagree.
          <span className="text-[10px] font-bold text-amber-700">
            {isAr ? "فيه أسنان لبنية — افتح «لبني»" : "includes primary teeth — open Primary"}
          </span>
        )}
      </div>
    </div>
  );
}
