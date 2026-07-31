import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { sendWhatsApp } from "@/lib/whatsapp";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import { resolveWhatsappTemplateForPatient } from "@/lib/whatsappDefaultBodies";
import { pickPatientPhone } from "@/lib/patientPhone";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";

export async function POST(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json().catch(() => ({}))) as { patientId?: string };
    const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
    if (!patientId) {
      return NextResponse.json({ ok: false, error: "patientId required" }, { status: 400 });
    }

    const patientSnap = await adminDb().collection("patients").doc(patientId).get();
    if (!patientSnap.exists) {
      return NextResponse.json({ ok: false, error: "Patient not found" }, { status: 404 });
    }
    const patient = patientSnap.data() as Record<string, unknown>;
    if (patient.whatsappOptOut === true) {
      return NextResponse.json({ ok: false, error: "Patient opted out of WhatsApp" }, { status: 400 });
    }

    const phone = pickPatientPhone(patient);
    if (!phone) {
      return NextResponse.json({ ok: false, error: "Patient has no phone number" }, { status: 400 });
    }

    const settingsSnap = await adminDb().collection("settings").doc("whatsapp").get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    const tplText = resolveWhatsappTemplateForPatient(settings?.templates, "google_review");
    if (!tplText?.trim()) {
      return NextResponse.json(
        { ok: false, error: 'Google Review template is disabled or empty in Settings → WhatsApp' },
        { status: 400 }
      );
    }

    const needsGoogleLink = tplText.includes("{{google_link}}");

    const profile = await getClinicProfileAdmin();
    const reviewUrl = String(profile?.googleReviewUrl || "").trim();
    const mapsUrl = String(profile?.googleMapsUrl || "").trim();
    /** Prefer dedicated review URL; fall back to legacy single Maps field if review URL was never saved. */
    const googleLink = reviewUrl || mapsUrl;
    if (needsGoogleLink && !googleLink) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Add your Google review link under Settings → Clinic profile (required because your template uses {{google_link}}). Use the Review link field, not only Maps.",
        },
        { status: 400 }
      );
    }

    let clinicName = (profile?.clinicName && profile.clinicName.trim()) || "";
    if (!clinicName) {
      const ci = await adminDb().collection("settings").doc("clinic_info").get();
      const d = ci.data() as Record<string, unknown> | undefined;
      clinicName =
        (typeof d?.clinicName === "string" && d.clinicName.trim()) ||
        (typeof d?.name === "string" && d.name.trim()) ||
        "Alpha Dental";
    }
    const patientName = typeof patient.name === "string" ? patient.name : "Patient";

    const merged = mergeWhatsAppTemplate(tplText, {
      patient_name: patientName,
      clinic_name: clinicName,
      google_link: googleLink,
    });

    await sendWhatsApp({ to: phone, text: merged });
    await adminDb().collection("whatsapp_logs").add({
      patientId,
      type: "google_review",
      message: merged,
      status: "success",
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Send failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
