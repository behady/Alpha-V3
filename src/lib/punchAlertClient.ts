import { auth } from "@/lib/firebase";

/**
 * After a clock-in or clock-out is saved, ask the server to tell the owner (if the clinic has the
 * "Someone clocked in or out" alert switched on — the server decides, and words it from the saved
 * record). Never awaited by the caller and never throws: the punch is saved either way, and a
 * missed alert must not look like a failed punch.
 */
export function notifyPunch(clinicId: string | null | undefined, attendanceId: string, direction: "in" | "out"): void {
  if (!clinicId || !attendanceId) return;
  void (async () => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) return;
      await fetch("/api/attendance/punch-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ clinicId, attendanceId, direction }),
      });
    } catch (error) {
      console.error("Punch alert failed", error);
    }
  })();
}
