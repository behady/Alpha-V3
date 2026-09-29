"use client";

import { insurerBadge } from "@/lib/insurerPresets";

/**
 * A payer's monogram: two letters on a stable tone, drawn rather than downloaded.
 *
 * It stands in for the logo everybody's first instinct is to ship. Every insurer's mark is a
 * registered trademark, and bundling a library of them into a product sold to clinics is a
 * disproportionate risk for a nicety — so the app draws its own, the colour is derived from the
 * name so it never moves, and a clinic that wants the real mark can upload it.
 *
 * `Private` is the clinic's own work rather than a company, so it gets the ink slab instead of a
 * tone: in a column of coloured chips the clinic's own row should read as the baseline, not as
 * one more insurer.
 */
export default function InsurerBadge({
  name,
  isPrivate = false,
  size = 24,
}: {
  name: string;
  isPrivate?: boolean;
  size?: number;
}) {
  const { initials, tone } = insurerBadge(name);
  return (
    <span
      aria-hidden
      title={name}
      className="inline-grid shrink-0 place-items-center rounded-full font-black text-white"
      style={{
        width: size,
        height: size,
        background: isPrivate ? "var(--ink-slab, #14161a)" : tone,
        // Scaled rather than fixed: the same component sits at 20px in a dense sheet and 34px on
        // a settings card, and a font size that did not follow would be unreadable at one end.
        fontSize: Math.max(9, Math.round(size * 0.4)),
        letterSpacing: "0.01em",
      }}
    >
      {initials}
    </span>
  );
}
