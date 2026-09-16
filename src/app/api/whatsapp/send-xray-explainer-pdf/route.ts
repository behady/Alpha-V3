import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser, requireStaffPermission } from "@/lib/apiStaffAuth";
import { adminBucket } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { sendWhatsAppPdfFromUrl } from "@/lib/whatsapp";
import { resolveWhatsappDeliveryMode } from "@/lib/whatsappDelivery";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { pickPatientPhone } from "@/lib/patientPhone";
import { XRAY_REPORTS_COLLECTION } from "@/lib/xrayReport";

const MAX_PDF_BYTES = 6 * 1024 * 1024;

function slugifyName(name: string) {
  return name.trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 48) || "patient";
}

/**
 * Sends the patient-friendly x-ray explanation to the patient on WhatsApp.
 *
 * Same shape as send-treatment-plan-pdf: the browser renders the PDF (outlined picture plus the
 * plain-words explanation), this route stores it and sends it, or hands back a click-to-send
 * message with a signed link when the clinic has no connected number.
 *
 * One rule the treatment-plan sender does not need: the report must be SIGNED. The explanation is
 * model text about a patient's own body, and the whole design of this feature is that nothing the
 * model wrote reaches a patient before a dentist has read it. The button is hidden until the
 * report is signed; this is the check for anyone who finds the route without the button.
 */
export async function POST(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      patientId?: string;
      reportId?: string;
      pdfBase64?: string;
      clinicId?: string;
    };

    const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
    const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
    const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64.trim() : "";
    if (!patientId || !reportId || !pdfBase64) {
      return NextResponse.json({ ok: false, error: "patientId, reportId and pdfBase64 are required" }, { status: 400 });
    }

    const clinicId = await resolveUserClinicId(authz.uid, body.clinicId);
    if (!(await clinicHasFeature(clinicId, "clinicalPdfs"))) {
      return NextResponse.json({ ok: false, error: "Clinical PDFs on WhatsApp are not included in this clinic's subscription." }, { status: 403 });
    }
    const permitted = await requireStaffPermission(request, clinicId, "clinical.edit");
    if (!permitted.ok) return permitted.response;

    const reportSnap = await adminClinicDoc(clinicId, XRAY_REPORTS_COLLECTION, reportId).get();
    const report = reportSnap.data() as Record<string, unknown> | undefined;
    if (!reportSnap.exists || !report || String(report.patientId || "") !== patientId) {
      return NextResponse.json({ ok: false, error: "Report not found for this patient." }, { status: 404 });
    }
    if (report.signed !== true) {
      return NextResponse.json({ ok: false, error: "Sign the report before sending anything to the patient." }, { status: 409 });
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(pdfBase64, "base64");
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid base64 PDF" }, { status: 400 });
    }
    if (buffer.length < 32 || buffer.length > MAX_PDF_BYTES) {
      return NextResponse.json({ ok: false, error: "PDF is missing or too large" }, { status: 400 });
    }
    if (buffer.slice(0, 5).toString() !== "%PDF-") {
      return NextResponse.json({ ok: false, error: "File is not a valid PDF" }, { status: 400 });
    }

    const patientSnap = await adminClinicDoc(clinicId, "patients", patientId).get();
    if (!patientSnap.exists) return NextResponse.json({ ok: false, error: "Patient not found" }, { status: 404 });
    const patient = patientSnap.data() as Record<string, unknown>;
    if (patient.whatsappOptOut === true) {
      return NextResponse.json({ ok: false, error: "Patient opted out of WhatsApp messages" }, { status: 400 });
    }
    const phone = pickPatientPhone(patient);
    if (!phone) return NextResponse.json({ ok: false, error: "Patient has no phone number" }, { status: 400 });

    let clinicName = "Alpha Dental";
    try {
      const clinicSnap = await adminClinicDoc(clinicId, "settings", "clinic_info").get();
      const c = clinicSnap.data();
      if (c && typeof c.clinicName === "string" && c.clinicName.trim()) clinicName = c.clinicName.trim();
      else if (c && typeof c.name === "string" && c.name.trim()) clinicName = c.name.trim();
    } catch {
      /* ignore */
    }

    const patientName = typeof patient.name === "string" ? patient.name : "Patient";
    const safeName = slugifyName(patientName);
    const storagePath = `outbound_xray_explainers/${patientId}/${Date.now()}_${safeName}.pdf`;
    const bucket = adminBucket();
    const file = bucket.file(storagePath);
    await file.save(buffer, { contentType: "application/pdf", metadata: { cacheControl: "private, max-age=3600" } });
    const [signedUrl] = await file.getSignedUrl({ action: "read", expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });

    const caption = `شرح صورة الأشعة من ${clinicName}\nالمريض: ${patientName}\nده شرح مبسّط للي باين في الأشعة، راجعه الدكتور. لو عندك أي سؤال كلمنا في أي وقت.`;
    const pdfFilename = `${safeName}_xray_explained.pdf`;

    try {
      const mode = await resolveWhatsappDeliveryMode(clinicId);
      if (mode === "manual") {
        const textWithLink = `${caption}\n\n${signedUrl}`;
        await adminClinicCollection(clinicId, "whatsapp_logs").add({
          patientId,
          type: "xray_explainer_pdf",
          message: textWithLink,
          storagePath,
          status: "manual",
          createdAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ ok: true, manual: true, phone, text: textWithLink, asLink: true });
      }

      await sendWhatsAppPdfFromUrl({ clinicId, to: phone, fileUrl: signedUrl, pdfBytes: buffer, filename: pdfFilename, caption });
      await adminClinicCollection(clinicId, "whatsapp_logs").add({
        patientId,
        type: "xray_explainer_pdf",
        message: caption,
        storagePath,
        status: "success",
        createdAt: FieldValue.serverTimestamp(),
      });
      await reportSnap.ref.set({ sentToPatientAt: FieldValue.serverTimestamp(), sentToPatientBy: authz.uid }, { merge: true });
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Send failed";
      await adminClinicCollection(clinicId, "whatsapp_logs").add({
        patientId,
        type: "xray_explainer_pdf",
        message: caption,
        storagePath,
        status: "failed",
        createdAt: FieldValue.serverTimestamp(),
      });
      await file.delete().catch(() => {});
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
