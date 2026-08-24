/**
 * Client calls to the routes that own deletion.
 *
 * Every screen used to call `deleteDoc` and the record was gone. They call here instead, the
 * record is photographed on its way out, and firestore.rules denies the client a direct delete on
 * these collections — so the bin is what actually happens rather than merely the intended path.
 *
 * Errors carry the server's own message and a machine-readable `reason`, so a caller can offer the
 * right next step ("this patient has 12 records that will be left behind") instead of a generic
 * failure.
 */

import { auth } from "@/lib/firebase";

export class RecycleBinError extends Error {
  status: number;
  reason?: string;
  counts?: Record<string, number>;

  constructor(message: string, status: number, reason?: string, counts?: Record<string, number>) {
    super(message);
    this.name = "RecycleBinError";
    this.status = status;
    this.reason = reason;
    this.counts = counts;
  }
}

/** The patient has records that would be left pointing at nothing. */
export function isOrphanWarning(error: unknown): error is RecycleBinError {
  return error instanceof RecycleBinError && error.reason === "HAS_CHILDREN";
}

async function headers(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new RecycleBinError("You are signed out. Sign in and try again.", 401);
  return { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` };
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: await headers() });
  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    // A route that died before writing JSON — the status is all there is to go on.
  }
  if (!response.ok || payload.ok === false) {
    throw new RecycleBinError(
      typeof payload.error === "string" ? payload.error : "Something went wrong",
      response.status,
      typeof payload.reason === "string" ? payload.reason : undefined,
      (payload.counts as Record<string, number>) || undefined
    );
  }
  return payload as T;
}

export type DeleteResult = {
  ok: true;
  actionId: string;
  deleted: number;
  results: Array<{ collection: string; documentId: string; status: string; error?: string }>;
};

/**
 * Move one or more records to the bin. One call per user action — a bulk delete must NOT be a loop
 * of single calls, because a failure halfway would leave some records gone and some not, with
 * nothing tying the survivors to the attempt.
 */
export async function deleteRecords(
  clinicId: string,
  items: Array<{ collection: string; documentId: string }>,
  options?: { reason?: string; acknowledgeOrphans?: boolean }
): Promise<DeleteResult> {
  return call<DeleteResult>("/api/records/delete", {
    method: "POST",
    body: JSON.stringify({ clinicId, items, ...options }),
  });
}

/** Convenience for the common single-record case. */
export async function deleteRecord(
  clinicId: string,
  collection: string,
  documentId: string,
  options?: { reason?: string; acknowledgeOrphans?: boolean }
): Promise<DeleteResult> {
  return deleteRecords(clinicId, [{ collection, documentId }], options);
}

export type BinEntry = {
  id: string;
  collection: string;
  documentId: string;
  label: string;
  deletedByName: string;
  deletedAt: string | null;
  expiresAt: string | null;
  actionId: string | null;
  actionSize: number;
  reason: string | null;
  snapshotBytes: number;
  hasFiles: boolean;
};

export async function listBin(clinicId: string): Promise<{
  entries: BinEntry[];
  visibleCollections: string[];
  totalBytes: number;
}> {
  return call(`/api/records/bin?clinicId=${encodeURIComponent(clinicId)}`, { method: "GET" });
}

export async function restoreRecord(
  clinicId: string,
  entryId: string,
  options?: { acknowledgeDuplicate?: boolean }
): Promise<{ collection: string; documentId: string }> {
  return call("/api/records/restore", {
    method: "POST",
    body: JSON.stringify({ clinicId, entryId, ...options }),
  });
}

export async function purgeRecord(clinicId: string, entryId: string): Promise<{ filesRetained: number }> {
  return call("/api/records/purge", { method: "POST", body: JSON.stringify({ clinicId, entryId }) });
}
