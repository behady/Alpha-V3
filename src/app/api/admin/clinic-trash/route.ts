import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminAuth } from "@/lib/firebaseAdmin";
import { requireSuperAdmin } from "@/lib/apiStaffAuth";
import {
  DELETED_CLINICS_COLLECTION,
  headerFromTrash,
  trashRecordFrom,
  typedNameMatches,
} from "@/lib/clinicTrash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deleting a clinic from the superadmin console, and undoing it.
 *
 * Server-side on purpose. The old button called deleteDoc from the browser, and the rules let a
 * superadmin do that, so one click on the wrong row took a live clinic off the air with no copy
 * anywhere. Here the header is copied to `deleted_clinics/{id}` in the same transaction that
 * removes it, and the person must have typed the clinic's exact name. The rules never have to
 * open `deleted_clinics` to anyone: it is read and written only through this route.
 *
 * Only the header moves. Everything under `clinics/{id}/` stays where it is, which is what made
 * the recovery possible and is what makes Restore instant — recreate the header and every
 * patient, ledger row and note is reachable again.
 *
 *   GET                               → the trash, newest first
 *   POST { action: "delete",  clinicId, confirmName }
 *   POST { action: "restore", clinicId }
 */
export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;
  try {
    const snap = await adminDb().collection(DELETED_CLINICS_COLLECTION).get();
    const items = snap.docs
      .map((d) => {
        const data = d.data();
        const deletedAt = data.deletedAt?.toDate?.() as Date | undefined;
        return {
          id: d.id,
          name: typeof data.name === "string" ? data.name : "(unnamed)",
          ownerId: typeof data.ownerId === "string" ? data.ownerId : null,
          subscriptionTier: typeof data.subscriptionTier === "string" ? data.subscriptionTier : null,
          deletedAt: deletedAt ? deletedAt.toISOString() : null,
          deletedByEmail: typeof data.deletedByEmail === "string" ? data.deletedByEmail : null,
        };
      })
      .sort((a, b) => (b.deletedAt || "").localeCompare(a.deletedAt || ""));
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    reportServerError("clinic-trash list error:", error);
    return NextResponse.json({ ok: false, error: "Could not read the trash" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
    }

    const db = adminDb();
    const clinicRef = db.collection("clinics").doc(clinicId);
    const trashRef = db.collection(DELETED_CLINICS_COLLECTION).doc(clinicId);

    if (action === "delete") {
      const snap = await clinicRef.get();
      if (!snap.exists) {
        return NextResponse.json({ ok: false, error: "That clinic no longer exists" }, { status: 404 });
      }
      const header = snap.data() || {};
      if (!typedNameMatches(body?.confirmName, header.name)) {
        return NextResponse.json(
          { ok: false, error: "The name you typed does not match the clinic's name. Nothing was deleted." },
          { status: 400 }
        );
      }

      let email: string | null = null;
      try {
        email = (await adminAuth().getUser(auth.uid)).email ?? null;
      } catch {
        // The uid is recorded either way.
      }

      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(clinicRef);
        if (!fresh.exists) throw new Error("That clinic no longer exists");
        tx.set(
          trashRef,
          trashRecordFrom(fresh.data() || {}, { uid: auth.uid, email, at: FieldValue.serverTimestamp() })
        );
        tx.delete(clinicRef);
      });
      return NextResponse.json({ ok: true, clinicId, name: header.name });
    }

    if (action === "restore") {
      await db.runTransaction(async (tx) => {
        const trash = await tx.get(trashRef);
        if (!trash.exists) throw new Error("Nothing to restore: that clinic is not in the trash");
        const live = await tx.get(clinicRef);
        if (live.exists) throw new Error("That clinic already exists; nothing was overwritten");
        tx.set(clinicRef, headerFromTrash(trash.data() || {}));
        tx.delete(trashRef);
      });
      return NextResponse.json({ ok: true, clinicId });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    reportServerError("clinic-trash error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
