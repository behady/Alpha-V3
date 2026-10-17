/**
 * Renaming a member of staff, and carrying the new name into every record that copied the old one.
 *
 * Records do not look the name up; they keep a copy taken when they were written — `doctor` and
 * `doctorName` on a booking, `addedBy` on a payment, `modifiedBy` inside a status history. Renaming
 * only the staff row would leave every old booking, payment and report under the old name, and the
 * screens that still match a dentist by name (older rows carry no `doctorId`) would stop finding them.
 *
 * Two ways a copy is recognised, and both are needed:
 *
 *  1. ANCHORED BY ID. A field that holds this person's staff id or login uid (`doctorId`, `createdBy`,
 *     `userId`) names its sibling: `doctorId` → `doctor` and `doctorName`, `createdBy` →
 *     `createdByName`. The sibling is rewritten whatever it said, so a copy taken under an even
 *     older name is corrected too.
 *  2. BY THE NAME ITSELF, in person-shaped fields only. `addedBy`, `receivedBy` and `modifiedBy`
 *     were only ever names — there is no id beside them to anchor on. A value is rewritten only when
 *     it IS the old name (ignoring case, spacing and a "Dr." in front), and only under a key that
 *     holds a person. `patientName`, `serviceName` and free text are never touched, so a patient
 *     who happens to share the name keeps theirs.
 *
 * Pure: no Firestore. The route walks the clinic's collections and hands each document here.
 */

export type RenameTarget = {
  /** The name being replaced, as the staff row holds it now. */
  oldName: string;
  newName: string;
  /** The staff document id and the login uid, whichever exist. */
  ids: string[];
};

/** "Dr. ", "Dr ", "د. ", "د/", "دكتور " … in front of a name, kept as written when the name changes. */
const HONORIFIC = /^\s*(dr\.?\s*|doctor\s+|د\.\s*|د\/\s*|د\s+|دكتور[ةه]?\s+|دكتور[ةه]?\/\s*)/i;

function norm(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function splitHonorific(s: string): { prefix: string; core: string } {
  const m = s.match(HONORIFIC);
  if (!m) return { prefix: "", core: s.trim() };
  return { prefix: m[0], core: s.slice(m[0].length).trim() };
}

/** The renamed value, or null when `value` is not this person's old name. */
export function renamedValue(value: string, target: RenameTarget): string | null {
  const oldCore = norm(splitHonorific(target.oldName).core);
  if (!oldCore) return null;
  if (norm(value) === norm(target.oldName)) return target.newName.trim();
  const { prefix, core } = splitHonorific(value);
  if (norm(core) !== oldCore) return null;
  // "Dr. Norhan" stays a "Dr." — unless the new name already brings its own title.
  const newParts = splitHonorific(target.newName);
  return newParts.prefix ? target.newName.trim() : `${prefix}${newParts.core}`;
}

/**
 * Keys whose value is a person's name. `…By` covers addedBy, modifiedBy, receivedBy, collectedBy,
 * approvedBy and their `…ByName` twins; the rest are the name fields the app has used for staff.
 */
const PERSON_KEY =
  /^(doctor|dentist|staff|user|provider|author|assistant|actor|cashier|leadDoctor|assignedTo|assignee|treatingDentist)(Name)?$/i;
/** Case-sensitive on purpose: `addedBy` is a person, `lobby` is not. */
const BY_KEY = /[a-z]By(Name)?$/;

/** String arrays of staff names, e.g. a room's `dentists: ["Norhan", "Ramy"]`. */
const PERSON_LIST_KEY = /^(doctors|dentists|assistants|staffNames|doctorNames|dentistNames)$/i;

export function isPersonKey(key: string): boolean {
  return PERSON_KEY.test(key) || BY_KEY.test(key);
}

/** The keys an id field speaks for: `doctorId` → doctor, doctorName; `createdBy` → createdByName. */
function siblingsOf(key: string, nested: boolean): string[] {
  if (/^(id|uid|staffId|staffDocId)$/i.test(key)) {
    // A bare id only names its object's `name` inside a list or map entry. At the top of a
    // document `id` + `name` is the document's own subject (a patient, a service), not this person.
    const base = /^staff/i.test(key) ? ["staffName"] : [];
    return nested ? [...base, "name"] : base;
  }
  const m = key.match(/^(.*?)(Id|Uid|DocId)$/);
  if (m && m[1]) return [m[1], `${m[1]}Name`];
  if (/By$/.test(key)) return [`${key}Name`];
  return [];
}

type Walked = { value: unknown; changes: number };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  // Firestore Timestamps, GeoPoints and references are class instances; leave them be.
  return proto === Object.prototype || proto === null;
}

function walk(value: unknown, target: RenameTarget, ids: Set<string>, nested: boolean): Walked {
  if (Array.isArray(value)) {
    let changes = 0;
    let out: unknown[] | null = null;
    value.forEach((item, i) => {
      const r = walk(item, target, ids, true);
      if (r.changes) {
        out ??= value.slice();
        out[i] = r.value;
        changes += r.changes;
      }
    });
    return { value: out ?? value, changes };
  }
  if (!isPlainObject(value)) return { value, changes: 0 };

  let changes = 0;
  let out: Record<string, unknown> | null = null;
  const set = (k: string, v: unknown) => {
    out ??= { ...value };
    out[k] = v;
    changes++;
  };
  const newName = target.newName.trim();

  // 1. Anchored by id.
  const anchored = new Set<string>();
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string" || !ids.has(v)) continue;
    for (const sib of siblingsOf(k, nested)) {
      const cur = value[sib];
      if (typeof cur !== "string" || ids.has(cur)) continue;
      anchored.add(sib);
      // Keep a title the record wrote ("Dr. Norhan") when the new name brings none.
      const next = renamedValue(cur, target) ?? newName;
      if (cur !== next) set(sib, next);
    }
  }

  // 2. By the name, under person keys; then recurse.
  for (const [k, v] of Object.entries(value)) {
    if (anchored.has(k)) continue;
    if (typeof v === "string") {
      if (!isPersonKey(k)) continue;
      const next = renamedValue(v, target);
      if (next !== null && next !== v) set(k, next);
      continue;
    }
    if (Array.isArray(v) && PERSON_LIST_KEY.test(k) && v.every((x) => typeof x === "string")) {
      let hit = false;
      const list = (v as string[]).map((x) => {
        const next = renamedValue(x, target);
        if (next !== null && next !== x) {
          hit = true;
          return next;
        }
        return x;
      });
      if (hit) set(k, list);
      continue;
    }
    if (v && typeof v === "object") {
      const r = walk(v, target, ids, true);
      if (r.changes) {
        out ??= { ...value };
        out[k] = r.value;
        changes += r.changes;
      }
    }
  }
  return { value: out ?? value, changes };
}

/**
 * The top-level fields of one document that change, with their new values — empty when the
 * document never mentions this person. Whole top-level fields are returned so an array (a status
 * history) is written back entire; Firestore cannot address one entry inside it.
 */
export function renameInDocument(
  data: Record<string, unknown>,
  target: RenameTarget
): { patch: Record<string, unknown>; changes: number } {
  const ids = new Set(target.ids.filter((x) => typeof x === "string" && x.trim()));
  const r = walk(data, target, ids, false);
  if (!r.changes) return { patch: {}, changes: 0 };
  const next = r.value as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(next)) {
    if (next[k] !== data[k]) patch[k] = next[k];
  }
  return { patch, changes: r.changes };
}

/**
 * Collections that never hold a staff name worth correcting: raw debug captures, counters, cost
 * tallies, read markers. Skipping them keeps the rename to the records people actually read.
 */
export const RENAME_SKIP_COLLECTIONS = new Set([
  "ai_debug",
  "ai_usage",
  "ai_usage_log",
  "whatsapp_inbound_debug",
  "whatsapp_seen",
  "whatsapp_cost",
  "tour_events",
  "lab_counters",
  "alert_marks",
]);

export const STAFF_NAME_MAX = 80;

/** A usable new name, or the reason it is not. */
export function validateStaffName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Name is required" };
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Name is required" };
  if (name.length > STAFF_NAME_MAX) return { ok: false, error: `Name is longer than ${STAFF_NAME_MAX} characters` };
  return { ok: true, name };
}
