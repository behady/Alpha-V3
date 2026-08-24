import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { logActivityServer } from "@/lib/server/systemLog";
import { reportServerError } from "@/lib/server/reportError";
import {
  MAX_ITEMS_PER_ACTION,
  MAX_SNAPSHOT_BYTES,
  checkBinnable,
  checkDeleteAllowed,
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
 */

const CHILD_COLLECTIONS = [
  "ledger",
  "appointments",
  "prescriptions",
  "patient_media",
  "clinical_notes",
  "treatment_plans",
  "diagnosis_chats",
];

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

    // requireStaffUser proves membership; it does not check whether the clinic is still active.
    // memberMayWrite in the rules does, so without this an expired or suspended clinic could
    // delete through the route what the rules would refuse.
    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    const clinic = clinicSnap.data();
    if (!clinicSnap.exists || !clinic) {
      return NextResponse.json({ ok: false, error: "Clinic not found" }, { status: 404 });
    }
    if ((clinic.status ?? "Active") !== "Active") {
      return NextResponse.json({ ok: false, error: "This clinic is not active." }, { status: 403 });
    }

    // Validate EVERY item before touching anything. One bad item fails the whole request — a
    // partial delete driven by a malformed batch is the worst of both outcomes.
    const validated: Array<{ collection: string; documentId: string }> = [];
    for (const raw of rawItems) {
      const verdict = checkBinnable(raw?.collection, raw?.documentId);
      if (!verdict.ok) {
        return NextResponse.json({ ok: false, error: verdict.error, reason: verdict.reason }, { status: verdict.status });
      }
      const permission = checkDeleteAllowed(verdict.rule, { role: auth.role, permissions: auth.permissions });
      if (permission !== true) {
        return NextResponse.json(
          { ok: false, error: permission.error, reason: permission.reason },
          { status: permission.status }
        );
      }
      validated.push({ collection: String(raw.collection).trim(), documentId: String(raw.documentId).trim() });
    }

    // Deleting a patient does not cascade, and this change does not add one — but it must not be
    // done blind. Count what would be left pointing at nothing and make the caller acknowledge it.
    const patientItems = validated.filter((i) => i.collection === "patients");
    if (patientItems.length > 0 && !acknowledgeOrphans) {
      const counts: Record<string, number> = {};
      for (const item of patientItems) {
        for (const child of CHILD_COLLECTIONS) {
          const snap = await adminClinicDoc(clinicId, "patients", item.documentId)
            .parent.parent!.collection(child)
            .where("patientId", "==", item.documentId)
            .count()
            .get();
          const n = snap.data().count;
          if (n > 0) counts[child] = (counts[child] || 0) + n;
        }
      }
      if (Object.keys(counts).length > 0) {
        return NextResponse.json(
          {
            ok: false,
            reason: "HAS_CHILDREN",
            error: "This patient has records that will be left behind.",
            counts,
          },
          { status: 409 }
        );
      }
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
        return { item, ref, exists: snap.exists, data: snap.data() };
      })
    );

    const actionId = adminDb().collection("_").doc().id;
    const results: Array<{ collection: string; documentId: string; status: string; error?: string }> = [];
    const present = reads.filter((r) => r.exists && r.data);

    for (const missing of reads.filter((r) => !r.exists || !r.data)) {
      results.push({ ...missing.item, status: "notFound" });
    }

    const batch = adminDb().batch();
    let queued = 0;

    for (const [index, row] of present.entries()) {
      const snapshot = stripUndefined(row.data as Record<string, unknown>);
      const bytes = approximateBytes(snapshot);
      if (bytes > MAX_SNAPSHOT_BYTES) {
        results.push({
          ...row.item,
          status: "tooLarge",
          error: "This record is too large to move to the bin. Export it first.",
        });
        continue;
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

      batch.set(ref, {
        clinicId,
        collection: row.item.collection,
        documentId: row.item.documentId,
        label: labelFor(row.item.collection, snapshot),
        deletedByUid: auth.uid,
        deletedByName: auth.name,
        deletedAt: FieldValue.serverTimestamp(),
        expiresAt: expiryTimestamp(),
        actionId,
        actionIndex: index,
        actionSize: present.length,
        reason,
        storagePaths: storagePathsFrom(row.item.collection, snapshot),
        snapshotBytes: bytes,
        status: "deleted",
      });
      batch.set(binPayload(entryId), { snapshot });
      batch.delete(row.ref);
      queued++;
      results.push({ ...row.item, status: "deleted" });
    }

    if (queued > 0) await batch.commit();

    const deletedCount = results.filter((r) => r.status === "deleted").length;
    if (deletedCount > 0) {
      const breakdown = [...new Set(validated.map((v) => v.collection))].join(", ");
      await logActivityServer({
        clinicId,
        user: { uid: auth.uid, name: auth.name, role: auth.role },
        action: "Records Deleted",
        details: `Moved ${deletedCount} record(s) to Recently Deleted (${breakdown})${reason ? ` — ${reason}` : ""}`,
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
