import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { sendOwnerWhatsAppAlertIfEnabled } from "@/lib/whatsappOwnerAlerts";
import type { OwnerAlertKey } from "@/types/whatsapp";

const OWNER_KEYS = new Set<string>([
  "appointment_add",
  "appointment_edit",
  "appointment_delete",
  "finance_add",
  "finance_edit",
  "finance_delete",
]);

export async function POST(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  // SUBSCRIPTION ENFORCEMENT
  const userSnap = await adminDb().collection("users").doc(authz.uid).get();
  const userData = userSnap.data();
  const clinicId = userData?.defaultClinicId || Object.keys(userData?.clinicRoles || {})[0];
  if (clinicId) {
    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    const clinic = clinicSnap.data();
    if (clinic && (clinic.status !== 'Active' || (clinic.expiresAt && clinic.expiresAt.toDate() < new Date()))) {
      return NextResponse.json({ ok: false, error: "Subscription expired or suspended." }, { status: 403 });
    }
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      alertKey?: string;
      message?: string;
    };

    const alertKey = typeof body.alertKey === "string" ? body.alertKey.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!alertKey || !OWNER_KEYS.has(alertKey)) {
      return NextResponse.json({ ok: false, error: "Invalid alertKey" }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });
    }

    if (!clinicId) {
      return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
    }

    const result = await sendOwnerWhatsAppAlertIfEnabled(clinicId, alertKey as OwnerAlertKey, message);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Send failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
