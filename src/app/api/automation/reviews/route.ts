import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
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
 * Asking for a review the day after a visit.
 *
 * Reviews are how new patients find a clinic, and the moment to ask is the day after a completed
 * appointment — not at the desk, and not a month later. This sweep runs daily, finds yesterday's
 * COMPLETED appointments, and sends the review request with the clinic's Google link, once per
 * patient per month so a course of treatment does not produce a request after every visit.
 *
 * It does nothing until the clinic has saved a review link in its profile: a request that points
 * nowhere is worse than none.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_GAP_DAYS = 30;

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

interface ReviewResult {
  appointmentId: string;
  patientId: string;
  status: "sent" | "queued" | "skipped" | "failed";
  reason?: string;
}

async function runReviewsForClinic(clinicId: string): Promise<{ results: ReviewResult[]; reviewUrl: string }> {
  const settingsSnap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
  const settings = (settingsSnap.data() || {}) as Record<string, unknown>;
  if (settings.isReviewRequestEnabled !== true) return { results: [], reviewUrl: "" };

  const profile = await getClinicProfileAdmin(clinicId);
  const reviewUrl = String(profile?.googleReviewUrl || "").trim();
  if (!reviewUrl) return { results: [], reviewUrl: "" };

  const today = clinicNow().dateKey;
  const y = new Date(`${today}T12:00:00`);
  // With the morning-after check-in on, the review ask waits one more day: two messages from
  // the clinic before lunch is one too many.
  y.setDate(y.getDate() - (settings.isCheckinEnabled === true ? 2 : 1));
  const yesterday = y.toISOString().slice(0, 10);

  const appts = await adminClinicCollection(clinicId, "appointments").where("date", "==", yesterday).get();
  const clinicName = await clinicDisplayName(clinicId);
  const pack = isTemplatePack(settings.templatePack) ? settings.templatePack : "bilingual";
  const tpl = resolveWhatsappTemplateForPatient(settings.templates, "google_review", pack);
  if (!tpl?.trim()) return { results: [], reviewUrl };

  const results: ReviewResult[] = [];
  const askedThisRun = new Set<string>();
  for (const d of appts.docs) {
    const a = d.data() || {};
    const patientId = String(a.patientId || "");
    if (!patientId || normalizeAppointmentStatus(String(a.status || "")) !== "Completed") continue;
    if (a.reviewRequestedAt || askedThisRun.has(patientId)) continue;

    const pSnap = await adminClinicDoc(clinicId, "patients", patientId).get();
    if (!pSnap.exists) continue;
    const patient = pSnap.data() as Record<string, unknown>;
    if (isWhatsAppBlocked(patient)) { results.push({ appointmentId: d.id, patientId, status: "skipped", reason: "opted_out" }); continue; }
    const phone = patientSendablePhone(patient);
    if (!phone) { results.push({ appointmentId: d.id, patientId, status: "skipped", reason: "no_phone" }); continue; }
    const last = typeof patient.reviewRequestedAt === "string" ? Date.parse(patient.reviewRequestedAt) : 0;
    if (last && Date.now() - last < MIN_GAP_DAYS * DAY_MS) { results.push({ appointmentId: d.id, patientId, status: "skipped", reason: "asked_recently" }); continue; }

    const patientName = (typeof patient.name === "string" && patient.name.trim()) || "Patient";
    const text = mergeWhatsAppTemplate(tpl, { patient_name: patientName, clinic_name: clinicName, google_link: reviewUrl });
    try {
      const delivery = await deliverWhatsAppMessage({
        clinicId,
        to: phone,
        text,
        audience: "patient",
        queue: { key: `review_${d.id}`, type: "google_review", patientId, patientName, appointmentId: d.id },
        metaTemplate: { kind: "review", params: [clinicName, reviewUrl] },
      });
      const now = new Date().toISOString();
      await d.ref.set({ reviewRequestedAt: now }, { merge: true });
      await adminClinicDoc(clinicId, "patients", patientId).set({ reviewRequestedAt: now, reviewRequests: FieldValue.increment(1) }, { merge: true });
      askedThisRun.add(patientId);
      results.push({ appointmentId: d.id, patientId, status: delivery.mode === "auto" ? "sent" : "queued" });
    } catch (e) {
      results.push({ appointmentId: d.id, patientId, status: "failed", reason: e instanceof Error ? e.message : "send_failed" });
    }
  }
  return { results, reviewUrl };
}

export async function GET(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;
  try {
    if (!authz.cron) {
      const clinicId = await resolveUserClinicId(authz.uid as string);
      const run = await runReviewsForClinic(clinicId);
      return NextResponse.json({ ok: true, clinicId, ...run });
    }
    const clinics = await forEachActiveClinic((clinicId) => runReviewsForClinic(clinicId));
    const results = clinics.flatMap((c) => c.result?.results ?? []);
    return NextResponse.json({
      ok: true,
      sent: results.filter((r) => r.status === "sent").length,
      queued: results.filter((r) => r.status === "queued").length,
      clinics: clinics.map((c) => ({ clinicId: c.clinicId, ok: c.ok, sent: (c.result?.results ?? []).filter((r) => r.status === "sent").length })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
