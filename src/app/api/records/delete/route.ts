import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { logActivityServer } from "@/lib/server/systemLog";
import { reportServerError } from "@/lib/server/reportError";
import { recordLedgerAuditBatch } from "@/lib/server/ledgerAudit";
import {
  MAX_ACTION_BYTES,
  MAX_ITEMS_PER_ACTION,
  MAX_SNAPSHOT_BYTES,
  PATIENT_CASCADE_COLLECTIONS,
  PER_DOCUMENT_OVERHEAD_BYTES,
  cascadeCounts,
  checkBinnable,
  checkCascadeAllowed,
  checkClaimCascade,
  checkDeleteAllowed,
  checkPatientCascade,
  claimLinkedRows,
  labelFor,
  logModuleFor,
} from "@/lib/recycleBin";
import {
  approximateBytes,
  binEntry,
  binPayload,
  expiryTimestamp,
  liveEntryId,
  storagePathsFrom,
  stripUndefined,
} from "@/lib/server/recycleBinStore";

/**
 * Deleting a record now means moving it to the bin.
 *
 * Before this, the assistant photographed a record before deleting it while a person clicking
 * Delete did not — the AI was recoverable and the human was not. A deleted patient left one line
 * in the activity log saying a patient of that name once existed, carrying none of her data.
 *
 * EVERY BOUNDARY HERE IS RE-ENFORCED, NOT INHERITED. This runs on the Admin SDK, which bypasses
 * firestore.rules completely, so the tenant prefix, the collection allow-list, the Admin-only
 * narrowings and the active-clinic check all have to exist in code or they are simply absent. The
 * decisions live in src/lib/recycleBin.ts and are covered by tests/recycleBin.test.mjs.
 *
 * The unit is the USER'S ACTION, not the document. A single deleteDoc was already atomic and never
 * needed help; what needed help is the gallery's bulk delete — a Promise.all over N ids where a
 * failure halfway leaves some gone and some not, with no record of which. One request, one
 * actionId, one batch.
 *
 * POST { clinicId, items: [{ collection, documentId }], reason?, acknowledgeOrphans? }
 *
 * Some records take others with them, as children of their entry (`cascadeOf`): hidden from the
 * list, restored with the parent, purged with it.
 *
 *   - An insurance approval takes the ledger charge and the clinical note it wrote for each
 *     approved line. Refused per item ("blocked") once any of those charges has money against it,
 *     because the payments would be left settling nothing.
 *   - A patient takes their whole file (PATIENT_CASCADE_COLLECTIONS): charges and payments,
 *     visits, notes, approvals, images, ortho work. Payments go too — the charges they settle go
 *     with them, so the books stay whole on both sides of the delete. Only someone who could
 *     delete each kind of record on its own may (checkCascadeAllowed). The first call answers 409
 *     HAS_CHILDREN with the counts so the screen can say what will go; `acknowledgeOrphans: true`
 *     (the name predates the cascade) is the person saying yes. A record named in the same request
 *     that belongs to a patient being deleted goes as part of that patient's file, so the two can
 *     never part company.
 *
 * Everything, children included, is one commit: all of it moves or none of it does. Every delete
 * in it carries the update time it was read at, so a record edited between the read and the
 * commit fails the whole commit instead of being binned as its older self.
 */

type Item = { collection: string; documentId: string };
type Child = {
  collection: string;
  documentId: string;
  ref: FirebaseFirestore.DocumentReference;
  data: Record<string, unknown>;
  updateTime?: FirebaseFirestore.Timestamp;
};

const keyOf = (i: Item) => `${i.collection}|${i.documentId}`;

/** Firestore's code for a failed precondition: something changed after it was read. */
function isChangedUnderUs(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 9 || code === "failed-precondition" || code === "FAILED_PRECONDITION";
}

/**
 * Everything in the clinic that finds this patient by `patientId`, plus the ortho case filed under
 * the patient's own id (one written before the field existed has nothing to query by). A numeric
 * id is also looked for as a number: records imported from older systems stored it that way.
 */
async function loadPatientFile(clinicId: string, patientId: string): Promise<Child[]> {
  const found = new Map<string, Child>();
  const add = (collection: string, snap: FirebaseFirestore.DocumentSnapshot) => {
    const data = snap.data();
    if (!snap.exists || !data) return;
    if (!snap.ref.path.startsWith(`clinics/${clinicId}/`)) {
      throw new Error(`Refusing to touch a path outside the clinic: ${snap.ref.path}`);
    }
    found.set(`${collection}|${snap.id}`, { collection, documentId: snap.id, ref: snap.ref, data, updateTime: snap.updateTime });
  };
  const ids: Array<string | number> = /^\d{1,15}$/.test(patientId) ? [patientId, Number(patientId)] : [patientId];
  const byField = await Promise.all(
    PATIENT_CASCADE_COLLECTIONS.map(async (collection) => ({
      collection,
      snap: await adminClinicCollection(clinicId, collection).where("patientId", "in", ids).get(),
    })),
  );
  for (const { collection, snap } of byField) for (const d of snap.docs) add(collection, d);
  add("ortho_cases", await adminClinicDoc(clinicId, "ortho_cases", patientId).get());
  return [...found.values()];
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;
    const acknowledgeOrphans = body?.acknowledgeOrphans === true;
    const rawItems = Array.isArray(body?.items) ? body.items : [];

    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
    }
    if (rawItems.length === 0) {
      return NextResponse.json({ ok: false, error: "Nothing to delete" }, { status: 400 });
    }
    if (rawItems.length > MAX_ITEMS_PER_ACTION) {
      return NextResponse.json(
        { ok: false, error: `Too many records at once (limit ${MAX_ITEMS_PER_ACTION}).` },
        { status: 400 }
      );
    }

    const auth = await requireStaffUser(request, clinicId);
    if (!auth.ok) return auth.response;
    const actor = { role: auth.role, permissions: auth.permissions };

    // The active-clinic check used to live here, as a local copy. It read `status` only, so a
    // clinic whose expiresAt had passed but whose status nobody had flipped still deleted freely
    // — which is the exact gap that made isClinicActive in the rules stop trusting status alone.
    // requireStaffUser now owns the decision for every route, using the same rule the rules use.

    // Validate EVERY item before touching anything. One bad item fails the whole request — a
    // partial delete driven by a malformed batch is the worst of both outcomes.
    const validated: Item[] = [];
    for (const raw of rawItems) {
      const verdict = checkBinnable(raw?.collection, raw?.documentId);
      if (!verdict.ok) {
        return NextResponse.json({ ok: false, error: verdict.error, reason: verdict.reason }, { status: verdict.status });
      }
      const permission = checkDeleteAllowed(verdict.rule, actor);
      if (permission !== true) {
        return NextResponse.json(
          { ok: false, error: permission.error, reason: permission.reason },
          { status: permission.status }
        );
      }
      validated.push({ collection: String(raw.collection).trim(), documentId: String(raw.documentId).trim() });
    }

    // Read everything first. Firestore reports success for deleting a document that is not there,
    // so without this the route would cheerfully report "deleted" and write an empty snapshot.
    const reads = await Promise.all(
      validated.map(async (item) => {
        const ref = adminClinicDoc(clinicId, item.collection, item.documentId);
        // Last line of defence: whatever the helpers did, the path must be inside this tenant.
        if (!ref.path.startsWith(`clinics/${clinicId}/`)) {
          throw new Error(`Refusing to touch a path outside the clinic: ${ref.path}`);
        }
        const snap = await ref.get();
        return { item, ref, exists: snap.exists, data: snap.data(), updateTime: snap.updateTime };
      })
    );

    const actionId = adminDb().collection("_").doc().id;
    const results: Array<{ collection: string; documentId: string; status: string; error?: string; linked?: number }> = [];
    const present = reads.filter((r) => r.exists && r.data);

    for (const missing of reads.filter((r) => !r.exists || !r.data)) {
      results.push({ ...missing.item, status: "notFound" });
    }

    // Each patient's file, read before anything is queued. A record named in this request that is
    // in one of those files goes as part of it, never on its own: done separately it could be
    // refused (a paid approval) while its patient went, and the two would be parted.
    const childrenOf = new Map<string, Child[] | { blocked: string }>();
    const patientOfChild = new Map<string, string>();
    for (const row of present) {
      if (row.item.collection !== "patients") continue;
      const file = await loadPatientFile(clinicId, row.item.documentId);
      childrenOf.set(keyOf(row.item), file);
      for (const c of file) patientOfChild.set(keyOf(c), keyOf(row.item));
    }
    const ownRows = present.filter((r) => !patientOfChild.has(keyOf(r.item)));

    // An approval's treatment rows: whether any has been paid decides whether it may go at all.
    for (const row of ownRows) {
      if (row.item.collection !== "insurance_claims") continue;
      const links = claimLinkedRows(row.data as Record<string, unknown>);
      if (links.length === 0) continue;
      const targets = links.flatMap((l) => [
        { collection: "ledger", documentId: l.ledgerId },
        { collection: "clinical_notes", documentId: l.noteId },
      ]);
      const snaps = await Promise.all(targets.map((t) => adminClinicDoc(clinicId, t.collection, t.documentId).get()));
      const charges = snaps.filter((_, i) => targets[i].collection === "ledger").map((snap) => (snap.exists ? snap.data() : null));
      const verdict = checkClaimCascade(charges);
      if (verdict !== true) {
        childrenOf.set(keyOf(row.item), { blocked: verdict.error });
        continue;
      }
      childrenOf.set(
        keyOf(row.item),
        snaps.flatMap((snap, i) => {
          const data = snap.data();
          if (!snap.exists || !data) return [];
          if (!snap.ref.path.startsWith(`clinics/${clinicId}/`)) throw new Error(`Refusing to touch a path outside the clinic: ${snap.ref.path}`);
          return [{ ...targets[i], ref: snap.ref, data, updateTime: snap.updateTime }];
        }),
      );
    }

    // What the patients' files hold: who may move them, and — before anything moves — what will go.
    const patientRows = ownRows.filter((r) => r.item.collection === "patients");
    if (patientRows.length > 0) {
      const counts: Record<string, number> = {};
      for (const row of patientRows) {
        const children = childrenOf.get(keyOf(row.item));
        if (!Array.isArray(children)) continue;
        for (const [collection, n] of Object.entries(cascadeCounts(children))) counts[collection] = (counts[collection] || 0) + n;
      }
      const allowed = checkCascadeAllowed(counts, actor);
      if (allowed !== true) {
        return NextResponse.json({ ok: false, error: allowed.error, reason: allowed.reason }, { status: allowed.status });
      }
      if (Object.keys(counts).length > 0 && !acknowledgeOrphans) {
        return NextResponse.json(
          {
            ok: false,
            reason: "HAS_CHILDREN",
            error: "Deleting this patient also moves their linked records to Recently Deleted. Restoring the patient brings them all back.",
            counts,
          },
          { status: 409 }
        );
      }
    }

    const batch = adminDb().batch();
    let queued = 0;
    let actionBytes = 0;
    const binnedLedger: Array<{ id: string; before: Record<string, unknown>; via: string }> = [];
    let linkedTotal = 0;
    // An approval deleted in the same request as another approval's rows, or the like: each
    // document is queued once, under whichever entry reached it first.
    const queuedKeys = new Set(ownRows.map((r) => keyOf(r.item)));

    for (const [index, row] of ownRows.entries()) {
      const cascade = childrenOf.get(keyOf(row.item));
      if (cascade && "blocked" in cascade) {
        results.push({ ...row.item, status: "blocked", error: cascade.blocked });
        continue;
      }
      const children = (cascade ?? []).filter((c) => !queuedKeys.has(keyOf(c))).map((c) => {
        const childSnapshot = stripUndefined(c.data);
        return { ...c, snapshot: childSnapshot, bytes: approximateBytes(childSnapshot), entryId: liveEntryId(clinicId, c.collection, c.documentId) };
      });

      const snapshot = stripUndefined(row.data as Record<string, unknown>);
      const bytes = approximateBytes(snapshot);
      const oversized = children.find((c) => c.bytes > MAX_SNAPSHOT_BYTES);
      if (bytes > MAX_SNAPSHOT_BYTES || oversized) {
        results.push({
          ...row.item,
          status: "tooLarge",
          error: oversized
            ? `"${labelFor(oversized.collection, oversized.snapshot)}" is too large to move to the bin. Export it first.`
            : "This record is too large to move to the bin. Export it first.",
        });
        continue;
      }

      const childEntries = children.length ? await adminDb().getAll(...children.map((c) => binEntry(c.entryId))) : [];
      const childrenInBin = children.filter((_, i) => childEntries[i].exists && childEntries[i].data()?.status === "deleted");
      const perDocument = PER_DOCUMENT_OVERHEAD_BYTES + (reason?.length ?? 0);
      const rowBytes = bytes + children.reduce((sum, c) => sum + c.bytes, 0) + (children.length + 1) * perDocument;

      if (row.item.collection === "patients") {
        const verdict = checkPatientCascade({
          alreadyInBin: childrenInBin.map((c) => labelFor(c.collection, c.snapshot)),
          totalBytes: actionBytes + rowBytes,
        });
        if (verdict !== true) {
          results.push({ ...row.item, status: verdict.reason === "TOO_LARGE" ? "tooLarge" : "alreadyInBin", error: verdict.error });
          continue;
        }
      } else {
        if (childrenInBin.length > 0) {
          results.push({ ...row.item, status: "alreadyInBin", error: "An earlier version of this record is already in Recently Deleted." });
          continue;
        }
        if (actionBytes + rowBytes > MAX_ACTION_BYTES) {
          results.push({ ...row.item, status: "tooLarge", error: "Too much to move to the bin in one go. Delete fewer records at once." });
          continue;
        }
      }

      const entryId = liveEntryId(clinicId, row.item.collection, row.item.documentId);
      const ref = binEntry(entryId);
      const existing = await ref.get();
      if (existing.exists && existing.data()?.status === "deleted") {
        // The live id is one-per-target, so this can only mean the document was recreated and
        // deleted again while the first entry is still in the bin. Refuse rather than overwrite
        // the older snapshot, which may be the one someone is about to restore.
        results.push({
          ...row.item,
          status: "alreadyInBin",
          error: "An earlier version of this record is already in Recently Deleted.",
        });
        continue;
      }

      const label = labelFor(row.item.collection, snapshot);
      batch.set(ref, {
        clinicId,
        collection: row.item.collection,
        documentId: row.item.documentId,
        label,
        deletedByUid: auth.uid,
        deletedByName: auth.name,
        deletedAt: FieldValue.serverTimestamp(),
        expiresAt: expiryTimestamp(),
        actionId,
        actionIndex: index,
        actionSize: ownRows.length,
        reason,
        storagePaths: storagePathsFrom(row.item.collection, snapshot),
        snapshotBytes: bytes,
        status: "deleted",
        ...(children.length ? { cascadeCounts: cascadeCounts(children) } : {}),
      });
      batch.set(binPayload(entryId), { snapshot });
      batch.delete(row.ref, row.updateTime ? { lastUpdateTime: row.updateTime } : {});
      // The children, binned exactly like the parent and tied to its entry, so Recently Deleted
      // holds all of them and restoring the parent brings them all back.
      const via = row.item.collection === "patients" ? "records/delete:patient" : "records/delete:approval";
      for (const c of children) {
        batch.set(binEntry(c.entryId), {
          clinicId,
          collection: c.collection,
          documentId: c.documentId,
          label: labelFor(c.collection, c.snapshot),
          deletedByUid: auth.uid,
          deletedByName: auth.name,
          deletedAt: FieldValue.serverTimestamp(),
          expiresAt: expiryTimestamp(),
          actionId,
          actionIndex: index,
          actionSize: ownRows.length,
          reason,
          storagePaths: storagePathsFrom(c.collection, c.snapshot),
          snapshotBytes: c.bytes,
          status: "deleted",
          cascadeOf: entryId,
          cascadeParentLabel: label,
        });
        batch.set(binPayload(c.entryId), { snapshot: c.snapshot });
        batch.delete(c.ref, c.updateTime ? { lastUpdateTime: c.updateTime } : {});
        queuedKeys.add(keyOf(c));
        if (c.collection === "ledger") binnedLedger.push({ id: c.documentId, before: c.snapshot, via });
      }
      actionBytes += rowBytes;
      linkedTotal += children.length;
      queued++;
      results.push({ ...row.item, status: "deleted", ...(children.length ? { linked: children.length } : {}) });
    }

    // The records named in the request that went (or did not) as part of their patient's file.
    for (const row of present.filter((r) => patientOfChild.has(keyOf(r.item)))) {
      const parent = results.find((r) => keyOf(r) === patientOfChild.get(keyOf(row.item)));
      results.push({
        ...row.item,
        status: parent?.status ?? "notFound",
        ...(parent?.status === "deleted" ? {} : { error: parent?.error ?? "Its patient could not be deleted." }),
      });
    }

    if (queued > 0) {
      try {
        await batch.commit();
      } catch (err) {
        if (!isChangedUnderUs(err)) throw err;
        return NextResponse.json(
          { ok: false, reason: "CHANGED", error: "Something changed while this was being deleted. Nothing was moved — try again." },
          { status: 409 }
        );
      }
    }

    // Money left the books: the before-copy of every charge and payment, as every other money
    // delete records it. Never throws, so it cannot undo a delete that has already happened.
    if (binnedLedger.length > 0) {
      await recordLedgerAuditBatch(
        binnedLedger.map((l) => ({
          clinicId,
          action: "delete" as const,
          collection: "ledger" as const,
          documentId: l.id,
          before: l.before,
          actor: { uid: auth.uid, name: auth.name, role: auth.role },
          via: l.via,
        })),
      );
    }

    const deletedCount = results.filter((r) => r.status === "deleted").length;
    if (deletedCount > 0) {
      const breakdown = [...new Set(validated.map((v) => v.collection))].join(", ");
      const linked = linkedTotal > 0 ? ` with ${linkedTotal} linked record(s)` : "";
      await logActivityServer({
        clinicId,
        user: { uid: auth.uid, name: auth.name, role: auth.role },
        action: "Records Deleted",
        details: `Moved ${deletedCount} record(s) to Recently Deleted (${breakdown})${linked}${reason ? ` — ${reason}` : ""}`,
        severity: validated.some((v) => v.collection === "patients") ? "CRITICAL" : "HIGH",
        module: logModuleFor(validated.map((v) => v.collection)),
      });
    }

    return NextResponse.json({ ok: true, actionId, deleted: deletedCount, results });
  } catch (error: unknown) {
    reportServerError("records/delete failed", error);
    const message = error instanceof Error ? error.message : "Delete failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
