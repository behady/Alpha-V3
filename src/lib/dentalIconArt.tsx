"use client";

import React from "react";

/**
 * The colour dental icon set.
 *
 * The stroke icons in `dentalIcons.tsx` are one colour by design — they are mirrored path-for-path
 * into the Android app, which renders them as single-colour vectors. That constraint made every
 * treatment in the price list look the same: thirty variations on a grey tooth outline, where the
 * difference between a zircon crown and a root canal was two short strokes most people never
 * looked closely enough to see.
 *
 * These are drawings rather than glyphs. Each one is built from flat, layered shapes — enamel,
 * dentine, gum, metal, porcelain — in the colours those materials actually are, so a treatment is
 * recognisable at a glance instead of by reading its label. Flat layers and not gradients on
 * purpose: at the 16–24px these render at, a gradient is invisible, and every gradient would need
 * a document-unique id to avoid colliding with the same icon drawn elsewhere on the page.
 *
 * The ids match `DENTAL_ICONS` exactly. Anything without art here falls back to the stroke icon,
 * so the two sets can never disagree about which treatments exist.
 *
 * ANDROID: these are NOT mirrored into DentalIcons.kt — the Android renderer takes a single path
 * list and one tint, and cannot draw them. Android keeps the stroke icons until that renderer is
 * replaced. See the note in dentalIcons.tsx before editing either set.
 */

/** Materials, not a theme. A tooth is the colour a tooth is in both light and dark mode. */
const C = {
  enamel: "#FFFFFF",
  enamelMid: "#E9F1F8",
  enamelShade: "#C9DAE8",
  line: "#8CA4BA",
  dentine: "#F6E8D2",
  dentineDeep: "#DFC9A4",
  gum: "#F2919C",
  gumDeep: "#DA6675",
  gumSore: "#E24356",
  gold: "#F0C462",
  goldDeep: "#CE9A28",
  steel: "#C4CED8",
  steelDeep: "#8A9BAB",
  ice: "#93DAEF",
  iceDeep: "#48AFD2",
  mint: "#4FC9B6",
  red: "#E4635C",
  amber: "#F4A93A",
  decay: "#7A5334",
  pearl: "#EDE2F7",
  pearlDeep: "#B694D6",
  blue: "#5B9BE8",
  film: "#2E4A63",
} as const;

/* ------------------------------------------------------------------ *
 * Shared anatomy. One molar, drawn once, reused by most of the set.
 * ------------------------------------------------------------------ */

/** Full molar silhouette: crown plus two tapering roots. */
const MOLAR =
  "M12 3.3c-3.6 0-6.1 1.9-6.1 4.7 0 1.6.4 3 .82 4.3.46 1.47.77 3.24.97 5.06.14 1.3.3 2.43.46 3.14.16.81.5 1.32 1.07 1.32.61 0 .94-.56 1.1-1.42.19-1.16.33-2.43.47-3.55.1-.81.28-1.32.51-1.32s.41.51.51 1.32c.14 1.12.28 2.39.47 3.55.16.86.49 1.42 1.1 1.42.57 0 .91-.51 1.07-1.32.16-.71.32-1.84.46-3.14.2-1.82.51-3.59.97-5.06.42-1.3.82-2.7.82-4.3 0-2.8-2.5-4.7-6.1-4.7z";

/** The enamel cap only — the part of a tooth that is actually white. */
const MOLAR_ENAMEL =
  "M12 3.3c-3.6 0-6.1 1.9-6.1 4.7 0 1.18.22 2.2.48 3.15h11.24c.26-.95.48-1.97.48-3.15 0-2.8-2.5-4.7-6.1-4.7z";

/** A soft shine down the left of the crown. Sells the gloss more than any gradient would. */
const MOLAR_SHINE = "M9.1 5.4c-.9.6-1.4 1.5-1.4 2.6 0 .8.1 1.5.25 2.2";

/** Gum line hugging the neck of the tooth. */
const GUM_BAND =
  "M6.38 11.15h11.24c-.16.6-.31 1.22-.44 1.87-1.72.6-3.44.9-5.18.9s-3.46-.3-5.18-.9c-.13-.65-.28-1.27-.44-1.87z";

/** A four-point sparkle, for the icons that mean "brighter than before". */
const sparkle = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}L${cx + r * 0.32} ${cy - r * 0.32}L${cx + r} ${cy}L${cx + r * 0.32} ${cy + r * 0.32}L${cx} ${cy + r}L${cx - r * 0.32} ${cy + r * 0.32}L${cx - r} ${cy}L${cx - r * 0.32} ${cy - r * 0.32}Z`;

/** The molar every treatment is drawn on top of. */
function Molar({ gum = false, shine = true }: { gum?: boolean; shine?: boolean }) {
  return (
    <>
      <path d={MOLAR} fill={C.dentine} stroke={C.line} strokeWidth={0.9} strokeLinejoin="round" />
      <path d={MOLAR_ENAMEL} fill={C.enamel} stroke="none" />
      <path d={MOLAR_ENAMEL} fill="none" stroke={C.line} strokeWidth={0.9} strokeLinejoin="round" />
      {gum && <path d={GUM_BAND} fill={C.gum} stroke="none" />}
      {shine && (
        <path d={MOLAR_SHINE} fill="none" stroke={C.enamelMid} strokeWidth={1.5} strokeLinecap="round" />
      )}
    </>
  );
}

/** A smaller molar pushed to one side, when a tool has to sit beside it. */
function MolarSmall({ x = -3.2, y = -1.4, scale = 0.72 }: { x?: number; y?: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} style={{ transformOrigin: "12px 12px" }}>
      <Molar shine={false} />
    </g>
  );
}

/** The porcelain-cap shape shared by every kind of crown. */
function CrownCap({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <>
      <path
        d="M5.6 9.6l2.1-4.3 2.8 2.7L12 3.6l1.5 4.4 2.8-2.7 2.1 4.3z"
        fill={fill}
        stroke={stroke}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path
        d="M6.5 9.6h11v2.3c0 4.2-1.7 8.3-5.5 8.3s-5.5-4.1-5.5-8.3z"
        fill={fill}
        stroke={stroke}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
    </>
  );
}

/** The titanium screw shared by the implant icons. */
function ImplantScrew() {
  return (
    <>
      <path d="M9.5 10.2h5l-.5 3.1h-4z" fill={C.steel} stroke={C.steelDeep} strokeWidth={0.8} strokeLinejoin="round" />
      <path d="M10 13.3h4l-.45 2.9h-3.1z" fill={C.steel} stroke={C.steelDeep} strokeWidth={0.8} strokeLinejoin="round" />
      <path d="M10.45 16.2h3.1l-1.55 3.6z" fill={C.steel} stroke={C.steelDeep} strokeWidth={0.8} strokeLinejoin="round" />
      <path d="M9.7 11.6h4.6M10.2 14.6h3.6" stroke={C.steelDeep} strokeWidth={0.7} strokeLinecap="round" />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The icons.
 * ------------------------------------------------------------------ */

export const DENTAL_ICON_ART: Record<string, React.ReactNode> = {
  tooth: <Molar />,

  checkup: (
    <>
      <Molar />
      <path
        d="M9.2 10.3l1.9 1.9 3.8-3.9"
        fill="none"
        stroke={C.mint}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),

  cleaning: (
    <>
      <Molar />
      <path d={sparkle(19.3, 4.9, 2)} fill={C.mint} />
      <path d={sparkle(4.5, 9.2, 1.5)} fill={C.mint} />
    </>
  ),

  whitening: (
    <>
      <Molar />
      <path d={sparkle(12, 8.2, 2.4)} fill={C.ice} />
      <path d={sparkle(19, 4.6, 1.6)} fill={C.iceDeep} />
    </>
  ),

  filling: (
    <>
      <Molar />
      <path
        d="M9.6 7.6c0-1.2 1.1-2.1 2.4-2.1s2.4.9 2.4 2.1c0 1.4-1.1 2.4-2.4 2.4s-2.4-1-2.4-2.4z"
        fill={C.blue}
        stroke="#3E7DC4"
        strokeWidth={0.8}
      />
      <path d="M10.6 6.9c.3-.4.7-.6 1.2-.6" stroke="#A9CDF2" strokeWidth={0.9} strokeLinecap="round" fill="none" />
    </>
  ),

  "root-canal": (
    <>
      <Molar />
      <path
        d="M12 6.4v6.2M9.9 19.8c.2-3.2.7-5.6 2.1-5.6s1.9 2.4 2.1 5.6"
        fill="none"
        stroke={C.red}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="5.9" r="1.5" fill={C.red} />
    </>
  ),

  "post-core": (
    <>
      <Molar />
      <path d="M11.2 4.8h1.6v10.4h-1.6z" fill={C.steel} stroke={C.steelDeep} strokeWidth={0.8} strokeLinejoin="round" />
      <path d="M9.6 6.6h4.8" stroke={C.steelDeep} strokeWidth={1.4} strokeLinecap="round" />
    </>
  ),

  extraction: (
    <>
      <MolarSmall />
      <path
        d="M15.4 4.6l4.6 4.6M20 4.6l-4.6 4.6"
        stroke={C.red}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M14.9 14.2c2.1 1.1 3.5 2.9 4 5.2"
        fill="none"
        stroke={C.steelDeep}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </>
  ),

  surgery: (
    <>
      <MolarSmall />
      <path
        d="M20.4 3.6l-6.2 6.2c-.9.9-2.1 1.3-3.3 1.3 0-1.2.4-2.4 1.3-3.3l1.6-1.6z"
        fill={C.steel}
        stroke={C.steelDeep}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path d="M14.4 16.6h5.4" stroke={C.gumDeep} strokeWidth={1.6} strokeLinecap="round" />
    </>
  ),

  implant: (
    <>
      <path d="M8.8 4.1h6.4l-1.1 3.3h-4.2z" fill={C.enamel} stroke={C.line} strokeWidth={0.9} strokeLinejoin="round" />
      <path d="M8.2 7.4h7.6" stroke={C.steelDeep} strokeWidth={1.3} strokeLinecap="round" />
      <ImplantScrew />
    </>
  ),

  "implant-crown": (
    <>
      <path
        d="M8.3 8.2c0-2.7 1.7-4.5 3.7-4.5s3.7 1.8 3.7 4.5c0 .9-.4 1.4-1.2 1.4H9.5c-.8 0-1.2-.5-1.2-1.4z"
        fill={C.enamel}
        stroke={C.line}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <ImplantScrew />
    </>
  ),

  crown: <CrownCap fill={C.gold} stroke={C.goldDeep} />,

  "crown-zircon": (
    <>
      <CrownCap fill={C.enamel} stroke={C.iceDeep} />
      <path d={sparkle(19.4, 4.4, 1.9)} fill={C.ice} />
      <path d="M9.4 12.4h5.2" stroke={C.ice} strokeWidth={1.2} strokeLinecap="round" />
    </>
  ),

  "crown-emax": (
    <>
      <CrownCap fill={C.pearl} stroke={C.pearlDeep} />
      <path d="M8.4 13.2h7.2M9.2 16h5.6" stroke={C.pearlDeep} strokeWidth={1.1} strokeLinecap="round" />
    </>
  ),

  "crown-metal": (
    <>
      <CrownCap fill={C.steel} stroke={C.steelDeep} />
      <path
        d="M7.2 12.6h9.6v1.7c-.2 1.1-.5 2.1-.9 3H8.1c-.4-.9-.7-1.9-.9-3z"
        fill={C.gold}
        stroke={C.goldDeep}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </>
  ),

  bridge: (
    <>
      <path d="M3.4 7.6h17.2" stroke={C.goldDeep} strokeWidth={1.8} strokeLinecap="round" />
      <path
        d="M4.9 7.9h4.9v2.7c0 2.5-.95 4.7-2.45 4.7S4.9 13.1 4.9 10.6zM14.2 7.9h4.9v2.7c0 2.5-.95 4.7-2.45 4.7s-2.45-2.2-2.45-4.7z"
        fill={C.gold}
        stroke={C.goldDeep}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path
        d="M9.8 7.9h4.4v1.9c0 1.8-.95 3.4-2.2 3.4s-2.2-1.6-2.2-3.4z"
        fill={C.enamel}
        stroke={C.line}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
    </>
  ),

  veneer: (
    <>
      <Molar />
      <path
        d="M11.9 3.35c-2.05.05-3.6.75-4.6 1.85-.9 1.6-1.05 3.8-.5 5.9.5 1.9 1.6 3.7 3.2 4.8V3.35z"
        fill={C.enamel}
        stroke={C.ice}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <path d={sparkle(19.2, 5.1, 1.6)} fill={C.ice} />
    </>
  ),

  "veneer-emax": (
    <>
      <Molar />
      <path
        d="M11.9 3.35c-2.05.05-3.6.75-4.6 1.85-.9 1.6-1.05 3.8-.5 5.9.5 1.9 1.6 3.7 3.2 4.8V3.35z"
        fill={C.pearl}
        stroke={C.pearlDeep}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <path d={sparkle(19.2, 5.1, 1.7)} fill={C.pearlDeep} />
    </>
  ),

  "smile-design": (
    <>
      <path
        d="M3.6 8.1c2.3 4.5 5.2 6.8 8.4 6.8s6.1-2.3 8.4-6.8z"
        fill={C.gumDeep}
        stroke={C.gumDeep}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path
        d="M5.9 8.1h12.2c-1.9 3.1-4 4.7-6.1 4.7S7.8 11.2 5.9 8.1z"
        fill={C.enamel}
        stroke="none"
      />
      <path d="M8.4 8.1v3.5M12 8.1v4.6M15.6 8.1v3.5" stroke={C.enamelShade} strokeWidth={0.85} />
      <path d={sparkle(19.6, 4.6, 1.8)} fill={C.ice} />
    </>
  ),

  denture: (
    <>
      <path
        d="M3.9 14.4c0-5.6 3.6-9.2 8.1-9.2s8.1 3.6 8.1 9.2v1.2c0 1.6-1.3 2.9-2.9 2.9H6.8c-1.6 0-2.9-1.3-2.9-2.9z"
        fill={C.gum}
        stroke={C.gumDeep}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path
        d="M4.6 11.9h14.8c.4 1.1.6 2.3.6 3.7H4c0-1.4.2-2.6.6-3.7z"
        fill={C.enamel}
        stroke="none"
      />
      <path d="M8 12.1v3.4M12 12v3.5M16 12.1v3.4" stroke={C.enamelShade} strokeWidth={0.9} />
    </>
  ),

  "partial-denture": (
    <>
      <path
        d="M4.8 16.6c0-6.1 3.1-9.7 7.2-9.7s7.2 3.6 7.2 9.7c-2.1 1.5-4.6 2.2-7.2 2.2s-5.1-.7-7.2-2.2z"
        fill={C.gum}
        stroke={C.gumDeep}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path
        d="M7.4 12.4h9.2c.5 1.2.8 2.6.9 4.2-1.7 1-3.6 1.5-5.5 1.5s-3.8-.5-5.5-1.5c.1-1.6.4-3 .9-4.2z"
        fill={C.enamel}
        stroke="none"
      />
      <path d="M9 13v4.3M15 13v4.3" stroke={C.enamelShade} strokeWidth={0.9} />
      <path d="M4.8 16.6h14.4" stroke={C.steelDeep} strokeWidth={1.2} strokeLinecap="round" />
    </>
  ),

  braces: (
    <>
      <Molar />
      <path d="M4.3 11.4h15.4" stroke={C.steelDeep} strokeWidth={1.5} strokeLinecap="round" />
      <rect x="9.9" y="9.3" width="4.2" height="4.2" rx="1" fill={C.steel} stroke={C.steelDeep} strokeWidth={0.9} />
      <path d="M10.9 10.4h2.2v2h-2.2z" fill={C.blue} />
    </>
  ),

  aligner: (
    <>
      <path
        d="M5.3 9.8c0-3.7 3-6.7 6.7-6.7s6.7 3 6.7 6.7c0 2.1-1 3.9-2.7 3.9-1.35 0-1.65-1-4-1s-2.65 1-4 1c-1.7 0-2.7-1.8-2.7-3.9z"
        fill={C.ice}
        fillOpacity={0.45}
        stroke={C.iceDeep}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <path
        d="M4.3 17.4c2.4 1.7 4.9 2.5 7.7 2.5s5.3-.8 7.7-2.5"
        fill="none"
        stroke={C.iceDeep}
        strokeWidth={1.4}
        strokeLinecap="round"
      />
    </>
  ),

  retainer: (
    <>
      <path
        d="M4.4 15.4C4.4 9.8 7.8 5.8 12 5.8s7.6 4 7.6 9.6c-2.2 1.3-4.8 2-7.6 2s-5.4-.7-7.6-2z"
        fill={C.gum}
        stroke={C.gumDeep}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path
        d="M6.4 12.7c1.7-.9 3.6-1.4 5.6-1.4s3.9.5 5.6 1.4"
        fill="none"
        stroke={C.steelDeep}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <path d="M6.4 12.7v3.5M17.6 12.7v3.5" stroke={C.steelDeep} strokeWidth={1.5} strokeLinecap="round" />
    </>
  ),

  "night-guard": (
    <>
      <path
        d="M12 3.3l7.1 2.6v5.5c0 4.4-2.9 7.5-7.1 9.1-4.2-1.6-7.1-4.7-7.1-9.1V5.9z"
        fill={C.ice}
        fillOpacity={0.5}
        stroke={C.iceDeep}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <path
        d="M8.7 11.2l2.2 2.2 4.3-4.3"
        fill="none"
        stroke={C.mint}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),

  xray: (
    <>
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="2" fill={C.film} stroke="#1B3247" strokeWidth={0.9} />
      <g transform="translate(0 0.6) scale(0.72)" style={{ transformOrigin: "12px 12px" }}>
        <path d={MOLAR} fill="#9FC6DE" fillOpacity={0.85} stroke="#CFE6F4" strokeWidth={0.9} strokeLinejoin="round" />
        <path d={MOLAR_ENAMEL} fill="#E4F2FB" stroke="none" />
      </g>
    </>
  ),

  scan: (
    <>
      <MolarSmall x={-2.6} y={-1.8} scale={0.66} />
      <circle cx="16.4" cy="14.2" r="4.3" fill={C.ice} fillOpacity={0.35} stroke={C.iceDeep} strokeWidth={1.3} />
      <path d="M19.6 17.4l2.2 2.2" stroke={C.iceDeep} strokeWidth={1.8} strokeLinecap="round" />
    </>
  ),

  perio: (
    <>
      <Molar gum />
      <path
        d="M3.6 18.6c1.3-1.3 2.6-1.9 3.9-1.9 1.7 0 2.5 1.1 4.2 1.1s2.5-1.1 4.2-1.1c1.4 0 2.7.6 4 1.9"
        fill="none"
        stroke={C.gumSore}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),

  pediatric: (
    <>
      <Molar />
      <circle cx="9.9" cy="7.6" r="0.85" fill={C.line} />
      <circle cx="14.1" cy="7.6" r="0.85" fill={C.line} />
      <path
        d="M10 9.9c.55.7 1.2 1.05 2 1.05s1.45-.35 2-1.05"
        fill="none"
        stroke={C.gumDeep}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    </>
  ),

  anesthesia: (
    <>
      <path d="M13.4 5.4l5.2 5.2M15 3.8l5.2 5.2" stroke={C.steelDeep} strokeWidth={1.7} strokeLinecap="round" />
      <path
        d="M11.9 6.9l5.2 5.2-6.6 6.6c-.9.9-2.4.9-3.3 0l-1.9-1.9c-.9-.9-.9-2.4 0-3.3z"
        fill={C.ice}
        fillOpacity={0.55}
        stroke={C.iceDeep}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <path d="M4.9 19l-1.5 1.5" stroke={C.steelDeep} strokeWidth={1.6} strokeLinecap="round" />
      <path d="M9.7 11.7l1.8 1.8" stroke={C.iceDeep} strokeWidth={1.2} strokeLinecap="round" />
    </>
  ),

  medication: (
    <>
      <path d="M8.1 4.1h7.8v3.3H8.1z" fill={C.steel} stroke={C.steelDeep} strokeWidth={0.9} strokeLinejoin="round" />
      <path
        d="M6.9 7.4h10.2v9.5c0 1.5-1.2 2.6-2.6 2.6H9.5c-1.4 0-2.6-1.1-2.6-2.6z"
        fill={C.amber}
        stroke="#CE861F"
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      <path d="M9.8 12.6h4.4M12 10.4v4.4" stroke={C.enamel} strokeWidth={1.7} strokeLinecap="round" />
    </>
  ),
};

/** One colour icon, or null when this id has no art and the caller should fall back. */
export function DentalIconArt({
  id,
  size = 22,
  className = "",
}: {
  id?: string | null;
  size?: number;
  className?: string;
}) {
  const art = id ? DENTAL_ICON_ART[id] : null;
  if (!art) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      // Shapes are drawn back to front; without this a stroke on a lower layer bleeds through.
      shapeRendering="geometricPrecision"
    >
      {art}
    </svg>
  );
}

export function hasColorArt(id?: string | null): boolean {
  return !!id && !!DENTAL_ICON_ART[id];
}
