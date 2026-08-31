"use client";

/**
 * A tooth written the way Palmer is actually written: the number INSIDE its quadrant bracket.
 *
 * The bracket is not a character that sits beside the digit — it is the corner of the chart's
 * cross, and the number belongs within it. Set as a box-drawing glyph (`┘6`) it reads as two
 * separate marks and a technician has to reassemble them; drawn as borders on the number itself it
 * reads as the notation, because it IS the notation.
 *
 * `toPalmer().sides` decides which two edges get a line, so this component and the printed order
 * cannot drift apart — they read the same source.
 */

import { toPalmer } from "@/lib/labCases";

export default function PalmerMark({ fdi, className = "" }: { fdi: number; className?: string }) {
  const palmer = toPalmer(fdi);
  if (!palmer) return null;

  const { sides, position } = palmer;
  const border = "2px solid currentColor";

  return (
    <span
      // dir=ltr because the bracket's side carries meaning — mirrored by RTL layout it would name
      // the opposite quadrant, which is the wrong tooth rather than an odd-looking one.
      dir="ltr"
      title={palmer.shorthand}
      className={`inline-flex items-center justify-center px-[3px] leading-none tabular-nums ${className}`}
      style={{
        borderTop: sides.top ? border : undefined,
        borderBottom: sides.bottom ? border : undefined,
        borderLeft: sides.left ? border : undefined,
        borderRight: sides.right ? border : undefined,
      }}
    >
      {position}
    </span>
  );
}

/** A list of teeth, each in its own bracket, spaced so the marks stay legible side by side. */
export function PalmerList({ teeth, className = "" }: { teeth: number[]; className?: string }) {
  if (!teeth.length) return null;
  return (
    <span dir="ltr" className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      {teeth.map((fdi) => (
        <PalmerMark key={fdi} fdi={fdi} />
      ))}
    </span>
  );
}
