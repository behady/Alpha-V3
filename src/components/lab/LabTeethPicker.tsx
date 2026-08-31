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
}: {
  upper: number[];
  lower: number[];
  selected: Set<number>;
  onToggle: (id: number) => void;
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

      {/* Scrolls on its own rather than widening the modal — sixteen teeth do not fit a phone. */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="flex flex-col gap-3 w-max">
          <PalmerGrid upper={FDI_UPPER} lower={FDI_LOWER} selected={selected} onToggle={toggle} />
          {showPrimary && (
            <PalmerGrid
              upper={FDI_PRIMARY_UPPER}
              lower={FDI_PRIMARY_LOWER}
              selected={selected}
              onToggle={toggle}
            />
          )}
        </div>
      </div>

      <div className="flex items-baseline gap-2 flex-wrap pt-1">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
          {isAr ? "المختار" : "Selected"}
        </span>
        <span className="text-sm font-black text-sky-800 tracking-wider" dir="ltr">
          {teeth.length ? formatPalmer(teeth) : isAr ? "لا شيء" : "none"}
        </span>
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
