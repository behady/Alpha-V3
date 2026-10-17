import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { isOwnerRole } from "@/lib/permissions";
import {
  RENAME_SKIP_COLLECTIONS,
  renameInDocument,
  validateStaffName,
  type RenameTarget,
} from "@/lib/staffRename";

// A clinic's whole history is read once; a busy clinic's ledger alone can be thousands of rows.
export const maxDuration = 300;

const PAGE = 500;

/**
 * Rename a member of staff, and every copy of their name in this clinic's records.
 *
 * Body: { clinicId, staffId, name }. Admins only. The staff row, the login's profile and its Auth
 * display name take the new name first; then each of the clinic's collections is read page by page
 * and every document that copied the old name is corrected (see lib/staffRename for what counts).
 *
 * Safe to run again: a second run with the same name finds nothing left to change, so a rename cut
 * short by a timeout is finished by pressing Save once more.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const staffId = typeof body?.staffId === "string" ? body.staffId.trim() : "";
    if (!clinicId || !staffId) {
      return NextResponse.json({ ok: false, error: "clinicId and staffId are required" }, { status: 400 });
    }

    const auth = await requireAdminUser(request, clinicId);
    if (!auth.ok) return auth.response;

    const valid = validateStaffName(body?.name);
    if (!valid.ok) return NextResponse.json({ ok: false, error: valid.error }, { status: 400 });
    const newName = valid.name;

    const db = adminDb();
    const clinicRef = db.collection("clinics").doc(clinicId);
    const staffRef = clinicRef.collection("staff").doc(staffId);
    const staffSnap = await staffRef.get();
    if (!staffSnap.exists) {
      return NextResponse.json({ ok: false, error: "Staff member not found" }, { status: 404 });
    }
    const staff = staffSnap.data() || {};
    const uid = typeof staff.uid === "string" ? staff.uid : "";

    // The owner's record is the owner's to edit — the same line update-user draws.
    if (isOwnerRole(String(staff.role || "")) && auth.uid !== uid) {
      return NextResponse.json(
        { ok: false, error: "Only the clinic owner can change their own name." },
        { status: 403 }
      );
    }

    // Allow `body.oldName` so a rename that timed out half way can be re-run after the staff row
    // already carries the new name: the row says "Norhan Ali", the old records still say "Norhan".
    const storedName = typeof staff.name === "string" ? staff.name.trim() : "";
    const oldName =
      typeof body?.oldName === "string" && body.oldName.trim() ? body.oldName.trim() : storedName;

    // 1. The person themself.
    if (storedName !== newName) {
      await staffRef.update({ name: newName, updatedAt: FieldValue.serverTimestamp() });
    }
    if (uid) {
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      if (userSnap.exists && userSnap.data()?.name !== newName) {
        await userRef.update({ name: newName, updatedAt: FieldValue.serverTimestamp() });
      }
      try {
        await adminAuth().updateUser(uid, { displayName: newName });
      } catch (error) {
        // The profile document is what the app shows; a stale Auth display name only seeds a
        // brand-new profile, so this is not worth failing the rename over.
        reportServerError("admin/rename-staff:auth", error);
      }
    }

    if (!oldName || oldName === newName) {
      return NextResponse.json({ ok: true, name: newName, documents: 0, fields: 0 });
    }

    // 2. Every record that copied the old name.
    const target: RenameTarget = { oldName, newName, ids: [staffId, uid].filter(Boolean) };
    const writer = db.bulkWriter();
    let documents = 0;
    let fields = 0;
    const touched: Record<string, number> = {};

    const collections = await clinicRef.listCollections();
    for (const col of collections) {
      if (RENAME_SKIP_COLLECTIONS.has(col.id)) continue;
      let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      for (;;) {
        let q = col.orderBy(FieldPath.documentId()).limit(PAGE);
        if (last) q = q.startAfter(last);
        const page = await q.get();
        for (const d of page.docs) {
          const { patch, changes } = renameInDocument(d.data(), target);
          if (!changes) continue;
          // merge, not update: a top-level key with a dot in it would be read as a path by update().
          void writer.set(d.ref, patch, { merge: true });
          documents++;
          fields += changes;
          touched[col.id] = (touched[col.id] || 0) + 1;
        }
        if (page.size < PAGE) break;
        last = page.docs[page.docs.length - 1];
      }
    }
    await writer.close();

    // The activity-log line is written by the screen, with logActivity, like every other change on it.
    return NextResponse.json({ ok: true, name: newName, documents, fields, collections: touched });
  } catch (error) {
    reportServerError("admin/rename-staff", error);
    const message = error instanceof Error ? error.message : "Rename failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
