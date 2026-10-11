"use client";

/**
 * The calendar, for whoever's home screen is something else.
 *
 * This used to be a page of its own with a second copy of the schedule. Since 2026-10-11 the desk
 * dashboard's calendar is the only one: reception has it at "/", and this address shows the same
 * screen to a dentist on their chair view or an owner on theirs, and keeps every old link working
 * (?book=… from Leads and the patient file among them).
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import DesktopDashboard from "@/components/dashboard/DesktopDashboard";
import MobileDashboard from "@/components/dashboard/MobileDashboard";
import PermissionGuard from "@/components/PermissionGuard";
import { useClinic } from "@/context/ClinicContext";

export default function AppointmentsPage() {
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

  return (
    <PermissionGuard permission="access.appointments">
      {isDesktop ? <DesktopDashboard /> : <MobileDashboard />}
    </PermissionGuard>
  );
}
