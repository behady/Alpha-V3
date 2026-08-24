import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireAdminUser } from "@/lib/apiStaffAuth";
import { hasFeature } from "@/lib/subscriptions";
import { scanDormantPatients } from "@/lib/automation/dormantPatients";
import { createMessageDrafts, type DraftInput } from "@/lib/messageDrafts";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
import type { Clinic } from "@/types/saas";
import type { CampaignRecipient, CampaignSegment } from "@/types/marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Segment scans walk the whole patient base, like the reactivation scan they reuse. */
export const maxDuration = 300;

/**
 * Marketing campaigns: pick an audience, write one message, launch.
 *
 * "Launch" never sends anything. It queues one reviewable draft per recipient in the existing
 * message_drafts pipeline — the same scan-proposes-human-decides split as reactivation, because
 * a campaign is exactly that risk multiplied by its audience size. Admin-only for the same
 * reason the reactivation scan is: both actions enumerate the clinic's patient base.
 */

type ScanBody = { action?: "scan"; clinicId?: string; segment?: CampaignSegment };
type LaunchBody = {
  action?: "launch";
  clinicId?: string;
  segment?: CampaignSegment;
  name?: string;
  body?: string;
  recipients?: { patientId?: string; name?: string; phone?: string; detail?: string }[];
};

const DEFAULT_DORMANT_THRESHOLD_DAYS = 180;
const MAX_RECIPIENTS = 500;

const todayYmd = () => new Date().toISOString().slice(0, 10);

function parseDateValue(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickPhone(p: Record<string, unknown>): string {
  for (const key of ["phone", "phoneNumber", "phoneE164", "mobile", "whatsapp", "primaryPhone"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Patient ids that have a booking today or later that wasn't cancelled — leave them alone. */
async function upcomingPatientIds(clinicId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const snap = await adminClinicCollection(clinicId, "appointments")
    .where("date", ">=", todayYmd())
    .limit(2000)
    .get();
  snap.forEach((doc) => {
    const d = doc.data() || {};
    const status = String(d.status || "");
    if (status === "Cancelled" || status === "No Show") return;
    if (typeof d.patientId === "string" && d.patientId) ids.add(d.patientId);
  });
  return ids;
}

async function scanSegment(clinicId: string, segment: CampaignSegment): Promise<CampaignRecipient[]> {
  if (segment === "dormant") {
    const settingsSnap = await adminClinicDoc(clinicId, "settings", "reactivation").get();
    const saved = Number(settingsSnap.exists ? settingsSnap.data()?.thresholdDays : NaN);
    const threshold = Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_DORMANT_THRESHOLD_DAYS;
    const report = await scanDormantPatients(clinicId, threshold);
    return report.patients
      .filter((p) => p.reason === "dormant" && p.phone && !p.hasUpcomingAppointment)
      .slice(0, MAX_RECIPIENTS)
      .map((p) => ({
        patientId: p.patientId,
        name: p.patientName,
        phone: p.phone,
        detail: p.daysSinceLastVisit != null ? `~${Math.round(p.daysSinceLastVisit / 30)} months away` : "",
      }));
  }

  if (segment === "unfinished_treatment") {
    // Plans someone already saw or agreed to, belonging to patients with nothing booked —
    // the easiest audience in marketing: people who said yes and then life happened.
    const [plansSnap, patientsSnap, upcoming] = await Promise.all([
      adminClinicCollection(clinicId, "treatment_plans").limit(2000).get(),
      adminClinicCollection(clinicId, "patients").limit(4000).get(),
      upcomingPatientIds(clinicId),
    ]);

    const patients = new Map<string, Record<string, unknown>>();
    patientsSnap.forEach((doc) => patients.set(doc.id, doc.data() || {}));

    const byPatient = new Map<string, { total: number; status: string }>();
    plansSnap.forEach((doc) => {
      const d = doc.data() || {};
      const status = String(d.status || "");
      if (status !== "presented" && status !== "accepted") return;
      const patientId = typeof d.patientId === "string" ? d.patientId : "";
      if (!patientId || upcoming.has(patientId)) return;
      const total = Number(d.total) || 0;
      const current = byPatient.get(patientId);
      // Keep the strongest signal per patient: accepted beats presented, bigger beats smaller.
      if (!current || (status === "accepted" && current.status !== "accepted") || total > current.total) {
        byPatient.set(patientId, { total, status });
      }
    });

    const out: CampaignRecipient[] = [];
    for (const [patientId, plan] of byPatient) {
      const p = patients.get(patientId);
      if (!p) continue;
      const phone = pickPhone(p);
      if (!phone) continue;
      out.push({
        patientId,
        name: String(p.name || "Unknown"),
        phone,
        detail: `${plan.status === "accepted" ? "accepted" : "presented"} plan${plan.total ? ` · ${plan.total}` : ""}`,
      });
      if (out.length >= MAX_RECIPIENTS) break;
    }
    return out;
  }

  // birthdays — month-day within the next 7 days, year ignored.
  const patientsSnap = await adminClinicCollection(clinicId, "patients").limit(4000).get();
  const now = new Date();
  const windowKeys = new Set<string>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    windowKeys.add(`${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }

  const out: CampaignRecipient[] = [];
  patientsSnap.forEach((doc) => {
    if (out.length >= MAX_RECIPIENTS) return;
    const p = doc.data() || {};
    const dob = parseDateValue(p.dateOfBirth);
    if (!dob) return;
    const key = `${String(dob.getMonth() + 1).padStart(2, "0")}-${String(dob.getDate()).padStart(2, "0")}`;
    if (!windowKeys.has(key)) return;
    const phone = pickPhone(p);
    if (!phone) return;
    out.push({
      patientId: doc.id,
      name: String(p.name || "Unknown"),
      phone,
      detail: key,
    });
  });
  return out;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ScanBody & LaunchBody;
  const clinicId = typeof body.clinicId === "string" ? body.clinicId.trim() : "";
  if (!clinicId) {
    return NextResponse.json({ ok: false, error: "clinicId is required" }, { status: 400 });
  }

  const authz = await requireAdminUser(request, clinicId);
  if (!authz.ok) return authz.response;

  const segment: CampaignSegment =
    body.segment === "unfinished_treatment" || body.segment === "birthdays" ? body.segment : "dormant";

  try {
    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    if (!clinicSnap.exists) {
      return NextResponse.json({ ok: false, error: "Clinic not found" }, { status: 404 });
    }
    const clinic = { id: clinicSnap.id, ...clinicSnap.data() } as Clinic;
    if (!hasFeature(clinic, "marketingText")) {
      return NextResponse.json(
        { ok: false, upgradeRequired: true, error: "Campaigns are part of the Marketing add-on." },
        { status: 403 }
      );
    }

    if (body.action === "launch") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
      const template = typeof body.body === "string" ? body.body.trim().slice(0, 1500) : "";
      const recipients = (Array.isArray(body.recipients) ? body.recipients : [])
        .map((r) => ({
          patientId: typeof r.patientId === "string" ? r.patientId.trim() : "",
          name: typeof r.name === "string" ? r.name.trim().slice(0, 120) : "",
          phone: typeof r.phone === "string" ? r.phone.trim().slice(0, 30) : "",
        }))
        .filter((r) => r.patientId && r.phone)
        .slice(0, MAX_RECIPIENTS);

      if (!name || !template || recipients.length === 0) {
        return NextResponse.json(
          { ok: false, error: "A campaign needs a name, a message, and at least one recipient." },
          { status: 400 }
        );
      }

      const profile = await getClinicProfileAdmin(clinicId);
      const clinicName = profile?.clinicName?.trim() || clinic.name || "our clinic";

      const campaignRef = await adminClinicCollection(clinicId, "marketing_campaigns").add({
        name,
        segment,
        body: template,
        recipientCount: recipients.length,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: authz.uid,
      });

      const inputs: DraftInput[] = recipients.map((r) => ({
        patientId: r.patientId,
        patientName: r.name,
        phone: r.phone,
        reason: "marketing_campaign" as const,
        body: mergeWhatsAppTemplate(template, { patient_name: r.name, clinic_name: clinicName }),
        context: { campaignId: campaignRef.id, campaignName: name, segment },
      }));

      const drafted = await createMessageDrafts(clinicId, inputs);
      return NextResponse.json({ ok: true, campaignId: campaignRef.id, ...drafted });
    }

    // default: scan
    const recipients = await scanSegment(clinicId, segment);
    return NextResponse.json({ ok: true, segment, recipients, count: recipients.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Campaign request failed";
    reportServerError("[MarketingCampaigns] failed", e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
