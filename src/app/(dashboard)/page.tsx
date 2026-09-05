"use client";
import { useState, useEffect } from "react";
import DesktopDashboard from "@/components/dashboard/DesktopDashboard";
import MobileDashboard from "@/components/dashboard/MobileDashboard";
import DentistHome from "@/components/dashboard/DentistHome";
import { Loader2 } from "lucide-react";

import { useClinic } from "@/context/ClinicContext";

export default function Dashboard() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const { clinicId, role } = useClinic();

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

  // A dentist's home is the chair, not the desk. Only the Dentist role: an owner who also
  // treats still runs the clinic from the desk view, and admins get their own screen later.
  if (role === "Dentist") return <DentistHome />;

  return isDesktop ? <DesktopDashboard /> : <MobileDashboard />;
}
