import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";

/**
 * Server-side twin of `logActivity` in lib/logger.
 *
 * That one imports the client Firestore SDK and resolves the clinic from a browser-global set
 * by ClinicContext, so an API route cannot call it — it would throw "No clinic selected
 * globally", and its own catch would swallow that, producing an audit trail that looks healthy
 * and records nothing. Anything running server-side logs through here instead.
 *
 * Entries land in the same `system_logs` collection the Activity Logs screen already reads, so
 * AI actions appear inline with staff actions rather than in a separate place nobody checks.
 * That collection is append-only at the rules layer (create for members, update/delete for
 * superadmin only), which is what makes it worth trusting.
 */

type AuditSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type AuditModule =
  | "auth" | "settings" | "users" | "patients" | "appointments"
  | "clinical" | "finance" | "inventory" | "attendance" | "system";

/** Mirrors inferModule in lib/logger so the module filter behaves the same for both sources. */
function moduleForCollection(collection: string): AuditModule {
  switch (collection) {
    case "patients": return "patients";
    case "appointments": return "appointments";
    case "clinical_notes": return "clinical";
    case "ledger": case "expenses": return "finance";
    case "inventory": case "inventory_transactions": return "inventory";
    case "staff": return "users";
    default: return "system";
  }
}

export type AiActionKind = "create" | "update" | "delete";

const VERB: Record<AiActionKind, string> = {
  create: "created",
  update: "updated",
  delete: "deleted",
};

const SEVERITY: Record<AiActionKind, AuditSeverity> = {
  // A delete is the one that cannot be undone by simply looking at the record again.
  create: "MEDIUM",
  update: "MEDIUM",
  delete: "HIGH",
};

/**
 * Record something the assistant did to a clinic's data.
 *
 * `before` is the document as it stood prior to the change — captured for updates and deletes so
 * the log says what was actually lost, not just that something happened. Never throws: a failure
 * to log must not roll back or mask the operation the user asked for, but it is logged loudly to
 * the server console so a silently-empty audit trail is noticeable.
 */
export async function logAiAction(args: {
  clinicId: string;
  kind: AiActionKind;
  collection: string;
  documentId: string;
  userId?: string | null;
  userName?: string | null;
  userRole?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  const { clinicId, kind, collection, documentId, userId, userName, userRole, before, after } = args;

  try {
    await adminClinicCollection(clinicId, "system_logs").add({
      userId: userId || null,
      // The person who asked is accountable for the action, so their name is what shows in the
      // log; `actor` is what distinguishes it from something they did by hand.
      userName: userName || "Unknown User",
      userRole: userRole || null,
      user: userName || "Unknown User",
      actor: "ai",
      aiTool: `db_${kind}`,
      action: `Alpha AI ${VERB[kind]} ${collection} record`,
      details: `${collection}/${documentId}`,
      targetCollection: collection,
      targetDocumentId: documentId,
      before: before ?? null,
      after: after ?? null,
      severity: SEVERITY[kind],
      module: moduleForCollection(collection),
      timestamp: FieldValue.serverTimestamp(),
      date: new Date().toISOString().split("T")[0],
    });
  } catch (error) {
    console.error("logAiAction: failed to write audit entry", { clinicId, collection, documentId }, error);
  }
}
