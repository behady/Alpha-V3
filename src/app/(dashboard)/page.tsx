"use client";
import { useState, useEffect } from "react";
import DesktopDashboard from "@/components/dashboard/DesktopDashboard";
import MobileDashboard from "@/components/dashboard/MobileDashboard";
import { Loader2 } from "lucide-react";

import { useClinic } from "@/context/ClinicContext";

export default function Dashboard() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const { clinicId } = useClinic();

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  if (isDesktop === null || !clinicId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-subtle">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return isDesktop ? <DesktopDashboard /> : <MobileDashboard />;
}
