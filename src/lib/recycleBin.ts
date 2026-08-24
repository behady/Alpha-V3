/**
 * What may go in the recycle bin, and every decision about putting it there or taking it back.
 *
 * Pure — no Firebase — so the rules that decide whether a record can be deleted or restored are
 * testable without an emulator. The routes in src/app/api/records/ are the shell that reads and
 * writes; they make no decisions of their own.
 *
 * WHY AN EXPLICIT TABLE RATHER THAN THE PERMISSION MAP
 *
 * `COLLECTION_WRITE_PERMISSIONS` in src/lib/permissions.ts mirrors only the permDelete() map in
 * firestore.rules. It does NOT encode the two other layers the rules rely on: the memberMayWrite()
 * exclusion chain, and the Admin-only narrowings inside individual match blocks. `holdsPermission`
 * treats a null permission as "open to any clinic member" — which is safe inside the rules only
 * because the exclusion chain already refused the dangerous collections before the map is ever
 * consulted.
 *
 * A server route runs on the Admin SDK and bypasses rules entirely. Deriving its authority from
 * that map would inherit the null-is-open default without the gate that makes it safe, handing out
 * deletes on `system_logs`, `ai_usage`, `sms_outbox` and every other collection the rules close on
 * purpose. So: absent from the table below means DENY, and the table is written out by hand.
 */

/** Collections the bin will accept, and what it takes to delete or restore one. */
export type BinCollectionRule = {
  /** Granular permission required, or null when the role gate alone decides. */
  permission: string | null;
  /** Admin-only, mirroring a match block in firestore.rules that requires isClinicAdmin. */
  adminOnly: boolean;
  /** Fields on the snapshot that point at other documents which must still exist to restore. */
  refFields: readonly string[];
  /** Field to check for a duplicate live record before restoring (a name collision is invisible). */
  uniqueBy?: readonly string[];
};

export const BIN_COLLECTIONS: Record<string, BinCollectionRule> = {
  patients: { permission: "patients.delete", adminOnly: false, refFields: [], uniqueBy: ["phone"] },
  patient_media: { permission: "patients.edit", adminOnly: false, refFields: ["patientId"] },
  prescriptions: { permission: "clinical.delete", adminOnly: false, refFields: ["patientId"] },
  treatment_plans: { permission: "clinical.delete", adminOnly: false, refFields: ["patientId"] },
  diagnosis_chats: { permission: "clinical.delete", adminOnly: false, refFields: ["patientId"] },
  inventory: { permission: "inventory.delete", adminOnly: false, refFields: [], uniqueBy: ["name"] },
  drugs: { permission: "access.settings", adminOnly: false, refFields: [], uniqueBy: ["name", "dose"] },
  marketing_content: { permission: "access.marketing", adminOnly: false, refFields: [] },
  attendance: { permission: "attendance.admin", adminOnly: false, refFields: [] },
  // Admin-only in firestore.rules via their own match blocks, which the permission map does not
  // express: `services` requires isClinicAdmin (the price list decides what patients are charged),
  // and `leads` restricts delete to Admin so the marketing report stays honest.
  services: { permission: "access.settings", adminOnly: true, refFields: [], uniqueBy: ["name"] },
  leads: { permission: null, adminOnly: true, refFields: [] },
};

/**
 * Never binned, with the route that owns them instead. Kept as data so the refusal can name the
 * right door rather than saying "no".
 *
 * These are not merely absent from the table above — they are collections somebody will reach for,
 * and a bare "unknown collection" would read as an oversight to fix rather than a decision.
 */
export const ROUTED_ELSEWHERE: Record<string, string> = {
  ledger: "/api/finance/ledger",
  clinical_notes: "/api/clinical/procedures",
  appointments: "/api/appointments/delete",
};

/** Collections that live at the database root; clinicId does not scope them. */
const GLOBAL_COLLECTION_NAMES = new Set(["users", "clinics", "join_requests", "clinic_secrets"]);

export const BIN_ENTRIES_COLLECTION = "deleted_records";
export const BIN_HISTORY_COLLECTION = "deleted_records_history";
export const BIN_PAYLOAD_SUBCOLLECTION = "payload";
export const BIN_PAYLOAD_DOC = "data";

/** Firestore's hard ceiling is 1 MiB; leave headroom for the wrapper fields. */
export const MAX_SNAPSHOT_BYTES = 900_000;

/** One user action may not bin more than this many documents. */
export const MAX_ITEMS_PER_ACTION = 200;

export type BinRefusal = { ok: false; status: number; error: string; reason: string };
export type BinApproval = { ok: true; rule: BinCollectionRule };

/**
 * Is this a collection the bin will touch at all, and is the identifier safe to build a path from?
 *
 * Runs BEFORE authorization, deliberately. `requireStaffPermission` short-circuits on
 * `role === "Admin"`, so a check ordered after it would let any clinic Admin reach any collection
 * name they cared to type.
 */
export function checkBinnable(collection: unknown, documentId: unknown): BinApproval | BinRefusal {
  const name = typeof collection === "string" ? collection.trim() : "";
  const id = typeof documentId === "string" ? documentId.trim() : "";

  if (!name || !id) {
    return { ok: false, status: 400, error: "A collection and document id are required.", reason: "MISSING" };
  }

  // `adminClinicCollection(id, "a/b")` is a legal multi-segment path — a document id containing a
  // slash escapes the tenant prefix the clinicId was supposed to provide.
  for (const [label, value] of [["collection", name], ["document id", id]] as const) {
    if (value.includes("/") || value === "." || value === "..") {
      return { ok: false, status: 400, error: `Invalid ${label}.`, reason: "BAD_PATH" };
    }
  }

  // These four are returned UNPREFIXED by adminClinicCollection, so clinicId stops scoping
  // anything the moment one of them is named. An Admin of clinic A could otherwise delete clinic
  // B, or copy the WhatsApp gateway token out of clinic_secrets into a readable snapshot.
  if (GLOBAL_COLLECTION_NAMES.has(name)) {
    return {
      ok: false,
      status: 400,
      error: "That collection is not clinic data and cannot be deleted through this route.",
      reason: "GLOBAL_COLLECTION",
    };
  }

  const elsewhere = ROUTED_ELSEWHERE[name];
  if (elsewhere) {
    return {
      ok: false,
      status: 400,
      error: `Records in "${name}" are deleted through ${elsewhere}, which enforces rules this route cannot.`,
      reason: "ROUTED_ELSEWHERE",
    };
  }

  const rule = BIN_COLLECTIONS[name];
  if (!rule) {
    return { ok: false, status: 400, error: `"${name}" cannot be deleted through this route.`, reason: "NOT_BINNABLE" };
  }

  // A rule with neither gate would be reachable by any member; make that unbuildable rather than
  // relying on the table being written correctly.
  if (rule.permission === null && !rule.adminOnly) {
    return { ok: false, status: 500, error: "Misconfigured collection rule.", reason: "RULE_UNGATED" };
  }

  return { ok: true, rule };
}

/**
 * May this person delete from this collection?
 *
 * `adminOnly` is checked FIRST and independently, because requireStaffPermission returns early for
 * an Admin — a collection whose real rule is "Admin only" must not become reachable by anyone
 * holding the mapped permission.
 */
export function checkDeleteAllowed(
  rule: BinCollectionRule,
  actor: { role: string | null | undefined; permissions: string[] }
): true | BinRefusal {
  const isAdmin = actor.role === "Admin";
  if (rule.adminOnly && !isAdmin) {
    return { ok: false, status: 403, error: "Only a clinic Admin can delete this.", reason: "ADMIN_ONLY" };
  }
  if (isAdmin) return true;
  if (rule.permission && actor.permissions.includes(rule.permission)) return true;
  return {
    ok: false,
    status: 403,
    error: `You do not have permission to do this (${rule.permission}).`,
    reason: "NO_PERMISSION",
  };
}

/**
 * May this person restore it?
 *
 * Stricter than deleting, on purpose. A restore is a CREATE performed with the Admin SDK, so the
 * create permission the rules would have demanded is bypassed unless it is demanded here — and
 * undoing someone's deletion is not a lesser act than making one. Requiring both keeps a
 * Receptionist, who holds neither clinical permission, out of adjudicating a deleted treatment plan.
 */
export function checkRestoreAllowed(
  collection: string,
  rule: BinCollectionRule,
  actor: { role: string | null | undefined; permissions: string[] },
  createPermissionFor: (collection: string) => string | null
): true | BinRefusal {
  const deleteCheck = checkDeleteAllowed(rule, actor);
  if (deleteCheck !== true) return deleteCheck;
  if (actor.role === "Admin") return true;

  const createPermission = createPermissionFor(collection);
  if (createPermission && !actor.permissions.includes(createPermission)) {
    return {
      ok: false,
      status: 403,
      error: `Restoring this also needs permission to create it (${createPermission}).`,
      reason: "NO_CREATE_PERMISSION",
    };
  }
  return true;
}

/**
 * Changes applied on top of a verbatim snapshot at restore time.
 *
 * A restore is otherwise byte-for-byte, which is right for clinical facts — re-stamping
 * `createdAt` on a radiograph would file a years-old image under "today", which is a falsified
 * record rather than a cosmetic bug. But a few fields describe a record's participation in
 * something ongoing, and bringing those back verbatim restarts it with nobody deciding to.
 */
export function restoreOverrides(
  collection: string,
  snapshot: Record<string, unknown>
): Record<string, unknown> {
  switch (collection) {
    case "diagnosis_chats":
      // "super" resumes on the expensive model tier at the next message, unchosen.
      return { mode: "power" };
    case "treatment_plans":
      // The unfinished-treatment WhatsApp audience is built from exactly these two statuses and
      // quotes the plan total. A plan deleted because it was withdrawn must not text the patient
      // about stale prices on its way back in.
      return snapshot.status === "presented" || snapshot.status === "accepted"
        ? { status: "draft" }
        : {};
    case "marketing_content":
      // A restored "scheduled" item lands on the calendar already overdue, and a restored
      // starred/posted one silently re-enters the AI's style examples.
      return { status: "draft", scheduledDate: null, starred: false };
    default:
      return {};
  }
}

/**
 * Reasons a snapshot cannot be written back, checked before anything is.
 *
 * `targetExists` is the one that matters most: the document id is the only foreign key this app
 * has, so restoring under a fresh id would orphan every pointer at it, and overwriting would
 * destroy whatever was charted in the gap — `patients.teethData` is written wholesale with no
 * per-tooth history, so an overwrite leaves nothing to reconcile against. Refusing and asking a
 * human to compare is the only answer that cannot lose data.
 */
export function checkRestorable(args: {
  collection: string;
  entryStatus: string;
  targetExists: boolean;
  missingRefs: string[];
  duplicateOf?: string | null;
  snapshot: Record<string, unknown>;
  acknowledgeDuplicate?: boolean;
  actorIsAdmin?: boolean;
}): true | BinRefusal {
  if (args.entryStatus !== "deleted") {
    return {
      ok: false,
      status: 409,
      error: "This entry has already been restored or removed.",
      reason: "ALREADY_HANDLED",
    };
  }

  if (args.targetExists) {
    return {
      ok: false,
      status: 409,
      error: "A record already exists in its place. Compare the two and merge by hand.",
      reason: "TARGET_OCCUPIED",
    };
  }

  if (args.missingRefs.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `Cannot restore: ${args.missingRefs.join(", ")} no longer exists. Restore it first.`,
      reason: "MISSING_REF",
    };
  }

  // An open shift restored verbatim becomes live again: elapsed weeks are counted as worked
  // minutes, the clock widget starts running, and payroll moves.
  if (args.collection === "attendance" && !args.snapshot.checkOut) {
    return {
      ok: false,
      status: 409,
      error: "That log was an open shift and cannot be restored as it was.",
      reason: "OPEN_SHIFT",
    };
  }

  if (args.duplicateOf) {
    const overridable = args.collection === "patients";
    if (!overridable || !args.acknowledgeDuplicate || !args.actorIsAdmin) {
      return {
        ok: false,
        status: 409,
        error: `A live record already matches this one (${args.duplicateOf}).`,
        reason: "DUPLICATE",
      };
    }
  }

  return true;
}

/**
 * Which activity-log module a deletion belongs to.
 *
 * `logActivityServer` takes a fixed union — inventing a "records" module would not compile, and
 * more usefully, a deletion should appear under the module a reader would filter by when looking
 * for it. A mixed batch falls back to "system" rather than claiming one of its parts.
 */
export function logModuleFor(collections: string[]): "patients" | "clinical" | "inventory" | "attendance" | "settings" | "system" {
  const distinct = [...new Set(collections)];
  const of = (c: string) => {
    switch (c) {
      case "patients":
      case "patient_media":
        return "patients" as const;
      case "prescriptions":
      case "treatment_plans":
      case "diagnosis_chats":
        return "clinical" as const;
      case "inventory":
        return "inventory" as const;
      case "attendance":
        return "attendance" as const;
      case "services":
      case "drugs":
        return "settings" as const;
      default:
        return "system" as const;
    }
  };
  const modules = [...new Set(distinct.map(of))];
  return modules.length === 1 ? modules[0] : "system";
}

/** A short human label for the bin list, so a row is recognisable without opening the snapshot. */
export function labelFor(collection: string, snapshot: Record<string, unknown>): string {
  const s = (key: string) => {
    const v = snapshot[key];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  };
  switch (collection) {
    case "patients":
      return s("name") || s("fileNumber") || "Patient";
    case "patient_media":
      return s("fileName") || s("caption") || s("category") || "Image";
    case "prescriptions":
      return s("drugName") || s("name") || "Prescription";
    case "treatment_plans":
      return s("title") || s("name") || "Treatment plan";
    case "diagnosis_chats":
      return s("title") || "Diagnosis chat";
    case "services":
    case "drugs":
    case "inventory":
      return s("name") || collection;
    case "leads":
      return s("name") || s("phone") || "Lead";
    case "marketing_content":
      return s("title") || s("caption") || "Marketing item";
    case "attendance":
      return `${s("staffName") || "Staff"} — ${s("date") || ""}`.trim();
    default:
      return collection;
  }
}
