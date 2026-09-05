import { GoogleGenerativeAI } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { loadMetaWhatsappConfig } from "@/lib/metaWhatsapp";
import { reserveAiCredit } from "./aiCredits";

/**
 * A voice note, turned into the text the assistant can act on.
 *
 * Egyptians send voice notes as readily as text, and every one went straight to a person: the
 * bot could not read it, so "عايز أحجز بكره" spoken aloud became a handoff while the same words
 * typed became a booking. The audio is fetched from Meta, transcribed by the model in Egyptian
 * Arabic, and the transcript is handled exactly as if it had been typed — including the clinical
 * triage, which is the reason this is worth a credit: a spoken "وشي وارم" now reaches the
 * emergency path instead of the generic "someone will listen to it".
 *
 * Costs one credit from the clinic's pool, charged only when a transcript actually comes back.
 * Any failure returns to the old behaviour — acknowledge the note and fetch a person — so a
 * transcription problem can never make a voice note disappear.
 */

const MODEL = "gemini-flash-latest";
const TIMEOUT_MS = 25000;
/** WhatsApp voice notes are short; anything past this is not a message the bot should act on. */
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export type TranscriptResult = { ok: true; text: string } | { ok: false; reason: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("transcribe_timeout")), ms))]);
}

export async function transcribeWhatsappAudio(clinicId: string, mediaId: string): Promise<TranscriptResult> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return { ok: false, reason: "no_api_key" };
  if (!mediaId) return { ok: false, reason: "no_media_id" };

  const config = await loadMetaWhatsappConfig(clinicId);
  if (!config?.token) return { ok: false, reason: "no_meta_config" };

  const reservation = await reserveAiCredit(clinicId);
  if (!reservation.ok) return { ok: false, reason: reservation.reason };

  try {
    // Meta hands out a short-lived download URL for the media id; the bytes need the same token.
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const meta = (await metaRes.json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number };
    if (!metaRes.ok || !meta.url) return { ok: false, reason: "media_lookup_failed" };
    if ((meta.file_size || 0) > MAX_AUDIO_BYTES) return { ok: false, reason: "audio_too_large" };

    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${config.token}` } });
    if (!fileRes.ok) return { ok: false, reason: "media_download_failed" };
    const bytes = Buffer.from(await fileRes.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES) return { ok: false, reason: "audio_size" };

    const mimeType = (meta.mime_type || "audio/ogg").split(";")[0].trim();
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0, maxOutputTokens: 400 },
    });
    const result = await withTimeout(
      model.generateContent([
        { inlineData: { mimeType, data: bytes.toString("base64") } },
        {
          text:
            "اكتب نص الرسالة الصوتية دي زي ما اتقالت بالظبط، بالعامية المصرية، من غير أي إضافة أو تعليق أو ترجمة. " +
            "لو مفيش كلام مفهوم أو الرسالة فاضية، اكتب الكلمة EMPTY بس.",
        },
      ]),
      TIMEOUT_MS
    );
    const text = result.response.text().trim();
    if (!text || /^EMPTY$/i.test(text)) return { ok: false, reason: "empty" };

    await reservation.charge("whatsapp_voice", text);
    // Same flight recorder the AI answers use, so a wrong transcript can be read back later.
    await adminClinicCollection(clinicId, "ai_debug")
      .doc(new Date().toISOString().replace(/[:.]/g, "-"))
      .set({ kind: "transcript", mediaId, text: text.slice(0, 500), createdAt: FieldValue.serverTimestamp() })
      .catch(() => {});
    return { ok: true, text: text.slice(0, 1000) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "transcribe_failed" };
  }
}
