import { TtsError, type SynthesisRequest, type SynthesisResult, type TtsProvider } from "./types";

/**
 * Speech from a self-hosted Piper instance — see /tts-service.
 *
 * English only. Piper's entire Arabic catalogue is one Jordanian voice at "medium" quality at
 * best; real Egyptian Arabic through Gemini is clearly better, confirmed by ear before this was
 * written rather than assumed. getTtsProvider() never routes Arabic here, but this file does not
 * rely on that — it just does whatever text it is given.
 *
 * Unlike Gemini, this depends on infrastructure the clinic runs, not a managed API. That box being
 * slow to start, restarted, or simply down is routine, not exceptional, so every failure mode here
 * is marked retryable — the caller falls back to Gemini rather than the assistant losing its voice
 * because one small container needed a restart.
 */

const REQUEST_TIMEOUT_MS = 8_000;

export function createPiperTtsProvider(baseUrl: string, token?: string): TtsProvider {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/synthesize`;

  return {
    name: "piper",

    async synthesize({ text }: SynthesisRequest): Promise<SynthesisResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
      } catch (error) {
        // Connection refused, DNS failure, or the abort above firing on a timeout — all mean the
        // box was not reachable in time, not that the request itself was wrong.
        const reason = error instanceof Error ? error.message : String(error);
        throw new TtsError(`Piper service unreachable: ${reason}`, true);
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new TtsError(`Piper service returned ${response.status}. ${detail.slice(0, 200)}`, true);
      }

      const arrayBuffer = await response.arrayBuffer();
      return {
        audioBase64: Buffer.from(arrayBuffer).toString("base64"),
        mimeType: "audio/wav",
        // Self-hosted: there is no per-character bill from this provider to record.
        billedTokens: null,
      };
    },
  };
}
