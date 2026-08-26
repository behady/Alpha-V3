"use client";

import { TREATMENT_STATES, type TreatmentStateId } from "@/lib/toothTreatments";

/**
 * The mark that says what was DONE to a tooth.
 *
 * Drawn as one SVG on a 0–100 viewBox with the default `preserveAspectRatio`, so it letterboxes to
 * a centred square exactly the way the tooth artwork's `object-contain` does. Positioning these in
 * CSS percentages of the containing box looks equivalent and is not: the box is 30×40 at the
 * smallest breakpoint and the art inside it is 30×30, so a mark placed at "50% down the box" sits
 * five pixels below the middle of the tooth. Sharing the art's own coordinate space is the only
 * way the mark lands where the tooth actually is.
 *
 * Every glyph is horizontally symmetric and takes its vertical orientation from `isUpper`. That is
 * not an aesthetic choice — the caller renders this OUTSIDE the mirrored wrapper (quadrants 2 and
 * 3 are mirrored, 3 and 4 are flipped), and a mark that is not symmetric would be right on eight
 * teeth and wrong on twenty-four.
 *
 * Geometry stays inside x 25–75, y 20–80, which is where the PNG's alpha actually is. Outside that
 * the mark floats over transparent pixels and reads as a smudge beside the tooth.
 */
export default function ToothTreatmentMark({
  treatment,
  isUpper,
}: {
  treatment: TreatmentStateId;
  isUpper: boolean;
}) {
  const color = TREATMENT_STATES[treatment].color;

  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 w-full h-full z-[15] pointer-events-none overflow-visible"
      aria-hidden
    >
      {treatment === "extracted" && (
        /*
         * A full ✕, and deliberately not the single red slash that marks a tooth DIAGNOSED as
         * missing. The two facts are different — "this tooth was already gone when we met the
         * patient" against "we took it out" — and a chart that draws them identically has thrown
         * away the more useful of the two.
         */
        <g stroke={color} strokeWidth={7} strokeLinecap="round">
          <line x1={22} y1={22} x2={78} y2={78} />
          <line x1={22} y1={78} x2={78} y2={22} />
        </g>
      )}

      {treatment === "implant" && (
        /* A shaft with threads: the one form in dentistry nobody mistakes for anything else, and
           the only one still readable when the whole tooth is thirty pixels wide. */
        <g>
          <rect x={42} y={24} width={16} height={58} rx={3} fill={color} stroke="#fff" strokeWidth={1.5} />
          {[36, 48, 60, 72].map((y) => (
            <rect key={y} x={30} y={y} width={40} height={5} rx={2.5} fill={color} stroke="#fff" strokeWidth={1.5} />
          ))}
        </g>
      )}

      {treatment === "veneered" && (
        /* A facing bonded across the visible half of the crown — a plate with a hard edge, so it
           reads as something laid ON the tooth rather than as a stain in it. */
        <rect
          x={22}
          y={isUpper ? 18 : 48}
          width={56}
          height={34}
          rx={10}
          fill={color}
          fillOpacity={0.95}
          stroke="#64748b"
          strokeWidth={2.5}
        />
      )}

      {treatment === "root_canal" && (
        /* The canal itself, down the middle, where the file goes. */
        <rect x={45.5} y={20} width={9} height={60} rx={4.5} fill={color} stroke="#fff" strokeWidth={2} />
      )}

      {treatment === "filled" && (
        /* A solid block in the middle of the crown. Solid rather than a ring: it is material that
           was put in, and a block cannot be confused with the root canal's thin stripe even at the
           smallest size, which is the whole test a mark has to pass. */
        <rect
          x={31}
          y={35}
          width={38}
          height={30}
          rx={8}
          fill={color}
          fillOpacity={0.95}
          stroke="#fff"
          strokeWidth={2}
        />
      )}

      {treatment === "perio" && (
        /* A band hugging the gum line, which is where the treatment happened. Told apart from the
           others by WHERE it sits rather than by its colour. */
        <rect
          x={20}
          y={isUpper ? 18 : 74}
          width={60}
          height={8}
          rx={4}
          fill={color}
          stroke="#fff"
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
}
