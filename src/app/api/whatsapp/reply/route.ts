import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { markHumanActive } from "@/lib/bot/conversation";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { deliverWhatsAppMessage } from "@/lib/whatsappDelivery";

export const runtime = "nodejs";

/**
 * A person answering a patient, from the clinic's own WhatsApp number.
 *
 * This is the other half of the handoff. The bot raises a flag and says "someone will contact
 * you"; this is how that someone does it without leaving the app — and, on the official channel,
 * it is the ONLY way: the clinic's number lives on Meta's servers, not in a phone, so a
 * receptionist cannot open WhatsApp and type. Replying here also tells the bot to stand down for
 * an hour, so it stops answering the patient's next message over the top of the human.
 *
 * Free-form text on the official channel only delivers inside 24 hours of the patient's last
 * message. Handoffs are raised BY a patient message, so a same-day reply is always in-window;
 * the inbox warns when a row is old enough for that to matter.
 */
export async function POST(request: Request) {
  const requestedClinicId = await request
    .clone()
    .json()
    .then((b) => (typeof b?.clinicId === "string" ? b.clinicId.trim() : ""))
    .catch(() => "");

  const authz = await requireStaffUser(request, requestedClinicId || undefined);
  if (!authz.ok) return authz.response;

  const clinicId = requestedClinicId || (await resolveUserClinicId(authz.uid));
  if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic" }, { status: 400 });

  const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
  const clinic = clinicSnap.data();
  if (clinic && (clinic.status !== "Active" || (clinic.expiresAt && clinic.expiresAt.toDate() < new Date()))) {
    return NextResponse.json({ ok: false, error: "Subscription expired or suspended. Read-only mode active." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    phone?: string;
    text?: string;
    patientId?: string;
    patientName?: string;
  };

  const phone = normalizeToE164AssumingCountry(String(body.phone || ""));
  const text = String(body.text || "").trim();
  if (!phone) return NextResponse.json({ ok: false, error: "A valid phone number is required" }, { status: 400 });
  if (!text) return NextResponse.json({ ok: false, error: "Message text is required" }, { status: 400 });
  if (text.length > 1500) return NextResponse.json({ ok: false, error: "Message is too long" }, { status: 400 });

  const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
  const patientName = typeof body.patientName === "string" ? body.patientName.trim() : "";

  try {
    const delivery = await deliverWhatsAppMessage({
      clinicId,
      to: phone,
      text,
      audience: "patient",
      queue: {
        key: `reply_${phone.replace(/\D/g, "")}_${Date.now()}`,
        type: "staff_reply",
        ...(patientId ? { patientId } : {}),
        ...(patientName ? { patientName } : {}),
      },
    });

    // The thread is a person's now; the bot stays out of it for an hour and the inbox row closes.
    await markHumanActive(clinicId, phone, authz.uid);

    // Same audit trail the bot writes to, so the Messages history shows both voices in order.
    await adminClinicCollection(clinicId, "whatsapp_logs").add({
      patientId: patientId || null,
      type: "staff_reply",
      message: text,
      status: delivery.mode === "auto" ? "success" : "queued",
      sentBy: authz.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Keep the patient record's contact trail honest too, when there is a record to keep it on.
    if (patientId) {
      await adminClinicDoc(clinicId, "patients", patientId)
        .set({ lastContactedAt: FieldValue.serverTimestamp() }, { merge: true })
        .catch(() => {});
    }

    return NextResponse.json({ ok: true, mode: delivery.mode });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Send failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
