import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { loadMetaWhatsappConfig } from "@/lib/metaWhatsapp";
import { reserveAiCredit } from "./aiCredits";

/**
 * A photo, described for the people who will act on it.
 *
 * Patients send pictures of the thing that worries them — a chipped tooth, a swelling, a
 * receipt from another clinic, a screenshot of an ad. The bot could only say "someone will look".
 * Now the model looks first and writes two lines FOR STAFF: what the picture shows and how
 * urgent it reads, plus the service it seems to be about. The patient is never told any of it —
 * a description is not a diagnosis, and a model's guess about a swelling is exactly the message
 * a clinic must never send — but the handoff arrives with the picture already read, and a
 * swelling is flagged urgent instead of sitting behind a parking-spot photo.
 *
 * One credit, charged only when a description comes back. Any failure falls back to the plain
 * "we got your photo" path.
 */

const MODEL = "gemini-flash-latest";
const TIMEOUT_MS = 25000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export type ImageDescription =
  | { ok: true; summary: string; urgent: boolean; interest: string; category: "dental" | "document" | "other" }
  | { ok: false; reason: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("describe_timeout")), ms))]);
}

export async function describeWhatsappImage(clinicId: string, mediaId: string): Promise<ImageDescription> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return { ok: false, reason: "no_api_key" };
  if (!mediaId) return { ok: false, reason: "no_media_id" };

  const config = await loadMetaWhatsappConfig(clinicId);
  if (!config?.token) return { ok: false, reason: "no_meta_config" };

  const reservation = await reserveAiCredit(clinicId);
  if (!reservation.ok) return { ok: false, reason: reservation.reason };

  try {
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, { headers: { Authorization: `Bearer ${config.token}` } });
    const meta = (await metaRes.json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number };
    if (!metaRes.ok || !meta.url) return { ok: false, reason: "media_lookup_failed" };
    if ((meta.file_size || 0) > MAX_IMAGE_BYTES) return { ok: false, reason: "image_too_large" };
    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${config.token}` } });
    if (!fileRes.ok) return { ok: false, reason: "media_download_failed" };
    const bytes = Buffer.from(await fileRes.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "image_size" };
    const mimeType = (meta.mime_type || "image/jpeg").split(";")[0].trim();

    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            category: { type: SchemaType.STRING, enum: ["dental", "document", "other"], format: "enum" },
            summary: { type: SchemaType.STRING },
            urgent: { type: SchemaType.BOOLEAN },
            interest: { type: SchemaType.STRING },
          },
          required: ["category", "summary", "urgent"],
        },
        temperature: 0.2,
        maxOutputTokens: 2048,
        ...({ thinkingConfig: { thinkingBudget: 0 } } as Record<string, unknown>),
      },
    });
    const result = await withTimeout(
      model.generateContent([
        { inlineData: { mimeType, data: bytes.toString("base64") } },
        {
          text:
            "انت بتساعد استقبال عيادة أسنان. المريض بعت الصورة دي على واتساب. اكتب لفريق العيادة (مش للمريض):\n" +
            "- category: dental لو الصورة لفم أو أسنان أو وش، document لو روشتة أو أشعة أو فاتورة أو سكرين شوت، other غير كده.\n" +
            "- summary: وصف من جملة لجملتين بالعامية المصرية لإيه اللي باين في الصورة (مثلاً: ضرس مكسور في الفك السفلي يمين، أو ورم واضح في الخد الشمال، أو صورة أشعة بانوراما). ممنوع تشخيص أو خطة علاج — وصف بس.\n" +
            "- urgent: true لو باين ورم، نزيف، صديد، كسر كبير، إصابة، أو أي حاجة تستاهل رد فوري.\n" +
            "- interest: اسم الخدمة اللي الصورة غالباً بتخصها لو واضح (تبييض، تقويم، زراعة، حشو، خلع، تنظيف...) وإلا سيبها فاضية.",
        },
      ]),
      TIMEOUT_MS
    );
    const parsed = JSON.parse(result.response.text()) as { category?: string; summary?: string; urgent?: boolean; interest?: string };
    const summary = String(parsed.summary || "").trim().slice(0, 400);
    if (!summary) return { ok: false, reason: "empty" };
    const category = parsed.category === "dental" || parsed.category === "document" ? parsed.category : "other";

    await reservation.charge("whatsapp_photo", summary);
    await adminClinicCollection(clinicId, "ai_debug")
      .doc(new Date().toISOString().replace(/[:.]/g, "-"))
      .set({ kind: "image", mediaId, summary, urgent: parsed.urgent === true, category, createdAt: FieldValue.serverTimestamp() })
      .catch(() => {});
    return { ok: true, summary, urgent: parsed.urgent === true, interest: String(parsed.interest || "").trim().slice(0, 60), category };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "describe_failed" };
  }
}
