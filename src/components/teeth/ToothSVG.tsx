"use client";

import {
  getPrimaryCategoryForStatuses,
  isMissingStatus,
} from "@/lib/diagnosisCatalog";

export type ToothType = "incisor" | "canine" | "premolar" | "molar";

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

export const TOOTH_BODY = "#ffffff";
export const TOOTH_STROKE = "#94a3b8";

// All paths are drawn for a tooth in Quadrant 1 (e.g., tooth 14).
// Buccal is UP (y=0), Lingual is DOWN (y=100)
// Mesial is RIGHT (x=100), Distal is LEFT (x=0)

export type ShapeBundle = {
  paths: { id: string; d: string }[];
};

export function occlusalShapeFor(type: ToothType): ShapeBundle {
  switch (type) {
    case "incisor":
      return {
        paths: [
          // A curved crescent representing the incisal edge and lingual cingulum
          { id: "full", d: "M 10 40 C 30 10, 70 10, 90 40 C 70 60, 30 60, 10 40 Z" }
        ]
      };
    case "canine":
      return {
        paths: [
          // A pointed diamond/crescent
          { id: "full", d: "M 15 45 C 30 15, 70 15, 85 45 C 70 75, 30 75, 15 45 Z" }
        ]
      };
    case "premolar":
      return {
        paths: [
          // An oval with a central groove
          { id: "buccal", d: "M 15 50 C 15 15, 85 15, 85 50 C 70 55, 30 55, 15 50 Z" },
          { id: "lingual", d: "M 15 50 C 30 45, 70 45, 85 50 C 85 85, 15 85, 15 50 Z" }
        ]
      };
    case "molar":
    default:
      return {
        paths: [
          // 5-surface representation (O, B, L, M, D)
          { id: "occlusal", d: "M 30 30 L 70 30 L 70 70 L 30 70 Z" },
          { id: "buccal", d: "M 10 10 C 30 0, 70 0, 90 10 L 70 30 L 30 30 Z" },
          { id: "lingual", d: "M 30 70 L 70 70 L 90 90 C 70 100, 30 100, 10 90 Z" },
          { id: "distal", d: "M 10 10 L 30 30 L 30 70 L 10 90 C 0 70, 0 30, 10 10 Z" },
          { id: "mesial", d: "M 90 10 C 100 30, 100 70, 90 90 L 70 70 L 70 30 Z" }
        ]
      };
  }
}

interface ToothSVGProps {
  fdi: number;
  type: ToothType;
  isUpper: boolean;
  statuses: string[];
  isActive?: boolean;
  isHover?: boolean;
  hasNotes?: boolean;
  size?: number;
  ariaLabel?: string;
}

export default function ToothSVG({
  fdi,
  type,
  isUpper,
  statuses,
  isActive = false,
  isHover = false,
  hasNotes = false,
  size,
  ariaLabel,
}: ToothSVGProps) {
  const { paths } = occlusalShapeFor(type);
  const missing = isMissingStatus(statuses);
  const primaryCat = getPrimaryCategoryForStatuses(statuses);
  
  const accent = primaryCat?.color ?? TOOTH_STROKE;
  const fillAccent = primaryCat ? `${primaryCat.color}40` : TOOTH_BODY;
  
  const baseStroke = isActive ? "#3b82f6" : isHover ? "#64748b" : accent;
  const strokeWidth = isActive ? 3 : 2;

  // Mirroring logic
  const q = Math.floor(fdi / 10);
  const scaleX = (q === 2 || q === 3 || q === 6 || q === 7) ? -1 : 1;
  const scaleY = (q === 3 || q === 4 || q === 7 || q === 8) ? -1 : 1;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      className="drop-shadow-sm transition-all"
      style={{ overflow: "visible" }}
    >
      <g transform={`translate(50, 50) scale(${scaleX}, ${scaleY}) translate(-50, -50)`}>
        {missing ? (
          <>
            {paths.map((p) => (
               <path key={p.id} d={p.d} fill="transparent" stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4 4" />
            ))}
            <line x1="10" y1="10" x2="90" y2="90" stroke="#94a3b8" strokeWidth={3} />
            <line x1="90" y1="10" x2="10" y2="90" stroke="#94a3b8" strokeWidth={3} />
          </>
        ) : (
          paths.map((p) => (
            <path
              key={p.id}
              d={p.d}
              fill={primaryCat ? fillAccent : TOOTH_BODY}
              stroke={baseStroke}
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
              className="transition-colors duration-200"
            />
          ))
        )}
      </g>
      {hasNotes && (
        <circle cx="85" cy="15" r="6" fill="#f59e0b" stroke="#ffffff" strokeWidth={1.5} />
      )}
    </svg>
  );
}
