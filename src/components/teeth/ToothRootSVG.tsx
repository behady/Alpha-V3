import React from "react";
import { ToothType } from "./ToothSVG";

interface ToothRootSVGProps {
  type: ToothType;
  isUpper: boolean;
}

export function ToothRootSVG({ type, isUpper }: ToothRootSVGProps) {
  // A generic single root path (pointing UPwards). 
  // ViewBox is 0 0 100 100. The tooth crown would conceptually be at the bottom (y=100).
  const singleRoot = "M30,100 C30,60 40,10 50,10 C60,10 70,60 70,100 Z";
  
  // A generic multi-root (2 roots) path (pointing UPwards).
  const multiRoot = "M20,100 C20,60 30,10 40,10 C45,10 50,40 50,60 C50,40 55,10 60,10 C70,10 80,60 80,100 Z";

  const pathData = (type === "molar" || type === "premolar") ? multiRoot : singleRoot;

  return (
    <div 
      className="absolute left-0 right-0 z-0 pointer-events-none"
      style={{
        // Position the root above the tooth if upper, below if lower
        // Height is roughly 1.2x the crown height
        height: "120%",
        top: isUpper ? "-110%" : "auto",
        bottom: isUpper ? "auto" : "-110%",
        transform: isUpper ? "none" : "scaleY(-1)",
      }}
    >
      <svg 
        viewBox="0 0 100 100" 
        preserveAspectRatio="none" 
        className="w-full h-full opacity-30 drop-shadow-sm"
      >
        <path 
          d={pathData} 
          fill="#e2e8f0" 
          stroke="#cbd5e1" 
          strokeWidth="2" 
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
