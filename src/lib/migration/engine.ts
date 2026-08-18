import { randomUUID } from "node:crypto";
import {
  DocumentReference,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import {
  DOCUMENT_REROUTES,
  KNOWN_CLINIC_COLLECTIONS,
  MIGRATION_STAMP_FIELD,
  NO_V3_CONSUMER,
  SKIP_COLLECTIONS,
  emptyStats,
  remapDocPath,
  targetPathFor,
  type MigrationState,
  type SourceCredentials,
} from "./routing";
import { sourceDb } from "./sourceApp";

/**
 * The copy engine, in resumable slices.
 *
 * A clinic with tens of thousands of ledger rows cannot be migrated inside one HTTP request, so
 * the work is cut into steps: each call copies what it can within a time budget and hands back
 * the state needed to continue. The browser drives the loop and shows progress, which also means
 * a dropped connection costs one step rather than the whole migration.
 */

/** Documents fetched per page. Firestore caps a batch at 500 writes; BulkWriter handles that. */
const PAGE_SIZE = 200;

/**
 * Stop and return after this long. Comfortably inside the 60s route limit, leaving room for the
 * final BulkWriter flush and the JSON response.
 */
const TIME_BUDGET_MS = 40_000;

/** listCollections() is one round trip per document, so fan them out rather than serialise. */
const SUBCOLLECTION_PROBE_CONCURRENCY = 25;

export type PlanEntry = {
  name: string;
  action: "copy" | "skip";
  reason?: string;
  target?: string;
  count: number;
  known: boolean;
  noConsumer?: string;
};

/**
 * Survey the source project without copying anything: what exists, where each collection would
 * land, and how much is there. This is what the operator reads before agreeing to anything.
 */
export async function buildPlan(creds: SourceCredentials, clinicId: string): Promise<PlanEntry[]> {
  const src = sourceDb(creds);
  const collections = (await src.listCollections()).map((col) => col.id).sort();

  return Promise.all(
    collections.map(async (name): Promise<PlanEntry> => {
      const count = (await src.collection(name).count().get()).data().count;

      if (SKIP_COLLECTIONS[name]) {
        return { name, action: "skip", reason: SKIP_COLLECTIONS[name], count, known: true };
      }

      return {
        name,
        action: "copy",
        target: targetPathFor(clinicId, name).join("/"),
        count,
        known: KNOWN_CLINIC_COLLECTIONS.has(name),
        noConsumer: NO_V3_CONSUMER[name],
      };
    })
  );
}

/** Fresh state for a run over the given root collections. */
export function initialState(collections: string[]): MigrationState {
  return {
    pending: collections.filter((name) => !SKIP_COLLECTIONS[name]),
    cursor: null,
    completed: [],
    stats: emptyStats(),
    conflicts: [],
    runId: randomUUID(),
  };
}

type StepResult = {
  state: MigrationState;
  done: boolean;
  log: string[];
};

/**
 * Copy one slice of work.
 *
 * `commit: false` performs every read, routing decision and conflict check the real run does and
 * simply skips the writes — so a clean preview is a genuine prediction rather than a guess.
 */
export async function runStep(
  creds: SourceCredentials,
  clinicId: string,
  state: MigrationState,
  commit: boolean,
  overwrite: boolean
): Promise<StepResult> {
  const src = sourceDb(creds);
  const dst = adminDb();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const log: string[] = [];

  const writer = commit ? dst.bulkWriter() : null;
  if (writer) {
    writer.onWriteError((error) => {
      const retryable = [4, 8, 10, 13, 14].includes(error.code);
      if (retryable && error.failedAttempts < 5) return true;
      log.push(`Write failed: ${error.documentRef.path} — ${error.message}`);
      return false;
    });
  }

  try {
    while (state.pending.length > 0 && Date.now() < deadline) {
      const path = state.pending[0];
      const finished = await copyPage({
        src,
        dst,
        writer,
        creds,
        clinicId,
        state,
        path,
        commit,
        overwrite,
        log,
      });

      if (finished) {
        state.pending.shift();
        state.completed.push(path);
        state.cursor = null;
      }
    }
  } finally {
    // Always flush: a partial step must not silently drop the writes it already queued.
    if (writer) await writer.close();
  }

  return { state, done: state.pending.length === 0, log };
}

async function copyPage(args: {
  src: Firestore;
  dst: Firestore;
  writer: ReturnType<Firestore["bulkWriter"]> | null;
  creds: SourceCredentials;
  clinicId: string;
  state: MigrationState;
  path: string;
  commit: boolean;
  overwrite: boolean;
  log: string[];
}): Promise<boolean> {
  const { src, dst, writer, creds, clinicId, state, path, commit, overwrite, log } = args;

  let query = src.collection(path).orderBy("__name__").limit(PAGE_SIZE);
  if (state.cursor) query = query.startAfter(state.cursor);

  const page = await query.get();
  if (page.empty) return true;

  // The collection name drives routing; a nested path keeps its parent's target prefix.
  const segments = path.split("/");
  const rootName = segments[0];
  const targetSegments = [...targetPathFor(clinicId, rootName), ...segments.slice(1)];

  for (const doc of page.docs) {
    state.stats.read += 1;

    const ctx = {
      clinicId,
      targetDb: dst,
      sourceBucketName: creds.storageBucket,
      refsRemapped: 0,
      storageUrls: 0,
    };
    const data = rewriteValue(doc.data(), ctx) as DocumentData;
    state.stats.refsRemapped += ctx.refsRemapped;
    state.stats.storageUrls += ctx.storageUrls;

    const reroute = DOCUMENT_REROUTES[`${rootName}/${doc.id}`];
    if (reroute) {
      state.stats.rerouted += 1;
      const spec = reroute.target(clinicId);
      if (commit && writer) {
        writer.set(dst.doc(spec.path.join("/")), { [spec.field]: data }, { merge: true });
        state.stats.written += 1;
      }
    } else {
      const targetRef = dst.doc([...targetSegments, doc.id].join("/"));
      const existing = await targetRef.get();

      /**
       * Refreshing a document this migration wrote is fine — it is the same v2 row again.
       * Overwriting one it did NOT write means replacing something the clinic entered in v3
       * after cutover with an older copy from v2, and losing real work. Those are left alone
       * and reported.
       */
      if (existing.exists && !existing.get(MIGRATION_STAMP_FIELD) && !overwrite) {
        state.stats.conflicts += 1;
        if (state.conflicts.length < 50) state.conflicts.push(targetRef.path);
        continue;
      }

      if (commit && writer) {
        writer.set(targetRef, {
          ...data,
          [MIGRATION_STAMP_FIELD]: {
            sourceProject: creds.projectId,
            sourcePath: doc.ref.path,
            runId: state.runId,
            migratedAt: new Date().toISOString(),
          },
        });
        state.stats.written += 1;
      }
    }

    state.cursor = doc.id;
  }

  // Queue any subcollections found on this page (v2 nests team_chats/{id}/messages, and the
  // rules file allows deeper nesting elsewhere).
  await queueSubcollections(page.docs, path, state, log);

  return page.size < PAGE_SIZE;
}

async function queueSubcollections(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  parentPath: string,
  state: MigrationState,
  log: string[]
): Promise<void> {
  for (let i = 0; i < docs.length; i += SUBCOLLECTION_PROBE_CONCURRENCY) {
    const slice = docs.slice(i, i + SUBCOLLECTION_PROBE_CONCURRENCY);
    const results = await Promise.all(slice.map((doc) => doc.ref.listCollections()));

    results.forEach((subs, index) => {
      for (const sub of subs) {
        const subPath = `${parentPath}/${slice[index].id}/${sub.id}`;
        if (!state.pending.includes(subPath) && !state.completed.includes(subPath)) {
          state.pending.push(subPath);
          log.push(`Found subcollection ${subPath}`);
        }
      }
    });
  }
}

type RewriteContext = {
  clinicId: string;
  targetDb: Firestore;
  sourceBucketName: string;
  refsRemapped: number;
  storageUrls: number;
};

/**
 * Rewrite a document's data for the target project.
 *
 * Almost everything passes through untouched — Timestamps, GeoPoints and Bytes are copied
 * verbatim by the Admin SDK, which is why dates and money survive the move unchanged. The
 * exception is a stored DocumentReference: it holds an absolute path (`patients/abc`), so copied
 * as-is it would point at a root collection that does not exist in v3.
 *
 * Strings that name the old Storage bucket are counted, so the operator is told up front how
 * many documents the Files step will have to rewrite.
 */
function rewriteValue(value: unknown, ctx: RewriteContext): unknown {
  if (value instanceof DocumentReference) {
    ctx.refsRemapped += 1;
    return ctx.targetDb.doc(remapDocPath(ctx.clinicId, value.path));
  }

  if (Array.isArray(value)) return value.map((entry) => rewriteValue(entry, ctx));

  if (typeof value === "string") {
    if (ctx.sourceBucketName && value.includes(ctx.sourceBucketName)) ctx.storageUrls += 1;
    return value;
  }

  // Plain maps only. Timestamp/GeoPoint/Bytes are class instances and must pass through whole.
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = rewriteValue(entry, ctx);
    return out;
  }

  return value;
}
