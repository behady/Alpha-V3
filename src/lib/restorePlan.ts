/**
 * What a per-clinic restore is allowed to touch, and what it must refuse.
 *
 * A Firestore backup restore in Google Cloud never overwrites the live database — it creates a
 * NEW one alongside it. Recovery therefore means copying ONE clinic's documents out of that
 * snapshot and into the live database, touching nobody else's. The layout makes that possible:
 * everything a clinic owns lives under `clinics/{clinicId}/`.
 *
 * Everything below is the decision half of that job, kept pure so it can be tested without a
 * database. `scripts/restore-clinic.mjs` is the I/O half and holds no policy of its own.
 *
 * The reason this file exists at all, rather than the script just copying the subtree: a restore
 * is run once, under stress, by someone who will not be reading the code at the time. Every
 * refusal here is a decision made calmly in advance, in daylight.
 */

/** Collections that are NOT under `clinics/{clinicId}/` and must never be written by a restore. */
export const ROOT_COLLECTIONS = [
  "users",
  "clinics",
  "join_requests",
  "clinic_secrets",
  "deleted_records",
  "deleted_records_history",
  "storage_orphans",
  "meta_integrations",
  "meta_pages",
  "meta_lead_events",
  "sms_pairing_codes",
] as const;

/**
 * Root collections that nonetheless hold data belonging to a particular clinic.
 *
 * These matter because the backups runbook says "everything in this system lives under
 * `clinics/{clinicId}/`", and that is the sentence the whole per-clinic recovery story rests on.
 * It is true of clinic *records* and not true of these: the Facebook page that feeds a clinic its
 * leads, the WhatsApp gateway token it sends with, and the lead replay queue all sit at the root,
 * deliberately, because the blanket clinic-member grant must never reach them
 * (`firestore.rules:696-728`).
 *
 * So a clinic restored by this script comes back with its records and without its integrations.
 * That is the correct behaviour — every one of these holds a credential, and re-writing a
 * credential from an old snapshot can resurrect one that has since been rotated or revoked — but
 * it is not what an operator would assume, so it is printed rather than left to be discovered.
 */
export const ROOT_BUT_CLINIC_LINKED: Record<string, string> = {
  clinic_secrets: "the WhatsApp gateway token this clinic sends with",
  meta_pages: "the Facebook page → clinic mapping, and its page access token",
  meta_integrations: "the Meta app credentials the webhook verifies against",
  meta_lead_events: "the lead replay queue",
  join_requests: "pending requests from people asking to join this clinic",
};

export type RestoreMode =
  /** Copied back. The clinic's own records. */
  | "restore"
  /** Left alone unless the operator names it explicitly. Restoring it causes something to HAPPEN. */
  | "hold"
  /** Never copied, at any flag. */
  | "never";

export type CollectionVerdict = {
  mode: RestoreMode;
  reason: string;
  /** False when nothing in this repo has ever heard of the collection — worth a human look. */
  known: boolean;
};

/**
 * Collections whose restoration DOES something in the world rather than merely recording it.
 *
 * This is the distinction that matters most and is the least obvious. Copying back a ledger row
 * changes a number on a screen. Copying back an `sms_outbox` row sends a text message to a real
 * patient, because the queue worker claims anything still `queued` or `sending` and `isDue()` has
 * no upper bound on age (`src/lib/sms/schedule.ts:38-42`, `src/lib/sms/outbox.ts:132-140`): a
 * message queued at snapshot time is due the moment it reappears, however long ago that was.
 *
 * So a restore of a week-old snapshot would re-send every reminder that was in flight that day,
 * at cost, to people whose appointments have already happened. Held back by default and released
 * only with `--include`, one collection at a time, named out loud.
 */
export const SIDE_EFFECTING: Record<string, string> = {
  sms_outbox:
    "Drained by a background worker that sends without a human, and nothing expires a queued " +
    "message. Restoring this re-sends every text that was in flight when the snapshot was taken.",
  whatsapp_outbox:
    "The staff messages queue. Restoring it puts already-handled messages back on somebody's " +
    "to-do list, where they will be sent again by hand.",
  ai_pending_actions:
    "Actions awaiting a human's confirmation. A restored one can be confirmed and executed " +
    "against data that has moved on since.",
  marketing_content:
    "Scheduled campaign items. A restored 'scheduled' row lands on the calendar already overdue " +
    "and a restored 'posted' one re-enters the AI's style examples.",
  staff:
    "Restoring a deleted staff row does more than put a name back. It re-links the ghost account " +
    "that row belonged to: the revoker matches a user document to a staff record by staffId, uid " +
    "OR lowercased email, and REFUSES to revoke anyone who matches one. So restoring staff does " +
    "not merely fail to help — it disarms the tool built to remove those accounts, for exactly " +
    "the accounts it was built for, with nothing on any screen connecting the two. And because " +
    "this tool only creates what is missing, the rows it would restore are precisely the ones " +
    "somebody deleted: the people who were offboarded.",
  sms_devices:
    "Handsets paired to this clinic's message queue. Restoring an old registration can let a " +
    "phone that was retired since the snapshot start claiming and sending the clinic's messages.",
};

/**
 * Collections both this app and the migration know about. An unfamiliar name is still restored —
 * it is the clinic's data and discarding it is not ours to decide — but it is reported, because
 * 'never seen this before' during a disaster is worth ten seconds of a human's attention.
 */
export const KNOWN_CLINIC_COLLECTIONS = new Set([
  // With a dedicated match block in firestore.rules.
  "ai_deletion_log", "ai_pending_actions", "ai_usage", "ai_usage_log", "attendance",
  "clinical_notes", "diagnosis_chats", "drugs", "inventory", "leads", "ledger", "ledger_audit",
  "marketing_content", "message_drafts", "patient_media", "patients", "prescriptions", "services",
  "settings", "sms_devices", "sms_outbox", "staff", "system_logs", "treatment_plans",
  "whatsapp_outbox",
  // Named only in the rules' permission maps; governed by the blanket subcollection grant.
  "appointments", "categories", "inventory_transactions", "marketing_campaigns", "marketing_cases",
  "marketing_consents", "marketing_settings", "ortho_cases", "ortho_sessions", "lab_cases",
  // The per-branch lab case counter. Named nowhere in firestore.rules on purpose: leaving it out
  // of the permission maps means a member who cannot create a lab case fails on the CASE write,
  // which names the thing they were actually doing, rather than on a counter bump they never
  // asked for — the misleading failure the settings/counters comment in the rules describes.
  "lab_counters",
  // Real, used by the app, and mentioned nowhere in firestore.rules — which is why this list is
  // hand-maintained rather than derived from the rules: a rules-derived list would flag all eight
  // of these as strangers during an incident, and an operator who has been cried wolf at eight
  // times stops reading the ninth.
  "ai_preferences", "appointment_reminders", "notifications", "recovery_followups",
  "review_requests", "staff_summons", "whatsapp_logs",
  // v2 leftovers. Present only in clinics migrated in from an old per-clinic project, copied
  // wholesale because discarding a clinic's data was never the migration's call to make.
  "team_chats", "labs", "lab_orders", "ortho_visits", "ortho_photos", "tickets", "conversations",
  "portal_reviews", "ai_treatment_plans", "patient_change_requests", "loyalty_ledger", "tasks",
  "transactions", "vital_signs",
]);

/**
 * Where the restore may write. Anything else is a bug in the caller, not a configuration choice.
 *
 * `users` is the one worth naming out loud. It holds `clinicRoles[clinicId]` and
 * `clinicPermissions[clinicId]` — who may sign in to this clinic and what they may do. This
 * system revoked access for twenty-four ghost accounts and made the permission checkboxes
 * enforceable for the first time; a restore that copied `users` back from an older snapshot would
 * hand every one of those accounts its key again, silently, as a side effect of recovering a
 * ledger. Access control is not clinic data and is not restored here, ever. If a disaster really
 * did destroy the role grants, that is a separate, deliberate, separately-reviewed repair.
 */
/**
 * Individual documents that must never be written, even though their collection is restorable.
 *
 * Collection-level policy is too coarse for `settings`, which is not a table but a bag of about
 * ten unrelated singletons — some of them the most dangerous documents in the clinic.
 */
export const DOCUMENT_DENY: Record<string, string> = {
  "settings/wapilot":
    "The legacy WhatsApp gateway credential, and a PLATFORM-WIDE one — the migration moved it to " +
    "clinic_secrets precisely because `settings` is readable by every clinic member and this " +
    "document sends as the clinic. It is absent from live in exactly the clinics the migration " +
    "cleaned, so an additive restore would put it back without any overwrite flag. Restoring one " +
    "tenant re-opens a hole that spans all of them.",
  "lab_counters/branches":
    "The transactional generator behind lab case codes. Restoring it rewinds every branch's " +
    "counter, and the next cases raised are stamped with codes already printed on orders and " +
    "written in marker on bags sitting at a lab right now. Two different patients' work under one " +
    "number is precisely the confusion lab tracking exists to prevent, and it surfaces weeks " +
    "later when a bag comes back. Same reasoning as settings/counters below.",
  "settings/counters":
    "The transactional generator behind patient file numbers. Restoring it rewinds the counter, " +
    "and the next patients registered are stamped with file numbers already printed on existing " +
    "records. Nothing checks fileId for uniqueness. Two patients sharing one clinical file number " +
    "surfaces days later and cannot be undone by re-running anything.",
};

/** Is this exact document refused, whatever its collection allows? */
export function documentDenied(collection: string, documentId: string): string | null {
  return DOCUMENT_DENY[`${collection}/${documentId}`] ?? null;
}

export function collectionVerdict(name: string): CollectionVerdict {
  if (!name || name.includes("/")) {
    return { mode: "never", reason: "Not a single collection name.", known: false };
  }
  if ((ROOT_COLLECTIONS as readonly string[]).includes(name)) {
    return {
      mode: "never",
      reason:
        name === "users"
          ? "Access control, not clinic data. Restoring it would re-grant revoked accounts, and " +
            "clinicRoles is keyed by EVERY clinic a person works at — writing the document back " +
            "while repairing one clinic would clobber their access at the others."
          : ROOT_BUT_CLINIC_LINKED[name]
            ? `A root collection holding ${ROOT_BUT_CLINIC_LINKED[name]}. Outside the clinic ` +
              `subtree, and restoring a credential from an old snapshot can resurrect one that ` +
              `has since been rotated.`
            : "A root collection, outside the clinic subtree. A per-clinic restore does not own it.",
      known: true,
    };
  }
  if (SIDE_EFFECTING[name]) {
    return { mode: "hold", reason: SIDE_EFFECTING[name], known: true };
  }
  return {
    mode: "restore",
    reason: "The clinic's own records.",
    known: KNOWN_CLINIC_COLLECTIONS.has(name),
  };
}

/**
 * Collections that other collections point at. Restored first.
 *
 * A ledger row carries `patientId`; a prescription carries `patientId`; a procedure carries
 * `serviceId`. Restore the ledger before the patients and there is a window — minutes, on a large
 * clinic — in which the clinic is live and showing payments against patients who do not exist yet.
 * Alphabetical order puts `ledger` before `patients` and `prescriptions` before `services`, so the
 * default ordering is close to the worst one available, and deterministically so.
 *
 * This does not make the restore atomic; nothing can. It makes the incoherent window as short as
 * the tool can make it, and puts it at the start rather than the end.
 */
export const RESTORE_FIRST = [
  "patients",
  "staff",
  "services",
  "inventory",
  "drugs",
  "ortho_cases",
  "settings",
] as const;

/** Parents first, then everything else alphabetically so a resumed run repeats the same order. */
export function restoreOrder(names: string[]): string[] {
  const rank = (relative: string) => {
    const i = (RESTORE_FIRST as readonly string[]).indexOf(relative.split("/")[0]);
    return i === -1 ? RESTORE_FIRST.length : i;
  };
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** This project's live database is literally named `default`, not `(default)`. */
export const LIVE_DATABASE = "default";

export type RequestCheck = { ok: true } | { ok: false; error: string };

/**
 * The guards that stand between a tired operator and a catastrophe. Every one of these is a
 * mistake that is easy to make at 2am and impossible to take back.
 */
export function checkRestoreRequest(input: {
  clinicId: string;
  sourceDatabase: string;
  targetDatabase: string;
}): RequestCheck {
  const clinicId = (input.clinicId ?? "").trim();
  const source = (input.sourceDatabase ?? "").trim();
  const target = (input.targetDatabase ?? "").trim();

  if (!clinicId) return { ok: false, error: "No --clinic given. A restore must name exactly one clinic." };
  // A slash makes a document id a multi-segment path, which climbs straight out of the tenant.
  if (clinicId.includes("/") || clinicId === "." || clinicId === "..") {
    return { ok: false, error: `Invalid --clinic "${clinicId}": a clinic id cannot contain a path.` };
  }
  if (!source) return { ok: false, error: "No --from given. Name the restored snapshot database." };
  if (!target) return { ok: false, error: "No --to given. The live database is named 'default'." };

  // Transposing --from and --to leaves the SNAPSHOT as the write target, and the read-only guard
  // follows whatever --from names, so it guards the live database instead. Every live document
  // absent from the snapshot — including the ones the incident corrupted — would be created inside
  // the backup. Run it the right way round afterwards and that corruption comes back as
  // "restored" data, laundered into legitimacy by the tool meant to undo it.
  //
  // Naming the flags does not prevent this; only refusing the value does. The live database is
  // never a source, because there is nothing to restore FROM the present.
  if (source === LIVE_DATABASE) {
    return {
      ok: false,
      error:
        `--from is "${LIVE_DATABASE}", which is the live database. A restore reads from a SNAPSHOT ` +
        `and writes to the live one; you have them the wrong way round, and running this would ` +
        `write into the backup.`,
    };
  }

  // Reading and writing the same database means the 'snapshot' is the live data: the copy would
  // be a no-op at best, and at worst it would resurrect documents inside the very database the
  // operator is trying to repair, with no snapshot left to try again from.
  if (source === target) {
    return {
      ok: false,
      error:
        `--from and --to are both "${source}". A restore copies OUT of a snapshot INTO the live ` +
        `database; they can never be the same one.`,
    };
  }

  return { ok: true };
}

/**
 * Are these two Firestore values the same?
 *
 * Used to tell "already restored" from "changed since the snapshot", which decides whether a
 * document is skipped silently or listed for a human. Getting it wrong in the lax direction
 * hides a real difference; getting it wrong in the strict direction fills the report with
 * thousands of documents that are actually identical, which is the same as having no report.
 *
 * Timestamps, GeoPoints and Bytes are class instances with an `isEqual` of their own — that is
 * what is called here. The alternative, walking into them as if they were maps, is a real bug in
 * this codebase already: `stripUndefined` in recycleBinStore exempts only Date and Timestamp, so
 * a GeoPoint passing through it is shredded into `{_latitude, _longitude}` and restored as
 * garbage. The prototype test below is the fix that generalises — recurse into plain maps and
 * nothing else — and is the same test `migration/engine.ts` uses for the same reason.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;

  const eq = (v: unknown) => (v as { isEqual?: (o: unknown) => boolean })?.isEqual;
  if (typeof eq(a) === "function" && typeof eq(b) === "function") {
    return Boolean(eq(a)!.call(a, b));
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }

  const plain = (v: unknown) =>
    typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;
  if (plain(a) && plain(b)) {
    const ma = a as Record<string, unknown>;
    const mb = b as Record<string, unknown>;
    const ka = Object.keys(ma);
    if (ka.length !== Object.keys(mb).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(mb, k) && sameValue(ma[k], mb[k]));
  }

  // Bytes arrive as Buffer/Uint8Array, which fall through every branch above and would compare
  // false forever — so a document holding one would be reported as differing on every run and the
  // restore would never converge.
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const va = new Uint8Array((a as ArrayBufferView).buffer, a.byteOffset, a.byteLength);
    const vb = new Uint8Array((b as ArrayBufferView).buffer, b.byteOffset, b.byteLength);
    return va.length === vb.length && va.every((byte, i) => byte === vb[i]);
  }

  // NaN is not equal to itself, and two documents both holding NaN in the same field are not a
  // difference anybody wants listed.
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);

  return false;
}

/**
 * A non-identifying handle for a document, so a row in the differs report can be placed without
 * naming a patient.
 *
 * This used to return the value of `name` / `patientName` / `title` — patient names, written into
 * a CSV that lands in the working directory during an incident, two lines below a comment
 * insisting that values never go in it. `.gitignore` covered neither the CSV nor the state file,
 * so one `git add -A` while recovering would have committed a patient list.
 *
 * What survives is the shape of the record and nothing about the person: which fields it has, and
 * whichever date it carries. That is enough to tell a routine appointment row from the odd one at
 * line 900, and the document path in the first column opens the real thing in one click for
 * anyone with a reason to see it.
 */
export function labelOf(data: Record<string, unknown> | undefined | null): string {
  if (!data) return "";
  const date = data.date;
  const when = typeof date === "string" && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : "";
  const fields = Object.keys(data).length;
  return when ? `${when}, ${fields} fields` : `${fields} fields`;
}

/** Whatever this document last recorded about when it changed. Best effort; blank is fine. */
export function whenOf(data: Record<string, unknown> | undefined | null): string {
  if (!data) return "";
  for (const key of ["updatedAt", "modifiedAt", "createdAt", "date", "at"]) {
    const v = data[key];
    if (!v) continue;
    if (typeof v === "string") return v.slice(0, 25);
    const maybe = v as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      try {
        return maybe.toDate().toISOString();
      } catch {
        /* a broken timestamp names nothing */
      }
    }
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "number") return new Date(v).toISOString();
  }
  return "";
}

/**
 * Which top-level keys differ between the snapshot and the live document.
 *
 * KEY NAMES ONLY, never values, and never nested. The differs report is a CSV that lands in the
 * working directory during an incident: it gets opened in a spreadsheet, mailed to somebody, and
 * forgotten about. These are medical records. A key name tells the operator whether a row is worth
 * their attention, which is all the report is for; the values are one console click away for
 * anyone who has a reason to see them.
 */
export function differingKeys(
  snapshot: Record<string, unknown> | undefined | null,
  live: Record<string, unknown> | undefined | null
): string[] {
  const a = snapshot || {};
  const b = live || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => !sameValue(a[k], b[k])).sort();
}

export type DocDecision =
  /** Not in the live database. Copy it in. */
  | { action: "create"; reason: string }
  /** In both, and different. Left alone unless the operator asked for overwrite. */
  | { action: "skip-differs"; reason: string }
  /** In both, identical. Nothing to do. */
  | { action: "identical"; reason: string }
  /** In both, different, and the operator asked for overwrite. */
  | { action: "overwrite"; reason: string };

/**
 * What to do about one document.
 *
 * The default is ADDITIVE: put back what is missing, touch nothing that is already there.
 *
 * That is the safe direction, and the reason is asymmetric. A restore happens after damage, and
 * the operator does not know precisely what was damaged — that is why they are running a restore
 * rather than a targeted repair. If the tool overwrites by default, every document the clinic
 * legitimately changed between the snapshot and now is silently reverted, and those changes are
 * gone for good: there is no snapshot of the present. If the tool only creates, the worst case is
 * that a damaged document survives and has to be dealt with by hand — recoverable, visible, and
 * reported in the summary rather than discovered months later in an audit.
 *
 * `--overwrite` exists because "the data was mangled, not deleted" is a real disaster shape. It
 * is a separate flag from `--apply` on purpose: the operator has to decide twice.
 */
export function decideDocument(input: {
  existsLive: boolean;
  identical: boolean;
  overwrite: boolean;
}): DocDecision {
  if (!input.existsLive) {
    return { action: "create", reason: "Missing from the live database." };
  }
  if (input.identical) {
    return { action: "identical", reason: "Already present and unchanged." };
  }
  if (input.overwrite) {
    return { action: "overwrite", reason: "Present and different; --overwrite was given." };
  }
  return {
    action: "skip-differs",
    reason:
      "Present and different. Left as it is — it may be a legitimate change made since the " +
      "snapshot, and reverting it would destroy the only copy. Re-run with --overwrite to replace.",
  };
}

/** What a restore cannot do, printed every run so nobody believes they are more recovered than they are. */
export const NOT_COVERED: string[] = [
  "Cloud Storage. Patient photographs, X-rays and clinic logos are files, not documents, and a " +
    "Firestore backup does not contain them. A restored patient record can point at an image that " +
    "no longer exists.",
  "Logins and permissions. users/{uid}.clinicRoles and .clinicPermissions live outside the clinic " +
    "subtree and are deliberately never touched. If the disaster removed staff access, this script " +
    "does not bring it back.",
  "The recycle bin. deleted_records is a root collection; things deliberately deleted stay deleted.",
  "Integrations. The WhatsApp gateway token, the Facebook page mapping and the lead queue live at " +
    "the root, not under the clinic, because the blanket member grant must never reach them. A " +
    "restored clinic comes back with its records and without its integrations — deliberately, " +
    "since re-writing a credential from an old snapshot can resurrect a rotated one.",
  "Anything written after the snapshot was taken. The snapshot is a photograph of one moment; " +
    "work done since exists only in the live database, which is why nothing is overwritten by default.",
];
