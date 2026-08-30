"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Clinic } from "@/types/saas";
import { useRouter, usePathname } from "next/navigation";
import { setGlobalClinicId } from "@/lib/db-utils";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { clinicActivity } from "@/lib/clinicStatus";
import { isFullAccessRole, isOwnerRole, type Role } from "@/lib/permissions";

interface ClinicContextType {
  clinicId: string | null;
  clinic: Clinic | null;
  role: Role | null;
  /**
   * Full access: Owner or Admin. The name stays because every screen already reads it, and the
   * answer is the same for both — Owner is a protected identity, not extra buttons.
   */
  isAdmin: boolean;
  /** The one person the clinic belongs to. Only they can hand it over. */
  isOwner: boolean;
  isReadOnly: boolean;
  /** Why, when isReadOnly — 'expired' or 'suspended'. Null when the clinic is active. */
  readOnlyReason: 'expired' | 'suspended' | null;
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
    // Persist the choice. This context already READS preferredClinicId when picking a
    // clinic and already clears it on sign-out, but nothing ever wrote it -- so switching
    // clinic and reloading silently dropped you back into defaultClinicId. It is also what
    // lets the theme boot script paint the right clinic on the next load.
    try { sessionStorage.setItem("preferredClinicId", id); } catch { /* private mode */ }
    setClinicIdState(id);
  };

  const role = user?.isSuperAdmin ? 'Admin' : ((user && clinicId && user.clinicRoles) ? user.clinicRoles[clinicId] : null);
  const isAdmin = user?.isSuperAdmin ? true : isFullAccessRole(role);
  // Never true for a superadmin looking into a clinic: they administer it, they do not own it,
  // and handing it to somebody else is not theirs to do from the inside.
  const isOwner = !user?.isSuperAdmin && isOwnerRole(role);

  // The same decision the API routes and firestore.rules make, from the same module, so the banner
  // cannot say one thing while a write says another. The hand-rolled version this replaces parsed
  // `expiresAt` with `new Date(...)`, which accepts strings that the rules cannot read as
  // timestamps — so a clinic with a stringly-typed expiry showed the red read-only banner while
  // every write it attempted went through, which reads as the app being broken rather than as the
  // subscription being over.
  const activity = clinicActivity(clinic as unknown as Record<string, unknown> | null);
  const isReadOnly = !activity.active;
  const readOnlyReason = activity.active ? null : activity.reason;

  return (
    <ClinicContext.Provider value={{ clinicId, clinic, role, isAdmin, isOwner, isReadOnly, readOnlyReason, setClinicId }}>
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
