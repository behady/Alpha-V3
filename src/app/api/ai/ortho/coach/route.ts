import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { logAiCreditUsage } from "@/lib/aiCreditLog";
import { normalizeNormOverrides } from "@/lib/orthoCeph";
import {
  buildLessonDistillPrompt,
  correctionLines,
  LESSON_DISTILL_SCHEMA,
  normalizeLessonKind,
  normalizeLessonSuggestions,
  normalizeLessonText,
  normalizeOrthoReport,
  ORTHO_AI_KINDS,
  ORTHO_AI_REPORTS_COLLECTION,
  ORTHO_COACHING_BIAS_DOC,
  ORTHO_COACHING_COLLECTION,
  ORTHO_COACHING_NORMS_DOC,
  ORTHO_LESSON_CREDITS,
  ORTHO_LESSON_LOG_FEATURE,
  ORTHO_LESSON_MAX_COUNT,
  type Lang,
  type OrthoAiKind,
  type OrthoReview,
} from "@/lib/orthoAi";
import { askGeminiJson, gateOrthoAi, loadOrthoCoaching, newMeter, OrthoAiTimeout, reserveOrthoCredits } from "@/lib/server/orthoAiServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Teaching the model.
 *
 * POST { clinicId, action, ... }
 *   add     { lessons: [{ text, kind }], reportId? }   save lessons in the dentist's words
 *   learn   { reportId }                               distil one report's corrections into 1–3
 *                                                      candidate lessons (one credit); nothing is
 *                                                      saved — the dentist approves, then `add`s
 *   toggle  { lessonId, active }                       switch a lesson off without losing it
 *   delete  { lessonId }
 *   norms   { norms: { SNA: { mean, sd }, ... } }      the clinic's own cephalometric norms
 *   reset_bias                                         forget the landmark tally
 *
 * `ortho_coaching` is server-only (firestore.rules). Lessons are read by every ortho prompt, so
 * who may write them is who may run the analysis: the same gate. Nothing the model suggests is
 * ever stored on its own say-so.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const action = typeof body?.action === "string" ? body.action : "";
    const language: Lang = body?.language === "ar" ? "ar" : "en";
    if (!clinicId) return NextResponse.json({ ok: false, error: "clinicId is required." }, { status: 400 });

    const gate = await gateOrthoAi(req, clinicId, language);
    if (!gate.ok) return gate.response;
    const { authz } = gate;
    const col = adminClinicCollection(clinicId, ORTHO_COACHING_COLLECTION);

    if (action === "add") {
      const raw: unknown[] = Array.isArray(body?.lessons) ? body.lessons : [];
      const reportId = typeof body?.reportId === "string" ? body.reportId.trim() : "";
      const existing = await loadOrthoCoaching(clinicId);
      if (existing.lessons.length >= ORTHO_LESSON_MAX_COUNT) {
        return NextResponse.json({ ok: false, error: `The lesson book is full (${ORTHO_LESSON_MAX_COUNT}). Delete or merge some first.` }, { status: 400 });
      }
      const have = new Set(existing.lessons.map((l) => l.text.toLowerCase()));
      const added: { id: string; text: string; kind: string }[] = [];
      for (const item of raw.slice(0, 5)) {
        const it = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        const text = normalizeLessonText(it.text);
        if (!text || have.has(text.toLowerCase())) continue;
        have.add(text.toLowerCase());
        const kind = normalizeLessonKind(it.kind);
        const ref = col.doc();
        await ref.set({
          text,
          kind,
          source: reportId ? "correction" : "manual",
          ...(reportId ? { reportId } : {}),
          active: true,
          createdBy: authz.uid,
          createdByName: authz.name,
          createdAt: FieldValue.serverTimestamp(),
        });
        added.push({ id: ref.id, text, kind });
      }
      if (!added.length) return NextResponse.json({ ok: false, error: language === "ar" ? "مفيش درس جديد يتحفظ." : "Nothing new to save." }, { status: 400 });
      return NextResponse.json({ ok: true, added });
    }

    if (action === "learn") {
      const apiKey = process.env.GEMINI_API_KEY || "";
      if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");
      const reportId = typeof body?.reportId === "string" ? body.reportId.trim() : "";
      if (!reportId) return NextResponse.json({ ok: false, error: "reportId is required." }, { status: 400 });
      const snap = await adminClinicDoc(clinicId, ORTHO_AI_REPORTS_COLLECTION, reportId).get();
      const data = snap.data() as Record<string, any> | undefined;
      if (!snap.exists || !data) return NextResponse.json({ ok: false, error: "Report not found." }, { status: 404 });
      const kind = data.kind as OrthoAiKind;
      const report = ORTHO_AI_KINDS.includes(kind) ? normalizeOrthoReport(kind, data.report) : null;
      const review = (data.review as OrthoReview | null) || null;
      if (!report || !review) return NextResponse.json({ ok: false, error: language === "ar" ? "راجع التقرير الأول — صحّح أو ارفض أو اكتب ملاحظة." : "Review the report first — edit, reject or write a note." }, { status: 400 });
      const corrections = correctionLines(kind, report, review);
      if (!corrections.length) return NextResponse.json({ ok: false, error: language === "ar" ? "مفيش تصحيحات على التقرير ده يتعلم منها." : "This report has no corrections to learn from." }, { status: 400 });

      const reserve = await reserveOrthoCredits(clinicId, ORTHO_LESSON_CREDITS);
      if (!reserve.ok) return reserve.response;
      const coaching = await loadOrthoCoaching(clinicId);
      const modelName = "gemini-flash-latest";
      const meter = newMeter(modelName);
      const raw = await askGeminiJson({
        apiKey,
        modelName,
        systemInstruction: buildLessonDistillPrompt({ kind, corrections, existing: coaching.lessons }),
        parts: [{ text: "Write the lessons as JSON." }],
        schema: LESSON_DISTILL_SCHEMA,
        meter,
        timeoutMs: 40_000,
        maxOutputTokens: 2048,
      });
      const suggestions = normalizeLessonSuggestions(raw);
      await reserve.charge();
      await logAiCreditUsage({
        clinicId,
        feature: ORTHO_LESSON_LOG_FEATURE,
        credits: ORTHO_LESSON_CREDITS,
        userId: authz.uid,
        userName: authz.name,
        patientId: String(data.patientId || ""),
        patientName: String(data.patientName || ""),
        detail: `${kind} · ${corrections.length} corrections → ${suggestions.length} lessons`,
        usage: meter.snapshot(),
      });
      return NextResponse.json({ ok: true, suggestions, corrections, credits: ORTHO_LESSON_CREDITS });
    }

    if (action === "toggle" || action === "delete") {
      const lessonId = typeof body?.lessonId === "string" ? body.lessonId.trim() : "";
      if (!lessonId || lessonId === ORTHO_COACHING_NORMS_DOC || lessonId === ORTHO_COACHING_BIAS_DOC) {
        return NextResponse.json({ ok: false, error: "lessonId is required." }, { status: 400 });
      }
      const ref = col.doc(lessonId);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ ok: false, error: "Lesson not found." }, { status: 404 });
      if (action === "delete") await ref.delete();
      else await ref.set({ active: body?.active !== false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return NextResponse.json({ ok: true });
    }

    if (action === "norms") {
      const norms = normalizeNormOverrides(body?.norms);
      await col.doc(ORTHO_COACHING_NORMS_DOC).set({ norms, updatedBy: authz.uid, updatedByName: authz.name, updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ ok: true, norms });
    }

    if (action === "reset_bias") {
      await col.doc(ORTHO_COACHING_BIAS_DOC).set({ stats: {}, reports: 0, updatedAt: FieldValue.serverTimestamp() });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error: any) {
    reportServerError("Ortho coaching failed:", error);
    const timeout = error instanceof OrthoAiTimeout;
    return NextResponse.json({ ok: false, error: timeout ? "The model took too long. Please try again." : error?.message || "Coaching failed." }, { status: timeout ? 504 : 500 });
  }
}
