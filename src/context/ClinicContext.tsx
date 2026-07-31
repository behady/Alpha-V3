"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Clinic } from "@/types/saas";
import { useRouter, usePathname } from "next/navigation";
import { setGlobalClinicId } from "@/lib/db-utils";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";

interface ClinicContextType {
  clinicId: string | null;
  clinic: Clinic | null;
  role: 'Admin' | 'Dentist' | 'Assistant' | 'Receptionist' | null;
  isAdmin: boolean;
  isReadOnly: boolean;
  setClinicId: (id: string) => void;
}

const ClinicContext = createContext<ClinicContextType | undefined>(undefined);

export function ClinicProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [clinicId, setClinicIdState] = useState<string | null>(null);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setClinicIdState(null);
      setClinic(null);
      setLoading(false);
      return;
    }

    // Determine which clinic to load
    const userClinics = Object.keys(user.clinicRoles || {});
    let targetClinicId = clinicId;

    if (user.isSuperAdmin) {
      // 1. Check URL for impersonation param (e.g. opened in new tab from superadmin)
      if (typeof window !== "undefined") {
        const urlParams = new URLSearchParams(window.location.search);
        const queryClinicId = urlParams.get("clinic");
        
        if (queryClinicId) {
          targetClinicId = queryClinicId;
          sessionStorage.setItem("superAdminClinicId", queryClinicId);
        } else {
          // 2. Check session storage for existing impersonation in this tab
          const storedClinicId = sessionStorage.getItem("superAdminClinicId");
          if (storedClinicId) {
            targetClinicId = storedClinicId;
          }
        }
      }

      if (targetClinicId) {
        setClinicIdState(targetClinicId);
        setGlobalClinicId(targetClinicId);
      } else {
        // Not impersonating any clinic. MUST be on superadmin dashboard.
        setClinicIdState(null);
        setClinic(null);
        if (pathname !== "/superadmin") {
          router.push("/superadmin");
        }
        setLoading(false);
        return;
      }
    } else {
      // Normal user logic
      if (userClinics.length === 0) {
        if (pathname !== "/onboarding") {
          router.push("/onboarding");
        }
        setLoading(false);
        return;
      }

      if (!targetClinicId && userClinics.length > 0) {
        targetClinicId = user.defaultClinicId || userClinics[0];
        setClinicIdState(targetClinicId);
      }

      if (!targetClinicId) {
        setLoading(false);
        return;
      }
      setGlobalClinicId(targetClinicId);
    }

    // Subscribe to the clinic document
    const unsubscribe = onSnapshot(getClinicDoc("clinics", targetClinicId), (docSnap) => {
      if (docSnap.exists()) {
        setClinic({ id: docSnap.id, ...docSnap.data() } as Clinic);
      } else {
        setClinic(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user, authLoading, clinicId, pathname, router]);

  const setClinicId = (id: string) => {
    setClinicIdState(id);
  };

  const role = user?.isSuperAdmin ? 'Admin' : ((user && clinicId && user.clinicRoles) ? user.clinicRoles[clinicId] : null);
  const isAdmin = user?.isSuperAdmin ? true : role === 'Admin';

  const isReadOnly = clinic ? (clinic.status !== 'Active' || (clinic.expiresAt && (clinic.expiresAt.toDate ? clinic.expiresAt.toDate() : new Date(clinic.expiresAt)) < new Date())) : false;

  return (
    <ClinicContext.Provider value={{ clinicId, clinic, role, isAdmin, isReadOnly, setClinicId }}>
      {/* We don't block render entirely here so that onboarding/login can still render, 
          but you might want to show a spinner if loading && user exists */}
      {loading && user && pathname !== '/onboarding' && pathname !== '/superadmin' && (user.isSuperAdmin || userClinicsLength(user) > 0) ? (
        <div className="flex h-screen w-screen items-center justify-center">Loading Clinic...</div>
      ) : (
        children
      )}
    </ClinicContext.Provider>
  );
}

function userClinicsLength(user: any) {
  return Object.keys(user.clinicRoles || {}).length;
}

export const useClinic = () => {
  const context = useContext(ClinicContext);
  if (!context) throw new Error("useClinic must be used within ClinicProvider");
  return context;
};
