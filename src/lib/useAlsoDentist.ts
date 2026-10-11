"use client";

import { useClinic } from "@/context/ClinicContext";
import { isDentistStaff } from "@/lib/staffRoles";
import { useOwnStaffRow } from "@/lib/useOwnStaffRow";

/**
 * Is the signed-in admin also one of the clinic's dentists?
 *
 * Read off their staff row — the "also works as dentist" tick on the team list — and never off
 * the user record, which was never given that flag for invited staff. In a solo practice the
 * person who runs the clinic is usually the one holding the handpiece, so this is common.
 *
 * Only admins are asked about: a plain dentist always gets the chair and is never offered a
 * choice, so the query is skipped for them and this returns false. Callers that need "can see
 * the chair at all" should check `role === "Dentist"` alongside this.
 */
export function useAlsoDentist(): boolean {
  return useAlsoDentistState().alsoDentist;
}

/** The same, plus whether the answer is in yet: always for a non-admin, after the first read for an admin. */
export function useAlsoDentistState(): { alsoDentist: boolean; ready: boolean } {
  const { isAdmin } = useClinic();
  // The query is skipped for a non-admin: a plain dentist always gets the chair.
  const { row, ready } = useOwnStaffRow(isAdmin);
  return { alsoDentist: isAdmin && !!row && isDentistStaff(row), ready };
}
