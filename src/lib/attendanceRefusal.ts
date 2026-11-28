/**
 * What the activity log says when a clock-in or clock-out is refused.
 *
 * Why this exists: a refused punch showed a message for a few seconds and left nothing behind. When
 * a receptionist reported "it won't let me clock in", there was no way to tell from the clinic's
 * records whether she was too far away, had location blocked, or never reached the button at all —
 * the only source was her memory of a message that had already disappeared.
 *
 * So every refusal now writes one line to the same activity log everything else uses. This module
 * only words that line; the page decides when to write it.
 */

import type { LocationFailure } from "./attendanceLocation";

export type PunchRefusal =
  | { kind: "noProfile" }
  | { kind: "settingsLoading" }
  | { kind: "wrongDevice" }
  | { kind: "noLocationSet" }
  | { kind: "location"; failure: LocationFailure }
  /** `place` is the branch name, or "" for a clinic with one location. */
  | { kind: "outside"; place: string; distance: number; effectiveDistance: number; accuracy: number; radius: number }
  | { kind: "saveFailed"; error: unknown }
  | { kind: "crashed"; error: unknown };

export type DeviceKind = "phone" | "computer" | "unknown";

/** A location read on a computer comes from Wi-Fi and is far coarser than a phone's — worth knowing. */
export function deviceKind(userAgent: string | null | undefined): DeviceKind {
  if (!userAgent) return "unknown";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ? "phone" : "computer";
}

const MAX_ERROR_CHARS = 120;

/** A Firebase error's code says more in fewer words than its message; fall back to the message. */
function errorText(error: unknown): string {
  const e = (error && typeof error === "object" ? error : {}) as { code?: unknown; message?: unknown };
  const raw = typeof e.code === "string" && e.code ? e.code : typeof e.message === "string" && e.message ? e.message : "unknown";
  return raw.length > MAX_ERROR_CHARS ? `${raw.slice(0, MAX_ERROR_CHARS)}…` : raw;
}

function locationText(failure: LocationFailure): string {
  switch (failure.kind) {
    case "unsupported":
      return "This device cannot give a location.";
    case "denied":
      return "Location permission is blocked in the browser.";
    case "unavailable":
      return "The device could not find its location.";
    case "timeout":
      return "Finding the location took too long.";
    case "inaccurate":
      return `Location signal too weak (±${failure.accuracy} m).`;
  }
}

function reasonText(refusal: PunchRefusal): string {
  switch (refusal.kind) {
    case "noProfile":
      return "No staff profile is linked to this login.";
    case "settingsLoading":
      return "Pressed before the clinic settings finished loading.";
    case "wrongDevice":
      return "Not the phone registered to this person.";
    case "noLocationSet":
      return "The clinic has no clock-in location saved.";
    case "location":
      return locationText(refusal.failure);
    case "outside":
      return (
        `Too far: about ${refusal.effectiveDistance} m from ${refusal.place || "the clinic"} (limit ${refusal.radius} m). ` +
        `Measured ${refusal.distance} m, signal ±${refusal.accuracy} m.`
      );
    case "saveFailed":
      return `Could not save the punch (${errorText(refusal.error)}).`;
    case "crashed":
      return `Unexpected error (${errorText(refusal.error)}).`;
  }
}

/**
 * The activity-log line for one refused punch.
 *
 * The action starts with "Attendance" because that is the word the log files rows by, and it never
 * contains "created", "updated" or "deleted", so the row stays at the lowest severity.
 */
export function punchRefusalLog(
  type: "in" | "out",
  refusal: PunchRefusal,
  device: DeviceKind
): { action: string; details: string } {
  const where = device === "unknown" ? "" : ` On a ${device}.`;
  return {
    action: `Attendance: clock-${type} refused`,
    details: `${reasonText(refusal)}${where}`,
  };
}
