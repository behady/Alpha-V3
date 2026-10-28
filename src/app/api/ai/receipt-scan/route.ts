import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { GoogleGenerativeAI, type ResponseSchema } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminBucket, adminDb } from "@/lib/firebaseAdmin";
import { requireStaffPermission } from "@/lib/apiStaffAuth";
import { clinicHasFeature } from "@/lib/clinicFeatures";
import { getAiCreditLimit } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";
import { createUsageMeter, logAiCreditUsage } from "@/lib/aiCreditLog";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import {
  buildReceiptPrompt,
  isOwnReceiptPath,
  normalizeReceiptScan,
  RECEIPT_ACCEPTED_TYPES,
  RECEIPT_MAX_BYTES,
  RECEIPT_RESPONSE_SCHEMA,
  RECEIPT_SCAN_CREDITS,
  RECEIPT_SCAN_FEATURE,
} from "@/lib/receiptScan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "gemini-flash-latest";
const TIMEOUT_MS = 50_000;

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

const segment = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.length <= 100 && !/[/\\]/.test(s) && s !== "." && s !== ".." ? s : "";
};

/**
 * Reads an expense receipt and says what it found. Writes no money: the desk checks the lines on
 * a review sheet and saves them through /api/finance/ledger `create-receipt-entries`.
 *
 * POST { clinicId, receiptId, path, language?: "ar"|"en" }
 *
 * The browser has already uploaded the file to `clinics/{clinicId}/expense_receipts/{receiptId}/…`.
 * The server downloads it itself by that path — never by a URL — after checking it is in THIS
 * clinic's folder (the same rule as the insurance reader).
 *
 * Gates, in order: staff with `finance.add` (the same as typing an expense) → the `aiReceipts`
 * add-on → enough AI credits → the file (≤ 8 MB, PDF or picture) → the model. Charged only when a
 * usable reading came back.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const clinicId = segment(body?.clinicId);
    const receiptId = segment(body?.receiptId);
    const path = typeof body?.path === "string" ? body.path.trim() : "";
    const language: "ar" | "en" = body?.language === "ar" ? "ar" : "en";
    if (!clinicId || !receiptId || !path) return fail(400, "clinicId, receiptId and path are required.");

    const authz = await requireStaffPermission(req, clinicId, "finance.add");
    if (!authz.ok) return authz.response;

    if (!(await clinicHasFeature(clinicId, "aiReceipts"))) {
      return fail(403, language === "ar" ? "قراءة الفواتير غير مفعّلة في اشتراك العيادة." : "Receipt scanning is not part of this clinic's subscription.", {
        reason: "feature_locked",
      });
    }

    if (!isOwnReceiptPath(path, clinicId, receiptId)) return fail(400, "That file is not in this clinic's receipts folder.");

    // --- credits ----------------------------------------------------------------------------
    const db = adminDb();
    const monthKey = new Date().toISOString().slice(0, 7);
    const usageRef = db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey);
    try {
      const [clinicSnap, usageSnap] = await Promise.all([db.collection("clinics").doc(clinicId).get(), usageRef.get()]);
      if (!clinicSnap.exists) return fail(404, "Clinic not found.");
      const limit = getAiCreditLimit({ id: clinicSnap.id, ...clinicSnap.data() } as Clinic);
      const used = usageSnap.exists ? Number(usageSnap.data()?.creditsUsed) || 0 : 0;
      if (limit > 0 && used + RECEIPT_SCAN_CREDITS > limit) {
        return fail(429, `Monthly AI credits limit reached (${used} / ${limit} credits used).`, { reason: "no_credits" });
      }
    } catch (err) {
      reportServerError("Receipt scan quota check failed:", err);
      return fail(503, "Could not verify your AI plan or usage. Please try again.");
    }

    // --- the file ---------------------------------------------------------------------------
    const file = adminBucket().file(path);
    let contentType = "";
    let data: Buffer;
    try {
      const [meta] = await file.getMetadata();
      contentType = String(meta.contentType || "").split(";")[0].trim().toLowerCase();
      if (!RECEIPT_ACCEPTED_TYPES.has(contentType)) return fail(400, "Only a PDF or a JPG, PNG, WebP or HEIC picture can be read.");
      if ((Number(meta.size) || 0) > RECEIPT_MAX_BYTES) return fail(400, "The file is larger than 8 MB.");
      [data] = await file.download();
    } catch (err) {
      if ((err as { code?: unknown })?.code === 404) return fail(404, "The uploaded receipt was not found. Upload it again.");
      throw err;
    }
    if (!data.length) return fail(400, "The uploaded receipt is empty.");

    // --- the model --------------------------------------------------------------------------
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
    const meter = createUsageMeter(MODEL);
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        // Plain data in lib/receiptScan.ts so tests can import it without the SDK.
        responseSchema: RECEIPT_RESPONSE_SCHEMA as unknown as ResponseSchema,
        temperature: 0.1,
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let parsed: unknown = null;
    try {
      const result = await Promise.race([
        model.generateContent([{ text: buildReceiptPrompt(language, ymdInTimeZone(clinicTimeZone())) }, { inlineData: { data: data.toString("base64"), mimeType: contentType } }]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("receipt_timeout")), TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer));
      meter.add(result.response);
      parsed = JSON.parse(result.response.text().replace(/```json/g, "").replace(/```/g, "").trim());
    } catch (err) {
      reportServerError("Receipt scan: model step failed:", err);
      return fail(502, language === "ar" ? "مقدرناش نقرا الفاتورة المرة دي. جرّب تاني أو اكتبها بإيدك." : "The receipt could not be read this time. Try again, or type it in by hand.", {
        retryable: true,
      });
    }

    const scan = normalizeReceiptScan(parsed);
    if (!scan) {
      return fail(422, language === "ar" ? "مفيش مبالغ واضحة في الصورة. صوّرها أوضح أو اكتبها بإيدك." : "No readable amounts on this picture. Take a clearer photo or type it in by hand.", {
        retryable: true,
      });
    }
    if (!scan.isReceipt) {
      return fail(422, language === "ar" ? "الصورة دي مش فاتورة." : "This picture is not a receipt or bill.", { retryable: false });
    }

    await usageRef.set({ monthKey, creditsUsed: FieldValue.increment(RECEIPT_SCAN_CREDITS), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await logAiCreditUsage({
      clinicId,
      feature: RECEIPT_SCAN_FEATURE,
      credits: RECEIPT_SCAN_CREDITS,
      userId: authz.uid,
      userName: authz.name,
      detail: [scan.supplier, `${scan.lines.length} line${scan.lines.length === 1 ? "" : "s"}`, `${scan.total} EGP`].filter(Boolean).join(" · "),
      usage: meter.snapshot(),
    });

    return NextResponse.json({ ok: true, scan, credits: RECEIPT_SCAN_CREDITS });
  } catch (error) {
    reportServerError("Receipt scan failed:", error);
    const timeout = error instanceof Error && error.message === "receipt_timeout";
    return fail(timeout ? 504 : 500, timeout ? "The reading took too long. Try a smaller picture." : "Receipt scan failed.");
  }
}
