import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAuthedUser } from "@/lib/apiStaffAuth";
import { DEMO_TOUR_PERMISSIONS, DEMO_TOUR_ROLE, homeClinicFor } from "@/lib/demoTour";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lets a signed-in person walk through the demo clinic, and lets them leave it again.
 *
 *   POST { action: "start" } → Assistant role on the demo clinic with VIEW permissions only
 *   POST { action: "leave" } → that role and its permission list removed
 *
 * The grant is deliberately not a staff card: tourists are not the demo clinic's team, and
 * the Users screen there should keep showing the five seeded people. The role in `clinicRoles`
 * is enough for every read, and the view-only list in `clinicPermissions` is what
 * firestore.rules and the server routes consult before any write — see lib/demoTour.
 */
async function findDemoClinic(db: FirebaseFirestore.Firestore) {
  const snap = await db.collection("clinics").where("__demo", "==", true).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthedUser(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const db = adminDb();
    const demo = await findDemoClinic(db);
    if (!demo) {
      return NextResponse.json({ ok: false, error: "The sample clinic is not available right now." }, { status: 404 });
    }
    const demoId = demo.id;
    const userRef = db.collection("users").doc(auth.uid);

    if (body?.action === "start") {
      // Someone who already belongs to the demo clinic — its seeded team, or a superadmin who
      // was granted Admin there for screenshots — keeps what they have. A tour must never
      // downgrade a real role to the tourist's.
      const existing = ((await userRef.get()).data()?.clinicRoles || {}) as Record<string, unknown>;
      if (typeof existing[demoId] === "string" && existing[demoId]) {
        return NextResponse.json({ ok: true, clinicId: demoId, name: demo.data()?.name || "Demo Clinic", alreadyMember: true });
      }
      // Merge is a deep merge for maps: roles and permission lists at other clinics survive.
      await userRef.set(
        {
          clinicRoles: { [demoId]: DEMO_TOUR_ROLE },
          clinicPermissions: { [demoId]: [...DEMO_TOUR_PERMISSIONS] },
          demoTourAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return NextResponse.json({ ok: true, clinicId: demoId, name: demo.data()?.name || "Demo Clinic" });
    }

    if (body?.action === "leave") {
      const userSnap = await userRef.get();
      const data = userSnap.data() || {};
      const roles = (data.clinicRoles || {}) as Record<string, unknown>;
      // The demo clinic's own seeded team keeps its access; only a tourist's grant is removed.
      if (roles[demoId] !== DEMO_TOUR_ROLE || demo.data()?.ownerId === auth.uid) {
        return NextResponse.json({ ok: true, clinicId: demoId, left: false });
      }
      const home = homeClinicFor(roles, typeof data.defaultClinicId === "string" ? data.defaultClinicId : null, demoId);
      // Dotted keys with update(): the form Firestore reads as a path into the nested maps.
      // Clinic ids are Firestore auto-ids and never contain a dot.
      const patch: Record<string, unknown> = {
        [`clinicRoles.${demoId}`]: FieldValue.delete(),
        [`clinicPermissions.${demoId}`]: FieldValue.delete(),
      };
      if (data.defaultClinicId === demoId) patch.defaultClinicId = home ?? FieldValue.delete();
      await userRef.update(patch);
      return NextResponse.json({ ok: true, clinicId: demoId, left: true, home });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    reportServerError("demo tour error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
