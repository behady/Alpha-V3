"use client";

import Image from "next/image";
import {
  getPrimaryCategoryForStatuses,
  isMissingStatus,
} from "@/lib/diagnosisCatalog";

import ToothSurfaces, { ToothSurface } from "./ToothSurfaces";

export type ToothType = "incisor" | "canine" | "premolar" | "molar";

const OCCLUSAL_IMAGES: Record<ToothType, string> = {
  incisor: "/teeth/occlusal_incisor.png",
  canine: "/teeth/realistic_canine.png",
  premolar: "/teeth/realistic_premolar.png",
  molar: "/teeth/realistic_molar.png",
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
  size?: number;
  viewType?: "buccal" | "occlusal";
  ariaLabel?: string;
  activeSurfaces?: ToothSurface[];
  surfaceColors?: Record<string, string>;
  onSurfaceClick?: (surface: ToothSurface) => void;
}

export default function ToothSVG({
  fdi,
  type,
  isUpper,
  statuses = [],
  isActive = false,
  isHover = false,
  hasNotes = false,
  size = 50,
  viewType = "buccal",
  ariaLabel,
  activeSurfaces = [],
  surfaceColors = {},
  onSurfaceClick,
}: ToothSVGProps) {
  const missing = isMissingStatus(statuses);
  const primaryCat = getPrimaryCategoryForStatuses(statuses);
  
  // Base transforms for realistic mirroring
  const q = Math.floor(fdi / 10);
  const scaleX = (q === 2 || q === 3 || q === 6 || q === 7) ? -1 : 1;
  const scaleY = (q === 3 || q === 4 || q === 7 || q === 8) ? -1 : 1;

  // CSS Drop Shadow based on Clinical Status
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

  // Check if tooth has a crown restoration
  const hasCrown = statuses.includes("rest_crown");
  
  const isOcclusal = viewType === "occlusal";
  
  let baseSrc = `/teeth/${type}.png`;
  if (isOcclusal) {
    baseSrc = OCCLUSAL_IMAGES[type];
  } else if (hasCrown) {
    baseSrc = `/teeth/crown_${type}.png`;
  }
  
  const imageSrc = `${baseSrc}?v=1`; // Cache buster

  // The CSS hacks are only needed if we are faking the occlusal view using the buccal image
  const isFakedOcclusal = isOcclusal && type !== "incisor"; 

  return (
    <div 
      className="relative w-full h-full transition-all duration-300 flex items-center justify-center group"
      title={ariaLabel}
    >
      <div 
        className={`absolute inset-0 transition-transform duration-300 ${isFakedOcclusal ? "scale-[0.6] opacity-80" : ""}`}
        style={{
           transform: isOcclusal ? undefined : `scale(${scaleX}, ${scaleY})`,
           filter: filterStyle,
           opacity: missing ? 0.15 : (isFakedOcclusal ? 0.6 : 1),
           borderRadius: isFakedOcclusal ? "50%" : undefined,
           overflow: isFakedOcclusal ? "hidden" : "visible",
           boxShadow: isFakedOcclusal && !missing ? "inset 0 0 10px rgba(0,0,0,0.1)" : undefined
        }}
      >
        <Image 
          src={imageSrc}
          alt={hasCrown ? `${type} crown` : type}
          fill
          className={`object-contain ${isFakedOcclusal ? "scale-150" : ""}`}
          unoptimized
        />
        
        {/* The interactive surface overlay layer */}
        {!missing && (
          <ToothSurfaces 
            activeSurfaces={activeSurfaces}
            surfaceColors={surfaceColors}
            onSurfaceClick={onSurfaceClick}
            viewType={viewType}
            isUpper={isUpper}
          />
        )}
      </div>

      {missing && (
         <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="w-[80%] h-0.5 bg-red-400 rotate-45 rounded-full shadow-sm" />
         </div>
      )}

      {hasNotes && (
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-500 border-2 border-white shadow-sm z-20" />
      )}
    </div>
  );
}
