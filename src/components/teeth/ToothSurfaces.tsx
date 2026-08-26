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
    // Swallow the click only when something is actually listening for it. Stopping propagation
    // first meant this layer ate clicks nobody wanted it to have: no caller has ever passed
    // `onSurfaceClick`, so every click landing here was cancelled on its way to the tooth.
    if (!onSurfaceClick) return;
    e.stopPropagation();
    onSurfaceClick(surface);
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
    <svg
      viewBox="0 0 100 100"
      className={`absolute inset-0 w-full h-full z-20 overflow-visible opacity-80 ${onSurfaceClick ? "" : "pointer-events-none"}`}
      style={{ mixBlendMode: 'multiply' }}
    >
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
       {/*
         * The buccal overlay, drawn only when the buccal surface actually carries a diagnosis.
         *
         * It used to render on every tooth, always, with `fill="transparent"` — and `transparent`
         * is a paint, not `none`, so the browser still hit-tests it. Together with the click being
         * swallowed above, that put a dead patch across the widest part of every tooth: about
         * 25 x 10 CSS px of the incisal third, where a click selected nothing and the cursor
         * turned into a pointer to promise otherwise. Harmless while the chart was only a picture;
         * not harmless now that the chart in the editor is how a tooth gets chosen.
         */}
       {activeSurfaces.includes("B") && surfaceColors["B"] && (
         <path
            d={isUpper ? "M 20 50 C 20 80, 80 80, 80 50 Z" : "M 20 50 C 20 20, 80 20, 80 50 Z"}
            fill={getFill("B")}
            opacity={getOpacity("B")}
            className={`transition-colors duration-300 ${onSurfaceClick ? "cursor-pointer hover:opacity-50" : ""}`}
            onClick={(e) => handleSurfaceClick(e, "B")}
          />
       )}
    </svg>
  );
}
