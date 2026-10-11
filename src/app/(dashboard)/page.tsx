"use client";
import { useState, useEffect } from "react";
import DesktopDashboard from "@/components/dashboard/DesktopDashboard";
import MobileDashboard from "@/components/dashboard/MobileDashboard";
import DentistHome from "@/components/dashboard/DentistHome";
import OwnerHome from "@/components/dashboard/OwnerHome";
import HomeNoAccess from "@/components/dashboard/HomeNoAccess";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { useClinic } from "@/context/ClinicContext";
import { useHomeView } from "@/lib/useHomeView";

export default function Dashboard() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const { clinicId } = useClinic();
  // Owner, calendar or chair — and whether this person may open it (lib/homeView).
  const { view, allowed, ready } = useHomeView();
  const router = useRouter();

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Only the desk dashboard opens the booking popup from /?book=… (the patient file's Book
  // button). Every other home screen hands the same request to the appointments page.
  const deskView = isDesktop === true && view === "desk" && allowed;
  const handsBookingOn = isDesktop !== null && !!clinicId && ready && !deskView;
  useEffect(() => {
    if (!handsBookingOn) return;
    const search = window.location.search;
    if (new URLSearchParams(search).get("book")) router.replace(`/appointments${search}`);
  }, [handsBookingOn, router]);

  if (isDesktop === null || !clinicId || !ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-subtle">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  // Every user has the three tabs; one they may not open shows an empty page asking for the
  // owner's permission instead of the screen.
  if (!allowed) return <HomeNoAccess />;
  // A dentist's own screen: their chair, their patients, their money.
  if (view === "chair") return <DentistHome />;
  // The owner's view: the whole clinic at a glance (admins only — see lib/homeView).
  if (view === "owner") return <OwnerHome />;

  return isDesktop ? <DesktopDashboard /> : <MobileDashboard />;
}
