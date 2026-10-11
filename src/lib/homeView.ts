/**
 * The three home screens — the owner's view, the calendar (the reception desk) and the dentist's
 * chair — and who may open each.
 *
 * Every user gets all three tabs (the owner's decision, 2026-10-11). A tab they cannot open still
 * shows, and opens onto an empty page saying they need the owner's permission, so nobody wonders
 * whether the screen exists. Pure, so the page, the band and the tests ask the same question.
 */
import { holdsPermission } from "@/lib/permissions";

export type HomeView = "desk" | "chair" | "owner";

/**
 * The screen to open: the stored one. Except for a Dentist who has not picked one on the tabs yet
 * — the old screens always gave them the chair, so whatever `homeView` happened to hold for them
 * (often "desk", written by a tour) was never their choice, and the chair is what they expect.
 */
export function effectiveHomeView(stored: HomeView, picked: boolean, role?: string | null): HomeView {
  if (role === "Dentist" && !picked) return "chair";
  return stored;
}

export type HomeViewAccessInput = {
  isAdmin: boolean;
  role?: string | null;
  permissions?: string[] | null;
  /** An admin whose team row says they also treat patients. */
  alsoDentist: boolean;
};

/**
 * Who may open what:
 * - the owner's view: admins (its brief is the clinic's money and payroll);
 * - the calendar: whoever holds the appointments permission (admins always do);
 * - the chair: a dentist — the Dentist role, or an admin who also treats. It is their own
 *   patients and their own money, so there is nothing to show anyone else.
 */
export function homeViewAccess(i: HomeViewAccessInput): Record<HomeView, boolean> {
  return {
    owner: i.isAdmin,
    desk: i.isAdmin || holdsPermission(i.role, i.permissions, "access.appointments"),
    chair: i.role === "Dentist" || (i.isAdmin && i.alsoDentist),
  };
}
