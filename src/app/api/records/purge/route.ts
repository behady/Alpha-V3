import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { logActivityServer } from "@/lib/server/systemLog";
import { reportServerError } from "@/lib/server/reportError";
import { logModuleFor } from "@/lib/recycleBin";
import { binEntry, binPayload, writeHistory } from "@/lib/server/recycleBinStore";

/**
 * "Delete permanently" — the answer to an erasure request.
 *
 * Admin-only, and deliberately a deliberate act rather than a timer. Nothing in this feature
 * expires on its own: an automatic sweep would be an untriggered permanent delete of what is, by
 * then, the only remaining copy of a patient record, and thirty days is the wrong number for a
 * system whose retention obligations are measured in years. The bin shows an expiry date as
 * guidance; only this route actually removes anything.
 *
 * What it does NOT do is delete the image files themselves. One stored object can be referenced by
 * several records — duplicating a media item copies the link without re-uploading — so deleting
 * bytes on the strength of one record would blank an image still in use elsewhere. The object
 * paths are copied to `storage_orphans` first, because after this the bin entry was the last
 * document anywhere that named them, and "orphaned but named" is recoverable while "orphaned and
 * unnamed" is not.
 *
 * POST { clinicId, entryId }
 */

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const entryId = typeof body?.entryId === "string" ? body.entryId.trim() : "";

    if (!clinicId || !entryId) {
      return NextResponse.json({ ok: false, error: "clinicId and entryId are required" }, { status: 400 });
    }

    const auth = await requireAdminUser(request, clinicId);
    if (!auth.ok) return auth.response;

    const ref = binEntry(entryId);
    const snap = await ref.get();
    const entry = snap.data();
    if (!snap.exists || !entry) {
      return NextResponse.json({ ok: false, error: "That entry no longer exists." }, { status: 404 });
    }
    if (entry.clinicId !== clinicId) {
      return NextResponse.json({ ok: false, error: "That entry belongs to another clinic." }, { status: 403 });
    }

    const paths: string[] = Array.isArray(entry.storagePaths) ? entry.storagePaths : [];
    if (paths.length > 0) {
      await adminDb().collection("storage_orphans").add({
        clinicId,
        collection: entry.collection ?? null,
        documentId: entry.documentId ?? null,
        storagePaths: paths,
        recordedAt: FieldValue.serverTimestamp(),
        via: "records/purge",
      });
    }

    await writeHistory({ ...entry, purgedByUid: auth.uid }, "purged");
    await binPayload(entryId).delete().catch(() => {});
    await ref.delete();

    await logActivityServer({
      clinicId,
      user: { uid: auth.uid, name: auth.name, role: auth.role },
      action: "Record Permanently Deleted",
      details: `Purged ${entry.collection}/${entry.documentId} (${entry.label || "record"}) from Recently Deleted`,
      severity: "CRITICAL",
      module: logModuleFor([String(entry.collection || "")]),
    });

    return NextResponse.json({ ok: true, filesRetained: paths.length });
  } catch (error: unknown) {
    reportServerError("records/purge failed", error);
    const message = error instanceof Error ? error.message : "Purge failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
