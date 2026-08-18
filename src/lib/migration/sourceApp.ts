import { createHash } from "node:crypto";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import type { SourceCredentials } from "./routing";

/**
 * Read-only access to a clinic's old Firebase project.
 *
 * The migration is a COPY. The clinic's existing project is left exactly as it is: it stays
 * their live, working system until cutover, and it is the only copy of anything the migration
 * misses. Nothing here may ever write to it.
 *
 * That is enforced rather than merely intended. `sourceDb()` and `sourceBucket()` hand back
 * guarded handles on which every mutating method throws before reaching the network, and the
 * guard follows derived references so it cannot be sidestepped by going one level deeper. The
 * engine only ever reads, but the guard is what stops a later change here breaking that quietly.
 *
 * Belt and braces: the operator is told to give the source service account only
 * `roles/datastore.viewer` and `roles/storage.objectViewer`, which makes a write impossible at
 * Google's level rather than at ours.
 */

const FIRESTORE_WRITE_METHODS = new Set([
  "set", "update", "delete", "add", "create",
  "batch", "bulkWriter", "runTransaction", "recursiveDelete", "bulkDelete",
]);

const STORAGE_WRITE_METHODS = new Set([
  "save", "delete", "deleteFiles", "upload", "createWriteStream", "setMetadata",
  "makePublic", "makePrivate", "move", "rename", "setStorageClass", "create",
]);

/** Ref-like objects worth wrapping when a guarded handle hands one back. */
const GUARDED_TYPES = new Set([
  "CollectionReference", "DocumentReference", "Query", "CollectionGroup", "File", "Bucket",
]);

function guardReadOnly<T extends object>(target: T, writeMethods: Set<string>, label: string): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "string" && writeMethods.has(prop)) {
        return () => {
          throw new Error(
            `Refusing to call ${label}.${prop}(): the clinic's existing database is opened ` +
              `read-only and must never be modified by a migration.`
          );
        };
      }

      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function") return value;

      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(obj, args);
        const name = (result as { constructor?: { name?: string } })?.constructor?.name;
        if (name && GUARDED_TYPES.has(name)) {
          return guardReadOnly(result as object, writeMethods, name);
        }
        return result;
      };
    },
  }) as T;
}

/**
 * One firebase-admin app per distinct source project, reused across requests.
 *
 * Serverless keeps module state alive between invocations on the same instance, so initialising
 * a fresh app per request would leak apps until the instance died. Naming the app after a hash
 * of its credentials makes reuse automatic and keeps two different clinics from colliding.
 */
function sourceAppFor(creds: SourceCredentials): App {
  const name = `mig-src-${createHash("sha256")
    .update(`${creds.projectId}:${creds.clientEmail}`)
    .digest("hex")
    .slice(0, 16)}`;

  const existing = getApps().find((app) => app.name === name);
  if (existing) return existing;

  return initializeApp(
    {
      credential: cert({
        projectId: creds.projectId,
        clientEmail: creds.clientEmail,
        privateKey: creds.privateKey,
      }),
      storageBucket: creds.storageBucket,
    },
    name
  );
}

export function sourceDb(creds: SourceCredentials): Firestore {
  const db = getFirestore(sourceAppFor(creds), creds.databaseId);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() throws if the instance has already been used; harmless on a reused app.
  }
  return guardReadOnly(db, FIRESTORE_WRITE_METHODS, "sourceDb");
}

export function sourceBucket(creds: SourceCredentials) {
  const storage: Storage = getStorage(sourceAppFor(creds));
  return guardReadOnly(
    storage.bucket(creds.storageBucket),
    STORAGE_WRITE_METHODS,
    "sourceBucket"
  );
}

/** Vercel and copy-paste both mangle multi-line keys in predictable ways; undo all of them. */
export function parsePrivateKey(raw: string): string {
  return (raw || "")
    .replace(/^["']|["']$/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

/**
 * Validate and normalise what the operator pasted in. A service-account JSON file is accepted
 * whole, which is what they actually download from Firebase — asking them to pick three fields
 * out of it by hand is the step where this goes wrong.
 */
export function parseCredentials(input: unknown): SourceCredentials {
  const raw = (input || {}) as Record<string, unknown>;

  const projectId = String(raw.projectId || raw.project_id || "").trim();
  const clientEmail = String(raw.clientEmail || raw.client_email || "").trim();
  const privateKey = parsePrivateKey(String(raw.privateKey || raw.private_key || ""));

  if (!projectId) throw new Error("The service account file has no project_id.");
  if (!clientEmail) throw new Error("The service account file has no client_email.");
  if (!privateKey.includes("BEGIN")) {
    throw new Error("The service account file has no usable private_key.");
  }

  return {
    projectId,
    clientEmail,
    privateKey,
    storageBucket:
      String(raw.storageBucket || "").trim() ||
      `${projectId}.appspot.com`,
    // v2 projects use the conventional unnamed database.
    databaseId: String(raw.databaseId || "").trim() || "(default)",
  };
}
