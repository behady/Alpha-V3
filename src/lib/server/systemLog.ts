/**
 * Server-side twin of lib/logger's `logActivity`.
 *
 * That one imports the browser Firebase SDK, so an API route cannot call it — and the routes that
 * now own every money write are exactly the code whose actions most need to appear on the
 * clinic's activity screen. Same collection, same field names, so both writers show up in one list
 * and no screen has to know which side produced an entry.
 *
 * Never throws: failing to log must not undo the thing the user asked for.
 */

import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";

export type LogSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type LogModule =
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

export async function logActivityServer(args: {
  clinicId: string;
  user: { uid?: string | null; name?: string | null; role?: string | null };
  action: string;
  details?: string;
  severity?: LogSeverity;
  module?: LogModule;
}): Promise<void> {
  const userName = args.user.name || "Unknown User";
  try {
    await adminClinicCollection(args.clinicId, "system_logs").add({
      userId: args.user.uid || null,
      userName,
      userRole: args.user.role || null,
      // Legacy key some older screens and reports still read.
      user: userName,
      action: args.action,
      details: args.details || "",
      severity: args.severity || "MEDIUM",
      module: args.module || "system",
      timestamp: FieldValue.serverTimestamp(),
      date: new Date().toISOString().split("T")[0],
    });
  } catch (error) {
    console.error("logActivityServer: failed to write system log", { clinicId: args.clinicId }, error);
  }
}
