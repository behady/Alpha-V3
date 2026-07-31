import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name, role, createDbRecords, clinicId, isDentist } = body;

    // Enforce admin auth with clinic context
    const authCheck = await requireAdminUser(request, clinicId || undefined);
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
      
      const permissions = [
        "dashboard.view",
        "appointments.view",
        "patients.view",
      ];

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
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        // Update existing root user document
        await userRef.update({
          [`clinicRoles.${clinicId}`]: role || "Assistant",
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
