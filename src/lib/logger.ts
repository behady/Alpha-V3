import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { currentBranchId } from "@/lib/branchScope";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { storedFields, stripUndefined } from "@/lib/activity/catalogue";
import type { ActivityEvent, AuditUser as EventUser } from "@/lib/activity/types";

type AuditUser = {
  uid?: string;
  name?: string;
  role?: string;
};

type AuditSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type AuditModule =
  | "auth"
  | "settings"
  | "users"
  | "patients"
  | "appointments"
  | "clinical"
  | "finance"
  | "inventory"
  | "attendance"
  | "system";

type AuditMeta = {
  severity?: AuditSeverity;
  module?: AuditModule;
};

const inferSeverity = (action: string): AuditSeverity => {
  const lower = action.toLowerCase();
  if (lower.includes("deleted") || lower.includes("password") || lower.includes("device unlinked")) return "HIGH";
  if (lower.includes("created") || lower.includes("updated") || lower.includes("payment")) return "MEDIUM";
  return "LOW";
};

const inferModule = (action: string): AuditModule => {
  const lower = action.toLowerCase();
  if (lower.includes("attendance") || lower.includes("checked in")) return "attendance";
  if (lower.includes("inventory")) return "inventory";
  if (lower.includes("finance") || lower.includes("payment") || lower.includes("ledger")) return "finance";
  if (lower.includes("clinical") || lower.includes("treatment")) return "clinical";
  if (lower.includes("appointment")) return "appointments";
  if (lower.includes("patient")) return "patients";
  if (lower.includes("user") || lower.includes("permission") || lower.includes("staff")) return "users";
  if (lower.includes("settings")) return "settings";
  if (lower.includes("login") || lower.includes("logout") || lower.includes("auth")) return "auth";
  return "system";
};

/**
 * Centrally records system activity to Firestore.
 * Supports legacy calls: logActivity("User Name", "Action", "Details")
 * and structured calls: logActivity({ uid, name, role }, "Action", "Details")
 */
export const logActivity = async (
  userOrName: AuditUser | string | null | undefined,
  action: string,
  details?: string,
  collectionName: string = "system_logs",
  meta?: AuditMeta
) => {
  const isLegacyString = typeof userOrName === "string";
  const user = isLegacyString ? null : userOrName;
  const userName = isLegacyString ? userOrName : user?.name || "Unknown User";

  try {
    await addDoc(getClinicCollection(collectionName), {
      userId: user?.uid || null,
      userName,
      userRole: user?.role || null,
      user: userName, // keep legacy key for older screens/reports
      action,
      details: details || "",
      severity: meta?.severity || inferSeverity(action),
      module: meta?.module || inferModule(action),
      timestamp: serverTimestamp(),
      date: new Date().toISOString().split("T")[0],
    });
  } catch (error) {
    console.error("Failed to write system log:", error);
  }
};

/**
 * Activity log v2, client side: records a structured event. The sentence, severity, module and
 * categories are derived from the event by the catalogue, so a screen only says what happened.
 *
 * Writes the same legacy fields as `logActivity` (older screens and reports still read them) plus
 * the event itself. `date` is the clinic's calendar day, not UTC. An event with no branch gets the
 * branch on screen. Never throws.
 */
export async function logEvent(user: EventUser | null | undefined, e: ActivityEvent): Promise<void> {
  try {
    const userName = user?.name || "Unknown User";
    const stored = storedFields(e);
    await addDoc(
      getClinicCollection("system_logs"),
      stripUndefined({
        userId: user?.uid || null,
        userName,
        userRole: user?.role || null,
        user: userName,
        ...e,
        branchId: e.branchId === undefined ? currentBranchId() || null : e.branchId,
        ...stored,
        timestamp: serverTimestamp(),
        date: ymdInTimeZone(clinicTimeZone()),
      }),
    );
  } catch (error) {
    console.error("Failed to write activity event:", error);
  }
}
