import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { isFullAccessRole } from "@/lib/permissions";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { getAiCreditLimit } from "@/lib/subscriptions";
import { fetchPatientAiContext, patientContextBlock } from "@/lib/aiPatientContext";
import { logAiCreditUsage, createUsageMeter } from "@/lib/aiCreditLog";
import {
  buildXrayPrompt,
  normalizeXrayReport,
  XRAY_DEEP_MULTIPLIER,
  XRAY_MAX_IMAGES,
  XRAY_REPORT_CREDITS,
  XRAY_REPORT_FEATURE,
  XRAY_REPORTS_COLLECTION,
  XRAY_RESPONSE_SCHEMA,
} from "@/lib/xrayReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 80_000;

/**
 * AI radiograph reading.
 *
 * POST { clinicId, patientId, mediaIds: string[1..4], language?: "ar"|"en", note?, mode?: "deep" }
 *
 * The images are named by their `patient_media` document ids, never by URL: the server looks each
 * one up, checks it belongs to this patient in this clinic, and downloads it itself. A client that
 * could hand over arbitrary URLs could bill a radiograph read against any picture on the internet
 * — and, worse, could read another clinic's files by URL if it had one.
 *
 * Gates, in order: signed-in staff with a clinical role or `access.clinical`; the `aiXray` add-on;
 * enough AI credits. Charged only when a usable report came back, like every other AI feature.
 * The report is saved under `xray_reports` (server-only writes) so it outlives the browser tab and
 * can be printed, and so the credits it cost have something to show for themselves.
 */
export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");

    const body = await req.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const patientId = typeof body?.patientId === "string" ? body.patientId.trim() : "";
    const language: "ar" | "en" = body?.language === "ar" ? "ar" : "en";
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
    const deep = body?.mode === "deep";
    const rawIds: unknown[] = Array.isArray(body?.mediaIds) ? body.mediaIds : [];
    const mediaIds: string[] = [
      ...new Set(rawIds.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())),
    ].slice(0, XRAY_MAX_IMAGES);

    if (!clinicId || !patientId) {
      return NextResponse.json({ ok: false, error: "clinicId and patientId are required." }, { status: 400 });
    }
    if (mediaIds.length === 0) {
      return NextResponse.json({ ok: false, error: "Pick at least one image." }, { status: 400 });
    }

    const authz = await requireStaffUser(req, clinicId);
    if (!authz.ok) return authz.response;
    const clinical = isFullAccessRole(authz.role) || authz.role === "Dentist" || authz.permissions.includes("access.clinical");
    if (!clinical) {
      return NextResponse.json({ ok: false, error: "Reading x-rays needs clinical access." }, { status: 403 });
    }

    if (!(await clinicHasFeature(clinicId, "aiXray"))) {
      return NextResponse.json(
        { ok: false, error: language === "ar" ? "قراءة الأشعة بالذكاء الاصطناعي غير مفعّلة في اشتراك العيادة." : "AI x-ray reading is not part of this clinic's subscription.", reason: "feature_locked" },
        { status: 403 }
      );
    }

    // The model and the price are decided here, from the mode flag, never from a number the
    // client sent.
    const modelName = deep ? "gemini-pro-latest" : "gemini-flash-latest";
    const requiredCredits = XRAY_REPORT_CREDITS * (deep ? XRAY_DEEP_MULTIPLIER : 1);

    const db = adminDb();
    let chargeCredits: (() => Promise<void>) | null = null;
    try {
      const clinicSnap = await db.collection("clinics").doc(clinicId).get();
      if (!clinicSnap.exists) return NextResponse.json({ ok: false, error: "Clinic not found." }, { status: 404 });
      const clinicData = { id: clinicSnap.id, ...clinicSnap.data() } as any;
      const monthKey = new Date().toISOString().slice(0, 7);
      const usageRef = db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey);
      const usageSnap = await usageRef.get();
      const currentUsed = usageSnap.exists ? Number(usageSnap.data()?.creditsUsed) || 0 : 0;
      const limit = getAiCreditLimit(clinicData);
      if (limit > 0 && currentUsed + requiredCredits > limit) {
        return NextResponse.json(
          { ok: false, error: `Monthly AI credits limit reached (${currentUsed} / ${limit} credits used).`, reason: "no_credits" },
          { status: 429 }
        );
      }
      chargeCredits = async () => {
        await usageRef.set(
          { monthKey, creditsUsed: FieldValue.increment(requiredCredits), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      };
    } catch (err) {
      reportServerError("X-ray report quota check failed:", err);
      return NextResponse.json({ ok: false, error: "Could not verify your AI plan or usage. Please try again." }, { status: 503 });
    }

    const ctx = await fetchPatientAiContext(clinicId, patientId);
    if (!ctx) return NextResponse.json({ ok: false, error: "Patient not found." }, { status: 404 });

    // The images, by id, each checked against this patient.
    const mediaSnaps = await Promise.all(mediaIds.map((id) => adminClinicDoc(clinicId, "patient_media", id).get()));
    const media: { id: string; url: string; category: string; filename: string }[] = [];
    for (const snap of mediaSnaps) {
      const d = snap.data() as Record<string, unknown> | undefined;
      if (!snap.exists || !d || String(d.patientId || "") !== patientId) {
        return NextResponse.json({ ok: false, error: "One of the images does not belong to this patient." }, { status: 400 });
      }
      const url = String(d.url || "");
      if (!/^https:\/\/firebasestorage\.googleapis\.com\//.test(url)) {
        return NextResponse.json({ ok: false, error: "One of the images has no readable file." }, { status: 400 });
      }
      media.push({ id: snap.id, url, category: String(d.category || ""), filename: String(d.filename || d.fileName || "") });
    }

    const imageParts: { inlineData: { data: string; mimeType: string } }[] = [];
    for (const m of media) {
      const res = await fetch(m.url);
      if (!res.ok) return NextResponse.json({ ok: false, error: "Could not download one of the images." }, { status: 502 });
      const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      if (!mimeType.startsWith("image/")) {
        return NextResponse.json({ ok: false, error: "Only image files can be read (PDF and DICOM are not supported yet)." }, { status: 400 });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_IMAGE_BYTES) {
        return NextResponse.json({ ok: false, error: "One of the images is larger than 8 MB." }, { status: 400 });
      }
      imageParts.push({ inlineData: { data: buf.toString("base64"), mimeType } });
    }

    const prompt = buildXrayPrompt({
      language,
      imageCount: media.length,
      imageCategories: media.map((m) => m.category),
      dentistNote: note,
      deep,
    });

    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: modelName,
      systemInstruction: `${prompt}\n\n${patientContextBlock(ctx)}`,
      generationConfig: {
        responseMimeType: "application/json",
        // Plain data in lib/xrayReport.ts (so tests can import it without the SDK); the SDK's
        // ResponseSchema type wants its own enum for `type`, but the wire format is identical.
        responseSchema: XRAY_RESPONSE_SCHEMA as any,
        temperature: 0.2,
        maxOutputTokens: 8192,
      },
    });

    const meter = createUsageMeter(modelName);
    const result = await Promise.race([
      model.generateContent([
        ...imageParts,
        { text: language === "ar" ? "اقرأ الصور واكتب التقرير بالهيكل المطلوب." : "Read the images and write the structured report." },
      ]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("xray_timeout")), TIMEOUT_MS)),
    ]);
    meter.add(result.response);

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(result.response.text().replace(/```json/g, "").replace(/```/g, "").trim());
    } catch {
      parsed = null;
    }
    const report = normalizeXrayReport(parsed, media.length);
    if (!report) {
      return NextResponse.json({ ok: false, error: "The AI returned an unreadable report. Please try again." }, { status: 502 });
    }

    const patientName = String((ctx.patient as any).name || "");
    const docRef = adminClinicCollection(clinicId, XRAY_REPORTS_COLLECTION).doc();
    await docRef.set({
      patientId,
      patientName,
      mediaIds: media.map((m) => m.id),
      // A snapshot of the pictures as they were: if one is later deleted or re-filed, the report
      // still shows what was read.
      media: media.map((m) => ({ id: m.id, url: m.url, category: m.category, filename: m.filename })),
      language,
      mode: deep ? "deep" : "standard",
      model: modelName,
      note,
      report,
      credits: requiredCredits,
      createdBy: authz.uid,
      createdByName: authz.name,
      createdAt: FieldValue.serverTimestamp(),
    });

    await chargeCredits?.();
    await logAiCreditUsage({
      clinicId,
      feature: XRAY_REPORT_FEATURE,
      credits: requiredCredits,
      userId: authz.uid,
      userName: authz.name,
      patientId,
      patientName,
      detail: [`${media.length} image${media.length === 1 ? "" : "s"}`, report.imageType, deep ? "deep read" : ""].filter(Boolean).join(" · "),
      usage: meter.snapshot(),
    });

    return NextResponse.json({ ok: true, reportId: docRef.id, report, credits: requiredCredits });
  } catch (error: any) {
    reportServerError("X-ray report failed:", error);
    const timeout = error?.message === "xray_timeout";
    return NextResponse.json(
      { ok: false, error: timeout ? "The reading took too long. Try fewer or smaller images." : error?.message || "X-ray reading failed." },
      { status: timeout ? 504 : 500 }
    );
  }
}
