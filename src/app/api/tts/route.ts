import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { hasFeature } from "@/lib/subscriptions";
import { getTtsProvider, getGeminiTtsProvider, TtsError } from "@/lib/tts";

/**
 * Turns an assistant reply into audio, on the server, so every clinic PC sounds the same.
 *
 * The browser's own voices were the previous approach and are still the fallback. They failed on
 * two counts: quality varies with whatever Windows happens to have installed, and a typical
 * machine has NO Egyptian Arabic voice at all, so Arabic was simply silent.
 *
 * Cost is metered rather than assumed. Speech is only generated when a user has deliberately
 * switched it on, every character is counted against a monthly ceiling, and the totals are written
 * where they can be read back — a per-message charge that nobody can see is how a surprise bill
 * happens.
 */

/**
 * Long replies are the expensive ones and the least worth hearing — by the time a paragraph has
 * been read aloud, the person has finished reading it. Anything past this is refused rather than
 * truncated, so a half-sentence is never spoken as if it were the whole answer.
 */
const MAX_CHARS = 600;

/** A ceiling no ordinary day's use can reach, sized to stop a runaway loop rather than to ration. */
const MONTHLY_CHAR_LIMIT = 400_000;

/**
 * Recently generated clips, keyed by clinic + language + exact text.
 *
 * Front-desk speech repeats relentlessly — "Payment recorded", "He's checked in", "She owes 7,700
 * pounds" — and each repeat otherwise costs both a few seconds of waiting and another charge. This
 * lives in the server instance's memory: it survives between requests while the instance is warm
 * and vanishes on redeploy, which is the right trade for something that is purely an optimisation.
 * Clinic id is part of the key so one clinic's audio can never be served to another.
 */
const AUDIO_CACHE = new Map<string, { audioBase64: string; mimeType: string }>();
const AUDIO_CACHE_MAX = 60;

function cacheGet(key: string) {
  const hit = AUDIO_CACHE.get(key);
  if (!hit) return null;
  // Refresh recency: re-inserting moves it to the end of the Map's iteration order.
  AUDIO_CACHE.delete(key);
  AUDIO_CACHE.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: { audioBase64: string; mimeType: string }) {
  if (AUDIO_CACHE.size >= AUDIO_CACHE_MAX) {
    const oldest = AUDIO_CACHE.keys().next().value;
    if (oldest) AUDIO_CACHE.delete(oldest);
  }
  AUDIO_CACHE.set(key, value);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { clinicId, text, language } = body as {
    clinicId?: string;
    text?: string;
    language?: string;
  };

  if (!clinicId || typeof clinicId !== "string") {
    return NextResponse.json({ error: "clinicId is required." }, { status: 400 });
  }
  const spoken = typeof text === "string" ? text.trim() : "";
  if (!spoken) {
    return NextResponse.json({ error: "text is required." }, { status: 400 });
  }
  if (spoken.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `That reply is too long to read aloud (${spoken.length} characters, limit ${MAX_CHARS}).` },
      { status: 413 }
    );
  }

  // Same membership check the assistant itself performs — this route spends money on the clinic's
  // behalf, so it must know who is asking.
  const authz = await requireStaffUser(request, clinicId);
  if (!authz.ok) return authz.response;

  const lang: "ar" | "en" = language === "ar" ? "ar" : "en";
  const monthKey = new Date().toISOString().slice(0, 7);
  const usageRef = adminClinicDoc(clinicId, "ai_usage", monthKey);

  try {
    const clinicSnap = await adminDb().collection("clinics").doc(clinicId).get();
    if (!clinicSnap.exists) {
      return NextResponse.json({ error: "Clinic not found." }, { status: 404 });
    }
    const clinicData = { id: clinicSnap.id, ...clinicSnap.data() } as any;

    // Spoken replies belong to the assistant; a plan without the assistant does not get its voice.
    if (!hasFeature(clinicData, "aiChat")) {
      return NextResponse.json(
        { error: "Voice replies are part of the AI assistant, available on Pro and Premium plans." },
        { status: 403 }
      );
    }

    // Served before the quota read and before any generation: a repeat costs nothing and should
    // therefore neither wait nor count against the ceiling.
    const cacheKey = `${clinicId}::${lang}::${spoken}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return NextResponse.json({
        audio: cached.audioBase64,
        mimeType: cached.mimeType,
        cached: true,
      });
    }

    let provider = getTtsProvider(lang);

    // The monthly ceiling exists to cap what a clinic spends — Piper is self-hosted and costs
    // nothing per character, so a busy day of English replies should not be able to trip a limit
    // that was sized around Gemini's bill. Only a request actually headed for a paid provider needs
    // the quota checked before it is allowed to spend anything.
    const usageSnap = await usageRef.get();
    const usedChars = Number(usageSnap.data()?.ttsCharacters) || 0;
    if (provider.name !== "piper" && usedChars + spoken.length > MONTHLY_CHAR_LIMIT) {
      return NextResponse.json(
        { error: "This clinic has reached its monthly limit for spoken replies." },
        { status: 429 }
      );
    }

    let result;
    try {
      result = await provider.synthesize({ text: spoken, language: lang });
    } catch (error) {
      if (!(error instanceof TtsError) || !error.retryable) throw error;

      // A self-hosted box being unreachable is not the same kind of failure as Gemini's own
      // occasional flakiness (see gemini.ts) — retrying Piper again just waits out the same
      // outage. Falling to Gemini keeps the assistant speaking while that box gets attention;
      // Gemini failing gets one more attempt at itself, since that has historically been enough.
      const fallback = provider.name === "piper" ? getGeminiTtsProvider() : provider;
      result = await fallback.synthesize({ text: spoken, language: lang });
      provider = fallback;
    }

    // Recorded after the audio exists, so a failed attempt is never billed to the clinic's ceiling.
    // Piper's own usage is still logged — ttsRequests and ttsProvider stay useful for visibility —
    // just never counted toward ttsCharacters, which is specifically the paid-usage ceiling.
    await usageRef.set(
      {
        monthKey,
        ...(provider.name !== "piper" ? { ttsCharacters: FieldValue.increment(spoken.length) } : {}),
        ttsRequests: FieldValue.increment(1),
        ttsTokens: FieldValue.increment(result.billedTokens || 0),
        ttsProvider: provider.name,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    cacheSet(cacheKey, { audioBase64: result.audioBase64, mimeType: result.mimeType });

    return NextResponse.json({
      audio: result.audioBase64,
      mimeType: result.mimeType,
      provider: provider.name,
      cached: false,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Could not generate speech.";
    console.error("TTS route failed:", error);
    // The panel falls back to the device voice on any failure, so this is a soft error: the
    // assistant still answers, it just answers in the browser's own voice.
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
