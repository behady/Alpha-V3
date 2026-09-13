"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Clinic, UserProfile } from "@/types/saas";
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

/**
 * Which clinic this session points at, decided from what is already in hand — no reads, no state.
 *
 * It is a function of its own because the answer is needed twice: once during render, to point
 * db-utils at the tenant, and once in the effect below, to subscribe to the clinic document.
 *
 * The render-time call is the important one. React runs a child's effects BEFORE its parent's,
 * so on the first render after sign-in every page that builds a Firestore path on mount —
 * `getClinicCollection("attendance")` in the clock widget, and ninety-odd other call sites — ran
 * while the tenant pointer was still null and threw "No clinic selected globally". With no error
 * boundary below the root, that throw blanked the whole app: the "Something went wrong" screen
 * people hit right after logging in, and at random on /leads, /attendance, /chats and /settings.
 * Resolving here means the pointer is set before any child effect can ask for it.
 */
function resolveClinicId(user: UserProfile | null, current: string | null): string | null {
  if (!user) return null;
  if (current) return current;

  const session = (key: string): string | null => {
    if (typeof window === "undefined") return null;
    try { return sessionStorage.getItem(key); } catch { return null; }
  };

  if (user.isSuperAdmin) {
    // An impersonation link wins, then whatever this tab was already looking at.
    const fromUrl = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("clinic")
      : null;
    return fromUrl || session("superAdminClinicId");
  }

  const userClinics = Object.keys(user.clinicRoles || {});
  if (userClinics.length === 0) return null;

  // A clinic entered on the login form wins over the stored default, but only if the user
  // genuinely holds a role in it — the login page already checked this, and re-checking here
  // means a hand-edited sessionStorage value falls back to the default instead of parking
  // clinicId on a clinic whose reads will just be denied.
  const requested = session("preferredClinicId");
  return (requested && userClinics.includes(requested))
    ? requested
    : (user.defaultClinicId || userClinics[0]);
}

export function ClinicProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [clinicId, setClinicIdState] = useState<string | null>(null);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  // Point db-utils at the tenant now, in render, so it is already right when the children
  // mounted below run their effects. Browser only: on the server this module-level pointer is
  // shared by every request being rendered at once, and one clinic's id must never leak into
  // another's render. The effect below is what sets it there (it does not run on the server).
  const resolvedClinicId = resolveClinicId(user, clinicId);
  if (typeof window !== "undefined" && !authLoading) {
    setGlobalClinicId(resolvedClinicId);
  }

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

    // Determine which clinic to load — the same decision render just made.
    const userClinics = Object.keys(user.clinicRoles || {});
    const targetClinicId = resolveClinicId(user, clinicId);

    if (user.isSuperAdmin) {
      // An impersonation that arrived in the URL is remembered for the rest of this tab.
      if (typeof window !== "undefined") {
        const queryClinicId = new URLSearchParams(window.location.search).get("clinic");
        if (queryClinicId) sessionStorage.setItem("superAdminClinicId", queryClinicId);
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

      if (!targetClinicId) {
        setLoading(false);
        return;
      }
      setClinicIdState(targetClinicId);
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
      {/* Signed in but not yet standing in a clinic: hold the page. Two cases. The clinic is
          known and its document is still on its way (`loading`); or there is no clinic to
          stand in — a superadmin in a fresh tab, a new account with no clinic yet — and the
          effect above is redirecting to /superadmin or /onboarding. Those two routes render
          without a clinic on purpose and are let through. Everything else is a dashboard page
          that builds Firestore paths on mount, and letting it mount for even one frame before
          the redirect lands throws "No clinic selected globally". The old gate dropped on
          `loading` alone, which the redirect branches cleared first. */}
      {user && pathname !== '/onboarding' && pathname !== '/superadmin' && (loading || !resolvedClinicId) ? (
        <div className="flex h-screen w-screen items-center justify-center">Loading Clinic...</div>
      ) : (
        children
      )}
    </ClinicContext.Provider>
  );
}

export const useClinic = () => {
  const context = useContext(ClinicContext);
  if (!context) throw new Error("useClinic must be used within ClinicProvider");
  return context;
};
