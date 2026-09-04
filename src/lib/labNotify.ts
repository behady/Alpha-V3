/**
 * Raising the bell when a lab case comes back.
 *
 * The "Lab Cases Received" toggle has been sitting in Settings → Alerts since before this feature
 * existed, switchable, and firing nothing — because the `notifications` collection the bell reads
 * has never had a writer. This is that writer.
 *
 * Written from the browser, at the moment somebody marks a case received, rather than from a
 * scheduled job. That is deliberate: the event IS a person's action, so there is nothing to poll
 * for and nothing to deploy. It also means the alert cannot fire for a case nobody has actually
 * taken delivery of.
 *
 * Best-effort by design. A case that arrived is the fact worth keeping; the notification about it
 * is a convenience, and a failed write must never roll back the status change that earned it.
 */

import { addDoc, serverTimestamp } from "firebase/firestore";
import { getClinicCollection } from "@/lib/db-utils";
import { wantsLabReadyAlert, type LabCase } from "@/lib/labCases";

/** Matches what `NotificationBell` reads, and the `actionUrl` it navigates to on tap. */
export const LAB_READY_EVENT = "lab_ready";

type AlertPreferences = { inApp?: { labReady?: boolean } } | null | undefined;

export { wantsLabReadyAlert } from "@/lib/labCases";

export async function notifyLabCaseReady(
  labCase: LabCase,
  language: "en" | "ar",
  alertPreferences: AlertPreferences
): Promise<void> {
  if (!wantsLabReadyAlert(alertPreferences)) return;

  const isAr = language === "ar";
  // The first name, not the full one — the bell is read over somebody's shoulder at a front desk.
  const who = labCase.patientFirstName || labCase.patientName?.split(/\s+/)[0] || "";

  try {
    await addDoc(getClinicCollection("notifications"), {
      title: isAr ? "حالة معمل وصلت" : "A lab case is back",
      body: isAr
        ? `${labCase.code}${who ? ` — ${who}` : ""} وصلت من ${labCase.labName}. كلّم المريض واحجزله التركيب.`
        : `${labCase.code}${who ? ` — ${who}` : ""} is back from ${labCase.labName}. Call the patient and book the fitting.`,
      eventType: LAB_READY_EVENT,
      actionUrl: "/lab",
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    // Never rethrown: the case has arrived either way, and failing the status change because the
    // bell could not be rung would lose the fact to save the reminder about it.
    console.error("Lab arrival notification failed", error);
  }
}
