import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(request: Request) {
  const body = await request.json();
  const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";

  const authCheck = await requireAdminUser(request, clinicId || undefined);
  if (!authCheck.ok) return authCheck.response;

  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
  }

  try {
    const db = adminDb();
    const staffCollection = `clinics/${clinicId}/staff`;

    // 1. Fetch all data
    const usersSnap = await db.collection("users").get();
    const staffSnap = await db.collection(staffCollection).get();

    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];
    const staff = staffSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

    // Only process users that belong to this clinic
    const clinicUsers = users.filter(u => {
      const roles = u.clinicRoles || {};
      return clinicId in roles;
    });

    let fixesApplied = 0;
    const batch = db.batch();

    for (const u of clinicUsers) {
      // Look for a matching staff profile by staffId, UID, or Email
      const linkedStaff = staff.find((s: any) =>
        s.id === u.staffId ||
        s.uid === u.uid ||
        (s.email && u.email && s.email.toLowerCase() === u.email.toLowerCase())
      );

      if (linkedStaff) {
        // Scenario A: They exist, but the IDs are disconnected (Ghosting)
        const needsRelink = u.staffId !== linkedStaff.id || linkedStaff.uid !== (u.uid || u.id);
        if (needsRelink) {
          batch.update(db.collection("users").doc(u.id), { staffId: linkedStaff.id });
          batch.update(db.collection(staffCollection).doc(linkedStaff.id), { uid: u.uid || u.id });
          fixesApplied++;
        }
      } else {
        // Scenario B: User exists but staff profile is missing — create it
        const role = u.clinicRoles?.[clinicId] || u.role || "Assistant";
        const newStaffRef = db.collection(staffCollection).doc();
        batch.set(newStaffRef, {
          name: u.name || "Recovered User",
          email: u.email || "",
          role: role,
          isDentist: u.isDentist || false,
          uid: u.uid || u.id,
          permissions: u.permissions || [],
          createdAt: FieldValue.serverTimestamp(),
        });

        // Link the user back to this newly generated staff profile
        batch.update(db.collection("users").doc(u.id), { staffId: newStaffRef.id });
        fixesApplied++;
      }
    }

    // Commit all fixes simultaneously
    if (fixesApplied > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      ok: true,
      scanned: clinicUsers.length,
      fixed: fixesApplied,
    });
  } catch (error) {
    console.error("Repair Bot API Error:", error);
    const message = error instanceof Error ? error.message : "Repair failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
