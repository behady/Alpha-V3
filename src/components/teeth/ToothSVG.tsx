"use client";

import Image from "next/image";
import {
  getPrimaryCategoryForStatuses,
  isMissingStatus,
} from "@/lib/diagnosisCatalog";
import { TREATMENT_STATES, type TreatmentStateId } from "@/lib/toothTreatments";

import ToothSurfaces, { ToothSurface } from "./ToothSurfaces";
import ToothTreatmentMark from "./ToothTreatmentMark";
import { ToothRootSVG } from "./ToothRootSVG";

export type ToothType = "incisor" | "canine" | "premolar" | "molar";

const OCCLUSAL_IMAGES: Record<ToothType, string> = {
  incisor: "/teeth/occlusal_incisor.png",
  canine: "/teeth/occlusal_canine.png",
  premolar: "/teeth/occlusal_premolar.png",
  molar: "/teeth/occlusal_molar.png",
};

export function toothTypeFromFDI(fdi: number): ToothType {
  const position = fdi % 10;
  if (position <= 2) return "incisor";
  if (position === 3) return "canine";
  if (position === 4 || position === 5) return "premolar";
  return "molar";
}

export function toothTypeFromPrimaryFDI(fdi: number): ToothType {
  const position = fdi % 10;
  if (position <= 2) return "incisor";
  if (position === 3) return "canine";
  return "molar";
}

export function isUpperFDI(fdi: number): boolean {
  const q = Math.floor(fdi / 10);
  return q === 1 || q === 2 || q === 5 || q === 6;
}

export interface ToothSVGProps {
  fdi: number;
  type: ToothType;
  isUpper: boolean;
  statuses: string[];
  isActive?: boolean;
  isHover?: boolean;
  hasNotes?: boolean;
  viewType?: "buccal" | "occlusal";
  ariaLabel?: string;
  activeSurfaces?: ToothSurface[];
  surfaceColors?: Record<string, string>;
  onSurfaceClick?: (surface: ToothSurface) => void;
  showRoot?: boolean;
  /**
   * What has been DONE to this tooth, as opposed to what is wrong with it.
   *
   * Drawn on a different channel from the diagnosis on purpose: the glow around a tooth says what
   * is wrong, the body of the tooth says what was done. A dentist glancing at a red halo has to be
   * able to read "caries" and not "we filled it", and the only way to guarantee that is to never
   * let the two share a channel.
   */
  treatment?: TreatmentStateId | null;
  /**
   * The mark drawn OVER the tooth, independent of whatever changed its form.
   *
   * Separate from `treatment` because a tooth can be both: root-filled and then crowned is the
   * commonest pair in dentistry. Collapsing the two into one winner drew the crown alone, which
   * presents a root-filled tooth as crowned and vital — and vitality testing then confirms a
   * non-response that reads as necrosis.
   */
  treatmentMark?: TreatmentStateId | null;
  /** Work booked or under way here. Never repaints the tooth — it has not happened yet. */
  hasPendingTreatment?: boolean;
}

export default function ToothSVG({
  fdi,
  type,
  isUpper,
  statuses = [],
  isActive = false,
  isHover = false,
  hasNotes = false,
  viewType = "buccal",
  ariaLabel,
  activeSurfaces = [],
  surfaceColors = {},
  onSurfaceClick,
  showRoot = false,
  treatment = null,
  treatmentMark = null,
  hasPendingTreatment = false,
}: ToothSVGProps) {
  const missing = isMissingStatus(statuses);
  const primaryCat = getPrimaryCategoryForStatuses(statuses);
  
  // Base transforms for realistic mirroring
  const q = Math.floor(fdi / 10);
  const scaleX = (q === 2 || q === 3 || q === 6 || q === 7) ? -1 : 1;
  const scaleY = (q === 3 || q === 4 || q === 7 || q === 8) ? -1 : 1;

  // CSS Drop Shadow based on Clinical Status
  /**
   * A crown changes the tooth's SHAPE, and it can arrive two ways: charted as a diagnosis
   * (`rest_crown` — a crown that was already in the mouth when this patient first sat down), or
   * performed here and recorded as a procedure. Both are a crowned tooth and both must look like
   * one; only the second is something this clinic did.
   */
  /**
   * A crown changes the tooth's SHAPE, and it can arrive two ways: charted as a diagnosis
   * (`rest_crown` — already in the mouth when this patient first sat down), or performed here and
   * recorded as a procedure. Both are a crowned tooth; only one is work this clinic did, and the
   * chart has room to say which, because both sets of artwork already exist.
   */
  const crownedHere = treatment === "crowned";
  const hasCrown = statuses.includes("rest_crown") || crownedHere;
  /** An extraction we performed empties the socket exactly as a charted `surg_missing` does. */
  const gone = missing || treatment === "extracted";
  
  let filterStyle = "";
  if (isActive) {
    filterStyle = `drop-shadow(0 0 8px #3b82f6) drop-shadow(0 0 3px #3b82f6)`;
  } else if (primaryCat) {
    filterStyle = `drop-shadow(0 0 6px ${primaryCat.color}) drop-shadow(0 0 2px ${primaryCat.color})`;
  } else if (isHover) {
    filterStyle = `drop-shadow(0 0 4px #94a3b8)`;
  } else {
    filterStyle = `drop-shadow(0 2px 4px rgba(0,0,0,0.1))`;
  }

  const isOcclusal = viewType === "occlusal";
  
  // Apply a metallic tint if it's an occlusal view of a crown
  if (isOcclusal && hasCrown) {
    filterStyle += " sepia(100%) hue-rotate(180deg) saturate(0) brightness(0.8) contrast(1.2)";
  }
  
  let baseSrc = `/teeth/${type}.png`;
  if (isOcclusal) {
    baseSrc = OCCLUSAL_IMAGES[type];
  } else if (crownedHere) {
    baseSrc = `/teeth/gold_crown_${type}.png`;
  } else if (hasCrown) {
    baseSrc = `/teeth/crown_${type}.png`;
  }
  
  const imageSrc = `${baseSrc}?v=1`; // Cache buster

  return (
    <div 
      className="relative w-full h-full transition-all duration-300 flex items-center justify-center group"
      title={ariaLabel}
    >
      {showRoot && !isOcclusal && !gone && (
        <ToothRootSVG type={type} isUpper={isUpper} />
      )}
      <div 
        className={`absolute inset-0 transition-transform duration-300`}
        style={{
           transform: isOcclusal ? undefined : `scale(${scaleX}, ${scaleY})`,
           filter: filterStyle,
           opacity: gone ? 0.15 : 1,
        }}
      >
        <Image 
          src={imageSrc}
          alt={hasCrown ? `${type} crown` : type}
          fill
          className="object-contain"
          unoptimized
        />
        
        {/* The interactive surface overlay layer */}
        {!gone && (
          <ToothSurfaces 
            activeSurfaces={activeSurfaces}
            surfaceColors={surfaceColors}
            onSurfaceClick={onSurfaceClick}
            viewType={viewType}
            isUpper={isUpper}
          />
        )}
      </div>

      {/* Diagnosed missing: one red slash, as always. An extraction WE performed draws its own ✕
          instead — see ToothTreatmentMark — so the two never stack into an unreadable asterisk. */}
      {gone && treatment !== "extracted" && (
         <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="w-[80%] h-0.5 bg-red-400 rotate-45 rounded-full shadow-sm" />
         </div>
      )}

      {treatment === "extracted" && (
        <ToothTreatmentMark treatment="extracted" isUpper={isUpper} />
      )}

      {/*
        * WORK DONE, drawn OUTSIDE the mirrored wrapper above.
        *
        * That placement is the whole trick. Everything inside that div inherits
        * `scale(±1, ±1)` — quadrant 2 is mirrored, quadrant 3 is upside-down, quadrant 4 is
        * flipped vertically. A mark drawn in there would be right on eight teeth and wrong on
        * twenty-four, and nobody would spot it until a dentist asked why the left side of the
        * mouth looked different from the right. The amber notes dot has always been a sibling for
        * exactly this reason; these follow it.
        *
        * `extracted` and `crowned` are absent here: they change the tooth ITSELF above — the
        * socket empties, the crown swaps the artwork — which is the strongest signal available
        * and the one the eye reads without being taught.
        */}
      {/*
        * WORK DONE, drawn OUTSIDE the mirrored wrapper above.
        *
        * That placement is the whole trick. Everything inside that div inherits `scale(±1, ±1)` —
        * quadrant 2 is mirrored, quadrant 3 is upside-down, quadrant 4 is flipped. A mark in there
        * would be right on eight teeth and wrong on twenty-four, and nobody would notice until a
        * dentist asked why the left of the mouth looked unlike the right. The amber notes dot has
        * always been a sibling for exactly this reason; these follow it.
        *
        * `crowned` is absent here: it changes the tooth ITSELF above, by swapping the artwork,
        * which is a stronger signal than anything drawn on top and needs no key to read.
        */}
      {treatment && !gone && treatment !== "crowned" && treatment !== "treated" && (
        <ToothTreatmentMark treatment={treatment} isUpper={isUpper} />
      )}

      {/* What is marked ON the tooth, whatever its form became. A crowned tooth still shows the
          root canal underneath it. */}
      {treatmentMark && !gone && treatmentMark !== "treated" && (
        <ToothTreatmentMark treatment={treatmentMark} isUpper={isUpper} />
      )}

      {(treatment === "treated" || treatmentMark === "treated") && !gone && (
        /* Work this chart cannot classify further. A quiet pip in a corner none of the other marks
           use, saying "there is a note about this tooth" — honest about being unspecific rather
           than guessing at a treatment and drawing the wrong one. */
        <div
          className="absolute -bottom-1 -left-1 w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm z-20 pointer-events-none"
          style={{ background: TREATMENT_STATES.treated.color }}
          aria-hidden
        />
      )}

      {/*
        * Booked, not done. A hollow ring in a corner the finished marks never use, because the
        * single most dangerous thing this chart could do is let planned work read as completed —
        * a dentist seeing a treated tooth that is still carious.
        */}
      {hasPendingTreatment && !gone && (
        <div
          className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border-2 bg-surface shadow-sm z-20 pointer-events-none"
          style={{ borderColor: "#64748b" }}
          aria-hidden
        />
      )}

      {hasNotes && (
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-500 border-2 border-white shadow-sm z-20" />
      )}
    </div>
  );
}
