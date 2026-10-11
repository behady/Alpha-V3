"use client";

import { useAuth } from "@/context/AuthContext";
import { useClinic } from "@/context/ClinicContext";
import { useUI } from "@/context/UIContext";
import { effectiveHomeView, homeViewAccess, type HomeView } from "@/lib/homeView";
import { useAlsoDentistState } from "@/lib/useAlsoDentist";

/**
 * The home screen this person is on, whether they may open it, and the switch between the three.
 * `ready` is false until it is known whether an admin also treats — deciding the chair before
 * that would flash the "ask the owner" page at a dentist-owner on every load.
 */
export function useHomeView(): {
  view: HomeView;
  setView: (view: HomeView) => void;
  access: Record<HomeView, boolean>;
  allowed: boolean;
  ready: boolean;
} {
  const { user } = useAuth();
  const { role, isAdmin } = useClinic();
  const { homeView, homeViewChosen, setHomeView } = useUI();
  const { alsoDentist, ready } = useAlsoDentistState();
  const view = effectiveHomeView(homeView, homeViewChosen, role);
  const access = homeViewAccess({ isAdmin, role, permissions: user?.permissions, alsoDentist });
  return { view, setView: setHomeView, access, allowed: access[view], ready };
}
