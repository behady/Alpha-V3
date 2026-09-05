"use client";
import { useState, useEffect } from "react";
import DesktopDashboard from "@/components/dashboard/DesktopDashboard";
import MobileDashboard from "@/components/dashboard/MobileDashboard";
import DentistHome from "@/components/dashboard/DentistHome";
import { Loader2 } from "lucide-react";

import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";

export default function Dashboard() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const { clinicId, role } = useClinic();
  const { homeView } = useUI();

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

  // A dentist's home is the chair, not the desk. The Dentist role always gets it; an admin who
  // also treats picks desk or chair under Settings → Interface (only offered to them). Admins
  // who never treat keep the desk, and get their own screen later.
  if (role === "Dentist" || homeView === "chair") return <DentistHome />;

  return isDesktop ? <DesktopDashboard /> : <MobileDashboard />;
}
