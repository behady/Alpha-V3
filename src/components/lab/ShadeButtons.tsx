"use client";

/**
 * The shade, picked the way a shade guide is read.
 *
 * A drop-down of twenty names is a scroll and a squint with a gloved hand on a phone. Here every
 * shade is a button big enough to hit, one family to a row: A, B, C, D, then the bleach shades.
 * Tapping the chosen shade again clears it.
 */

import { SHADE_ROWS } from "@/lib/labCases";

export default function ShadeButtons({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  // An order written before these buttons, or by hand, can hold a shade the guide does not list.
  // It is shown, so it is not silently dropped the next time the order is saved.
  const offGuide = value && !SHADE_ROWS.some((row) => row.includes(value));

  return (
    <div className="space-y-1.5" dir="ltr" role="group" aria-label={label} data-tour="lab-case-shade">
      {SHADE_ROWS.map((row) => (
        <div key={row[0]} className="grid grid-cols-5 gap-1.5">
          {row.map((shade) => {
            const on = value === shade;
            return (
              <button
                key={shade}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? "" : shade)}
                className={`h-11 rounded-lg border text-[13px] font-black tabular-nums transition-colors ${
                  on ? "border-ink-slab bg-ink-slab text-white" : "border-line bg-surface text-ink hover:border-ink"
                }`}
              >
                {shade}
              </button>
            );
          })}
        </div>
      ))}
      {offGuide && (
        <button
          type="button"
          aria-pressed="true"
          onClick={() => onChange("")}
          className="h-11 rounded-lg border border-ink-slab bg-ink-slab px-4 text-[13px] font-black text-white"
        >
          {value}
        </button>
      )}
    </div>
  );
}
