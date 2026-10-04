import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { COLLECTION_WRITE_PERMISSIONS, isFullAccessRole } from "@/lib/permissions";
import { logActivityServer } from "@/lib/server/systemLog";
import { reportServerError } from "@/lib/server/reportError";
import { recordLedgerAuditBatch } from "@/lib/server/ledgerAudit";
import {
  cascadeCollectionsFor,
  checkBinnable,
  checkNotCascadeChild,
  checkRestorable,
  checkRestoreAllowed,
  labelFor,
  logModuleFor,
  restoreOverrides,
} from "@/lib/recycleBin";
import { binCollection, binEntry, binPayload, writeHistory } from "@/lib/server/recycleBinStore";

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
 *
 * An entry can carry children (`cascadeOf` = its id): the treatment rows an insurance approval took
 * into the bin with it, or the whole file a patient did. They come back in the same transaction as
 * their parent, under the same never-overwrite rule, or nothing comes back. A child is never
 * restored on its own: it comes back with its parent.
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

    const notChild = checkNotCascadeChild(entry);
    if (notChild !== true) {
      return NextResponse.json({ ok: false, error: notChild.error, reason: notChild.reason }, { status: notChild.status });
    }

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

    // The children binned with this entry. Each is re-validated like the entry itself: same clinic,
    // a collection this parent may carry, a path inside the tenant.
    const allowedChildren = cascadeCollectionsFor(collection);
    const childDocs = (await binCollection().where("cascadeOf", "==", entryId).get()).docs.filter((d) => d.data().status === "deleted");
    const children: Array<{ entryRef: FirebaseFirestore.DocumentReference; entry: FirebaseFirestore.DocumentData; targetRef: FirebaseFirestore.DocumentReference; collection: string }> = [];
    for (const d of childDocs) {
      const child = d.data();
      const childCollection = String(child.collection || "");
      const childDocumentId = String(child.documentId || "");
      if (child.clinicId !== clinicId || !allowedChildren.includes(childCollection) || !childDocumentId || /[/\\]/.test(childDocumentId)) {
        return NextResponse.json({ ok: false, error: "A record deleted with this one cannot be restored. Please contact support." }, { status: 409 });
      }
      const childTarget = adminClinicDoc(clinicId, childCollection, childDocumentId);
      if (!childTarget.path.startsWith(`clinics/${clinicId}/`)) {
        return NextResponse.json({ ok: false, error: "Refusing to write outside the clinic." }, { status: 400 });
      }
      children.push({ entryRef: d.ref, entry: child, targetRef: childTarget, collection: childCollection });
    }

    const result = await adminDb().runTransaction(async (tx) => {
      const freshEntry = await tx.get(entryRef);
      const freshTarget = await tx.get(targetRef);
      // Every child's entry, saved copy and place, read in one round trip before anything is
      // written: a patient's file can be a few hundred documents.
      const childSnaps = children.length
        ? await tx.getAll(...children.flatMap((c) => [c.entryRef, binPayload(c.entryRef.id), c.targetRef]))
        : [];
      const childReads = children.map((c, i) => {
        const [freshChild, childPayload, childTarget] = childSnaps.slice(i * 3, i * 3 + 3);
        return { ...c, freshChild, snapshot: (childPayload.data()?.snapshot ?? null) as Record<string, unknown> | null, occupied: childTarget.exists };
      });
      if (childReads.some((c) => c.freshChild.data()?.status !== "deleted" || !c.snapshot)) {
        return { ok: false as const, status: 410, error: "A record deleted with this one is missing from Recently Deleted, so it cannot be restored.", reason: "CHILD_MISSING" };
      }
      const occupied = childReads.find((c) => c.occupied);
      if (occupied) {
        const name = String(occupied.entry.label || "") || labelFor(occupied.collection, occupied.snapshot ?? {});
        return { ok: false as const, status: 409, error: `"${name}", deleted with this one, already exists again. Compare the two and merge by hand.`, reason: "TARGET_OCCUPIED" };
      }

      const verdict = checkRestorable({
        collection,
        entryStatus: String(freshEntry.data()?.status || ""),
        targetExists: freshTarget.exists,
        missingRefs,
        duplicateOf,
        snapshot,
        acknowledgeDuplicate,
        actorIsAdmin: isFullAccessRole(auth.role),
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
      for (const c of childReads) {
        tx.create(c.targetRef, {
          ...(c.snapshot as Record<string, unknown>),
          ...restoreOverrides(c.collection, c.snapshot as Record<string, unknown>),
          restoredAt: FieldValue.serverTimestamp(),
          restoredFromBinEntryId: c.entryRef.id,
        });
        tx.update(c.entryRef, {
          status: "restored",
          restoredAt: FieldValue.serverTimestamp(),
          restoredByUid: auth.uid,
          restoredByName: auth.name,
          expiresAt: FieldValue.delete(),
        });
      }
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
    await Promise.all(
      children.map(async (c) => {
        await writeHistory({ ...c.entry, restoredByUid: auth.uid }, "restored");
        await binPayload(c.entryRef.id).delete().catch(() => {});
        await c.entryRef.delete().catch(() => {});
      }),
    );

    // Money came back into the books: recorded like any other money write.
    const restoredLedger = children.filter((c) => c.collection === "ledger");
    if (restoredLedger.length > 0) {
      const rows = await adminDb().getAll(...restoredLedger.map((c) => c.targetRef));
      await recordLedgerAuditBatch(
        restoredLedger.map((c, i) => ({
          clinicId,
          action: "create" as const,
          collection: "ledger" as const,
          documentId: c.targetRef.id,
          after: rows[i].data() ?? null,
          actor: { uid: auth.uid, name: auth.name, role: auth.role },
          via: "records/restore",
        })),
      );
    }

    await logActivityServer({
      clinicId,
      user: { uid: auth.uid, name: auth.name, role: auth.role },
      action: "Record Restored",
      details: `Restored ${collection}/${documentId} (${entry.label || "record"})${children.length ? ` with ${children.length} linked record(s)` : ""} from Recently Deleted`,
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
