import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { expandPermissions } from "@/lib/permissions";

/**
 * Fills in `users/{uid}.clinicPermissions[clinicId]` for people who already work at this clinic.
 *
 * firestore.rules reads that map to decide what someone may write. Nothing ever wrote it, so the
 * rules fell through their "this account predates the permission system" branch and allowed every
 * write by everyone — see the header of src/lib/permissions.ts. The routes that seed and edit
 * permissions write it from now on; this is for the accounts that already exist.
 *
 * scripts/backfill-clinic-permissions.mjs does the same job across every clinic at once, but needs
 * a terminal and a service-account key. This route needs neither: it runs on the server where the
 * credentials already live, and a Clinic Admin can trigger it from Settings → Users.
 *
 * SCOPED TO THE CALLER'S CLINIC, and that matters. A user document is global — one person can work
 * at several clinics — so this only ever writes the single `clinicPermissions.<thisClinic>` key,
 * via a dotted path that merges rather than replacing. An Admin of one clinic can neither read nor
 * rewrite what someone may do at another.
 *
 * POST { clinicId, apply?: boolean }
 *   apply omitted or false → reports what it would do, writes nothing
 *   apply true             → writes
 */

const BATCH_LIMIT = 400; // Firestore caps a batch at 500

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const apply = body?.apply === true;

    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
    }

    // Admin of *this* clinic. The clinicId arrives in the body, so it is caller-controlled;
    // requireAdminUser checks the caller's role in that specific clinic rather than anywhere.
    const auth = await requireAdminUser(request, clinicId);
    if (!auth.ok) return auth.response;

    const db = adminDb();

    // Every account holding a role at this clinic.
    //
    // The indexed path is a query on `clinicRoles.<id>`, which reads this clinic's staff rather
    // than every user on the platform. Map subfields are auto-indexed by default, but a project
    // can carry an index exemption that turns that query into an error — and an error here would
    // be far worse than a slow read, because a backfill that quietly finds nobody leaves everyone
    // without a permission map and the rules then deny them all. So the fallback is a full scan
    // filtered in memory: slower, bounded by the number of staff accounts rather than patients,
    // and correct regardless of how the project is indexed.
    let userDocs;
    let scanMode: "indexed" | "full-scan" = "indexed";
    try {
      const snap = await db.collection("users").where(`clinicRoles.${clinicId}`, "!=", null).get();
      userDocs = snap.docs;
    } catch {
      scanMode = "full-scan";
      const snap = await db.collection("users").get();
      userDocs = snap.docs.filter((d) => {
        const roles = (d.data() || {}).clinicRoles;
        return roles && typeof roles === "object" && roles[clinicId];
      });
    }

    const planned: Array<{
      uid: string;
      name: string;
      role: string;
      willStore: string[];
      previous: string[] | null;
    }> = [];
    let alreadyCorrect = 0;

    for (const docSnap of userDocs) {
      const data = docSnap.data() || {};
      const role = String((data.clinicRoles || {})[clinicId] || "");
      const existing = (data.clinicPermissions || {})[clinicId];

      // The role's floor UNION whatever was explicitly granted. Not the stored array alone: the
      // browser's guards also admit people on their role, so enforcing the bare array would lock
      // staff out of work they can do today. See src/lib/permissions.ts.
      const willStore = expandPermissions(role, data.permissions);

      const unchanged =
        Array.isArray(existing) &&
        existing.length === willStore.length &&
        existing.every((v: unknown, i: number) => v === willStore[i]);

      if (unchanged) {
        alreadyCorrect++;
        continue;
      }

      planned.push({
        uid: docSnap.id,
        name: String(data.name || data.email || "(no name)"),
        role,
        willStore,
        previous: Array.isArray(existing) ? existing : null,
      });
    }

    if (!apply) {
      return NextResponse.json({
        ok: true,
        applied: false,
        scanned: userDocs.length,
        scanMode,
        alreadyCorrect,
        toWrite: planned.length,
        plan: planned,
      });
    }

    let written = 0;
    for (let i = 0; i < planned.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const row of planned.slice(i, i + BATCH_LIMIT)) {
        // Dotted path: merges into the map instead of replacing it, so this cannot disturb what
        // the person may do at any other clinic.
        batch.update(db.collection("users").doc(row.uid), {
          [`clinicPermissions.${clinicId}`]: row.willStore,
        });
      }
      await batch.commit();
      written += Math.min(BATCH_LIMIT, planned.length - i);
    }

    return NextResponse.json({
      ok: true,
      applied: true,
      scanned: userDocs.length,
      scanMode,
      alreadyCorrect,
      written,
      plan: planned,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Backfill failed";
    console.error("admin/backfill-permissions", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
