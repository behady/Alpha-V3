/**
 * The one model call the onboarding scan needs: a prompt in, JSON out, with the token counts.
 *
 * A seam on purpose: scan.ts depends on `JsonModel`, tests inject a fake and never reach Gemini.
 * `geminiProJson` reads no environment itself; the caller passes the key and the model name
 * (botPro reads only GEMINI_PRO_API_KEY / GEMINI_PRO_MODEL, in the route).
 */
import { GoogleGenerativeAI, type ResponseSchema } from "@google/generative-ai";

export interface JsonModel {
  generate(prompt: string, schema: object): Promise<{ json: unknown; usage: { inTok: number; outTok: number } }>;
}

/** One scan or chat call may take this long; a hung call fails instead of eating the route's maxDuration. */
export const JSON_MODEL_TIMEOUT_MS = 90_000;

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export function geminiProJson(apiKey: string, modelName: string): JsonModel {
  const genAI = new GoogleGenerativeAI(apiKey);
  return {
    async generate(prompt, schema) {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema as unknown as ResponseSchema,
          temperature: 0.3,
        },
      }, { timeout: JSON_MODEL_TIMEOUT_MS });
      const result = await model.generateContent(prompt);
      const json: unknown = JSON.parse(result.response.text());
      const usage = result.response.usageMetadata;
      return { json, usage: { inTok: count(usage?.promptTokenCount), outTok: count(usage?.candidatesTokenCount) } };
    },
  };
}
