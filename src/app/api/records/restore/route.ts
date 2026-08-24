import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { COLLECTION_WRITE_PERMISSIONS } from "@/lib/permissions";
import { logActivityServer } from "@/lib/server/systemLog";
import { reportServerError } from "@/lib/server/reportError";
import {
  checkBinnable,
  checkRestorable,
  checkRestoreAllowed,
  logModuleFor,
  restoreOverrides,
} from "@/lib/recycleBin";
import { binEntry, binPayload, writeHistory } from "@/lib/server/recycleBinStore";

/**
 * Puts a record back where it was — or refuses, clearly, and changes nothing.
 *
 * The single most important rule here is that a restore NEVER overwrites. The document id is the
 * only foreign key this app has: every prescription, image and charge finds its patient by
 * `patientId`, so restoring under a fresh id would orphan all of them, while overwriting whatever
 * now sits at the old id would destroy work done in the meantime — and `patients.teethData` is
 * written wholesale with no per-tooth history, so an overwrite would leave nothing to reconcile
 * against. When the place is occupied the only answer that cannot lose data is to stop and ask a
 * person to compare the two.
 *
 * The entry is a request, not a capability. Its `collection` is re-validated and the caller's
 * permissions are re-checked against it, because a bin entry is data and data is never trusted to
 * authorise the write it describes.
 *
 * POST { clinicId, entryId, acknowledgeDuplicate? }
 */

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const entryId = typeof body?.entryId === "string" ? body.entryId.trim() : "";
    const acknowledgeDuplicate = body?.acknowledgeDuplicate === true;

    if (!clinicId || !entryId) {
      return NextResponse.json({ ok: false, error: "clinicId and entryId are required" }, { status: 400 });
    }

    const auth = await requireStaffUser(request, clinicId);
    if (!auth.ok) return auth.response;

    // Active-clinic check: owned by requireStaffUser above, for every route at once. The local
    // copy that used to sit here tested `status` alone and let a date-expired clinic through.

    const entryRef = binEntry(entryId);
    const entrySnap = await entryRef.get();
    const entry = entrySnap.data();
    if (!entrySnap.exists || !entry) {
      return NextResponse.json({ ok: false, error: "That entry no longer exists." }, { status: 404 });
    }
    // The entry id is derivable from (clinic, collection, document), so it must be checked against
    // the caller's clinic rather than assumed to belong to them.
    if (entry.clinicId !== clinicId) {
      return NextResponse.json({ ok: false, error: "That entry belongs to another clinic." }, { status: 403 });
    }

    const collection = String(entry.collection || "");
    const documentId = String(entry.documentId || "");

    // Re-validate the path out of the entry. Never build a write from stored data unchecked.
    const binnable = checkBinnable(collection, documentId);
    if (!binnable.ok) {
      return NextResponse.json({ ok: false, error: binnable.error, reason: binnable.reason }, { status: binnable.status });
    }

    const allowed = checkRestoreAllowed(
      collection,
      binnable.rule,
      { role: auth.role, permissions: auth.permissions },
      (c) => COLLECTION_WRITE_PERMISSIONS.create[c] ?? null
    );
    if (allowed !== true) {
      return NextResponse.json({ ok: false, error: allowed.error, reason: allowed.reason }, { status: allowed.status });
    }

    const payloadSnap = await binPayload(entryId).get();
    const snapshot = (payloadSnap.data()?.snapshot ?? null) as Record<string, unknown> | null;
    if (!snapshot) {
      return NextResponse.json(
        { ok: false, error: "The saved copy of this record is missing and it cannot be restored." },
        { status: 410 }
      );
    }

    const targetRef = adminClinicDoc(clinicId, collection, documentId);
    if (!targetRef.path.startsWith(`clinics/${clinicId}/`)) {
      return NextResponse.json({ ok: false, error: "Refusing to write outside the clinic." }, { status: 400 });
    }

    // Outbound foreign keys: a prescription whose patient is gone is live medical data that no
    // screen can reach, because every read of it is `where patientId ==` issued from a patient
    // page that will not load. It could never be deleted again either.
    const missingRefs: string[] = [];
    for (const field of binnable.rule.refFields) {
      const value = snapshot[field];
      if (typeof value !== "string" || !value.trim()) continue;
      const parentCollection = field === "patientId" ? "patients" : null;
      if (!parentCollection) continue;
      const parent = await adminClinicDoc(clinicId, parentCollection, value.trim()).get();
      if (!parent.exists) missingRefs.push("the patient this record belongs to");
    }

    // A name collision is invisible on screen but decides real behaviour — two services with the
    // same name make the price a patient is charged arbitrary.
    let duplicateOf: string | null = null;
    if (binnable.rule.uniqueBy?.length) {
      const query = binnable.rule.uniqueBy.reduce(
        (q, field) => {
          const value = snapshot[field];
          return typeof value === "string" && value.trim() ? q.where(field, "==", value.trim()) : q;
        },
        adminClinicCollection(clinicId, collection).limit(1) as FirebaseFirestore.Query
      );
      const dupes = await query.get();
      if (!dupes.empty) {
        duplicateOf = binnable.rule.uniqueBy.map((f) => String(snapshot[f] ?? "")).filter(Boolean).join(" ");
      }
    }

    const result = await adminDb().runTransaction(async (tx) => {
      const freshEntry = await tx.get(entryRef);
      const freshTarget = await tx.get(targetRef);

      const verdict = checkRestorable({
        collection,
        entryStatus: String(freshEntry.data()?.status || ""),
        targetExists: freshTarget.exists,
        missingRefs,
        duplicateOf,
        snapshot,
        acknowledgeDuplicate,
        actorIsAdmin: auth.role === "Admin",
      });
      if (verdict !== true) return verdict;

      // `create`, not `set`: if anything appeared between the read above and this write, the
      // transaction fails rather than silently overwriting it.
      tx.create(targetRef, {
        ...snapshot,
        ...restoreOverrides(collection, snapshot),
        // A verbatim write-back is otherwise indistinguishable from a record nobody ever
        // questioned. This is sharpest for a deliberately-removed diagnosis chat or a prescription
        // republished weeks later.
        restoredAt: FieldValue.serverTimestamp(),
        restoredFromBinEntryId: entryId,
      });
      tx.update(entryRef, {
        status: "restored",
        restoredAt: FieldValue.serverTimestamp(),
        restoredByUid: auth.uid,
        restoredByName: auth.name,
        expiresAt: FieldValue.delete(),
      });
      return true as const;
    });

    if (result !== true) {
      return NextResponse.json({ ok: false, error: result.error, reason: result.reason }, { status: result.status });
    }

    // The fact of the deletion outlives the copy of the data, and the live id is freed so the same
    // record can be binned again later.
    await writeHistory({ ...entry, restoredByUid: auth.uid }, "restored");
    await binPayload(entryId).delete().catch(() => {});
    await entryRef.delete().catch(() => {});

    await logActivityServer({
      clinicId,
      user: { uid: auth.uid, name: auth.name, role: auth.role },
      action: "Record Restored",
      details: `Restored ${collection}/${documentId} (${entry.label || "record"}) from Recently Deleted`,
      severity: "HIGH",
      module: logModuleFor([collection]),
    });

    return NextResponse.json({ ok: true, collection, documentId });
  } catch (error: unknown) {
    reportServerError("records/restore failed", error);
    const message = error instanceof Error ? error.message : "Restore failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
