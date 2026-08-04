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
      // Logout is a client-side navigation, so this module is never reloaded — the tenant
      // pointer in db-utils survives into the next user's session unless we clear it here.
      // Without this, the next login reads from the previous user's clinic until this effect
      // re-runs and re-points it. Nulling it makes getClinicCollection() throw loudly instead
      // of silently building a path into someone else's tenant.
      setGlobalClinicId(null);
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("superAdminClinicId");
        sessionStorage.removeItem("preferredClinicId");
      }
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
        // A clinic entered on the login form wins over the stored default, but only if the user
        // genuinely holds a role in it — the login page already checked this, and re-checking here
        // means a hand-edited sessionStorage value falls back to the default instead of parking
        // clinicId on a clinic whose reads will just be denied.
        const requested = typeof window !== "undefined" ? sessionStorage.getItem("preferredClinicId") : null;
        targetClinicId = (requested && userClinics.includes(requested))
          ? requested
          : (user.defaultClinicId || userClinics[0]);
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
    // Only switch into a clinic the user actually belongs to. Firestore rules would reject the
    // reads anyway, but without this the app lands in a broken half-state: clinicId points at a
    // clinic whose doc read is denied, so `clinic` stays null and downstream checks like
    // isReadOnly silently evaluate against nothing.
    const isMember = Boolean(user?.clinicRoles?.[id]);
    if (!user?.isSuperAdmin && !isMember) {
      console.warn(`Refused to switch to clinic "${id}": current user has no role in it.`);
      return;
    }
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
