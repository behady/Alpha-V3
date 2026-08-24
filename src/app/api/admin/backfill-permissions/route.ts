import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { expandPermissions } from "@/lib/permissions";

/**
 * Fills in `users/{uid}.clinicPermissions[clinicId]` — the field firestore.rules reads — for the
 * people who actually work at this clinic, and surfaces the accounts that only *look* like they do.
 *
 * The first cut of this route treated "holds a role for this clinic" as "works at this clinic".
 * The preview against real data said otherwise: the Users screen showed four members of staff, the
 * scan found twenty-eight accounts. The other two dozen were deleted staff whose role key was never
 * taken back by older delete code, test signups, and duplicate documents. None of them appear in
 * any screen — the Users page lists accounts joined to a staff record — but every one of them can
 * sign in and read the whole clinic today, because read access in the rules follows the role alone.
 * Backfilling them would have armed them with write permissions on top.
 *
 * So the staff collection is the boundary now:
 *
 *  - An account matching a staff record (by staffId, uid, or email — the same three-way match the
 *    rest of the admin code uses) is planned for backfill.
 *  - An account matching nothing is a GHOST: reported separately, never backfilled, and revocable
 *    here with `revoke: [uids]`, which deletes its role key and permission map for THIS clinic
 *    only. Revocation re-verifies each account server-side against live data — the UI's list may
 *    be stale — and refuses to revoke the caller.
 *
 * A legitimate member wrongly in the ghost list is a missing staff record, which is exactly what
 * /api/admin/repair rebuilds; run that first, then re-preview here.
 *
 * POST { clinicId, apply?: boolean }        → preview (default) or write the backfill
 * POST { clinicId, revoke: string[] }       → take this clinic's keys back from listed ghosts
 */

const BATCH_LIMIT = 400; // Firestore caps a batch at 500

type PlanRow = {
  uid: string;
  name: string;
  email: string;
  role: string;
  willStore: string[];
  previous: string[] | null;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const apply = body?.apply === true;
    const revoke: string[] = Array.isArray(body?.revoke)
      ? body.revoke.filter((u: unknown): u is string => typeof u === "string" && u.trim() !== "")
      : [];

    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
    }

    // Admin of *this* clinic. The clinicId arrives in the body, so it is caller-controlled;
    // requireAdminUser checks the caller's role in that specific clinic rather than anywhere.
    const auth = await requireAdminUser(request, clinicId);
    if (!auth.ok) return auth.response;

    const db = adminDb();

    // The clinic's real staff, indexed the three ways a user document can point at a record.
    const staffSnap = await db.collection(`clinics/${clinicId}/staff`).get();
    const staffIds = new Set<string>();
    const staffUids = new Set<string>();
    const staffEmails = new Set<string>();
    for (const s of staffSnap.docs) {
      staffIds.add(s.id);
      const d = s.data() || {};
      if (typeof d.uid === "string" && d.uid) staffUids.add(d.uid);
      if (typeof d.email === "string" && d.email) staffEmails.add(d.email.trim().toLowerCase());
    }

    const isStaffLinked = (docId: string, data: Record<string, unknown>): boolean => {
      const staffId = typeof data.staffId === "string" ? data.staffId : "";
      const uid = (typeof data.uid === "string" && data.uid) || docId;
      const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
      return (
        (staffId !== "" && staffIds.has(staffId)) ||
        staffUids.has(uid) ||
        (email !== "" && staffEmails.has(email))
      );
    };

    // --- revocation -----------------------------------------------------------------------------
    if (revoke.length > 0) {
      const revoked: string[] = [];
      const skipped: Array<{ uid: string; reason: string }> = [];

      for (let i = 0; i < revoke.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const uid of revoke.slice(i, i + BATCH_LIMIT)) {
          if (uid === auth.uid) {
            skipped.push({ uid, reason: "That is your own account." });
            continue;
          }
          // Re-verified against live data, not the list the UI happened to render: the account
          // must still hold a role here and still match no staff record.
          const snap = await db.collection("users").doc(uid).get();
          const data = snap.data();
          if (!snap.exists || !data || !(data.clinicRoles || {})[clinicId]) {
            skipped.push({ uid, reason: "Holds no role at this clinic." });
            continue;
          }
          if (isStaffLinked(snap.id, data)) {
            skipped.push({ uid, reason: "Matches a staff record — remove them from Users instead." });
            continue;
          }
          batch.update(snap.ref, {
            [`clinicRoles.${clinicId}`]: FieldValue.delete(),
            [`clinicPermissions.${clinicId}`]: FieldValue.delete(),
          });
          revoked.push(uid);
        }
        await batch.commit();
      }

      return NextResponse.json({ ok: true, revoked: revoked.length, revokedUids: revoked, skipped });
    }

    // --- backfill preview / apply ---------------------------------------------------------------

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

    const planned: PlanRow[] = [];
    const ghosts: PlanRow[] = [];
    let alreadyCorrect = 0;

    for (const docSnap of userDocs) {
      const data = docSnap.data() || {};
      const role = String((data.clinicRoles || {})[clinicId] || "");
      const existing = (data.clinicPermissions || {})[clinicId];

      // The role's floor UNION whatever was explicitly granted. Not the stored array alone: the
      // browser's guards also admit people on their role, so enforcing the bare array would lock
      // staff out of work they can do today. See src/lib/permissions.ts.
      const willStore = expandPermissions(role, data.permissions);

      const row: PlanRow = {
        uid: docSnap.id,
        name: String(data.name || data.email || "(no name)"),
        email: String(data.email || ""),
        role,
        willStore,
        previous: Array.isArray(existing) ? existing : null,
      };

      if (!isStaffLinked(docSnap.id, data)) {
        // Never backfilled, even on apply. Read access via the role is already more than these
        // accounts should have; granting writes because a scan found them would be the original
        // bug wearing a repair's clothes.
        ghosts.push(row);
        continue;
      }

      const unchanged =
        Array.isArray(existing) &&
        existing.length === willStore.length &&
        existing.every((v: unknown, i: number) => v === willStore[i]);

      if (unchanged) {
        alreadyCorrect++;
        continue;
      }
      planned.push(row);
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
        ghosts,
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
      ghosts,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Backfill failed";
    reportServerError("admin/backfill-permissions", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
