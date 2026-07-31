import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { uid, newPassword } = body;

    // Enforce admin auth (global or specific clinic admin)
    const authCheck = await requireAdminUser(request);
    if (!authCheck.ok) return authCheck.response;

    if (!uid || !newPassword) {
      return NextResponse.json({ error: "Missing user ID or password" }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters long" }, { status: 400 });
    }

    const auth = adminAuth();
    
    await auth.updateUser(uid, {
      password: newPassword
    });

    return NextResponse.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to reset password";
    console.error("Reset Password Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
