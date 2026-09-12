import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import {
  INVITES_COLLECTION,
  generateInviteCode,
  inviteExpiry,
  inviteStatus,
  isInvitableRole,
  normalizeInviteCode,
} from "@/lib/inviteLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Invite links, for the clinic's admins: make one, list them, revoke one.
 *
 *   GET  ?clinicId=…                              → this clinic's invites, newest first
 *   POST { action: "create", clinicId, role, maxUses? }
 *   POST { action: "revoke", clinicId, code }
 *
 * Admin of THIS clinic, checked against the clinicId in the request — never "an admin
 * somewhere". Accepting a link is a different caller with a different check and lives in
 * ./accept. The collection is root-level and has no firestore.rules entry, so nothing here can
 * be reached from a browser except through these routes.
 */
function summarize(id: string, data: FirebaseFirestore.DocumentData) {
  const toIso = (v: unknown) => {
    const d = (v as { toDate?: () => Date })?.toDate?.();
    return d ? d.toISOString() : null;
  };
  return {
    code: id,
    role: data.role,
    status: inviteStatus(data),
    maxUses: typeof data.maxUses === "number" ? data.maxUses : 1,
    usedCount: typeof data.usedCount === "number" ? data.usedCount : 0,
    createdAt: toIso(data.createdAt),
    expiresAt: toIso(data.expiresAt),
    createdByName: typeof data.createdByName === "string" ? data.createdByName : null,
    usedBy: Array.isArray(data.usedBy)
      ? data.usedBy.map((u: Record<string, unknown>) => ({
          name: typeof u.name === "string" ? u.name : null,
          email: typeof u.email === "string" ? u.email : null,
          at: toIso(u.at),
        }))
      : [],
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const clinicId = (url.searchParams.get("clinicId") || "").trim();
    if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });

    const auth = await requireAdminUser(request, clinicId, { allowInactive: true });
    if (!auth.ok) return auth.response;

    const snap = await adminDb().collection(INVITES_COLLECTION).where("clinicId", "==", clinicId).get();
    const items = snap.docs
      .map((d) => summarize(d.id, d.data()))
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    reportServerError("invites list error:", error);
    return NextResponse.json({ ok: false, error: "Could not load invites" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });

    const auth = await requireAdminUser(request, clinicId);
    if (!auth.ok) return auth.response;

    const db = adminDb();
    const invites = db.collection(INVITES_COLLECTION);

    if (body?.action === "create") {
      if (!isInvitableRole(body?.role)) {
        return NextResponse.json({ ok: false, error: "Pick a role the link may grant" }, { status: 400 });
      }
      // 1 by default; up to 20 for "the whole front desk". Never unlimited.
      const maxUses = Math.min(20, Math.max(1, Math.floor(Number(body?.maxUses) || 1)));

      let createdByName: string | null = auth.name || null;
      if (!createdByName) {
        try {
          createdByName = (await adminAuth().getUser(auth.uid)).displayName ?? null;
        } catch {
          /* the uid is recorded regardless */
        }
      }

      const clinicSnap = await db.collection("clinics").doc(clinicId).get();
      const clinicName = typeof clinicSnap.data()?.name === "string" ? clinicSnap.data()!.name : "";

      // A fresh code, retried on the vanishingly rare collision.
      let code = generateInviteCode();
      for (let i = 0; i < 5 && (await invites.doc(code).get()).exists; i++) code = generateInviteCode();

      const record = {
        clinicId,
        clinicName,
        role: body.role as string,
        maxUses,
        usedCount: 0,
        usedBy: [] as unknown[],
        createdBy: auth.uid,
        createdByName,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: inviteExpiry(),
      };
      await invites.doc(code).set(record);
      return NextResponse.json({ ok: true, code, expiresAt: record.expiresAt.toISOString(), role: record.role, maxUses });
    }

    if (body?.action === "revoke") {
      const code = normalizeInviteCode(body?.code);
      if (!code) return NextResponse.json({ ok: false, error: "code is required" }, { status: 400 });
      const ref = invites.doc(code);
      const snap = await ref.get();
      // The caller proved they administer clinicId; the invite must belong to that same clinic.
      if (!snap.exists || snap.data()?.clinicId !== clinicId) {
        return NextResponse.json({ ok: false, error: "No such invite for this clinic" }, { status: 404 });
      }
      await ref.set({ revokedAt: FieldValue.serverTimestamp(), revokedBy: auth.uid }, { merge: true });
      return NextResponse.json({ ok: true, code });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    reportServerError("invites error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
