import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { reportServerError } from "@/lib/server/reportError";
import { BIN_COLLECTIONS, checkDeleteAllowed } from "@/lib/recycleBin";
import { binCollection } from "@/lib/server/recycleBinStore";

/**
 * The Recently Deleted list.
 *
 * Served by a route rather than read from Firestore, because the bin is a root collection denied
 * to every client — see the header of src/lib/server/recycleBinStore.ts for why it cannot live
 * under the clinic.
 *
 * Filtered to the collections the caller may delete. The entries are full patient records, so a
 * member with no clinical access must not be able to read every deleted prescription and diagnosis
 * chat by opening a screen that lists them. The snapshot itself is never included here — only the
 * label — so listing costs one small document per row and no medical data crosses the wire until
 * somebody restores.
 *
 * GET ?clinicId=...
 */

export async function GET(request: Request) {
  try {
    const clinicId = new URL(request.url).searchParams.get("clinicId")?.trim() || "";
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
    }

    const auth = await requireStaffUser(request, clinicId, { allowInactive: true });
    if (!auth.ok) return auth.response;

    const visible = Object.entries(BIN_COLLECTIONS)
      .filter(([, rule]) => checkDeleteAllowed(rule, { role: auth.role, permissions: auth.permissions }) === true)
      .map(([name]) => name);

    if (visible.length === 0) {
      return NextResponse.json({ ok: true, entries: [], visibleCollections: [] });
    }

    // `select()` keeps the payload subdocument out of the read entirely, and the projection keeps
    // the row small — a diagnosis chat's transcript or a full odontogram would otherwise be
    // downloaded just to render a label.
    const snap = await binCollection()
      .where("clinicId", "==", clinicId)
      .where("status", "==", "deleted")
      .orderBy("deletedAt", "desc")
      .limit(500)
      .select(
        "collection", "documentId", "label", "deletedByName", "deletedAt",
        "expiresAt", "actionId", "actionSize", "reason", "snapshotBytes", "storagePaths"
      )
      .get();

    const entries = snap.docs
      .map((d) => {
        const data = d.data();
        return {
          id: d.id,
          collection: String(data.collection || ""),
          documentId: String(data.documentId || ""),
          label: String(data.label || ""),
          deletedByName: String(data.deletedByName || "Unknown"),
          deletedAt: data.deletedAt?.toDate?.()?.toISOString() ?? null,
          expiresAt: data.expiresAt?.toDate?.()?.toISOString() ?? null,
          actionId: data.actionId ?? null,
          actionSize: data.actionSize ?? 1,
          reason: data.reason ?? null,
          snapshotBytes: data.snapshotBytes ?? 0,
          hasFiles: Array.isArray(data.storagePaths) && data.storagePaths.length > 0,
        };
      })
      // Filtered here rather than with an `in` clause: Firestore caps `in` at 30 values and a
      // silent truncation would present a partial bin as the whole of it.
      .filter((e) => visible.includes(e.collection));

    return NextResponse.json({
      ok: true,
      entries,
      visibleCollections: visible,
      totalBytes: entries.reduce((sum, e) => sum + (e.snapshotBytes || 0), 0),
    });
  } catch (error: unknown) {
    reportServerError("records/bin failed", error);
    const message = error instanceof Error ? error.message : "Could not load Recently Deleted";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
