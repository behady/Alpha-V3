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
 * "How are you feeling today?" — the morning after a procedure.
 *
 * The one message patients remember a clinic by, and the one nobody has time to send. It goes
 * the day after every completed appointment except plain check-ups and cleanings, carries the
 * clinic's own aftercare line when written, and offers two buttons: "كله تمام" is a courtesy
 * the bot answers with one line; "عندي ألم" trips the clinical rule and puts a person on it
 * immediately. Business-initiated, so it is the approved template or nothing.
 */

/** Treatments that are a visit, not a procedure: no check-in needed, and it would read as odd. */
const NOT_A_PROCEDURE = /كشف|consult|تنظيف|clean|scal|polish|استشار/i;

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
  if (settings.isCheckinEnabled !== true) return { results: [] };
  const aftercare = String((settings.botFacts as Record<string, unknown> | undefined)?.aftercare || "").trim();

  const y = new Date(`${clinicNow().dateKey}T12:00:00`);
  y.setDate(y.getDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  const appts = await adminClinicCollection(clinicId, "appointments").where("date", "==", yesterday).get();
  const clinicName = await clinicDisplayName(clinicId);

  const results: Result[] = [];
  const done = new Set<string>();
  for (const d of appts.docs) {
    const a = d.data() || {};
    const patientId = String(a.patientId || "");
    const treatment = String(a.treatment || "").trim();
    if (!patientId || normalizeAppointmentStatus(String(a.status || "")) !== "Completed") continue;
    if (a.checkinSentAt || done.has(patientId)) continue;
    if (!treatment || NOT_A_PROCEDURE.test(treatment)) { results.push({ appointmentId: d.id, status: "skipped", reason: "not_a_procedure" }); continue; }

    const pSnap = await adminClinicDoc(clinicId, "patients", patientId).get();
    if (!pSnap.exists) continue;
    const patient = pSnap.data() as Record<string, unknown>;
    if (isWhatsAppBlocked(patient)) { results.push({ appointmentId: d.id, status: "skipped", reason: "opted_out" }); continue; }
    const phone = patientSendablePhone(patient);
    if (!phone) { results.push({ appointmentId: d.id, status: "skipped", reason: "no_phone" }); continue; }

    const patientName = (typeof patient.name === "string" && patient.name.trim()) || "Patient";
    const text = [`إزيك النهارده بعد ${treatment} في ${clinicName}؟ 🦷`, aftercare, "لو في أي ألم أو استفسار ابعتلنا هنا وهنرد عليك فوراً."].filter(Boolean).join("\n\n");
    try {
      const delivery = await deliverWhatsAppMessage({
        clinicId,
        to: phone,
        text,
        audience: "patient",
        queue: { key: `checkin_${d.id}`, type: "treatment", patientId, patientName, appointmentId: d.id },
        metaTemplate: { kind: "checkin", params: [treatment, clinicName] },
      });
      await d.ref.set({ checkinSentAt: FieldValue.serverTimestamp() }, { merge: true });
      done.add(patientId);
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
