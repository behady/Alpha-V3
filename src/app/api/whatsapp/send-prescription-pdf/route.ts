import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminBucket } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { sendWhatsAppPdfFromUrl } from "@/lib/whatsapp";
import { pickPatientPhone } from "@/lib/patientPhone";

const MAX_PDF_BYTES = 6 * 1024 * 1024;

function slugifyName(name: string) {
  return name
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 48) || "patient";
}

export async function POST(request: Request) {
  const authz = await requireStaffUser(request);
  if (!authz.ok) return authz.response;

  try {
    // Clinic data lives under clinics/{clinicId}/. These reads were hitting root-level
    // collections that do not exist, so they silently resolved to empty and this route
    // could never find the record it was asked to send.
    const clinicId = await resolveUserClinicId(authz.uid);

    const body = (await request.json().catch(() => ({}))) as {
      patientId?: string;
      pdfBase64?: string;
    };

    const patientId = typeof body.patientId === "string" ? body.patientId.trim() : "";
    const pdfBase64 = typeof body.pdfBase64 === "string" ? body.pdfBase64.trim() : "";
    if (!patientId || !pdfBase64) {
      return NextResponse.json({ ok: false, error: "patientId and pdfBase64 are required" }, { status: 400 });
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
    if (!patientSnap.exists) {
      return NextResponse.json({ ok: false, error: "Patient not found" }, { status: 404 });
    }
    const patient = patientSnap.data() as Record<string, unknown>;
    if (patient.whatsappOptOut === true) {
      return NextResponse.json(
        { ok: false, error: "Patient opted out of WhatsApp messages" },
        { status: 400 }
      );
    }

    const phone = pickPatientPhone(patient);
    if (!phone) {
      return NextResponse.json({ ok: false, error: "Patient has no phone number" }, { status: 400 });
    }

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
    const stamp = Date.now();
    const storagePath = `outbound_prescriptions/${patientId}/${stamp}_${safeName}.pdf`;

    const bucket = adminBucket();
    const file = bucket.file(storagePath);
    await file.save(buffer, {
      contentType: "application/pdf",
      metadata: {
        cacheControl: "private, max-age=3600",
      },
    });

    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    const caption = `روشتة من ${clinicName}\nالمريض: ${patientName}\nألف سلامة عليك، ونتمنالك الشفا العاجل.`;
    const pdfFilename = `${safeName}_prescription.pdf`;

    try {
      await sendWhatsAppPdfFromUrl({
        clinicId,
        to: phone,
        fileUrl: signedUrl,
        pdfBytes: buffer,
        filename: pdfFilename,
        caption,
      });
      await adminClinicCollection(clinicId, "whatsapp_logs").add({
        patientId,
        type: "prescription_pdf",
        message: caption,
        storagePath,
        status: "success",
        createdAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Send failed";
      await adminClinicCollection(clinicId, "whatsapp_logs").add({
        patientId,
        type: "prescription_pdf",
        message: caption,
        storagePath,
        status: "failed",
        createdAt: FieldValue.serverTimestamp(),
      });
      try {
        await file.delete().catch(() => {});
      } catch {
        /* ignore */
      }
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
