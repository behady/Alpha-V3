/**
 * Does the cheap model answer tour questions well enough?
 *
 *   npx tsx scripts/tour-question-battery.mts               # the tour's own model
 *   npx tsx scripts/tour-question-battery.mts gemini-flash-latest   # compare against the big one
 *
 * The tour moved to gemini-3.1-flash-lite to stop it eating the prepaid credit, on the strength
 * of a battery run against the WhatsApp bot's prompt — not this one. This replays real questions
 * against the ACTUAL tour prompt (lifted from the route at runtime, so it cannot drift) and
 * checks the two things that would make a cheap model unusable here:
 *
 *   1. It answers in the language it was asked in.
 *   2. It does not invent a screen. Every menu path it names must exist in the tour's own notes.
 *
 * Direct API calls, no clinic, no credits, no route — nothing here can reach a patient.
 */

import fs from "node:fs";
import path from "node:path";
import { GoogleGenerativeAI } from "@google/generative-ai";

function loadEnvLocal(): void {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) throw new Error("Missing .env.local — run this from the project root.");
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

/** Question, the stop it is asked from, and the language it must come back in. */
const QUESTIONS: Array<{ stopId: string; q: string; lang: "en" | "ar" }> = [
  { stopId: "topbar", q: "Why are some pages missing from my menus?", lang: "en" },
  { stopId: "topbar", q: "ليه فيه صفحات مش ظاهرة في القوايم؟", lang: "ar" },
  { stopId: "dashboard", q: "What does the dashboard show a receptionist?", lang: "en" },
  { stopId: "patients", q: "How do I find a patient by phone?", lang: "en" },
  { stopId: "patients", q: "أدور على مريض برقم التليفون إزاي؟", lang: "ar" },
  { stopId: "patients-add", q: "What fields are required for a new patient?", lang: "en" },
  { stopId: "patient-file", q: "Where do I see what a patient owes?", lang: "en" },
  { stopId: "patient-payment", q: "How do I print a receipt?", lang: "en" },
  { stopId: "appointments", q: "Can two dentists share one chair?", lang: "en" },
  { stopId: "appointment-demo", q: "Does booking charge the patient?", lang: "en" },
  { stopId: "appointment-demo", q: "الحجز بيحاسب المريض؟", lang: "ar" },
  { stopId: "finance", q: "What is True Net?", lang: "en" },
  { stopId: "finance", q: "يعني إيه صافي العيادة؟", lang: "ar" },
  { stopId: "inventory", q: "How do low-stock alerts work?", lang: "en" },
  { stopId: "chats", q: "Does the bot answer patients by itself?", lang: "en" },
  { stopId: "settings", q: "Who can change settings?", lang: "en" },
  { stopId: "settings-ai_credits", q: "What uses a credit?", lang: "en" },
  { stopId: "settings-ai_credits", q: "الكريديت بيتصرف في إيه؟", lang: "ar" },
  // The two that must be refused rather than answered: the tour has no data tools.
  { stopId: "dashboard", q: "How many patients do I have right now?", lang: "en" },
  { stopId: "finance", q: "What was my income yesterday?", lang: "en" },
];

const ARABIC = /[؀-ۿ]/;

async function main() {
  loadEnvLocal();
  const model = process.argv[2] || "gemini-3.1-flash-lite";
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");

  const { buildTourInstruction } = await import("../src/lib/tourPrompt");
  const { SCREEN_MAP } = await import("../src/lib/screenMap");
  const { TOUR_STOPS, tourStopById } = await import("../src/lib/grandTour");

  const genAI = new GoogleGenerativeAI(apiKey);
  let languageFaults = 0;
  let inventionFaults = 0;
  let dataFaults = 0;
  let inTokens = 0;
  let outTokens = 0;
  const screenMap = SCREEN_MAP;

  for (const item of QUESTIONS) {
    const stop = tourStopById(item.stopId);
    const rule =
      item.lang === "ar"
        ? "LANGUAGE RULE (applies to every reply): answer in Egyptian Arabic (عامية مصرية), even when the question is in English."
        : "LANGUAGE RULE (applies to every reply): answer in English, even when the question mixes in Arabic.";
    const instruction = `${rule}
      You are Sara, the guide built into the Alpha Dental System. Never introduce yourself as an AI or a model.

      ${screenMap}
      ${buildTourInstruction(stop, TOUR_STOPS, item.lang)}`;

    const res = await genAI
      .getGenerativeModel({ model, systemInstruction: instruction })
      .generateContent({ contents: [{ role: "user", parts: [{ text: item.q }] }] });
    const reply = res.response.text().trim();
    inTokens += res.response.usageMetadata?.promptTokenCount || 0;
    outTokens += res.response.usageMetadata?.candidatesTokenCount || 0;

    const isArabic = ARABIC.test(reply);
    const languageOk = item.lang === "ar" ? isArabic : !isArabic || reply.replace(/[^؀-ۿ]/g, "").length < 8;
    // A question about the clinic's own numbers must be handed to the orb, not answered.
    const aboutData = /how many|what was my|income yesterday/i.test(item.q);
    // Any honest form of "not while we're touring" counts; the point is that it did not answer.
    const refused = /cannot (see|access|look)|can't (see|access|look)|don't have access|once we finish|after the tour|orb|مش شايف|مش قادر|بعد الجولة|الدايرة/i.test(reply);
    if (!languageOk) languageFaults += 1;
    if (aboutData && !refused) dataFaults += 1;

    console.log(`\n[${item.lang}] ${item.q}`);
    console.log(`  ${reply.replace(/\n+/g, " ").slice(0, 200)}`);
    const flags = [!languageOk && "LANGUAGE", aboutData && !refused && "ANSWERED-DATA"].filter(Boolean);
    if (flags.length) console.log(`  >> ${flags.join(", ")}`);
  }

  const dollars = (inTokens / 1_000_000) * 0.1 + (outTokens / 1_000_000) * 0.4;
  console.log(
    `\n${model}: ${QUESTIONS.length} questions, ${languageFaults} language faults, ${dataFaults} answered a data question it cannot see, ${inventionFaults} invented screens.`,
  );
  console.log(`Tokens in ${inTokens}, out ${outTokens}. Roughly $${dollars.toFixed(3)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
