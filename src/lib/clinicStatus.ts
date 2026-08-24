/**
 * Is this clinic still entitled to write?
 *
 * `firestore.rules` has answered this since before the money migration, in `isClinicActive()`,
 * and it answers it for every write the browser makes directly. It cannot answer it for a write
 * made by a server route: the Admin SDK bypasses rules entirely, by design. So when payments,
 * procedures and appointment deletes moved server-side to make the permission checkboxes real,
 * they also moved out from behind the expiry gate. An expired clinic could still take money —
 * not because anyone removed the lock, but because the traffic started using a different door.
 *
 * This is that same decision, expressed once, so the two doors cannot drift apart. The rules
 * version stays where it is (rules cannot import), but the logic below is a deliberate mirror of
 * it and `tests/clinicStatus.test.mjs` pins the cases where mirroring is easy to get wrong.
 *
 * The scope is writes only, matching the rules: `isClinicActive` is consulted from
 * `memberMayWrite`, not from any read grant. A clinic whose subscription lapses keeps full read
 * access to its own records. That is deliberate and not a leniency — the alternative is holding a
 * dentist's patient history hostage over an invoice, which is both wrong and, for medical records,
 * probably not ours to do.
 */

/** The wire code a route returns so the browser can tell this apart from a permission refusal. */
export const CLINIC_INACTIVE_CODE = "clinic_inactive";

export type ClinicInactiveReason = "suspended" | "expired";

export type ClinicActivity =
  | { active: true }
  | { active: false; reason: ClinicInactiveReason; message: string };

/**
 * Coerce whatever is in `expiresAt` to a Date, or null if it is not a real point in time.
 *
 * Firestore Timestamps (both SDKs) expose `toDate()`; a Date is already one; a number is millis.
 * Anything else — most likely an ISO string written by hand — returns null and therefore does not
 * expire the clinic.
 *
 * That last part looks like a hole and is a deliberate mirror of the rules, which guard with
 * `!(expires is timestamp) || expires > request.time` for the same reason: a clinic whose
 * `expiresAt` holds the wrong type would otherwise be frozen out of its own database by a typo.
 * A trial that overstays is a billing conversation. A clinic that cannot record today's payments
 * because a field is a string is an emergency. If the server were stricter than the rules here,
 * the same write would be allowed from the browser and refused by the route — which is exactly
 * the kind of split-brain this module exists to prevent.
 */
export function expiryDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return Number.isNaN(value) ? null : new Date(value);
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate === "function") {
    try {
      const d = maybe.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * `clinic` is the raw clinic document data, from either SDK. A missing document is treated as
 * active: the caller has already established the user holds a role at this clinic, so a clinic
 * document that cannot be read is an infrastructure problem, and blocking every write in response
 * to one turns a degraded read into a total outage.
 */
export function clinicActivity(
  clinic: Record<string, unknown> | null | undefined,
  now: Date = new Date()
): ClinicActivity {
  if (!clinic) return { active: true };

  const status = typeof clinic.status === "string" ? clinic.status : "Active";
  if (status !== "Active") {
    return {
      active: false,
      reason: status === "Expired" ? "expired" : "suspended",
      message:
        status === "Expired"
          ? "This clinic's subscription has ended. Records stay readable, but new entries are paused until it is renewed."
          : "This clinic is suspended. Records stay readable, but new entries are paused until it is reactivated.",
    };
  }

  const expires = expiryDate(clinic.expiresAt);
  if (expires && expires.getTime() <= now.getTime()) {
    return {
      active: false,
      reason: "expired",
      message:
        "This clinic's subscription has ended. Records stay readable, but new entries are paused until it is renewed.",
    };
  }

  return { active: true };
}

/** Convenience for call sites that only want the boolean. */
export function isClinicActive(
  clinic: Record<string, unknown> | null | undefined,
  now: Date = new Date()
): boolean {
  return clinicActivity(clinic, now).active;
}
