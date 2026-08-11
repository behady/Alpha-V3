import React, { useEffect, useState, useRef } from "react";
import { ToothData } from "@/lib/diagnosisCatalog";

interface PerioOverlayProps {
  arch: number[]; // e.g. Q1 + Q2
  data: Record<string, ToothData>;
  isUpper: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export default function PerioOverlay({ arch, data, isUpper, containerRef }: PerioOverlayProps) {
  const [points, setPoints] = useState<{ pd: { x: number; y: number }[]; gm: { x: number; y: number }[] }>({ pd: [], gm: [] });
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const updatePoints = () => {
      if (!containerRef.current || !svgRef.current) return;
      const containerRect = svgRef.current.getBoundingClientRect();
      const pdPoints: { x: number; y: number }[] = [];
      const gmPoints: { x: number; y: number }[] = [];

      arch.forEach((toothId) => {
        const toothEl = containerRef.current?.querySelector(`[data-tooth="${toothId}"]`);
        if (!toothEl) return;
        const rect = toothEl.getBoundingClientRect();
        
        // Calculate X coordinate (center of the tooth)
        const cx = rect.left - containerRect.left + rect.width / 2;
        
        // Calculate Y coordinates based on perio data
        const toothData = data[String(toothId)]?.perio?.buccal;
        
        // A generic mapping: 1mm = 3px. If upper, root goes UP (negative Y relative to crown).
        // If lower, root goes DOWN (positive Y).
        // For simplicity, we just use the mid value of the [Distal, Mid, Mesial] array.
        const pdMid = toothData?.pd[1] || 0;
        const gmMid = toothData?.gm[1] || 0;

        // Base Y is the middle of the SVG height
        const baseY = containerRect.height / 2;
        
        // Direction multiplier
        const dir = isUpper ? -1 : 1;
        
        pdPoints.push({ x: cx, y: baseY + (pdMid * 3 * dir) });
        gmPoints.push({ x: cx, y: baseY + (gmMid * 3 * dir) });
      });

      setPoints({ pd: pdPoints, gm: gmPoints });
    };

    updatePoints();
    
    // Listen to resize
    window.addEventListener("resize", updatePoints);
    return () => window.removeEventListener("resize", updatePoints);
  }, [arch, data, isUpper, containerRef]);

  // Generate SVG path string from points
  const generateSpline = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return "";
    const path = [`M ${pts[0].x},${pts[0].y}`];
    for (let i = 1; i < pts.length; i++) {
      // Simple bezier curve for smooth spline
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const cx = (p0.x + p1.x) / 2;
      path.push(`C ${cx},${p0.y} ${cx},${p1.y} ${p1.x},${p1.y}`);
    }
    return path.join(" ");
  };

  return (
    <svg 
      ref={svgRef}
      className="absolute inset-0 w-full h-full pointer-events-none z-20"
    >
      <path
        d={generateSpline(points.gm)}
        fill="none"
        stroke="#3b82f6" // blue-500
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={generateSpline(points.pd)}
        fill="none"
        stroke="#ef4444" // red-500
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
