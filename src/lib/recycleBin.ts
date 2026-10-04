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
import { isFullAccessRole } from "@/lib/permissions";

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
  xray_reports: { permission: "clinical.delete", adminOnly: false, refFields: ["patientId"] },
  ortho_ai_reports: { permission: "clinical.delete", adminOnly: false, refFields: ["patientId"] },
  // Insurance approvals are created by /api/insurance/* (Admin SDK). They sit in the patient's file
  // and are edited by anyone who may edit that patient, so the same gate decides the delete.
  insurance_claims: { permission: "patients.edit", adminOnly: false, refFields: ["patientId"] },
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

/**
 * Collections that only ever enter the bin as part of a parent's deletion, never on their own.
 *
 * An insurance approval writes one treatment charge and one clinical note per approved line;
 * deleting the approval alone would leave those rows in the patient's file pointing at nothing,
 * and saving the paper again would record the work twice. So they go into the bin WITH the
 * approval, as children of its entry (`cascadeOf`), and come back with it. They stay out of
 * BIN_COLLECTIONS: a client still cannot bin, list or restore a ledger row or a note by itself.
 */
export const CASCADE_CHILD_COLLECTIONS = ["ledger", "clinical_notes"] as const;

/**
 * What a patient takes into the bin with them: every record that finds its patient by `patientId`.
 *
 * Deleting a patient used to bin the card alone and leave the rest behind — the charges and
 * payments kept counting in Finance, the approvals stayed on the Insurance page, all of it pointing
 * at a patient no screen could open. Now the whole file goes, as children of the patient's entry
 * (`cascadeOf`), and restoring the patient brings every one of them back. Money with payments
 * against it goes too, and the payments with it: unlike an approval binned on its own, nothing is
 * left behind for the payments to settle.
 *
 * Logs and message queues are deliberately absent (system_logs, ledger_audit, sms_outbox, …): they
 * are the record that things happened, not part of the patient's file.
 */
export const PATIENT_CASCADE_COLLECTIONS = [
  "ledger",
  "clinical_notes",
  "appointments",
  "prescriptions",
  "patient_media",
  "treatment_plans",
  "diagnosis_chats",
  "xray_reports",
  "insurance_claims",
  "ortho_ai_reports",
  "ortho_cases",
  "ortho_sessions",
  "lab_cases",
] as const;

/** The collections an entry of this collection may carry as children; empty = none. */
export function cascadeCollectionsFor(parentCollection: string): readonly string[] {
  if (parentCollection === "patients") return PATIENT_CASCADE_COLLECTIONS;
  if (parentCollection === "insurance_claims") return CASCADE_CHILD_COLLECTIONS;
  return [];
}

/** How many of each kind went with a parent, for the confirm prompt and the bin list. */
export function cascadeCounts(children: ReadonlyArray<{ collection: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of children) counts[c.collection] = (counts[c.collection] || 0) + 1;
  return counts;
}

/**
 * May this patient go into the bin with everything linked to them?
 *
 * Two refusals. A linked record whose slot in the bin is already taken (an approval deleted on its
 * own earlier, then saved again from the same paper — approval ids come from the approval number)
 * would overwrite the older copy, which may be the one someone means to restore. And one action
 * is one Firestore commit, which refuses anything over 10 MiB.
 */
export function checkPatientCascade(args: { alreadyInBin: readonly string[]; totalBytes: number }): true | BinRefusal {
  if (args.alreadyInBin.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `"${args.alreadyInBin[0]}" is already in Recently Deleted from an earlier delete. Delete that copy permanently from Recently Deleted, then delete the patient again.`,
      reason: "CHILD_ALREADY_IN_BIN",
    };
  }
  if (args.totalBytes > MAX_ACTION_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "This patient's file is too large to move to Recently Deleted in one go. Export it first.",
      reason: "TOO_LARGE",
    };
  }
  return true;
}

/** What each linked kind is called on screen, [English, Arabic]. */
const LINKED_NAMES: Record<string, [string, string]> = {
  ledger: ["charges & payments", "حسابات ومدفوعات"],
  clinical_notes: ["treatment notes", "ملاحظات علاج"],
  appointments: ["appointments", "مواعيد"],
  prescriptions: ["prescriptions", "روشتات"],
  patient_media: ["images", "صور"],
  treatment_plans: ["treatment plans", "خطط علاج"],
  diagnosis_chats: ["diagnosis chats", "مناقشات تشخيص"],
  xray_reports: ["x-ray reports", "تقارير أشعة"],
  insurance_claims: ["insurance approvals", "موافقات تأمين"],
  ortho_ai_reports: ["ortho AI reports", "تقارير تقويم"],
  ortho_cases: ["ortho case", "ملف تقويم"],
  ortho_sessions: ["ortho visits", "زيارات تقويم"],
  lab_cases: ["lab cases", "حالات معمل"],
};

/**
 * "5 charges & payments, 3 appointments" — what goes with a patient, for the confirm prompt.
 * Arabic puts the number after the noun in brackets, which reads right for every count without
 * needing the dual and plural forms.
 */
export function describeLinked(counts: Record<string, number> | null | undefined, ar: boolean): string {
  return Object.entries(counts ?? {})
    .filter(([, n]) => n > 0)
    .map(([collection, n]) => {
      const names = LINKED_NAMES[collection] ?? [collection.replace(/_/g, " "), collection.replace(/_/g, " ")];
      return ar ? `${names[1]} (${n})` : `${n} ${names[0]}`;
    })
    .join(ar ? "، " : ", ");
}

/** What a screen needs to say "this is in Recently Deleted": when, by whom, and with what. */
export type BinNotice = { deletedAt: string | null; deletedByName: string; withParent: string | null };

/** A live bin entry's data → its notice; null when the entry is absent or no longer in the bin. */
export function binNoticeOf(data: Record<string, unknown> | null | undefined): BinNotice | null {
  if (!data || data.status !== "deleted") return null;
  const at = (data.deletedAt as { toDate?: () => Date } | null | undefined)?.toDate?.();
  const by = typeof data.deletedByName === "string" && data.deletedByName.trim() ? data.deletedByName.trim() : "Unknown";
  const parent =
    typeof data.cascadeOf === "string" && data.cascadeOf
      ? typeof data.cascadeParentLabel === "string" && data.cascadeParentLabel.trim()
        ? data.cascadeParentLabel.trim()
        : "another record"
      : null;
  return { deletedAt: at ? at.toISOString() : null, deletedByName: by, withParent: parent };
}

/**
 * A record that went into the bin with a parent is restored or purged with it, never alone: alone,
 * a charge would come back without its patient, and a purge would leave the parent's restore
 * missing a piece.
 */
export function checkNotCascadeChild(entry: { cascadeOf?: unknown; cascadeParentLabel?: unknown }): true | BinRefusal {
  if (typeof entry.cascadeOf !== "string" || !entry.cascadeOf) return true;
  const parent = typeof entry.cascadeParentLabel === "string" && entry.cascadeParentLabel.trim() ? `"${entry.cascadeParentLabel.trim()}"` : "another record";
  return {
    ok: false,
    status: 409,
    error: `This was deleted together with ${parent}. Restore or delete that instead.`,
    reason: "CASCADE_CHILD",
  };
}

/** A plain document id: present, short, and unable to step out of its collection. */
function isPlainDocId(v: unknown): v is string {
  return typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 200 && !/[/\\]/.test(v) && v !== "." && v !== "..";
}

/** The treatment rows an approval snapshot links to: its `ledgerIds` map of `{ ledgerId, noteId }`. */
export function claimLinkedRows(snapshot: Record<string, unknown>): Array<{ ledgerId: string; noteId: string }> {
  const raw = snapshot.ledgerIds;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: Array<{ ledgerId: string; noteId: string }> = [];
  for (const v of Object.values(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const { ledgerId, noteId } = v as { ledgerId?: unknown; noteId?: unknown };
    if (isPlainDocId(ledgerId) && isPlainDocId(noteId)) out.push({ ledgerId, noteId });
  }
  return out;
}

/**
 * May an approval go into the bin with its treatment rows? Not once money has been recorded
 * against any of them: binning a paid charge would leave its payments settling nothing, and the
 * payments are the clinic's books. Missing rows (null) are simply not there to block.
 */
export function checkClaimCascade(charges: ReadonlyArray<{ paid?: unknown } | null | undefined>): true | BinRefusal {
  if (charges.some((c) => c && Number(c.paid) > 0)) {
    return { ok: false, status: 409, error: "This approval has payments recorded; reverse them first.", reason: "CLAIM_HAS_PAYMENTS" };
  }
  return true;
}

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

/**
 * One action is one commit, and Firestore refuses a commit over 10 MiB. The count of writes is no
 * longer capped, so bytes are the limit that matters; this leaves room for the entry fields.
 */
export const MAX_ACTION_BYTES = 8_000_000;

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
  // Owner and Admin both: the same pair `isClinicAdmin()` accepts in firestore.rules. Checking
  // the literal "Admin" refused every clinic Owner — the person most entitled to delete — with
  // a 403 the screen showed as "could not delete".
  const isAdmin = isFullAccessRole(actor.role);
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
  if (isFullAccessRole(actor.role)) return true;

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
      case "insurance_claims":
        return "patients" as const;
      case "prescriptions":
      case "treatment_plans":
      case "diagnosis_chats":
      case "xray_reports":
      case "ortho_ai_reports":
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
    case "xray_reports":
      return s("patientName") ? `X-ray report — ${s("patientName")}` : "X-ray report";
    case "insurance_claims":
      return s("approvalNumber") && s("patientName")
        ? `Approval ${s("approvalNumber")} — ${s("patientName")}`
        : s("approvalNumber")
          ? `Approval ${s("approvalNumber")}`
          : "Insurance approval";
    case "ortho_ai_reports":
      return s("patientName") ? `Ortho AI ${s("kind") || "report"} — ${s("patientName")}` : `Ortho AI ${s("kind") || "report"}`;
    case "ledger":
      return s("description") || "Treatment charge";
    case "clinical_notes":
      return s("procedure") || "Treatment note";
    case "appointments":
      return [s("date"), s("time")].filter(Boolean).join(" ") || "Appointment";
    case "ortho_cases":
      return "Ortho case";
    case "ortho_sessions":
      return s("date") ? `Ortho visit — ${s("date")}` : "Ortho visit";
    case "lab_cases":
      return s("code") ? `Lab case ${s("code")}` : "Lab case";
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
