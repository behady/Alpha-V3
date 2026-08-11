/**
 * The seam between the app and whichever service actually produces speech.
 *
 * Deliberately tiny. The reception panel and /api/tts only ever see this shape, so swapping Gemini
 * for Azure, ElevenLabs, or a self-hosted server later is a new file plus one line in the factory —
 * not a rewrite. That mattered enough to build in from the start: the first provider was chosen for
 * "works today with the key we already have", not because it is the best-sounding or the fastest,
 * and it should be replaceable when that judgement changes.
 */

export type SpeechLanguage = "ar" | "en";

export interface SynthesisRequest {
  text: string;
  language: SpeechLanguage;
  /** Provider-specific voice id. Omitted means the provider's default for that language. */
  voice?: string;
}

export interface SynthesisResult {
  /** Base64 audio, ready for a `data:` URL — always in a container a browser can play. */
  audioBase64: string;
  mimeType: string;
  /** What the provider reported it billed, for the usage meter. Null when it does not say. */
  billedTokens: number | null;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
}

/** Thrown for a failure worth telling the user about, as opposed to an internal fault. */
export class TtsError extends Error {
  constructor(message: string, readonly retryable: boolean = false) {
    super(message);
    this.name = "TtsError";
  }
}
