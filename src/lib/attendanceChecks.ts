/**
 * Which proofs a clinic asks for when someone clocks in or out.
 *
 * Two independent switches, set by the clinic in Settings → Attendance:
 *
 *  - location: the person must be standing inside the clinic's saved area (GPS).
 *  - device:   the person may only clock in from the phone they first clocked in with.
 *
 * Both are ON unless the clinic has explicitly switched them off. That default matters: every
 * clinic that existed before these switches has neither field saved, and for them nothing may
 * change. Only a stored `false` turns a check off — a missing, empty or unreadable value never
 * loosens anything.
 */
export type AttendanceChecks = { location: boolean; device: boolean };

export const ATTENDANCE_CHECK_FIELDS = ["attendanceRequireLocation", "attendanceRequireDevice"] as const;

const isOff = (value: unknown) => value === false || value === "false";

export function readAttendanceChecks(info: Record<string, unknown> | null | undefined): AttendanceChecks {
  return {
    location: !isOff(info?.attendanceRequireLocation),
    device: !isOff(info?.attendanceRequireDevice),
  };
}

/**
 * Whether this phone is refused for this person.
 *
 * Never refused when the clinic has switched the phone lock off, and never refused for someone
 * who has no phone registered yet — the first clock-in is what registers it.
 */
export function isDeviceRefused(args: {
  checks: AttendanceChecks;
  registeredDeviceId: unknown;
  currentDeviceId: string;
}): boolean {
  if (!args.checks.device) return false;
  const registered = typeof args.registeredDeviceId === "string" ? args.registeredDeviceId : "";
  return Boolean(registered) && registered !== args.currentDeviceId;
}
