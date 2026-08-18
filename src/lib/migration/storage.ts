import { createHash } from "node:crypto";
import { adminDb, adminBucket } from "@/lib/firebaseAdmin";
import { SKIP_COLLECTIONS, type SourceCredentials } from "./routing";
import { sourceBucket } from "./sourceApp";

/**
 * Copy the clinic's files and repoint the URLs stored against them.
 *
 * Firestore only ever stores the URL of a file, never the file itself. So the data steps can
 * migrate a patient's record perfectly and every image in it still loads from the OLD project's
 * bucket. It looks completely fine — right until the old project is shut down, at which point
 * every x-ray in the clinic's history 404s at once with nothing in v3 to restore from.
 *
 * That is the most destructive thing that can go wrong in this migration, and it is silent until
 * it is irreversible. This step closes it, and must run before the old project is touched.
 */

export type StorageState = {
  pending: string[];
  cursor: string | null;
  completed: string[];
  copied: number;
  alreadyThere: number;
  missing: string[];
  documentsUpdated: number;
  scanned: number;
};

const TIME_BUDGET_MS = 40_000;
const PAGE_SIZE = 100;
const COPY_CONCURRENCY = 8;

/**
 * Object paths are prefixed with `clinics/{clinicId}/` in the target.
 *
 * v2 gave every clinic its own bucket, so two clinics can each own
 * `xrays/patient-1/panoramic.jpg`. Merged into one bucket unprefixed, the second clinic migrated
 * would overwrite the first clinic's images — one clinic silently looking at another clinic's
 * radiographs.
 */
const targetObjectPath = (clinicId: string, objectPath: string) =>
  `clinics/${clinicId}/${objectPath}`;

/**
 * Download token for a copied object, derived from the object path.
 *
 * This MUST be deterministic. The token is written in two independent places — onto the file's
 * metadata when it is copied, and into the URL stored in Firestore — and a Firebase download URL
 * only works while those agree. A random token would produce a bucket full of correctly copied
 * files that every URL in the database fails to open. Determinism also makes the step
 * re-runnable: a second pass recomputes the same token, so URLs already written stay valid.
 *
 * The salt keeps tokens unguessable. A download token is a bearer capability — anyone holding
 * the URL can fetch that file unauthenticated — so deriving one from the object path alone would
 * make every patient's radiographs reachable by anyone who can guess a path.
 */
function tokenFor(salt: string, clinicId: string, objectPath: string): string {
  const digest = createHash("sha256").update(`${salt}:${clinicId}:${objectPath}`).digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join("-");
}

/** Object path from a Firebase download URL or a gs:// reference, if it names `bucket`. */
function objectPathFrom(url: string, bucket: string): string | null {
  if (!bucket || !url.includes(bucket)) return null;

  const download = url.match(/\/v0\/b\/([^/]+)\/o\/([^?]+)/);
  if (download && download[1] === bucket) return decodeURIComponent(download[2]);

  if (url.startsWith(`gs://${bucket}/`)) return url.slice(`gs://${bucket}/`.length);

  return null;
}

/**
 * Walk a document, collecting every source-bucket object it references and returning a copy with
 * those URLs repointed. `shouldRewrite` decides per file, which lets the same function serve the
 * collect-only pass and the real rewrite once it is known which files exist.
 */
function walk(
  value: unknown,
  sourceBucketName: string,
  targetBucketName: string,
  clinicId: string,
  salt: string,
  found: string[],
  shouldRewrite: (objectPath: string) => boolean
): unknown {
  if (typeof value === "string") {
    const objectPath = objectPathFrom(value, sourceBucketName);
    if (!objectPath) return value;
    found.push(objectPath);
    if (!shouldRewrite(objectPath)) return value;

    const newPath = targetObjectPath(clinicId, objectPath);
    if (value.startsWith(`gs://${sourceBucketName}/`)) {
      return `gs://${targetBucketName}/${newPath}`;
    }
    return (
      `https://firebasestorage.googleapis.com/v0/b/${targetBucketName}` +
      `/o/${encodeURIComponent(newPath)}?alt=media&token=${tokenFor(salt, clinicId, objectPath)}`
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      walk(entry, sourceBucketName, targetBucketName, clinicId, salt, found, shouldRewrite)
    );
  }

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = walk(entry, sourceBucketName, targetBucketName, clinicId, salt, found, shouldRewrite);
    }
    return out;
  }

  return value;
}

export async function initialStorageState(clinicId: string): Promise<StorageState> {
  const collections = await adminDb().collection("clinics").doc(clinicId).listCollections();
  return {
    pending: collections.map((col) => col.id).filter((name) => !SKIP_COLLECTIONS[name]).sort(),
    cursor: null,
    completed: [],
    copied: 0,
    alreadyThere: 0,
    missing: [],
    documentsUpdated: 0,
    scanned: 0,
  };
}

export async function runStorageStep(
  creds: SourceCredentials,
  clinicId: string,
  salt: string,
  state: StorageState,
  commit: boolean
): Promise<{ state: StorageState; done: boolean; log: string[] }> {
  const dst = adminDb();
  const from = sourceBucket(creds);
  const to = adminBucket();
  const targetBucketName = to.name;
  const deadline = Date.now() + TIME_BUDGET_MS;
  const log: string[] = [];

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
      state.scanned += 1;
      state.cursor = doc.id;

      const found: string[] = [];
      walk(doc.data(), creds.storageBucket, targetBucketName, clinicId, salt, found, () => false);
      if (!found.length) continue;

      const distinct = [...new Set(found)];
      const missingHere = new Set<string>();

      for (let i = 0; i < distinct.length; i += COPY_CONCURRENCY) {
        await Promise.all(
          distinct.slice(i, i + COPY_CONCURRENCY).map(async (objectPath) => {
            const sourceFile = from.file(objectPath);
            const [exists] = await sourceFile.exists();
            if (!exists) {
              // A URL whose file is already gone, usually deleted in the console without
              // clearing the Firestore field. Worth reporting, not worth failing on.
              missingHere.add(objectPath);
              if (state.missing.length < 50) state.missing.push(objectPath);
              return;
            }

            const targetFile = to.file(targetObjectPath(clinicId, objectPath));
            const [present] = await targetFile.exists();
            if (present) {
              state.alreadyThere += 1;
              return;
            }
            if (!commit) return;

            await sourceFile.copy(targetFile);
            await targetFile.setMetadata({
              metadata: { firebaseStorageDownloadTokens: tokenFor(salt, clinicId, objectPath) },
            });
            state.copied += 1;
          })
        );
      }

      /**
       * Only now is it known which files made it across, so only now can the URLs be rewritten.
       * A reference to a file that was already missing in v2 keeps its old URL rather than being
       * pointed at a v3 file that does not exist, so pre-existing breakage stays where it is
       * instead of following the clinic into v3 disguised as a migration fault.
       */
      const rewritten: string[] = [];
      const data = walk(
        doc.data(),
        creds.storageBucket,
        targetBucketName,
        clinicId,
        salt,
        rewritten,
        (objectPath) => !missingHere.has(objectPath)
      );

      if (rewritten.some((objectPath) => !missingHere.has(objectPath))) {
        if (commit) await doc.ref.set(data as Record<string, unknown>, { merge: true });
        state.documentsUpdated += 1;
      }
    }

    if (page.size < PAGE_SIZE) {
      state.pending.shift();
      state.completed.push(name);
      state.cursor = null;
    }
  }

  return { state, done: state.pending.length === 0, log };
}
