/**
 * Copy ONE clinic's documents out of a restored Firestore snapshot and back into the live
 * database, touching no other clinic.
 *
 *   node scripts/restore-clinic.mjs --clinic <id> --from <snapshot-db>              # dry run
 *   node scripts/restore-clinic.mjs --clinic <id> --from <snapshot-db> --apply --confirm <id>
 *
 * WHAT THIS IS FOR
 *
 * A Firestore restore in Google Cloud never overwrites the live database — it creates a NEW one
 * beside it, frozen at the chosen moment. Every clinic keeps running throughout. Recovery is then
 * a copy from that snapshot into `default`, and because everything a clinic owns lives under
 * `clinics/{clinicId}/`, that copy can be confined to one tenant. docs/runbooks/backups.md called
 * this "the copy-back tool", and said it did not exist. This is it.
 *
 * WHAT IT WILL NOT DO
 *
 * It does not overwrite. By default a document already in the live database is left exactly as it
 * is, even when it differs from the snapshot. That asymmetry is deliberate: a restore happens
 * after damage nobody has fully mapped, and there is no snapshot of the present. Reverting a
 * document the clinic legitimately changed since would destroy the only copy of that change,
 * silently. Putting back only what is missing has a worst case of "a damaged document survived and
 * is listed in the report" — visible and recoverable. `--overwrite` exists for the mangled-not-
 * deleted case and is a second flag on purpose.
 *
 * It never touches `users`. That document holds clinicRoles and clinicPermissions — who may sign
 * in and what they may do. Twenty-four ghost accounts had their access revoked here; restoring
 * `users` from an older snapshot would hand every one of them its key back as a side effect of
 * recovering a ledger.
 *
 * It holds back collections whose restoration DOES something rather than records something. Chief
 * among them `sms_outbox`: the queue worker claims anything still queued and nothing expires a
 * message, so a restored week-old queue re-sends every reminder that was in flight, at cost, to
 * patients whose appointments already happened. Held unless named with --include.
 *
 * The policy lives in src/lib/restorePlan.ts and is unit-tested. This file is the I/O and holds
 * no policy of its own.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { DocumentReference, getFirestore } from "firebase-admin/firestore";
import { sourceDb } from "../src/lib/migration/sourceApp.ts";
import {
  NOT_COVERED,
  checkRestoreRequest,
  collectionVerdict,
  decideDocument,
  differingKeys,
  restoreOrder,
  documentDenied,
  labelOf,
  sameValue,
  whenOf,
} from "../src/lib/restorePlan.ts";

const PAGE_SIZE = 200;
/** listCollections() is one round trip per document, so fan them out rather than serialise. */
const SUBCOLLECTION_PROBE_CONCURRENCY = 25;

const USAGE = `
  usage:
    node scripts/restore-clinic.mjs --clinic <id> --from <snapshot-db>
    node scripts/restore-clinic.mjs --clinic <id> --from <snapshot-db> --apply --confirm <id>

    --clinic <id>       the ONE clinic to restore. Required.
    --from <db>         the database the backup was restored into. Required.
    --to <db>           the live database. Defaults to "default", which is this project's.
    --apply             write. Without it, nothing is written and you get the plan.
    --confirm <id>      required with --apply, and must match --clinic.
    --overwrite-list <csv>  replace only the documents named in this file. Run without --apply
                            first, read the differs CSV it writes, delete the rows you do NOT
                            want replaced, and feed it back. This is the one to use.
    --overwrite-all     replace every document that differs. Asks again, out loud. Blunt.
    --include <name>    restore one of the held-back collections. Repeatable.
    --only <name>       restore only these collections. Repeatable.
    --state <file>      move the progress file. Progress is saved either way; re-run the same
                        command to continue after an interruption.
    --no-deep           skip the search for nested subcollections. Faster, and can miss data.
    --out <dir>         where the CSV reports go. Defaults to the working directory.
`;

const args = process.argv.slice(2);

/**
 * Every flag this script accepts, and whether it takes a value.
 *
 * An unrecognised flag used to be ignored in silence, which is how a documented-but-renamed flag
 * becomes a silent no-op: `--apply --confirm X --overwrite` ran additively, printed `Done.`, and
 * exited 0, and the operator concluded the mangled rows had been replaced. A prompt that fails to
 * appear is not an event anybody notices.
 */
const FLAGS = {
  "--clinic": "value", "--from": "value", "--to": "value", "--confirm": "value",
  "--overwrite-list": "value", "--include": "value", "--only": "value",
  "--state": "value", "--out": "value",
  "--apply": "bare", "--overwrite-all": "bare", "--create-clinic-doc": "bare", "--no-deep": "bare",
};
const NEAREST = { "--overwrite": "--overwrite-list <csv>", "--dry-run": "nothing — a dry run is the default", "--force": "--apply" };

function parseArgs() {
  const bad = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) continue;
    const kind = FLAGS[token];
    if (!kind) {
      bad.push(`  I do not know the flag "${token}".${NEAREST[token] ? ` Did you mean ${NEAREST[token]}?` : ""}`);
      continue;
    }
    // A value that is itself a flag means the value was forgotten. `--only --apply` used to set
    // ONLY to "--apply", which matched no collection, restored nothing and exited 0.
    if (kind === "value") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) bad.push(`  ${token} needs a value, and "${next ?? "nothing"}" is not one.`);
      else i += 1;
    }
  }
  if (bad.length) {
    console.error(`\n  REFUSED:\n${bad.join("\n")}\n${USAGE}`);
    process.exit(2);
  }
}

const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const v = args[i + 1];
  return !v || v.startsWith("--") ? null : v;
};
const allValuesOf = (flag) => {
  const out = [];
  args.forEach((a, i) => {
    const v = args[i + 1];
    if (a === flag && v && !v.startsWith("--")) out.push(v);
  });
  return out;
};

const CLINIC = valueOf("--clinic");
const FROM = valueOf("--from");
const TO = valueOf("--to") || "default";
const APPLY = has("--apply");
const OVERWRITE_ALL = has("--overwrite-all");
const CREATE_CLINIC_DOC = has("--create-clinic-doc");
/** What this run was asked to do. A resumed run must have been asked the same thing. */
/** The invocation, rebuilt, so a printed "run this" line is never wider than what was previewed. */
function commandLine(extra = []) {
  const parts = ["npx tsx scripts/restore-clinic.mjs", "--clinic", CLINIC, "--from", FROM];
  if (TO !== "default") parts.push("--to", TO);
  for (const v of allValuesOf("--only")) parts.push("--only", v);
  for (const v of allValuesOf("--include")) parts.push("--include", v);
  if (has("--no-deep")) parts.push("--no-deep");
  if (has("--create-clinic-doc")) parts.push("--create-clinic-doc");
  if (valueOf("--out")) parts.push("--out", valueOf("--out"));
  if (valueOf("--state")) parts.push("--state", valueOf("--state"));
  return [...parts, ...extra].join(" ");
}

const RUN_SHAPE = JSON.stringify({
  only: [...allValuesOf("--only")].sort(),
  include: [...allValuesOf("--include")].sort(),
  overwriteAll: has("--overwrite-all"),
  overwriteList: valueOf("--overwrite-list") || null,
  deep: !has("--no-deep"),
});
const OVERWRITE_LIST = valueOf("--overwrite-list");
const CONFIRM = valueOf("--confirm");
const INCLUDE = new Set(allValuesOf("--include"));
const ONLY = new Set(allValuesOf("--only"));
const DEEP = !has("--no-deep");
// State is on by ALWAYS, not on request. A restore that dies at document 40,000 and cannot be
// resumed because nobody thought to pass a flag is the worst version of this tool. --state only
// moves the file somewhere else.
const safeName = (v) => String(v || "unknown").replace(/[^\w.-]/g, "_");
// Named for the clinic AND the snapshot, so two recoveries in the same week cannot resume each
// other's progress by sharing a filename.
const STATE_FILE =
  valueOf("--state") ||
  path.join(valueOf("--out") || process.cwd(), `restore-${safeName(valueOf("--clinic"))}-${safeName(valueOf("--from"))}.state.json`);
const OUT_DIR = valueOf("--out") || process.cwd();

function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local — run this from the project root.");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function credentials() {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "")
    .replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").trim();
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must all be set in .env.local."
    );
  }
  return { projectId, clientEmail, privateKey };
}

/** The live database. Unguarded — this is the one the restore is allowed to write. */
function targetDb(creds) {
  if (!getApps().some((a) => a.name === "[DEFAULT]")) {
    initializeApp({ credential: cert(creds) });
  }
  const db = getFirestore(getApps().find((a) => a.name === "[DEFAULT]"), TO);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    /* already used; harmless */
  }
  return db;
}

/**
 * The snapshot. Opened through the migration's read-only proxy, which throws on set/update/delete/
 * batch/bulkWriter and follows derived references so it cannot be sidestepped one level deeper.
 * A restore that wrote to the snapshot would destroy the only known-good copy of the data while
 * trying to recover it.
 */
function snapshotDb(creds) {
  return sourceDb({ ...creds, storageBucket: "", databaseId: FROM });
}

const rl = () => readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(question) {
  const face = rl();
  return new Promise((resolve) => face.question(question, (a) => { face.close(); resolve(a.trim()); }));
}

/**
 * Re-point any stored DocumentReference at the database being written to.
 *
 * A DocumentReference is not a string: it carries the Firestore instance it was read from. Copied
 * verbatim out of the snapshot, it would keep naming the snapshot database — which is deleted once
 * the recovery is confirmed, leaving a reference into nothing.
 *
 * Nothing this app writes today stores one; the migration codec exists because *v2* data did, so a
 * clinic migrated in from an old per-clinic project can be carrying them. The path is identical in
 * both databases here — same project, same layout — so only the handle changes.
 *
 * The plain-map test is the point: Timestamp, GeoPoint and Bytes are class instances that must
 * pass through whole. Recursing into them turns a GeoPoint into `{_latitude, _longitude}` and
 * restores it as garbage.
 */
function rebind(value, db) {
  if (value instanceof DocumentReference) return db.doc(value.path);
  if (Array.isArray(value)) return value.map((v) => rebind(v, db));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = rebind(v, db);
    return out;
  }
  return value;
}

/**
 * Everything this clinic deleted ON PURPOSE, as `collection/documentId`.
 *
 * "Missing from the live database" is what this tool treats as "destroyed by the incident". It
 * equally means "somebody deleted it, and meant to". The sharp case is an erasure request: a
 * patient asks to be erased on Monday, the record and its bin entry are purged, the storage
 * objects go. The incident is on Wednesday, the snapshot is from Sunday. Without this, Thursday's
 * restore finds that patient's record, notes, ledger rows, prescriptions, plans and media all
 * "missing" and recreates every one — while `deleted_records_history`, which nothing ever deletes,
 * goes on asserting they were purged. The clinic ends up holding identifiable records it certified
 * as erased, with no bin entry and no signal, and the run exits 0.
 *
 * `deleted_records_history` is the right source precisely because it is permanent: retention
 * removes copies of data, never the fact that a deletion happened.
 */
async function deliberatelyDeleted(dst, clinicId) {
  const keys = new Set();
  const snap = await dst.collection("deleted_records_history").where("clinicId", "==", clinicId).get();
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (d.collection && d.documentId) keys.add(`${d.collection}/${d.documentId}`);
  }
  return keys;
}

/** Every collection under the clinic, including any nested beneath a document. */
async function discoverCollections(src, clinicId) {
  const roots = await src.doc(`clinics/${clinicId}`).listCollections();
  const found = roots.map((c) => c.path.slice(`clinics/${clinicId}/`.length));
  if (!DEEP) return { paths: found, nested: [], probed: 0 };

  // A document deleted but whose subcollection survived is a "missing document"; listDocuments()
  // returns it and .get() on a collection does not. Missing it would silently drop the whole
  // subtree beneath it, which is exactly the data a restore is for.
  const nested = [];
  let probed = 0;
  const queue = [...found];
  while (queue.length) {
    const relative = queue.shift();
    const docs = await src.collection(`clinics/${clinicId}/${relative}`).listDocuments();
    for (let i = 0; i < docs.length; i += SUBCOLLECTION_PROBE_CONCURRENCY) {
      const slice = docs.slice(i, i + SUBCOLLECTION_PROBE_CONCURRENCY);
      const results = await Promise.all(slice.map((d) => d.listCollections()));
      probed += slice.length;
      for (const cols of results) {
        for (const col of cols) {
          const rel = col.path.slice(`clinics/${clinicId}/`.length);
          nested.push(rel);
          queue.push(rel);
        }
      }
    }
  }
  return { paths: [...found, ...nested], nested, probed };
}

function loadState() {
  if (!STATE_FILE || !fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    throw new Error(`--state file ${STATE_FILE} exists but is not readable JSON. Delete it to start over.`);
  }
}

/**
 * Progress is recorded by runs that WRITE, and only by them.
 *
 * A dry run used to save state too, which turned the documented sequence — dry run, read the plan,
 * then apply — into a trap: the apply found every collection in `completed`, skipped all of them,
 * and printed `read 0, created 0` with exit 0. The summary of a no-op is indistinguishable from
 * the summary of a clinic that was already whole, so the operator would have closed the incident.
 */
function saveState(state) {
  if (!APPLY) return;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  parseArgs();

  // Flags before credentials. A missing --clinic is the operator's typo and must be reported as
  // one; making them fix a .env.local problem first, only to be told the command was wrong anyway,
  // is how a 2am recovery turns into an hour of yak-shaving.
  const guard = checkRestoreRequest({ clinicId: CLINIC, sourceDatabase: FROM, targetDatabase: TO });
  if (!guard.ok) {
    console.error(`\n  REFUSED: ${guard.error}\n${USAGE}`);
    process.exit(2);
  }

  // Releasing a held collection and overwriting it are contradictory instructions. The hold exists
  // because restoring these DOES something; overwrite is worse than restore, not milder. An
  // sms_outbox row that was queued at snapshot time and is `sent` now DIFFERS — so an overwrite
  // rewrites status back to `queued` and attempts back to 0, and the worker re-sends messages that
  // were already delivered.
  const releasedAndOverwritten = [...INCLUDE].filter(() => OVERWRITE_ALL);
  if (releasedAndOverwritten.length) {
    console.error(
      `\n  REFUSED: --overwrite-all cannot be combined with --include.\n` +
      `  Held collections are held because restoring them makes something happen. Overwriting one\n` +
      `  does not put an old message back — it un-sends a recent one, and the queue worker sends it\n` +
      `  again. Restore them additively or not at all.\n`
    );
    process.exit(2);
  }

  if (OVERWRITE_ALL && OVERWRITE_LIST) {
    console.error(`\n  REFUSED: --overwrite-all and --overwrite-list contradict each other. Pick one.\n`);
    process.exit(2);
  }

  // Read the approval list before anything else touches the network. An operator who mistyped the
  // filename should be told so in the first second, not after an hour of reading.
  let approved = null;
  if (OVERWRITE_LIST) {
    if (!fs.existsSync(OVERWRITE_LIST)) {
      console.error(`\n  REFUSED: --overwrite-list ${OVERWRITE_LIST} does not exist.\n`);
      process.exit(2);
    }
    const rows = fs.readFileSync(OVERWRITE_LIST, "utf8").split(/\r?\n/).slice(1);
    approved = new Map();
    for (const line of rows) {
      const cells = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
      if (!cells[0]) continue;
      // Column 5 is liveUpdatedAt as it stood when the dry run wrote this file. Kept so the
      // overwrite can tell an approval that is still true from one that has been overtaken.
      approved.set(cells[0], cells[4] || "");
    }
    // An empty approval list means "replace nothing", which is what the operator gets by not
    // passing the flag. Far more likely they deleted the wrong rows or saved the wrong file.
    if (approved.size === 0) {
      console.error(`\n  REFUSED: ${OVERWRITE_LIST} names no documents. Nothing to overwrite.\n`);
      process.exit(2);
    }
    // Every path must be inside this clinic. A hand-edited CSV is operator input like any other.
    const stray = [...approved.keys()].filter((p0) => !p0.startsWith(`clinics/${CLINIC}/`));
    if (stray.length) {
      console.error(
        `\n  REFUSED: ${OVERWRITE_LIST} names ${stray.length} document(s) outside clinics/${CLINIC}/.\n` +
        `  First: ${stray[0]}\n`
      );
      process.exit(2);
    }
  }

  loadEnvLocal();
  const creds = credentials();
  const src = snapshotDb(creds);
  const dst = targetDb(creds);

  // Prove both databases are reachable and that the clinic exists in the snapshot BEFORE printing
  // anything that looks like a plan. A typo'd database name must fail here, not after an hour.
  const srcClinic = await src.doc(`clinics/${CLINIC}`).get().catch((e) => {
    throw new Error(`Cannot read the snapshot database "${FROM}": ${e.message}`);
  });
  const dstClinic = await dst.doc(`clinics/${CLINIC}`).get().catch((e) => {
    throw new Error(`Cannot read the live database "${TO}": ${e.message}`);
  });
  if (!srcClinic.exists) {
    console.error(
      `\n  REFUSED: clinic "${CLINIC}" does not exist in the snapshot database "${FROM}".\n` +
      `  Check the clinic id and that "${FROM}" is the database the backup was restored into.\n`
    );
    process.exit(2);
  }

  console.log(`\n  Restoring clinic  ${CLINIC}`);
  console.log(`  from snapshot     ${FROM}`);
  console.log(`  into              ${TO}${TO === "default" ? " (the live database)" : ""}`);
  if (TO !== "default") {
    console.log(`\n  NOTE: this project's live database is named "default". You have named "${TO}".`);
    console.log(`  That is fine for a rehearsal. It is not a real restore.`);
  }
  console.log(`  clinic name       ${srcClinic.data()?.name || "(unnamed)"}`);
  console.log(
    `  live clinic doc   ${dstClinic.exists
      ? "present (never touched)"
      : CREATE_CLINIC_DOC ? "MISSING — will be recreated (--create-clinic-doc)" : "MISSING — NOT restored"}`
  );
  const modeLabel = !APPLY
    ? "dry run (nothing is written)"
    : OVERWRITE_ALL
      ? "APPLY + OVERWRITE EVERYTHING THAT DIFFERS"
      : approved
        ? `APPLY + overwrite the ${approved.size} document(s) listed in ${OVERWRITE_LIST}`
        : "APPLY (adds what is missing; changes nothing that is there)";
  console.log(`  mode              ${modeLabel}\n`);

  const resumed = loadState();
  // The identity is not just which databases: it is what the run was ASKED to do. A state file
  // from a full restore would otherwise let `--only ledger --overwrite-all` find every collection
  // already "completed" and silently do nothing.
  if (resumed && (resumed.clinicId !== CLINIC || resumed.from !== FROM || resumed.to !== TO
                  || (resumed.shape || RUN_SHAPE) !== RUN_SHAPE)) {
    console.error(
      `\n  REFUSED: ${STATE_FILE} was written for clinic ${resumed.clinicId} ` +
      `(${resumed.from} -> ${resumed.to}).\n  Refusing to resume it for this one. Move it aside or ` +
      `pass --state <another file>.\n`
    );
    process.exit(2);
  }

  // Probing every document for nested subcollections is one round trip per document and can take
  // many minutes on a large clinic. A resumed run already knows what is there; re-walking it would
  // punish the operator for the crash.
  let paths;
  if (resumed?.discoveredPaths?.length) {
    paths = resumed.discoveredPaths;
    console.log(`  resuming: ${paths.length} collections already discovered by the earlier run\n`);
  } else {
    const found = await discoverCollections(src, CLINIC);
    paths = found.paths;
    console.log(
      DEEP
        ? `  probed ${found.probed} documents for nested collections; found ${found.nested.length}\n`
        : `  --no-deep: nested subcollections were NOT looked for and will NOT be restored\n`
    );
  }

  const plan = [];
  for (const relative of restoreOrder(paths)) {
    const rootName = relative.split("/")[0];
    const verdict = collectionVerdict(rootName);
    const released = verdict.mode === "hold" && INCLUDE.has(rootName);
    const excluded = ONLY.size > 0 && !ONLY.has(rootName);
    const count = (await src.collection(`clinics/${CLINIC}/${relative}`).count().get()).data().count;
    plan.push({
      relative,
      rootName,
      count,
      verdict,
      action:
        excluded ? "skipped (--only)"
        : verdict.mode === "never" ? "never"
        : verdict.mode === "hold" ? (released ? "restore (--include)" : "held")
        : "restore",
    });
  }

  // A typo in --only or --include silently restored NOTHING and exited 0: every collection became
  // "skipped", the loop body never ran, and the summary read `created 0` like a clean result. An
  // operator mid-incident would reasonably read that as "there was nothing to put back".
  const rootNames = new Set(plan.map((p) => p.rootName));
  for (const [flag, names] of [["--only", ONLY], ["--include", INCLUDE]]) {
    const unmatched = [...names].filter((n) => !rootNames.has(n));
    if (unmatched.length) {
      console.error(
        `\n  REFUSED: ${flag} ${unmatched.join(", ")} — this clinic has no such collection.\n` +
        `  It has: ${[...rootNames].sort().join(", ")}\n`
      );
      process.exit(2);
    }
  }

  const width = Math.max(...plan.map((p) => p.relative.length), 20);
  for (const p of plan) {
    const flag = p.verdict.known ? " " : "?";
    console.log(`  ${flag} ${p.relative.padEnd(width)}  ${String(p.count).padStart(7)}  ${p.action}`);
  }
  const unknown = plan.filter((p) => !p.verdict.known);
  if (unknown.length) {
    console.log(`\n  ? = no code in this repo reads this collection. It will still be restored; worth a look.`);
  }
  const held = plan.filter((p) => p.action === "held");
  if (held.length) {
    console.log(`\n  HELD BACK — restoring these makes something happen, not just appear:`);
    for (const p of held) console.log(`    ${p.rootName}: ${p.verdict.reason}\n      release with --include ${p.rootName}`);
  }

  console.log(`\n  This restore does NOT cover:`);
  for (const line of NOT_COVERED) console.log(`    - ${line}`);

  const willRestore = plan.filter((p) => p.action === "restore" || p.action === "restore (--include)");
  const totalDocs = willRestore.reduce((n, p) => n + p.count, 0);
  console.log(`\n  ${willRestore.length} collections, ${totalDocs} documents in the snapshot.\n`);

  // The dry run takes the SAME read path and makes the SAME decisions as the real one and simply
  // does not write. A preview that only counted rows would be a guess, and — more to the point —
  // it is the dry run that produces the differs CSV that --overwrite-list is built from. A preview
  // you cannot act on is a preview nobody reads twice.
  if (APPLY && CONFIRM !== CLINIC) {
    console.error(
      `\n  REFUSED: --apply needs --confirm <clinicId> matching --clinic.\n` +
      `  Type it out: --confirm ${CLINIC}\n`
    );
    process.exit(2);
  }
  if (APPLY && !dstClinic.exists && CREATE_CLINIC_DOC) {
    const d = srcClinic.data() || {};
    console.log(`\n  --create-clinic-doc will write clinics/${CLINIC} from the snapshot:`);
    for (const key of ["ownerId", "status", "expiresAt", "subscriptionTier", "billingCycle", "amountPaid"]) {
      if (d[key] !== undefined) console.log(`    ${key.padEnd(18)} ${whenOf({ [key]: d[key] }) || String(d[key])}`);
    }
    console.log(
      `\n  This reattaches the whole clinic: everyone still holding a role for it regains access,\n` +
      `  the owner named above can grant themselves Admin through self-heal, and the status and\n` +
      `  expiry above replace whatever the platform decided since. If this clinic was suspended or\n` +
      `  detached on purpose, stop here.`
    );
    const answer = await ask(`  Type CREATE to write it: `);
    if (answer !== "CREATE") {
      console.error(`\n  Stopped. Nothing was written.\n`);
      process.exit(2);
    }
  }

  if (APPLY && OVERWRITE_ALL) {
    const answer = await ask(
      `\n  --overwrite-all REPLACES every live document that differs from the snapshot.\n` +
      `  Anything this clinic changed since the snapshot is lost, and there is no snapshot of the\n` +
      `  present to get it back from. --overwrite-list is the scoped version: run without --apply,\n` +
      `  read the differs CSV, delete the rows you do not want, and feed it back.\n` +
      `  Type OVERWRITE to continue: `
    );
    if (answer !== "OVERWRITE") {
      console.error(`\n  Stopped. Nothing was written.\n`);
      process.exit(2);
    }
  }

  // Already validated against this restore above.
  const state = resumed || {
    clinicId: CLINIC, from: FROM, to: TO, shape: RUN_SHAPE,
    discoveredPaths: paths, completed: [], cursor: null, stats: {},
  };

  const stats = { created: 0, identical: 0, skippedDiffers: 0, overwritten: 0, read: 0, failed: 0, appearedLive: 0, deniedDocs: 0, deliberate: 0 };
  const deniedList = [];
  const movedOn = [];
  const resurrected = [];

  // Read once, before anything is written. A failure here must stop the run rather than proceed
  // without the shield — a restore that quietly loses this protection is worse than one that
  // refuses to start.
  const deletedOnPurpose = await deliberatelyDeleted(dst, CLINIC);
  if (deletedOnPurpose.size) {
    console.log(`\n  ${deletedOnPurpose.size} record(s) were deleted deliberately and will NOT be recreated.`);
  }

  /**
   * Is this approval still about the document in front of us?
   *
   * The CSV recorded what the live document looked like when the operator read it. If that has
   * changed since, the approval was for a version that no longer exists, and the safe reading of
   * "yes, replace this" is not "replace whatever is there now".
   */
  function approvalStillHolds(docPath, liveDoc) {
    if (!approved.has(docPath)) return false;
    const approvedAt = approved.get(docPath);
    const nowAt = whenOf(liveDoc.data());
    if (approvedAt && nowAt && approvedAt !== nowAt) {
      movedOn.push(`${docPath} (approved at ${approvedAt}, now ${nowAt})`);
      return false;
    }
    return true;
  }

  // The clinic document — `clinics/{clinicId}` — is the tenant root, and writing it is the single
  // most consequential thing this script can do. It is behind its own flag, its own typed
  // confirmation, and a printed diff, because it is not really a data restore at all:
  //
  //   - Re-creating it REATTACHES THE WHOLE SUBTREE. Deleting this one document is how a
  //     superadmin detaches a clinic while leaving its records intact, which is why the recycle
  //     bin refuses to hold it: putting it back instantly re-grants access to everyone still
  //     carrying a role for that clinic.
  //   - It carries `ownerId`, and the self-heal endpoint grants Admin to whoever matches that
  //     field with no role check by design. Rewinding it after an ownership transfer hands the
  //     previous owner a one-request route back to Admin on a clinic that is no longer theirs.
  //   - It carries `status`, `expiresAt`, `subscriptionTier` and the billing fields. A clinic
  //     suspended FOR ABUSE comes back Active. Suspension is an access decision, not a billing one.
  //
  // It is never overwritten, at any flag. The only case is creating one that is absent — and even
  // that is a decision somebody makes, not a side effect of recovering a ledger.
  const differs = [];
  const failures = [];

  // Both reports are opened NOW and appended to as the run goes, rather than built in memory and
  // written at the end. An interrupted apply — Ctrl-C, a closed laptop, an OOM — used to leave the
  // clinic half-restored with no record of what was left alone and no record of what failed, which
  // is the worst possible state to hand back to a tired operator.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const differsFile = path.join(OUT_DIR, `restore-${CLINIC}-differs-${stamp}.csv`);
  const failuresFile = path.join(OUT_DIR, `restore-${CLINIC}-failures-${stamp}.csv`);
  fs.writeFileSync(differsFile, "path,collection,id,label,liveUpdatedAt,snapshotUpdatedAt,differingFields\n");
  fs.writeFileSync(failuresFile, "path,error\n");
  const appendDiffer = (d) =>
    fs.appendFileSync(differsFile,
      [d.path, d.collection, d.id, d.label, d.liveUpdatedAt, d.snapshotUpdatedAt, d.differingFields]
        .map(csvCell).join(",") + "\n");
  const appendFailure = (f) => fs.appendFileSync(failuresFile, `${csvCell(f.path)},${csvCell(f.message)}\n`);

  const writer = APPLY ? dst.bulkWriter() : null;
  if (writer) writer.onWriteError((error) => {
    // ALREADY_EXISTS. The clinic is live throughout a restore, so a document can be created by
    // somebody at a keyboard between this run reading "missing" and writing it. create() losing
    // that race is the correct outcome — the live write wins — and it is not a failure. Counting
    // it as one would fill the failure report with the one case that needs no action.
    if (error.code === 6) {
      stats.appearedLive += 1;
      return false;
    }
    const retryable = [4, 8, 10, 13, 14].includes(error.code);
    if (retryable && error.failedAttempts < 5) return true;
    failures.push({ path: error.documentRef.path, message: error.message });
    appendFailure({ path: error.documentRef.path, message: error.message });
    stats.failed += 1;
    return false;
  });

  try {
    if (!dstClinic.exists && CREATE_CLINIC_DOC) {
      if (writer) writer.create(dst.doc(`clinics/${CLINIC}`), rebind(srcClinic.data(), dst));
      if (writer) await writer.flush();
      console.log(`  clinics/${CLINIC}: clinic document recreated`);
    }

    for (const p of willRestore) {
      if (state.completed.includes(p.relative)) {
        console.log(`  ${p.relative}: already done in an earlier run, skipping`);
        continue;
      }
      const failedBefore = stats.failed;
      let cursor = state.cursor && state.cursor.collection === p.relative ? state.cursor.after : null;
      for (;;) {
        let q = src.collection(`clinics/${CLINIC}/${p.relative}`).orderBy("__name__").limit(PAGE_SIZE);
        if (cursor) q = q.startAfter(cursor);
        const page = await q.get();
        if (page.empty) break;

        const targets = page.docs.map((d) => dst.doc(`clinics/${CLINIC}/${p.relative}/${d.id}`));
        const live = await dst.getAll(...targets);

        page.docs.forEach((doc, i) => {
          stats.read += 1;
          const liveDoc = live[i];
          const path0 = targets[i].path;

          const denied = documentDenied(p.relative, doc.id);
          if (denied) {
            stats.deniedDocs += 1;
            deniedList.push({ path: path0, reason: denied });
            return;
          }

          // Deleted on purpose, so not missing — gone. Skipped whether or not it would have been
          // a create, because an --overwrite-list is no more entitled to undo an erasure.
          if (deletedOnPurpose.has(`${p.relative}/${doc.id}`)) {
            stats.deliberate += 1;
            resurrected.push(path0);
            return;
          }

          // Rebind BEFORE comparing, not after. A DocumentReference carries the Firestore instance
          // it was read from, and isEqual compares that as well as the path — so a v2-migrated
          // clinic, the kind most likely to need this tool, would report every reference-bearing
          // document as "differs" on every run. The operator would see thousands of differences,
          // conclude the corruption was widespread, and reach for --overwrite-all.
          const fromSnapshot = rebind(doc.data(), dst);
          const decision = decideDocument({
            existsLive: liveDoc.exists,
            identical: liveDoc.exists && sameValue(fromSnapshot, liveDoc.data()),
            // An approval list is scoped to the paths a human read and kept — AND to the state
            // those documents were in when they read them. An approval is a decision about a
            // specific version: between the dry run at 01:40 and the overwrite at 02:10, reception
            // can update that patient's allergies, and replacing it then destroys an edit that
            // appears in no report and is counted as a successful overwrite.
            overwrite: OVERWRITE_ALL || (approved !== null && approvalStillHolds(path0, liveDoc)),
          });
          // Cheap invariant, checked at the moment of writing rather than where the path is built.
          // Every target is assembled from a path discovered UNDER this clinic, so this can only
          // fail if someone later refactors that assembly — and then it crashes instead of writing
          // into another tenant.
          if (!path0.startsWith(`clinics/${CLINIC}/`)) {
            throw new Error(`Refusing to write outside the clinic: ${path0}`);
          }
          if (decision.action === "create") {
            if (writer) writer.create(targets[i], fromSnapshot);
            stats.created += 1;
          } else if (decision.action === "overwrite") {
            if (writer) writer.set(targets[i], fromSnapshot);
            stats.overwritten += 1;
          } else if (decision.action === "identical") {
            stats.identical += 1;
          } else {
            stats.skippedDiffers += 1;
            const row = {
              path: path0,
              collection: p.relative,
              id: doc.id,
              label: labelOf(fromSnapshot),
              liveUpdatedAt: whenOf(liveDoc.data()),
              snapshotUpdatedAt: whenOf(fromSnapshot),
              // Top-level KEY NAMES only, never values. This file lands in the working directory
              // and gets opened in a spreadsheet, mailed around, and forgotten about; these are
              // medical records. A key name is enough to decide whether a row matters.
              differingFields: differingKeys(fromSnapshot, liveDoc.data()).join(" "),
            };
            differs.push(row);
            appendDiffer(row);
          }
        });

        cursor = page.docs[page.docs.length - 1].id;
        state.cursor = { collection: p.relative, after: cursor };
        if (writer) await writer.flush();
        saveState(state);
        process.stdout.write(`\r  ${p.relative}: ${stats.read} read, ${stats.created} written`);
      }
      // Only a collection whose every write landed counts as done. Marking it complete regardless
      // meant the documented recovery — "run exactly the same command again to continue" — skipped
      // the collection that failed, and reported Done. The 300 rows that failed would never have
      // been retried by any number of re-runs.
      if (stats.failed === failedBefore) {
        state.completed.push(p.relative);
      } else {
        console.log(`  ${p.relative}: ${stats.failed - failedBefore} write(s) failed — NOT marked done, re-run to retry`);
      }
      state.cursor = null;
      saveState(state);
      process.stdout.write("\n");
    }
  } finally {
    // Always close: a run that dies partway must not silently drop writes it already queued.
    if (writer) await writer.close();
    state.stats = stats;
    saveState(state);
  }

  if (differs.length) {
    console.log(`\n  ${differs.length} documents exist in both and DIFFER. Left untouched.`);
    console.log(`  Listed in ${differsFile}`);
    console.log(`  To replace some of them: delete the rows you do NOT want replaced, then run`);
    console.log(`    ${commandLine(["--apply", "--confirm", CLINIC, "--overwrite-list", differsFile])}`);
  } else {
    fs.unlinkSync(differsFile);
  }
  if (failures.length) {
    console.log(`\n  ${failures.length} writes FAILED. Listed in ${failuresFile}`);
  } else {
    fs.unlinkSync(failuresFile);
  }
  if (resurrected.length) {
    console.log(`\n  ${resurrected.length} document(s) skipped because the clinic deleted them on purpose.`);
    console.log(`  deleted_records_history still records those deletions; recreating them would leave`);
    console.log(`  the database contradicting its own audit trail.`);
  }
  if (deniedList.length) {
    console.log(`\n  ${deniedList.length} document(s) refused by name, whatever their collection allows:`);
    for (const d of deniedList) console.log(`    ${d.path}\n      ${d.reason}`);
  }
  if (movedOn.length) {
    console.log(`\n  ${movedOn.length} document(s) in the overwrite list MOVED ON since that list was`);
    console.log(`  written, and were left alone. Re-run the dry run to see them again:`);
    for (const m of movedOn.slice(0, 10)) console.log(`    ${m}`);
  }

  console.log(
    `\n  ${APPLY ? "Done" : "Dry run — nothing was written"}.\n` +
    `    read                       ${stats.read}\n` +
    `    ${APPLY ? "created                   " : "would be created          "} ${stats.created}\n` +
    `    already there, identical   ${stats.identical}\n` +
    `    already there, DIFFERENT   ${stats.skippedDiffers}   (left alone)\n` +
    `    overwritten                ${stats.overwritten}\n` +
    `    created live mid-run       ${stats.appearedLive}\n` +
    `    failed                     ${stats.failed}`
  );

  // The failure this exists to prevent: an operator reads "Done", assumes the damage is undone,
  // and finds out months later that the tool only ever adds. "Restore" colloquially means "make it
  // look like the snapshot", and this does not do that.
  if (stats.skippedDiffers > stats.created) {
    console.log(
      `\n  READ THIS: most of what this run found was already present and DIFFERENT, not missing.\n` +
      `  This tool puts back what is gone. It does not change what is there, and it never deletes.\n` +
      `  If the damage was corruption rather than deletion, this run has not repaired it —\n` +
      `  read ${differsFile || "the differs report"} and decide row by row.`
    );
  }
  if (!APPLY) {
    // The SAME scope that was just previewed. Printing a bare --clinic/--from line here handed
    // the operator a wider run than the plan they had read and approved.
    console.log(`\n  To apply exactly what is above:\n    ${commandLine(["--apply", "--confirm", CLINIC])}`);
  }
  console.log("");
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n  Restore stopped: ${error.message}\n`);
  if (CLINIC && FROM && fs.existsSync(STATE_FILE)) {
    let done = "";
    try {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      const written = (saved.stats?.created || 0) + (saved.stats?.overwritten || 0);
      done = `  ${written} document(s) were written, and that progress is saved.\n`;
    } catch {
      done = `  Progress up to the last completed page is saved.\n`;
    }
    console.error(done);
    console.error(`  Fix the cause and run exactly the same command again to continue:`);
    console.error(`    ${commandLine(APPLY ? ["--apply", "--confirm", CLINIC] : [])}\n`);
    console.error(`  If anything looks wrong, delete ${STATE_FILE} and start over — running this`);
    console.error(`  script twice is safe: the second pass finds what it wrote and does nothing.\n`);
  }
  process.exit(1);
});
