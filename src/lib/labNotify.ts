/**
 * Raising the bell when a lab case comes back.
 *
 * Written from the browser, at the moment somebody marks a case received, rather than from a
 * scheduled job. That is deliberate: the event IS a person's action, so there is nothing to poll
 * for and nothing to deploy. It also means the alert cannot fire for a case nobody has actually
 * taken delivery of.
 *
 * It used to `addDoc` into the `notifications` collection directly, and that is now wrong twice
 * over. A bell row carries an audience (so a receptionist never sees the owner's money digest) and
 * a per-person read list, and a row written by hand had neither — under the current bell it would
 * be addressed to nobody and therefore invisible. And the clinic's answer about who should hear
 * about a lab case was not consulted, because there was nowhere to consult.
 *
 * So it posts to `/api/notifications/raise` instead, which is the same gate every other alert goes
 * through: the clinic's on/off answer, the audience, each person's own mutes, quiet hours, the bell
 * row, and — new — an actual push, which this alert never had.
 *
 * Best-effort by design. A case that arrived is the fact worth keeping; the notification about it
 * is a convenience, and a failed send must never roll back the status change that earned it.
 */

import { auth } from "@/lib/firebase";
import { wantsLabReadyAlert, type LabCase } from "@/lib/labCases";

/** The catalogue id. Also what the bell row carries as `eventType`. */
export const LAB_READY_EVENT = "labCaseBack";

type AlertPreferences = { inApp?: { labReady?: boolean } } | null | undefined;

export { wantsLabReadyAlert } from "@/lib/labCases";

export async function notifyLabCaseReady(
  labCase: LabCase,
  language: "en" | "ar",
  alertPreferences: AlertPreferences,
  clinicId?: string | null,
): Promise<void> {
  /**
   * Checked here as well as on the server.
   *
   * Not belt and braces — this is the cheap check. The clinic's answer is already in hand on the
   * page, so a clinic that does not want lab alerts costs nothing rather than a round trip and a
   * token mint. The server checks again because this one can be skipped by a stale page.
   */
  if (!wantsLabReadyAlert(alertPreferences)) return;
  if (!clinicId) return;

  const isAr = language === "ar";
  // The first name, not the full one — the bell is read over somebody's shoulder at a front desk.
  const who = labCase.patientFirstName || labCase.patientName?.split(/\s+/)[0] || "";

  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return;
    await fetch("/api/notifications/raise", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({
        clinicId,
        event: LAB_READY_EVENT,
        title: isAr ? "حالة معمل وصلت" : "A lab case is back",
        body: isAr
          ? `${labCase.code}${who ? ` — ${who}` : ""} وصلت من ${labCase.labName}. كلّم المريض واحجزله التركيب.`
          : `${labCase.code}${who ? ` — ${who}` : ""} is back from ${labCase.labName}. Call the patient and book the fitting.`,
        actionUrl: "/lab",
        data: { screen: "lab" },
      }),
    });
  } catch (error) {
    // Never rethrown: the case has arrived either way, and failing the status change because the
    // bell could not be rung would lose the fact to save the reminder about it.
    console.error("Lab arrival notification failed", error);
  }
}
