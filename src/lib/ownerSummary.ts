/**
 * The owner's morning line: three sentences about a day, written once and kept.
 *
 * Built from the day's brief (the same engine as the owner's home), handed to the model as a fact
 * sheet — it may phrase, not invent — and stored under `clinics/{id}/owner_summaries/{date}` so
 * the morning read and the evening WhatsApp are the same text and the clinic pays for it once.
 * One AI credit per day, charged only when the model actually answered; with no plan, no credits
 * or no key, the plain-words version is stored instead and says so in `source`.
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { buildBriefing } from "@/lib/automation/briefing/build";
import { reserveAiCredit } from "@/lib/bot/aiCredits";
import { factSheet, plainSummary, summaryFacts, type DayFacts } from "@/lib/ownerSummaryText";
import { reportServerError } from "@/lib/server/reportError";

export const OWNER_SUMMARIES = "owner_summaries";
const MODEL = "gemini-flash-latest";
const TIMEOUT_MS = 20_000;

export type OwnerSummary = {
  dateKey: string;
  en: string[];
  ar: string[];
  source: "ai" | "plain";
  /** Why the plain version was stored — empty when the model wrote it. */
  aiSkipped?: string;
  facts: DayFacts;
  generatedAt: number;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function threeLines(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const lines = v.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 3);
  return lines.length >= 2 ? lines : null;
}

async function askModel(facts: DayFacts): Promise<{ en: string[]; ar: string[] } | { skipped: string }> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return { skipped: "no_api_key" };
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: MODEL,
    // A thinking model spends part of maxOutputTokens on its own reasoning, and 600 cut the JSON
    // off mid-string ("Unterminated string at position 44"). Room to think, and a schema so the
    // shape is enforced rather than hoped for.
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          en: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
          ar: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        },
        required: ["en", "ar"],
      },
      temperature: 0.4,
      maxOutputTokens: 4096,
    },
    systemInstruction:
      "You write a dental clinic owner's three-line summary of one day. Use ONLY the numbers in the fact sheet; " +
      "never invent, estimate or advise. Plain words, no exclamation marks, no praise. Leave out anything that is zero — \"0 no-shows\" is not news; a line that has nothing left to say is dropped. Line 1: what happened (visits, misses, new patients). " +
      "Line 2: the money, against the same day last week when given; omit the line entirely if money is not available. " +
      "Line 3: what is waiting (unconfirmed tomorrow, lab, stock) — or say nothing is waiting. " +
      "Return JSON {\"en\": [line, line, line], \"ar\": [line, line, line]}; the Arabic is Egyptian, as a clinic manager would text it. Numbers in Arabic lines use Western digits.",
  });
  try {
    const result = await withTimeout(model.generateContent(factSheet(facts)), TIMEOUT_MS);
    const text = (result.response.text() || "{}").trim().replace(/^```(?:json)?s*/i, "").replace(/```s*$/, "");
    const parsed = JSON.parse(text) as { en?: unknown; ar?: unknown };
    const en = threeLines(parsed.en);
    const ar = threeLines(parsed.ar);
    return en && ar ? { en, ar } : { skipped: "bad_shape" };
  } catch (e) {
    // Worth a line in the error log: a silent fallback here would read as "the AI is off".
    reportServerError("[OwnerSummary] model failed", e);
    return { skipped: e instanceof Error ? e.message.slice(0, 120) : "error" };
  }
}

/** The stored summary for a day, or nothing. */
export async function readOwnerSummary(clinicId: string, dateKey: string): Promise<OwnerSummary | null> {
  const snap = await adminClinicDoc(clinicId, OWNER_SUMMARIES, dateKey).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  const en = threeLines(d.en);
  const ar = threeLines(d.ar);
  if (!en || !ar) return null;
  return { dateKey, en, ar, source: d.source === "ai" ? "ai" : "plain", aiSkipped: String(d.aiSkipped || ""), facts: d.facts as DayFacts, generatedAt: Number(d.generatedAt) || 0 };
}

/**
 * The summary for a day, writing it if it does not exist yet. `moneyVisible` false hands the model
 * no money at all, so a stored summary never carries figures the clinic's admin cannot see.
 */
export async function getOrWriteOwnerSummary(clinicId: string, dateKey: string, opts: { moneyVisible?: boolean } = {}): Promise<OwnerSummary> {
  const existing = await readOwnerSummary(clinicId, dateKey);
  if (existing) return existing;

  const brief = await buildBriefing({ clinicId, period: "day", endDate: dateKey, access: { money: opts.moneyVisible !== false, hr: true } });
  const facts = summaryFacts(brief);

  let source: OwnerSummary["source"] = "plain";
  let en = plainSummary(facts, "en");
  let ar = plainSummary(facts, "ar");
  // Why the plain version was stored, when it was — "plan", "no_credits", or what the model said.
  let aiSkipped = "";

  const reservation = await reserveAiCredit(clinicId, 1);
  if (!reservation.ok) {
    aiSkipped = reservation.reason;
  } else {
    const written = await askModel(facts);
    if ("skipped" in written) {
      aiSkipped = written.skipped;
    } else {
      en = written.en;
      ar = written.ar;
      source = "ai";
      await reservation.charge("owner_summary", `Owner's summary for ${dateKey}`, 1);
    }
  }

  const generatedAt = Date.now();
  await adminClinicDoc(clinicId, OWNER_SUMMARIES, dateKey).set(
    { dateKey, en, ar, source, aiSkipped, facts, generatedAt, createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { dateKey, en, ar, source, aiSkipped, facts, generatedAt };
}
