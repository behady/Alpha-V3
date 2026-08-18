import {
  DocumentReference,
  GeoPoint,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import { adminDb, adminBucket } from "@/lib/firebaseAdmin";
import {
  DOCUMENT_REROUTES,
  MIGRATION_STAMP_FIELD,
  SKIP_COLLECTIONS,
  emptyStats,
  remapDocPath,
  targetPathFor,
  type MigrationStats,
} from "./routing";
import { tokenFor, targetObjectPath } from "./storage";

/**
 * Import a clinic from a v2 backup FILE instead of from live credentials.
 *
 * The v2 app grew a Backup page whose file is the whole database, encoded. Importing from that
 * file means the old project's admin key never has to be downloaded or uploaded anywhere — the
 * clinic presses one button there, the operator presses a few here, and the key that opens the
 * old patient database never travels at all. The old system is untouched by construction: this
 * module never opens a connection to it.
 *
 * The browser holds the parsed file and sends documents up in small batches, because Vercel
 * caps request bodies; a clinic of any size fits through in chunks. Everything else — routing,
 * id preservation, the wapilot secret re-route, the conflict guard, the migration stamp — is
 * identical to the live-credentials path, deliberately: however the data arrives, it must land
 * the same way.
 */

export type BackupDoc = { path: string; data: unknown };

/** Tagged-type revival. The contract with v2's export route — change both or neither. */
export function decodeValue(value: unknown, clinicId: string, dst: Firestore): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const tagged = value as { __t?: string; s?: number; ns?: number; path?: string; lat?: number; lng?: number; b64?: string };
    switch (tagged.__t) {
      case "ts":
        return new Timestamp(tagged.s || 0, tagged.ns || 0);
      case "ref":
        // A stored reference carries an absolute v2 path; repoint it into this clinic's subtree.
        return dst.doc(remapDocPath(clinicId, tagged.path || ""));
      case "geo":
        return new GeoPoint(tagged.lat || 0, tagged.lng || 0);
      case "bytes":
        return Buffer.from(tagged.b64 || "", "base64");
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = decodeValue(entry, clinicId, dst);
    return out;
  }
  if (Array.isArray(value)) return value.map((entry) => decodeValue(entry, clinicId, dst));
  return value;
}

/** Same encoding as the v2 export route; here so the round trip can be tested in one repo. */
export function encodeValue(value: unknown): unknown {
  if (value instanceof Timestamp) return { __t: "ts", s: value.seconds, ns: value.nanoseconds };
  if (value instanceof DocumentReference) return { __t: "ref", path: value.path };
  if (value instanceof GeoPoint) return { __t: "geo", lat: value.latitude, lng: value.longitude };
  if (Buffer.isBuffer(value)) return { __t: "bytes", b64: value.toString("base64") };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = encodeValue(entry);
    return out;
  }
  return value;
}

export type ImportChunkResult = {
  stats: MigrationStats;
  conflicts: string[];
};

/** Import one browser-sized batch of backup documents into the clinic's subtree. */
export async function importChunk(
  docs: BackupDoc[],
  clinicId: string,
  sourceProject: string,
  runId: string,
  commit: boolean,
  overwrite: boolean
): Promise<ImportChunkResult> {
  const dst = adminDb();
  const stats = emptyStats();
  const conflicts: string[] = [];
  const writer = commit ? dst.bulkWriter() : null;

  try {
    for (const entry of docs) {
      const segments = entry.path.split("/");
      const rootName = segments[0];
      const docId = segments[segments.length - 1];

      // users/ is keyed by per-project Auth uids; the staff step rebuilds those from email.
      if (SKIP_COLLECTIONS[rootName]) continue;

      stats.read += 1;
      const data = decodeValue(entry.data, clinicId, dst) as DocumentData;

      const reroute =
        segments.length === 2 ? DOCUMENT_REROUTES[`${rootName}/${docId}`] : undefined;
      if (reroute) {
        stats.rerouted += 1;
        const spec = reroute.target(clinicId);
        if (writer) {
          writer.set(dst.doc(spec.path.join("/")), { [spec.field]: data }, { merge: true });
        }
        // Counted whether or not this run writes: a practice run whose "will be copied" figure
        // is always zero tells the operator nothing, which is the whole point of a practice run.
        stats.written += 1;
        continue;
      }

      const targetRef = dst.doc(
        [...targetPathFor(clinicId, rootName), ...segments.slice(1)].join("/")
      );
      const existing = await targetRef.get();

      /**
       * Same conflict rule as the live path: a target document without the migration stamp is
       * work the clinic did in v3 after cutover, and an older v2 copy must not overwrite it.
       */
      if (existing.exists && !existing.get(MIGRATION_STAMP_FIELD) && !overwrite) {
        stats.conflicts += 1;
        if (conflicts.length < 50) conflicts.push(targetRef.path);
        continue;
      }

      if (writer) {
        writer.set(targetRef, {
          ...data,
          [MIGRATION_STAMP_FIELD]: {
            sourceProject,
            sourcePath: entry.path,
            runId,
            migratedAt: new Date().toISOString(),
          },
        });
      }
      stats.written += 1;
    }
  } finally {
    if (writer) await writer.close();
  }

  return { stats, conflicts };
}

// ------------------------------------------------------------------------------ file fetching

export type FetchFilesState = {
  pending: string[];
  cursor: string | null;
  completed: string[];
  copied: number;
  alreadyThere: number;
  missing: string[];
  /** gs:// references carry no download token, so they cannot be fetched without credentials. */
  needsCredentials: string[];
  documentsUpdated: number;
};

const TIME_BUDGET_MS = 40_000;
const PAGE_SIZE = 50;
const FETCH_CONCURRENCY = 6;

export async function initialFetchFilesState(clinicId: string): Promise<FetchFilesState> {
  const collections = await adminDb().collection("clinics").doc(clinicId).listCollections();
  return {
    pending: collections.map((col) => col.id).filter((name) => !SKIP_COLLECTIONS[name]).sort(),
    cursor: null,
    completed: [],
    copied: 0,
    alreadyThere: 0,
    missing: [],
    needsCredentials: [],
    documentsUpdated: 0,
  };
}

/**
 * Copy the clinic's photos and x-rays WITHOUT any credentials for the old project.
 *
 * Every image the app displays is stored as a Firebase download URL, and a download URL is a
 * bearer link: the token inside it is the whole authorisation. So the files can simply be
 * FETCHED over HTTPS using the very URLs already sitting in the imported records — the same way
 * the old app's own screens load them. Then each file is stored in this project's bucket under
 * `clinics/{clinicId}/` and the record is repointed, exactly like the credentials path.
 *
 * The one thing this cannot fetch is a bare `gs://` reference (no token). Those are counted and
 * reported rather than silently dropped; the key-file path remains available for a clinic that
 * turns out to have them.
 */
export async function runFetchFilesStep(
  clinicId: string,
  sourceBucket: string,
  salt: string,
  state: FetchFilesState,
  commit: boolean
): Promise<{ state: FetchFilesState; done: boolean }> {
  const dst = adminDb();
  const to = adminBucket();
  const targetBucketName = to.name;
  const deadline = Date.now() + TIME_BUDGET_MS;

  while (state.pending.length > 0 && Date.now() < deadline) {
    const name = state.pending[0];
    let query = dst
      .collection(`clinics/${clinicId}/${name}`)
      .orderBy("__name__")
      .limit(PAGE_SIZE);
    if (state.cursor) query = query.startAfter(state.cursor);

    const page = await query.get();
    if (page.empty) {
      state.pending.shift();
      state.completed.push(name);
      state.cursor = null;
      continue;
    }

    for (const doc of page.docs) {
      state.cursor = doc.id;

      // Collect every URL in this document that points at the old bucket, keyed by object path
      // so one file referenced twice is fetched once.
      const urlsByPath = new Map<string, string>();
      const gsRefs: string[] = [];
      collectUrls(doc.data(), sourceBucket, urlsByPath, gsRefs);
      if (!urlsByPath.size && !gsRefs.length) continue;

      for (const gs of gsRefs) {
        if (state.needsCredentials.length < 50) state.needsCredentials.push(gs);
      }

      const failed = new Set<string>();
      const entries = [...urlsByPath.entries()];
      for (let i = 0; i < entries.length; i += FETCH_CONCURRENCY) {
        await Promise.all(
          entries.slice(i, i + FETCH_CONCURRENCY).map(async ([objectPath, url]) => {
            const targetFile = to.file(targetObjectPath(clinicId, objectPath));
            const [present] = await targetFile.exists();
            if (present) {
              state.alreadyThere += 1;
              return;
            }
            if (!commit) return;

            const response = await fetch(url).catch(() => null);
            if (!response || !response.ok) {
              // Dead in v2 already (deleted file, revoked token). The URL is left as it is, so
              // the breakage stays visible instead of turning into a missing v3 file.
              failed.add(objectPath);
              if (state.missing.length < 50) state.missing.push(objectPath);
              return;
            }

            const bytes = Buffer.from(await response.arrayBuffer());
            await targetFile.save(bytes, {
              contentType: response.headers.get("content-type") || undefined,
              metadata: {
                metadata: {
                  firebaseStorageDownloadTokens: tokenFor(salt, clinicId, objectPath),
                },
              },
            });
            state.copied += 1;
          })
        );
      }

      const rewritten = rewriteUrls(
        doc.data(),
        sourceBucket,
        targetBucketName,
        clinicId,
        salt,
        (objectPath) => !failed.has(objectPath)
      );
      if (rewritten.changed) {
        if (commit) await doc.ref.set(rewritten.value as DocumentData, { merge: true });
        state.documentsUpdated += 1;
      }
    }

    if (page.size < PAGE_SIZE) {
      state.pending.shift();
      state.completed.push(name);
      state.cursor = null;
    }
  }

  return { state, done: state.pending.length === 0 };
}

function objectPathFromUrl(url: string, bucket: string): string | null {
  if (!bucket || !url.includes(bucket)) return null;
  const download = url.match(/\/v0\/b\/([^/]+)\/o\/([^?]+)/);
  if (download && download[1] === bucket) return decodeURIComponent(download[2]);
  return null;
}

function collectUrls(
  value: unknown,
  bucket: string,
  urlsByPath: Map<string, string>,
  gsRefs: string[]
): void {
  if (typeof value === "string") {
    const objectPath = objectPathFromUrl(value, bucket);
    if (objectPath) urlsByPath.set(objectPath, value);
    else if (value.startsWith(`gs://${bucket}/`)) gsRefs.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectUrls(entry, bucket, urlsByPath, gsRefs);
    return;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const entry of Object.values(value)) collectUrls(entry, bucket, urlsByPath, gsRefs);
  }
}

function rewriteUrls(
  value: unknown,
  sourceBucket: string,
  targetBucket: string,
  clinicId: string,
  salt: string,
  shouldRewrite: (objectPath: string) => boolean
): { value: unknown; changed: boolean } {
  let changed = false;

  const walk = (entry: unknown): unknown => {
    if (typeof entry === "string") {
      const objectPath = objectPathFromUrl(entry, sourceBucket);
      if (!objectPath || !shouldRewrite(objectPath)) return entry;
      changed = true;
      const newPath = targetObjectPath(clinicId, objectPath);
      return (
        `https://firebasestorage.googleapis.com/v0/b/${targetBucket}` +
        `/o/${encodeURIComponent(newPath)}?alt=media&token=${tokenFor(salt, clinicId, objectPath)}`
      );
    }
    if (Array.isArray(entry)) return entry.map(walk);
    if (entry && typeof entry === "object" && Object.getPrototypeOf(entry) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(entry)) out[key] = walk(item);
      return out;
    }
    return entry;
  };

  return { value: walk(value), changed };
}
