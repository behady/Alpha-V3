import React from 'react';

export type ToothSurface = "M" | "O" | "D" | "B" | "L";

interface ToothSurfacesProps {
  activeSurfaces?: ToothSurface[];
  surfaceColors?: Record<string, string>; // Map of surface to color (e.g. { O: "#ef4444" })
  onSurfaceClick?: (surface: ToothSurface) => void;
  viewType?: "buccal" | "occlusal";
  isUpper?: boolean;
}

export default function ToothSurfaces({
  activeSurfaces = [],
  surfaceColors = {},
  onSurfaceClick,
  viewType = "buccal",
  isUpper = true
}: ToothSurfacesProps) {
  
  const handleSurfaceClick = (e: React.MouseEvent, surface: ToothSurface) => {
    e.stopPropagation();
    if (onSurfaceClick) onSurfaceClick(surface);
  };

  const getFill = (s: ToothSurface) => {
    if (activeSurfaces.includes(s) && surfaceColors[s]) {
      return surfaceColors[s];
    }
    return "transparent";
  };

  const getOpacity = (s: ToothSurface) => {
    return activeSurfaces.includes(s) ? 0.7 : 0;
  };

  if (viewType === "occlusal") {
    // Top-down view MODBL polygons
    // We use a 100x100 viewBox
    return (
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full z-20 overflow-visible opacity-80" style={{ mixBlendMode: 'multiply' }}>
        {/* Buccal (Top/Outer) */}
        <path 
          d="M 10 10 L 90 10 L 70 30 L 30 30 Z" 
          fill={getFill("B")} 
          opacity={getOpacity("B")}
          className="transition-colors duration-300 cursor-pointer hover:opacity-50"
          onClick={(e) => handleSurfaceClick(e, "B")}
        />
        {/* Lingual (Bottom/Inner) */}
        <path 
          d="M 10 90 L 90 90 L 70 70 L 30 70 Z" 
          fill={getFill("L")} 
          opacity={getOpacity("L")}
          className="transition-colors duration-300 cursor-pointer hover:opacity-50"
          onClick={(e) => handleSurfaceClick(e, "L")}
        />
        {/* Mesial (Left/Front) */}
        <path 
          d="M 10 10 L 30 30 L 30 70 L 10 90 Z" 
          fill={getFill("M")} 
          opacity={getOpacity("M")}
          className="transition-colors duration-300 cursor-pointer hover:opacity-50"
          onClick={(e) => handleSurfaceClick(e, "M")}
        />
        {/* Distal (Right/Back) */}
        <path 
          d="M 90 10 L 70 30 L 70 70 L 90 90 Z" 
          fill={getFill("D")} 
          opacity={getOpacity("D")}
          className="transition-colors duration-300 cursor-pointer hover:opacity-50"
          onClick={(e) => handleSurfaceClick(e, "D")}
        />
        {/* Occlusal (Center) */}
        <path 
          d="M 30 30 L 70 30 L 70 70 L 30 70 Z" 
          fill={getFill("O")} 
          opacity={getOpacity("O")}
          className="transition-colors duration-300 cursor-pointer hover:opacity-50"
          onClick={(e) => handleSurfaceClick(e, "O")}
        />
      </svg>
    );
  }

  // Buccal view (side profile)
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full z-20 overflow-visible opacity-80" style={{ mixBlendMode: 'multiply' }}>
       {/* Root Canal Path (simulated as O surface for now if they click it) */}
       {activeSurfaces.includes("O") && surfaceColors["O"] && (
         <path 
           d={isUpper ? "M 50 50 L 50 10" : "M 50 50 L 50 90"}
           stroke={surfaceColors["O"]} 
           strokeWidth="8"
           strokeLinecap="round"
           fill="none"
           className="transition-all duration-300"
         />
       )}
       {/* Full Buccal Overlay mask (if B is selected) */}
       <path 
          d={isUpper ? "M 20 50 C 20 80, 80 80, 80 50 Z" : "M 20 50 C 20 20, 80 20, 80 50 Z"} 
          fill={getFill("B")} 
          opacity={getOpacity("B")}
          className="transition-colors duration-300 cursor-pointer hover:opacity-50"
          onClick={(e) => handleSurfaceClick(e, "B")}
        />
    </svg>
  );
}
