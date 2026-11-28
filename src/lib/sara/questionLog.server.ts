/**
 * Every question put to the assistant, and how it was answered.
 *
 * Until now nothing recorded what people ask, so the list of ready-made answers was a guess.
 * Each turn writes one row here: who asked, the question, which tools answered it, whether it
 * ended in a ready answer, a raw read, a deep search or nothing, and what it cost in tokens.
 * Questions that keep ending in "read" or "none" are the next ready answers to build.
 *
 * A root collection on purpose: questions carry patient names, and an unlisted root collection
 * is closed to every browser by the rules' default. Only the superadmin route reads it.
 *
 * Never throws. A failed log line must not lose the answer the person is waiting for.
 */

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import type { AiTokenUsage } from "@/lib/aiCreditLog";
import type { SaraOutcome } from "./turnOutcome";

export const SARA_QUESTION_LOG = "sara_question_log";

export async function logSaraQuestion(row: {
  clinicId: string;
  userId: string;
  userName: string;
  role: string;
  client: string;
  question: string;
  outcome: SaraOutcome;
  tools: string[];
  ceilingHit: boolean;
  deepOffered: boolean;
  credits: number;
  usage: AiTokenUsage | null;
}): Promise<void> {
  try {
    const question = String(row.question || "").trim().slice(0, 500);
    if (!question) return;
    await adminDb().collection(SARA_QUESTION_LOG).add({
      clinicId: row.clinicId,
      userId: row.userId,
      userName: row.userName || "",
      role: row.role || "",
      client: row.client || "",
      question,
      outcome: row.outcome,
      tools: [...new Set(row.tools)].slice(0, 12),
      ceilingHit: row.ceilingHit,
      deepOffered: row.deepOffered,
      credits: row.credits,
      apiCalls: row.usage?.apiCalls ?? 0,
      inputTokens: row.usage?.inputTokens ?? 0,
      outputTokens: (row.usage?.outputTokens ?? 0) + (row.usage?.thoughtTokens ?? 0),
      cachedTokens: row.usage?.cachedTokens ?? 0,
      day: new Date().toISOString().slice(0, 10),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("logSaraQuestion: failed to write", { clinicId: row.clinicId }, error);
  }
}
