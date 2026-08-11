"use client";

import Image from "next/image";
import {
  getPrimaryCategoryForStatuses,
  isMissingStatus,
} from "@/lib/diagnosisCatalog";

import ToothSurfaces, { ToothSurface } from "./ToothSurfaces";
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
  size?: number;
  viewType?: "buccal" | "occlusal";
  ariaLabel?: string;
  activeSurfaces?: ToothSurface[];
  surfaceColors?: Record<string, string>;
  onSurfaceClick?: (surface: ToothSurface) => void;
  showRoot?: boolean;
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
  showRoot = false,
}: ToothSVGProps) {
  const missing = isMissingStatus(statuses);
  const primaryCat = getPrimaryCategoryForStatuses(statuses);
  
  // Base transforms for realistic mirroring
  const q = Math.floor(fdi / 10);
  const scaleX = (q === 2 || q === 3 || q === 6 || q === 7) ? -1 : 1;
  const scaleY = (q === 3 || q === 4 || q === 7 || q === 8) ? -1 : 1;

  // CSS Drop Shadow based on Clinical Status
  // Check if tooth has a crown restoration
  const hasCrown = statuses.includes("rest_crown");
  
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
  } else if (hasCrown) {
    baseSrc = `/teeth/crown_${type}.png`;
  }
  
  const imageSrc = `${baseSrc}?v=1`; // Cache buster

  return (
    <div 
      className="relative w-full h-full transition-all duration-300 flex items-center justify-center group"
      title={ariaLabel}
    >
      {showRoot && !isOcclusal && !missing && (
        <ToothRootSVG type={type} isUpper={isUpper} />
      )}
      <div 
        className={`absolute inset-0 transition-transform duration-300`}
        style={{
           transform: isOcclusal ? undefined : `scale(${scaleX}, ${scaleY})`,
           filter: filterStyle,
           opacity: missing ? 0.15 : 1,
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
