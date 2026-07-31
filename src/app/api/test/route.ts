import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

export async function GET() {
  try {
    const user = await adminAuth().getUserByEmail("test69@test.com");
    return NextResponse.json({
      user: user.toJSON(),
      hasPassword: user.providerData.some((p: any) => p.providerId === "password")
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
