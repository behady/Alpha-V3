import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { clinicNow } from "@/lib/publicBooking";
import { clinicDisplayName } from "@/lib/sms/events";
import { patientSendablePhone } from "@/lib/patientPhone";
import { isWhatsAppBlocked } from "@/lib/patientMessaging";
import { deliverWhatsAppMessage } from "@/lib/whatsappDelivery";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The day after a no-show: one polite door back in.
 *
 * A patient who missed an appointment is not lost; they are embarrassed, and the clinic that
 * writes first — without blame — usually gets them back. This sends one message the next
 * morning with a "book me" button that lands in the bot's booking flow. Once per appointment,
 * never to somebody who already rebooked, never to somebody who opted out.
 */

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function authorize(request: Request) {
  if (isCronAuthorized(request)) return { ok: true as const, cron: true as const };
  const staff = await requireStaffUser(request);
  if (!staff.ok) return staff;
  return { ok: true as const, cron: false as const, uid: staff.uid };
}

interface Result {
  appointmentId: string;
  status: "sent" | "queued" | "skipped" | "failed";
  reason?: string;
}

async function runForClinic(clinicId: string): Promise<{ results: Result[] }> {
  const settings = ((await adminClinicDoc(clinicId, "settings", "whatsapp").get()).data() || {}) as Record<string, unknown>;
  if (settings.isNoShowRecoveryEnabled !== true) return { results: [] };

  const today = clinicNow().dateKey;
  const y = new Date(`${today}T12:00:00`);
  y.setDate(y.getDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  const appts = await adminClinicCollection(clinicId, "appointments").where("date", "==", yesterday).get();
  const clinicName = await clinicDisplayName(clinicId);

  const results: Result[] = [];
  for (const d of appts.docs) {
    const a = d.data() || {};
    const patientId = String(a.patientId || "");
    if (!patientId || normalizeAppointmentStatus(String(a.status || "")) !== "No Show" || a.noShowRecoveryAt) continue;

    // Already rebooked: the door is open, no need to knock.
    const upcoming = await adminClinicCollection(clinicId, "appointments").where("patientId", "==", patientId).where("date", ">=", today).limit(5).get();
    if (upcoming.docs.some((u) => !/cancel|no.?show/i.test(String(u.data().status || "")))) {
      results.push({ appointmentId: d.id, status: "skipped", reason: "rebooked" });
      continue;
    }

    const pSnap = await adminClinicDoc(clinicId, "patients", patientId).get();
    if (!pSnap.exists) continue;
    const patient = pSnap.data() as Record<string, unknown>;
    if (isWhatsAppBlocked(patient)) { results.push({ appointmentId: d.id, status: "skipped", reason: "opted_out" }); continue; }
    const phone = patientSendablePhone(patient);
    if (!phone) { results.push({ appointmentId: d.id, status: "skipped", reason: "no_phone" }); continue; }

    const patientName = (typeof patient.name === "string" && patient.name.trim()) || "Patient";
    const text = `فاتنا ميعادك امبارح في ${clinicName} 🙏 مفيش مشكلة — لو حابب نحجزلك ميعاد تاني يناسبك، ابعتلنا كلمة "حجز" وهنظبطهولك حالاً.`;
    try {
      const delivery = await deliverWhatsAppMessage({
        clinicId,
        to: phone,
        text,
        audience: "patient",
        queue: { key: `noshow_${d.id}`, type: "reactivation", patientId, patientName, appointmentId: d.id },
        metaTemplate: { kind: "noshow", params: [clinicName] },
      });
      await d.ref.set({ noShowRecoveryAt: FieldValue.serverTimestamp() }, { merge: true });
      results.push({ appointmentId: d.id, status: delivery.mode === "auto" ? "sent" : "queued" });
    } catch (e) {
      results.push({ appointmentId: d.id, status: "failed", reason: e instanceof Error ? e.message : "send_failed" });
    }
  }
  return { results };
}

export async function GET(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;
  try {
    if (!authz.cron) {
      const clinicId = await resolveUserClinicId(authz.uid as string);
      return NextResponse.json({ ok: true, clinicId, ...(await runForClinic(clinicId)) });
    }
    const clinics = await forEachActiveClinic((clinicId) => runForClinic(clinicId));
    const results = clinics.flatMap((c) => c.result?.results ?? []);
    return NextResponse.json({ ok: true, sent: results.filter((r) => r.status === "sent").length, queued: results.filter((r) => r.status === "queued").length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
