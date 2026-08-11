import { TtsError, type SynthesisRequest, type SynthesisResult, type TtsProvider } from "./types";

/**
 * Speech from the Gemini API, using the same GEMINI_API_KEY the assistant already uses.
 *
 * Chosen as the first provider because it needs no new account, no new billing relationship and no
 * per-machine voice installation — and because it handles Egyptian Arabic, which the Windows
 * voices on a typical clinic PC do not have at all.
 *
 * Two things about it are worth knowing when reading this file:
 *
 * 1. It returns RAW PCM, not a playable file. `<audio>` cannot play headerless PCM, so a WAV
 *    container is added here rather than in the browser — the sample rate is only stated in the
 *    response mime type, and that is the one place it is known for certain.
 * 2. It is flaky at the edges. Test calls occasionally came back 200 with no audio part at all,
 *    so a missing part is treated as a retryable failure rather than a crash.
 */

const MODEL = "gemini-2.5-flash-preview-tts";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Neutral, unhurried voices that hold up in both languages. */
const DEFAULT_VOICE: Record<string, string> = { ar: "Kore", en: "Kore" };

/** Wraps raw PCM in a WAV header so a browser will play it. */
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function createGeminiTtsProvider(apiKey: string): TtsProvider {
  return {
    name: "gemini",

    async synthesize({ text, language, voice }: SynthesisRequest): Promise<SynthesisResult> {
      const voiceName = voice || DEFAULT_VOICE[language] || "Kore";

      const response = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        // 429/5xx are worth another attempt; a 400 means the request itself is wrong.
        throw new TtsError(
          `Speech service returned ${response.status}. ${detail.slice(0, 200)}`,
          response.status === 429 || response.status >= 500
        );
      }

      const body = await response.json();
      const inline = body?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inline?.data) {
        throw new TtsError("Speech service returned no audio.", true);
      }

      const sampleRate = Number((String(inline.mimeType || "").match(/rate=(\d+)/) || [])[1] || 24000);
      const wav = pcmToWav(Buffer.from(inline.data, "base64"), sampleRate);

      return {
        audioBase64: wav.toString("base64"),
        mimeType: "audio/wav",
        billedTokens: Number(body?.usageMetadata?.totalTokenCount) || null,
      };
    },
  };
}
