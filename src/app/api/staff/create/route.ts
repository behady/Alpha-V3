import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";
import { clinicPermissionsPatch, clinicPermissionsSeed } from "@/lib/server/clinicPermissions";
import { expandPermissions } from "@/lib/permissions";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name, role, createDbRecords, clinicId, isDentist } = body;

    // The clinic is required: without one, this degraded to "any Admin anywhere may create Auth
    // accounts", and every invite is for a specific clinic anyway.
    if (!clinicId) {
      return NextResponse.json({ error: "clinicId is required" }, { status: 400 });
    }
    const authCheck = await requireAdminUser(request, clinicId);
    if (!authCheck.ok) return authCheck.response;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const auth = adminAuth();
    const db = adminDb();

    let userRecord;
    let isNewUser = false;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (e) {
      userRecord = await auth.createUser({
        email: email,
        password: password,
        displayName: name || "New Team Member",
      });
      isNewUser = true;
    }

    if (createDbRecords && clinicId) {
      const userRef = db.collection("users").doc(userRecord.uid);
      const userSnap = await userRef.get();
      
      // The role's floor, materialized: the same list lands on the staff card, the flat legacy
      // field, and the enforced per-clinic map, so the checkbox screen shows a new person's true
      // ticks from their first day. The baseline is starting ticks, not an un-untickable floor —
      // whatever an admin unticks later is stored verbatim by update-user. (An earlier seed listed
      // "appointments.view" and "patients.view", which are not permission ids; and before that,
      // the copies simply disagreed.)
      const permissions = expandPermissions(role || "Assistant", ["dashboard.view"]);

      // Add staff record to clinic
      const staffRef = await db.collection(`clinics/${clinicId}/staff`).add({
        name: name || "New Team Member",
        email: email.toLowerCase(),
        role: role || "Assistant",
        uid: userRecord.uid,
        isDentist: isDentist || false,
        permissions,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (!userSnap.exists) {
        // Create root user document
        await userRef.set({
          uid: userRecord.uid,
          name: name || "New Team Member",
          email: email.toLowerCase(),
          role: role || "Assistant",
          staffId: staffRef.id, // Legacy backwards compatibility
          clinicRoles: {
            [clinicId]: role || "Assistant"
          },
          isDentist: isDentist || false,
          permissions,
          // The field firestore.rules reads. `permissions` above is what the browser's guards
          // consult; the rules look up clinicPermissions[clinicId], and until now nothing wrote it.
          clinicPermissions: clinicPermissionsSeed(clinicId, role || "Assistant", permissions),
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        // An existing account invited to a second clinic. Their flat `permissions` array is not
        // touched — it belongs to whichever clinic set it, and overwriting it here would rewrite
        // their access at the first one. clinicPermissions is per-clinic, so it can be set safely.
        await userRef.update({
          [`clinicRoles.${clinicId}`]: role || "Assistant",
          ...clinicPermissionsPatch(clinicId, role || "Assistant", permissions),
        });
      }
    }

    return NextResponse.json({
      success: true,
      uid: userRecord.uid,
      message: isNewUser 
        ? "Staff login successfully created" 
        : "User already exists. They were added to the clinic but their original password was kept.",
      isNewUser
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create user";
    console.error("Create User Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
