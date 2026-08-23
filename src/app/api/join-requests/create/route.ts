import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { requireAuthedUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Files a request to join an existing clinic.
 *
 * This cannot be done from the browser, and firestore.rules denies it there. Three reasons, in
 * order of how much they hurt:
 *
 *  1. A client write cannot check that the Clinic ID is real. The rules deny reading a clinic you
 *     hold no role in — which is precisely the situation this request exists to resolve — so a
 *     mistyped ID was accepted silently and then waited forever for an admin who was never going
 *     to see it. The Admin SDK can look the clinic up and say "no such clinic" straight away.
 *
 *  2. The name and email on the request decide what the approving admin sees, and approval copies
 *     them onto the new staff record. Taken from the request body they are whatever the caller
 *     typed; taken from the Auth record they are who the caller actually is.
 *
 *  3. `doc()` with no id mints a fresh one per click, so pressing the button twice filed two
 *     requests. Keying on (uid, clinicId) makes a second press update the first request instead.
 *
 * The caller is authenticated but holds no clinic role yet — that is the whole point — so this
 * uses requireAuthedUser rather than any of the staff guards.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuthedUser(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "A Clinic ID is required" }, { status: 400 });
    }

    const db = adminDb();

    const clinicSnap = await db.collection("clinics").doc(clinicId).get();
    if (!clinicSnap.exists) {
      return NextResponse.json(
        { ok: false, error: "No clinic has that ID. Check it with the clinic and try again." },
        { status: 404 }
      );
    }

    // Already a member: filing a request would sit unanswered while they wonder why nothing
    // happens, when in fact they can simply sign in.
    const userRef = db.collection("users").doc(auth.uid);
    const userSnap = await userRef.get();
    const existingRoles = (userSnap.data()?.clinicRoles || {}) as Record<string, string>;
    if (existingRoles[clinicId]) {
      return NextResponse.json(
        { ok: false, error: "You already work at this clinic." },
        { status: 409 }
      );
    }

    // Who the caller actually is, not who the request body claims.
    const authUser = await adminAuth().getUser(auth.uid);
    const email = String(authUser.email || userSnap.data()?.email || "").toLowerCase();
    const name = String(authUser.displayName || userSnap.data()?.name || email || "New Team Member");

    // Deterministic id: one pending request per person per clinic, however many times they press.
    const requestId = `${auth.uid}_${clinicId}`;
    const reqRef = db.collection("join_requests").doc(requestId);
    const existing = await reqRef.get();
    if (existing.exists && String(existing.data()?.status || "").toLowerCase() === "pending") {
      return NextResponse.json({ ok: true, requestId, alreadyPending: true });
    }

    await reqRef.set(
      {
        clinicId,
        userId: auth.uid,
        // Both spellings on purpose: the admin's review screen reads `name`/`email`, and older
        // requests in the collection carry the `user*` names. Reading one and writing the other
        // is why join requests used to show up blank.
        name,
        email,
        userName: name,
        userEmail: email,
        // Lowercase, matching the query on the admin's Join Requests screen. A capitalised
        // "Pending" is stored but never matched, so the request is filed and never seen.
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        requestedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, requestId, clinicName: clinicSnap.data()?.name || null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to file join request";
    console.error("Create join request error:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
