import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { clinicNow } from "@/lib/publicBooking";
import { clinicDisplayName } from "@/lib/sms/events";
import { patientSendablePhone } from "@/lib/patientPhone";
import { isWhatsAppBlocked } from "@/lib/patientMessaging";
import { isTemplatePack, resolveWhatsappTemplateForPatient } from "@/lib/whatsappDefaultBodies";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import { deliverWhatsAppMessage } from "@/lib/whatsappDelivery";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Recalling the patients who stopped coming.
 *
 * The largest source of revenue a dental clinic leaves on the table is the patient who finished a
 * treatment, meant to come back for a check-up, and did not. This sweep finds everyone whose last
 * COMPLETED appointment is older than the clinic's recall window and sends the "وحشتنا" message
 * with the booking buttons — once, then not again for the same window.
 *
 * "Last seen" is read from completed appointments, not from patients.lastVisit: that field is
 * never written, and a recall built on it would recall nobody or everybody.
 *
 * Business-initiated on the official channel, so it goes as the approved template and needs a
 * payment method on the WABA. Capped per run so a clinic switching it on with a thousand dormant
 * patients does not blow through Meta's daily limit or its own budget on the first morning.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Per clinic per run — a weekly cron at this cap is a steady trickle, not a blast. */
const MAX_PER_RUN = 25;

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

interface RecallResult {
  patientId: string;
  status: "sent" | "queued" | "skipped" | "failed";
  reason?: string;
}

async function runRecallForClinic(clinicId: string): Promise<{ results: RecallResult[]; candidates: number }> {
  const settingsSnap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
  const settings = (settingsSnap.data() || {}) as Record<string, unknown>;
  if (settings.isRecallEnabled !== true) return { results: [], candidates: 0 };

  const months = Math.max(1, Math.min(24, Number(settings.recallAfterMonths) || 6));
  const today = clinicNow().dateKey;
  const cutoff = new Date(Date.now() - months * 30 * DAY_MS).toISOString().slice(0, 10);

  // One read of the calendar: the latest completed visit per patient, and whether anything is
  // already booked ahead — a patient with a future appointment does not need reminding to come.
  const appts = await adminClinicCollection(clinicId, "appointments").limit(8000).get();
  const lastCompleted = new Map<string, string>();
  const hasUpcoming = new Set<string>();
  for (const d of appts.docs) {
    const a = d.data() || {};
    const pid = String(a.patientId || "");
    const date = String(a.date || "");
    if (!pid || !date) continue;
    const status = normalizeAppointmentStatus(String(a.status || ""));
    if (status === "Completed" && (lastCompleted.get(pid) || "") < date) lastCompleted.set(pid, date);
    if (date >= today && status !== "Cancelled" && status !== "No Show") hasUpcoming.add(pid);
  }

  const due = [...lastCompleted.entries()].filter(([pid, date]) => date <= cutoff && !hasUpcoming.has(pid)).map(([pid]) => pid);
  const clinicName = await clinicDisplayName(clinicId);
  const pack = isTemplatePack(settings.templatePack) ? settings.templatePack : "bilingual";
  const tpl = resolveWhatsappTemplateForPatient(settings.templates, "reactivation", pack);
  if (!tpl?.trim()) return { results: due.map((patientId) => ({ patientId, status: "skipped", reason: "template_disabled" })), candidates: due.length };

  const results: RecallResult[] = [];
  let sent = 0;
  for (const patientId of due) {
    if (sent >= MAX_PER_RUN) break;
    const pSnap = await adminClinicDoc(clinicId, "patients", patientId).get();
    if (!pSnap.exists) continue;
    const patient = pSnap.data() as Record<string, unknown>;
    if (isWhatsAppBlocked(patient)) { results.push({ patientId, status: "skipped", reason: "opted_out" }); continue; }
    const phone = patientSendablePhone(patient);
    if (!phone) { results.push({ patientId, status: "skipped", reason: "no_phone" }); continue; }
    // Once per window: a recall that repeats every week is the message that gets a number reported.
    const last = typeof patient.recallSentAt === "string" ? Date.parse(patient.recallSentAt) : 0;
    if (last && Date.now() - last < months * 30 * DAY_MS) { results.push({ patientId, status: "skipped", reason: "recalled_recently" }); continue; }

    const patientName = (typeof patient.name === "string" && patient.name.trim()) || "Patient";
    const text = mergeWhatsAppTemplate(tpl, { patient_name: patientName, clinic_name: clinicName });
    try {
      const delivery = await deliverWhatsAppMessage({
        clinicId,
        to: phone,
        text,
        audience: "patient",
        queue: { key: `recall_${patientId}_${today}`, type: "reactivation", patientId, patientName },
        metaTemplate: { kind: "recall", params: [clinicName] },
      });
      await adminClinicDoc(clinicId, "patients", patientId).set(
        { recallSentAt: new Date().toISOString(), recallCount: FieldValue.increment(1) },
        { merge: true }
      );
      results.push({ patientId, status: delivery.mode === "auto" ? "sent" : "queued" });
      sent += 1;
    } catch (e) {
      results.push({ patientId, status: "failed", reason: e instanceof Error ? e.message : "send_failed" });
    }
  }
  return { results, candidates: due.length };
}

export async function GET(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;
  try {
    if (!authz.cron) {
      const clinicId = await resolveUserClinicId(authz.uid as string);
      const run = await runRecallForClinic(clinicId);
      return NextResponse.json({ ok: true, clinicId, ...run });
    }
    const clinics = await forEachActiveClinic((clinicId) => runRecallForClinic(clinicId));
    const results = clinics.flatMap((c) => c.result?.results ?? []);
    return NextResponse.json({
      ok: true,
      sent: results.filter((r) => r.status === "sent").length,
      queued: results.filter((r) => r.status === "queued").length,
      clinics: clinics.map((c) => ({ clinicId: c.clinicId, ok: c.ok, candidates: c.result?.candidates ?? 0, sent: (c.result?.results ?? []).filter((r) => r.status === "sent").length })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
