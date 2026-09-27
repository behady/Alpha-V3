/**
 * The owner's morning line: three sentences about a day, written once and kept.
 *
 * Built from the day's brief (the same engine as the owner's home), handed to the model as a fact
 * sheet — it may phrase, not invent — and stored under `clinics/{id}/owner_summaries/{date}` so
 * the morning read and the evening WhatsApp are the same text and the clinic pays for it once.
 * One AI credit per day, charged only when the model actually answered; with no plan, no credits
 * or no key, the plain-words version is stored instead and says so in `source`.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { buildBriefing } from "@/lib/automation/briefing/build";
import { reserveAiCredit } from "@/lib/bot/aiCredits";
import { factSheet, plainSummary, summaryFacts, type DayFacts } from "@/lib/ownerSummaryText";

export const OWNER_SUMMARIES = "owner_summaries";
const MODEL = "gemini-flash-latest";
const TIMEOUT_MS = 20_000;

export type OwnerSummary = {
  dateKey: string;
  en: string[];
  ar: string[];
  source: "ai" | "plain";
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

async function askModel(facts: DayFacts): Promise<{ en: string[]; ar: string[] } | null> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return null;
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: MODEL,
    generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 600 },
    systemInstruction:
      "You write a dental clinic owner's three-line summary of one day. Use ONLY the numbers in the fact sheet; " +
      "never invent, estimate or advise. Plain words, no exclamation marks, no praise. Line 1: what happened (visits, misses, new patients). " +
      "Line 2: the money, against the same day last week when given; omit the line entirely if money is not available. " +
      "Line 3: what is waiting (unconfirmed tomorrow, lab, stock) — or say nothing is waiting. " +
      "Return JSON {\"en\": [line, line, line], \"ar\": [line, line, line]}; the Arabic is Egyptian, as a clinic manager would text it. Numbers in Arabic lines use Western digits.",
  });
  try {
    const result = await withTimeout(model.generateContent(factSheet(facts)), TIMEOUT_MS);
    const parsed = JSON.parse(result.response.text() || "{}") as { en?: unknown; ar?: unknown };
    const en = threeLines(parsed.en);
    const ar = threeLines(parsed.ar);
    return en && ar ? { en, ar } : null;
  } catch {
    return null;
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
  return { dateKey, en, ar, source: d.source === "ai" ? "ai" : "plain", facts: d.facts as DayFacts, generatedAt: Number(d.generatedAt) || 0 };
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

  const reservation = await reserveAiCredit(clinicId, 1);
  if (reservation.ok) {
    const written = await askModel(facts);
    if (written) {
      en = written.en;
      ar = written.ar;
      source = "ai";
      await reservation.charge("owner_summary", `Owner's summary for ${dateKey}`, 1);
    }
  }

  const generatedAt = Date.now();
  await adminClinicDoc(clinicId, OWNER_SUMMARIES, dateKey).set(
    { dateKey, en, ar, source, facts, generatedAt, createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { dateKey, en, ar, source, facts, generatedAt };
}
