import { createGeminiTtsProvider } from "./gemini";
import { createPiperTtsProvider } from "./piper";
import { TtsError, type SpeechLanguage, type TtsProvider } from "./types";

export * from "./types";

/**
 * Gemini, always available whenever GEMINI_API_KEY is set — which is every environment this app
 * already runs in, since the assistant itself needs the same key. Exported on its own so the route
 * can reach it directly as a fallback target, not only as whatever getTtsProvider() happened to
 * pick.
 */
export function getGeminiTtsProvider(): TtsProvider {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) throw new TtsError("GEMINI_API_KEY is not set, so speech cannot be generated.");
  return createGeminiTtsProvider(apiKey);
}

/**
 * Chooses the speech provider for a given language.
 *
 * English and Arabic get different answers on purpose. Piper — self-hosted, free per use, and
 * faster than Gemini once its process is warm — has no usable Egyptian Arabic voice: its entire
 * Arabic catalogue is one Jordanian model capped at "medium" quality. That was confirmed by
 * listening to both side by side, not assumed, which is why Arabic is never routed here even when
 * PIPER_SERVICE_URL is set. English prefers Piper when that variable is configured; leaving it
 * unset (the default) means English quietly stays on Gemini too — this is additive, not required.
 */
export function getTtsProvider(language: SpeechLanguage): TtsProvider {
  if (language === "en" && process.env.PIPER_SERVICE_URL) {
    return createPiperTtsProvider(process.env.PIPER_SERVICE_URL, process.env.PIPER_SERVICE_TOKEN);
  }
  return getGeminiTtsProvider();
}
