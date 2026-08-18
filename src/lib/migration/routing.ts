/**
 * Where each v2 collection lands in v3, and the types shared by the migration engine.
 *
 * v2 gave every clinic its own Firebase project, so nothing needed a clinic id — the database
 * *was* the tenant boundary. v3 puts every clinic in this project under `clinics/{clinicId}/…`.
 * For nearly every collection the migration is therefore a pure re-parenting: same document id,
 * same fields, one extra path prefix.
 *
 * Document ids are preserved throughout, and that is the decision everything else rests on.
 * Every link in v2 is a raw id string (`appointment.patientId`, `ledger.patientId`,
 * `clinical_note.appointmentId`). Keep the ids and every one of those links still resolves after
 * the move — no rewriting, no lookup table, and no chance of attaching one patient's chart to
 * another patient's record.
 */

/** Credentials for the clinic's old Firebase project, supplied per request. */
export type SourceCredentials = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  storageBucket: string;
  databaseId: string;
};

export type MigrationStats = {
  read: number;
  written: number;
  conflicts: number;
  refsRemapped: number;
  storageUrls: number;
  rerouted: number;
};

/** Resumable job state. Held by the browser between steps and echoed back each call. */
export type MigrationState = {
  /** Source collection paths still to process, e.g. "patients", "team_chats/tc1/messages". */
  pending: string[];
  /** Last document id written within `pending[0]`, or null to start that collection. */
  cursor: string | null;
  /** Collection paths already finished, for the progress display. */
  completed: string[];
  stats: MigrationStats;
  conflicts: string[];
  runId: string;
};

export const emptyStats = (): MigrationStats => ({
  read: 0,
  written: 0,
  conflicts: 0,
  refsRemapped: 0,
  storageUrls: 0,
  rerouted: 0,
});

/**
 * Collections that live at the ROOT of v3 and are shared by every clinic. None of these may be
 * bulk-copied from a v2 project: `users` is keyed by Firebase Auth uid, and uids do not survive
 * a project change.
 */
export const TARGET_GLOBAL_COLLECTIONS = new Set([
  "users",
  "clinics",
  "join_requests",
  "clinic_secrets",
]);

/** Source collections the copier must not touch, with the reason shown to the operator. */
export const SKIP_COLLECTIONS: Record<string, string> = {
  users:
    "Firebase Auth uids are per-project, so v2 user documents cannot be re-keyed by copying. " +
    "The Staff logins step rebuilds these from each person's email address instead.",
};

/**
 * Documents that move somewhere other than `clinics/{clinicId}/<same name>`.
 *
 * v2 kept the WhatsApp gateway credentials in `settings/wapilot`, which the app could read. v3
 * moved them to `clinic_secrets/{clinicId}`, which Firestore rules lock to `if false` so no
 * staff member can read a token that sends messages as the clinic. Re-parenting that document
 * would hand every clinic Admin the sending token straight back, so it is re-routed instead.
 */
export const DOCUMENT_REROUTES: Record<
  string,
  { describe: string; target: (clinicId: string) => { path: string[]; field: string } }
> = {
  "settings/wapilot": {
    describe: "settings/wapilot → clinic_secrets (server-only secret)",
    target: (clinicId) => ({ path: ["clinic_secrets", clinicId], field: "wapilot" }),
  },
};

/**
 * Collections v2 has that no v3 code reads yet. The rows are still copied — it is the clinic's
 * data and discarding it is not ours to decide — but they are reported so nobody assumes the
 * matching feature works after cutover.
 */
export const NO_V3_CONSUMER: Record<string, string> = {
  labs: "v3 has no lab module yet — rows are preserved, but nothing in v3 reads them.",
  lab_orders: "v3 has no lab module yet — rows are preserved, but nothing in v3 reads them.",
  ortho_visits: "v3 ortho uses ortho_cases and ortho_sessions; preserved unread.",
  ortho_photos: "v3 ortho uses ortho_cases and ortho_sessions; preserved unread.",
  tickets: "No v3 consumer; preserved unread.",
  conversations: "No v3 consumer; preserved unread.",
  portal_reviews: "No v3 consumer; preserved unread.",
  ai_treatment_plans: "No v3 consumer; preserved unread.",
  patient_change_requests: "No v3 consumer; preserved unread.",
  loyalty_ledger: "No v3 consumer; preserved unread.",
  team_chats: "No v3 consumer; preserved unread.",
  tasks: "No v3 consumer; preserved unread.",
  transactions: "No v3 consumer; preserved unread.",
  vital_signs: "No v3 consumer; preserved unread.",
};

/**
 * Collections both versions use. Listed so the preview can tell "known and expected" apart from
 * "never seen this before" — an unfamiliar collection is worth a human look before it is copied.
 */
export const KNOWN_CLINIC_COLLECTIONS = new Set([
  "ai_preferences",
  "appointment_reminders",
  "appointments",
  "attendance",
  "categories",
  "clinical_notes",
  "drugs",
  "inventory",
  "inventory_transactions",
  "leads",
  "ledger",
  "notifications",
  "ortho_cases",
  "ortho_sessions",
  "patients",
  "patient_media",
  "prescriptions",
  "services",
  "settings",
  "staff",
  "staff_summons",
  "system_logs",
  "whatsapp_logs",
  ...Object.keys(NO_V3_CONSUMER),
]);

/** Stamped onto every migrated document; see the engine for why it matters. */
export const MIGRATION_STAMP_FIELD = "_v2Migration";

/** Where a v2 root collection lands in v3. */
export function targetPathFor(clinicId: string, collectionName: string): string[] {
  if (TARGET_GLOBAL_COLLECTIONS.has(collectionName)) return [collectionName];
  return ["clinics", clinicId, collectionName];
}

/**
 * Rewrite a source document path to its v3 equivalent. Used for the copy itself and for
 * remapping any DocumentReference stored inside a document — a reference carries an absolute
 * path, so an un-rewritten one would keep pointing at a root collection that does not exist here.
 */
export function remapDocPath(clinicId: string, sourcePath: string): string {
  const [root, ...rest] = sourcePath.split("/");
  return [...targetPathFor(clinicId, root), ...rest].join("/");
}
