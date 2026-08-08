import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { hasFeature } from "@/lib/subscriptions";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { scanDormantPatients } from "@/lib/automation/dormantPatients";
import { createMessageDrafts, type DraftInput } from "@/lib/messageDrafts";
import { resolveWhatsappTemplateForPatient } from "@/lib/whatsappDefaultBodies";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
import type { Clinic } from "@/types/saas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fallback only. The real threshold is the clinic's own setting — see below. */
const DEFAULT_THRESHOLD_DAYS = 180;

/**
 * Find patients who have not been seen in a while and draft a message to each.
 *
 * Admin-only, matching the revenue scan: this lists the clinic's entire lapsed patient base, and
 * approving from it sends messages in the clinic's name.
 *
 * Nothing is sent here. The scan only queues drafts for review — see lib/messageDrafts for why.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    clinicId?: string;
    thresholdDays?: number;
    createDrafts?: boolean;
  };
  const clinicId = body.clinicId?.trim();

  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
  }

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;

  try {
    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    if (!clinicSnap.exists) {
      return NextResponse.json({ ok: false, error: "Clinic not found" }, { status: 404 });
    }

    const clinic = { id: clinicSnap.id, ...clinicSnap.data() } as Clinic;
    if (!hasFeature(clinic, "aiProactive")) {
      return NextResponse.json(
        { ok: false, error: "Patient reactivation is available on the Premium plan.", upgradeRequired: true },
        { status: 403 }
      );
    }

    // How long counts as "a while" is clinical policy, not a number this code should pick. An
    // explicit request wins; otherwise the clinic's saved setting; the constant is only a last
    // resort, and the response says which was used so the number on screen is never unexplained.
    const settingsSnap = await adminClinicDoc(clinicId, "settings", "reactivation").get();
    const savedThreshold = Number(settingsSnap.exists ? settingsSnap.data()?.thresholdDays : NaN);
    const thresholdDays =
      Number(body.thresholdDays) > 0
        ? Number(body.thresholdDays)
        : Number.isFinite(savedThreshold) && savedThreshold > 0
          ? savedThreshold
          : DEFAULT_THRESHOLD_DAYS;

    const thresholdSource =
      Number(body.thresholdDays) > 0 ? "request" : Number.isFinite(savedThreshold) && savedThreshold > 0 ? "clinic_setting" : "default";

    const report = await scanDormantPatients(clinicId, thresholdDays);

    let drafted: { created: number; skipped: number } | null = null;

    if (body.createDrafts) {
      const waSnap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
      const templates = waSnap.exists ? waSnap.data()?.templates : undefined;
      const tpl = resolveWhatsappTemplateForPatient(templates, "reactivation");

      if (!tpl?.trim()) {
        return NextResponse.json(
          { ok: false, error: "The reactivation message template is disabled in Settings → WhatsApp." },
          { status: 400 }
        );
      }

      const profile = await getClinicProfileAdmin(clinicId);
      const clinicName = profile?.clinicName?.trim() || clinic.name || "our clinic";

      // Only patients we can actually reach, and only genuinely dormant ones — someone registered
      // but never treated needs a different conversation than "we miss you".
      const inputs: DraftInput[] = report.patients
        .filter((p) => p.reason === "dormant" && p.phone)
        .map((p) => ({
          patientId: p.patientId,
          patientName: p.patientName,
          phone: p.phone,
          reason: "dormant_reactivation" as const,
          body: mergeWhatsAppTemplate(tpl, { patient_name: p.patientName, clinic_name: clinicName }),
          context: { lastVisitDate: p.lastVisitDate, daysSinceLastVisit: p.daysSinceLastVisit },
        }));

      drafted = await createMessageDrafts(clinicId, inputs);
    }

    return NextResponse.json({ ok: true, report, thresholdSource, drafted });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed";
    console.error("[Reactivation] scan failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
