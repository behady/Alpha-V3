import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { fetchPatientAiContext, patientContextBlock } from "@/lib/aiPatientContext";
import { logAiCreditUsage } from "@/lib/aiCreditLog";
import { imageDimensions } from "@/lib/imageSize";
import {
  analyzeCeph,
  CEPH_LANDMARK_RESPONSE_SCHEMA,
  cephAnalysisToLines,
  landmarkBiasHints,
  normalizeCephLandmarkResult,
  type CephAnalysis,
} from "@/lib/orthoCeph";
import {
  buildCephInterpretationPrompt,
  buildCephLandmarkPrompt,
  buildDiagnosisPrompt,
  buildFollowupPrompt,
  buildPlanPrompt,
  findingsHaveContent,
  normalizeClinicalFindings,
  normalizeOrthoReport,
  ORTHO_AI_CREDITS,
  ORTHO_AI_KINDS,
  ORTHO_AI_LOG_FEATURE,
  ORTHO_AI_REPORTS_COLLECTION,
  ORTHO_DEEP_MULTIPLIER,
  ORTHO_MAX_PHOTOS,
  ORTHO_PHOTO_EXTRA_CREDITS,
  ORTHO_SCHEMAS,
  reportToPromptLines,
  type Lang,
  type OrthoAiKind,
  type OrthoClinicalFindings,
  type OrthoPlanReport,
  type OrthoReport,
  type OrthoReview,
} from "@/lib/orthoAi";
import {
  askGeminiJson,
  cleanIds,
  gateOrthoAi,
  inlineImage,
  loadOrthoCoaching,
  loadPatientMedia,
  mediaSnapshot,
  newMeter,
  OrthoAiTimeout,
  pickModel,
  reserveOrthoCredits,
} from "@/lib/server/orthoAiServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TIMEOUT_MS = 80_000;

/**
 * AI orthodontics: one route, four kinds of report.
 *
 * POST { clinicId, patientId, kind: "ceph"|"diagnosis"|"plan"|"followup", language?, note?,
 *        mode?: "deep", mediaIds?: string[], findings?: OrthoClinicalFindings }
 *
 *   ceph       mediaIds is exactly one lateral cephalogram. Two model calls: landmarks on the
 *              picture, then a reading of the analysis code computed from them.
 *   diagnosis  findings is the clinical examination (also kept on the ortho case by the client);
 *              mediaIds are up to six photographs. Uses the latest ceph report if there is one.
 *   plan       Builds on the latest diagnosis report (signed preferred), or the case's free-text
 *              diagnosis when there is none.
 *   followup   Builds on the case's visit log and the latest plan; mediaIds are today's photos.
 *
 * Gates, credits and storage are the x-ray route's: staff with clinical access, the `aiOrtho`
 * add-on, enough credits; charged only when a usable report came back; saved under
 * `ortho_ai_reports` (server-only writes) with the dentist's review kept separately.
 *
 * Every prompt carries the clinic's lessons — what its orthodontist has taught the model — and a
 * ceph landmarking carries the tally of where the dentist has moved earlier placements.
 */
export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || "";
    if (!apiKey) throw new Error("GEMINI_API_KEY is missing.");

    const body = await req.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const patientId = typeof body?.patientId === "string" ? body.patientId.trim() : "";
    const kind = body?.kind as OrthoAiKind;
    const language: Lang = body?.language === "ar" ? "ar" : "en";
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : "";
    const deep = body?.mode === "deep";
    const mediaIds = cleanIds(body?.mediaIds, kind === "ceph" ? 1 : ORTHO_MAX_PHOTOS);

    if (!clinicId || !patientId) return NextResponse.json({ ok: false, error: "clinicId and patientId are required." }, { status: 400 });
    if (!ORTHO_AI_KINDS.includes(kind)) return NextResponse.json({ ok: false, error: "Unknown report kind." }, { status: 400 });
    if (kind === "ceph" && mediaIds.length !== 1) return NextResponse.json({ ok: false, error: "Pick one lateral cephalogram." }, { status: 400 });

    const gate = await gateOrthoAi(req, clinicId, language);
    if (!gate.ok) return gate.response;
    const { authz } = gate;

    const ctx = await fetchPatientAiContext(clinicId, patientId);
    if (!ctx) return NextResponse.json({ ok: false, error: "Patient not found." }, { status: 404 });
    const patientName = String((ctx.patient as any).name || "");

    // The ortho case: findings, visits, the free-text diagnosis. May not exist yet for a ceph.
    const caseSnap = await adminClinicDoc(clinicId, "ortho_cases", patientId).get();
    const orthoCase = (caseSnap.exists ? caseSnap.data() : {}) as Record<string, any>;
    const findings: OrthoClinicalFindings = normalizeClinicalFindings(body?.findings !== undefined ? body.findings : orthoCase.clinicalFindings);

    // Earlier reports on this patient, newest first. Sorted in code — no composite index.
    const prior = await loadPriorReports(clinicId, patientId);
    const latest = (k: OrthoAiKind) => prior.find((r) => r.kind === k && r.signed) || prior.find((r) => r.kind === k) || null;

    // Inputs each kind cannot do without, checked before anyone is charged.
    if (kind === "diagnosis" && !findingsHaveContent(findings) && mediaIds.length === 0) {
      return NextResponse.json({ ok: false, error: language === "ar" ? "سجّل الفحص السريري أو اختر صوراً أولاً." : "Enter the clinical examination or pick photographs first." }, { status: 400 });
    }
    const diagnosisReport = kind === "plan" ? latest("diagnosis") : null;
    const caseDiagnosisText = String(orthoCase.diagnosis || "").trim();
    if (kind === "plan" && !diagnosisReport && !caseDiagnosisText && !findingsHaveContent(findings)) {
      return NextResponse.json({ ok: false, error: language === "ar" ? "اعمل التشخيص الأول." : "Run the diagnosis first." }, { status: 400 });
    }

    const photoCount = kind === "ceph" ? 0 : mediaIds.length;
    const modelName = pickModel(deep);
    const requiredCredits = (ORTHO_AI_CREDITS[kind] + (photoCount ? ORTHO_PHOTO_EXTRA_CREDITS : 0)) * (deep ? ORTHO_DEEP_MULTIPLIER : 1);
    const reserve = await reserveOrthoCredits(clinicId, requiredCredits);
    if (!reserve.ok) return reserve.response;

    const loaded = mediaIds.length ? await loadPatientMedia(clinicId, patientId, mediaIds) : { ok: true as const, media: [] };
    if (!loaded.ok) return loaded.response;
    const media = loaded.media;

    const coaching = await loadOrthoCoaching(clinicId);
    const meter = newMeter(modelName);
    const context = patientContextBlock(ctx);
    const ask = (systemInstruction: string, parts: Parameters<typeof askGeminiJson>[0]["parts"], schema: unknown, model = modelName) =>
      askGeminiJson({ apiKey, modelName: model, systemInstruction: `${systemInstruction}\n\n${context}`, parts, schema, meter, timeoutMs: TIMEOUT_MS });

    const doc: Record<string, unknown> = {
      kind,
      patientId,
      patientName,
      language,
      mode: deep ? "deep" : "standard",
      note,
      mediaIds: media.map((m) => m.id),
      media: media.map(mediaSnapshot),
      model: modelName,
      credits: requiredCredits,
      lessonsUsed: coaching.lessons.filter((l) => l.active && (l.kind === kind || l.kind === "general")).length,
      review: null,
      signed: false,
      createdBy: authz.uid,
      createdByName: authz.name,
      createdAt: FieldValue.serverTimestamp(),
    };
    let report: OrthoReport | null = null;
    let detail = "";

    if (kind === "ceph") {
      const film = media[0];
      const dims = imageDimensions(film.bytes);
      const aspect = dims ? dims.width / dims.height : 1;
      const hints = landmarkBiasHints(coaching.bias);
      const rawLandmarks = await ask(buildCephLandmarkPrompt({ hints, note }), [inlineImage(film), { text: "Locate the landmarks on this cephalogram and return the JSON." }], CEPH_LANDMARK_RESPONSE_SCHEMA);
      const landmarks = normalizeCephLandmarkResult(rawLandmarks);
      if (!landmarks) {
        return NextResponse.json(
          { ok: false, error: language === "ar" ? "الصورة دي مش أشعة سيفالومترية جانبية، أو النقاط مش واضحة بما يكفي." : "This is not a readable lateral cephalogram — the model could not place enough landmarks." },
          { status: 422 }
        );
      }
      const analysis: CephAnalysis = analyzeCeph(landmarks.landmarks, { aspect, calibration: landmarks.ruler, norms: coaching.norms });
      const rawReport = await ask(
        buildCephInterpretationPrompt({ language, analysis, findings: findingsHaveContent(findings) ? findings : null, quality: landmarks.quality, qualityNotes: landmarks.qualityNotes, lessons: coaching.lessons, landmarkHints: [], note }),
        [{ text: language === "ar" ? "اقرأ التحليل واكتب التقرير بالهيكل المطلوب." : "Read the analysis and write the structured report." }],
        ORTHO_SCHEMAS.ceph,
        "gemini-flash-latest"
      );
      report = normalizeOrthoReport("ceph", rawReport);
      Object.assign(doc, {
        imageSize: dims,
        aspectKnown: !!dims,
        landmarks: landmarks.landmarks,
        landmarkConfidence: landmarks.confidence,
        facing: landmarks.facing,
        quality: landmarks.quality,
        qualityNotes: landmarks.qualityNotes,
        calibration: landmarks.ruler,
        calibrationSource: landmarks.ruler ? "ruler" : "none",
        analysis,
        normsUsed: coaching.norms,
        biasHintsUsed: hints.length,
      });
      detail = [`${Object.keys(landmarks.landmarks).length} landmarks`, analysis.calibrated ? "calibrated" : "uncalibrated", deep ? "deep" : ""].filter(Boolean).join(" · ");
    } else if (kind === "diagnosis") {
      const ceph = latest("ceph");
      const cephLines = ceph ? cephLinesOf(ceph) : [];
      const priorLines = prior
        .filter((r) => r.kind === "diagnosis")
        .slice(0, 2)
        .map((r) => `${r.createdAt} diagnosis${r.signed ? " (signed)" : ""}: ${String(r.report.summary).slice(0, 300)}`);
      const rawReport = await ask(
        buildDiagnosisPrompt({ language, findings, cephLines, photoCount, photoCategories: media.map((m) => m.category), priorReports: priorLines, lessons: coaching.lessons, note, deep }),
        [...media.map(inlineImage), { text: language === "ar" ? "اكتب التشخيص التقويمي بالهيكل المطلوب." : "Write the structured orthodontic diagnosis." }],
        ORTHO_SCHEMAS.diagnosis
      );
      report = normalizeOrthoReport("diagnosis", rawReport);
      Object.assign(doc, { findings, cephReportId: ceph?.id || null });
      detail = [`${photoCount} photo${photoCount === 1 ? "" : "s"}`, ceph ? "with ceph" : "", deep ? "deep" : ""].filter(Boolean).join(" · ");
    } else if (kind === "plan") {
      const ceph = latest("ceph");
      const diagnosisLines = diagnosisReport
        ? reportToPromptLines("diagnosis", diagnosisReport.report, diagnosisReport.review)
        : [caseDiagnosisText && `Dentist's written diagnosis: ${caseDiagnosisText.slice(0, 1500)}`].filter(Boolean);
      const age = Number.parseInt(String(ctx.age || ""), 10);
      const rawReport = await ask(
        buildPlanPrompt({ language, findings: findingsHaveContent(findings) ? findings : null, diagnosisLines, cephLines: ceph ? cephLinesOf(ceph) : [], age: Number.isFinite(age) ? age : null, lessons: coaching.lessons, note, deep }),
        [{ text: language === "ar" ? "اكتب خطة العلاج بالهيكل المطلوب." : "Write the structured treatment plan." }],
        ORTHO_SCHEMAS.plan
      );
      report = normalizeOrthoReport("plan", rawReport);
      Object.assign(doc, { diagnosisReportId: diagnosisReport?.id || null, cephReportId: ceph?.id || null });
      detail = [diagnosisReport ? "from AI diagnosis" : "from written diagnosis", deep ? "deep" : ""].filter(Boolean).join(" · ");
    } else {
      const plan = latest("plan");
      const planLines = plan ? planLinesOf(plan) : [caseDiagnosisText && `Dentist's written plan: ${caseDiagnosisText.slice(0, 1500)}`].filter(Boolean);
      const visits: { visitNo?: number; date?: string; workDone?: string; nextStep?: string }[] = Array.isArray(orthoCase.visits) ? orthoCase.visits : [];
      const visitLines = visits
        .slice()
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
        .slice(-30)
        .map((v) => `${v.date || "?"} (visit ${v.visitNo ?? "?"}): ${String(v.workDone || "").slice(0, 300)}${v.nextStep ? ` — next: ${String(v.nextStep).slice(0, 200)}` : ""}`);
      const start = orthoCase.startDate ? new Date(String(orthoCase.startDate)).getTime() : NaN;
      const monthsIn = Number.isFinite(start) ? Math.max(0, Math.round((Date.now() - start) / (30.4 * 86400000))) : null;
      const rawReport = await ask(
        buildFollowupPrompt({ language, planLines, visitLines, monthsIn, status: String(orthoCase.status || "Active"), photoCount, lessons: coaching.lessons, note }),
        [...media.map(inlineImage), { text: language === "ar" ? "اكتب تقييم المتابعة بالهيكل المطلوب." : "Write the structured follow-up review." }],
        ORTHO_SCHEMAS.followup
      );
      report = normalizeOrthoReport("followup", rawReport);
      Object.assign(doc, { planReportId: plan?.id || null, visitCount: visits.length, monthsIn });
      detail = [`${visits.length} visits`, monthsIn !== null ? `${monthsIn} months in` : "", `${photoCount} photo${photoCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
    }

    if (!report) return NextResponse.json({ ok: false, error: "The AI returned an unreadable report. Please try again." }, { status: 502 });
    doc.report = report;

    const docRef = adminClinicCollection(clinicId, ORTHO_AI_REPORTS_COLLECTION).doc();
    await docRef.set(doc);
    // The case carries a pointer so the list page can show "AI diagnosis awaiting review" without
    // reading every report. Merge: the case may not exist yet (a ceph before the case is opened).
    await adminClinicDoc(clinicId, "ortho_cases", patientId)
      .set({ patientId, lastAi: { kind, reportId: docRef.id, at: new Date().toISOString(), signed: false } }, { merge: true })
      .catch(() => {});

    await reserve.charge();
    await logAiCreditUsage({
      clinicId,
      feature: ORTHO_AI_LOG_FEATURE[kind],
      credits: requiredCredits,
      userId: authz.uid,
      userName: authz.name,
      patientId,
      patientName,
      detail,
      usage: meter.snapshot(),
    });

    const { createdAt: _c, ...saved } = doc;
    return NextResponse.json({ ok: true, reportId: docRef.id, report: { id: docRef.id, ...saved, createdAt: new Date().toISOString() }, credits: requiredCredits });
  } catch (error: any) {
    reportServerError("Ortho AI failed:", error);
    const timeout = error instanceof OrthoAiTimeout || error?.message === "ortho_timeout";
    return NextResponse.json(
      { ok: false, error: timeout ? "The analysis took too long. Try again, or with fewer pictures." : error?.message || "Orthodontic analysis failed." },
      { status: timeout ? 504 : 500 }
    );
  }
}

interface PriorReport {
  id: string;
  kind: OrthoAiKind;
  signed: boolean;
  createdAt: string;
  report: OrthoReport;
  review: OrthoReview | null;
  analysis?: CephAnalysis;
}

async function loadPriorReports(clinicId: string, patientId: string): Promise<PriorReport[]> {
  try {
    const snap = await adminClinicCollection(clinicId, ORTHO_AI_REPORTS_COLLECTION).where("patientId", "==", patientId).get();
    const rows: (PriorReport & { sortKey: string })[] = [];
    for (const d of snap.docs) {
      const r = d.data() as Record<string, any>;
      const report = ORTHO_AI_KINDS.includes(r.kind) ? normalizeOrthoReport(r.kind as OrthoAiKind, r.report) : null;
      if (!report) continue;
      const createdAt: string = r.createdAt?.toDate?.()?.toISOString?.() || "";
      rows.push({
        id: d.id,
        kind: r.kind as OrthoAiKind,
        signed: r.signed === true,
        createdAt: createdAt.slice(0, 10),
        report,
        review: (r.review as OrthoReview | null) || null,
        analysis: r.analysis as CephAnalysis | undefined,
        sortKey: createdAt,
      });
    }
    rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    return rows;
  } catch {
    return [];
  }
}

/** The measurements as the dentist left them: the recomputed analysis after corrections, else the original. */
function cephLinesOf(r: PriorReport): string[] {
  const analysis = r.review?.analysis || r.analysis;
  if (!analysis || !Array.isArray(analysis.measurements)) return [];
  const lines = cephAnalysisToLines(analysis);
  return [`(ceph dated ${r.createdAt}${r.signed ? ", dentist-confirmed" : ", NOT yet confirmed by the dentist"})`, ...lines];
}

/** The plan as the dentist left it: the chosen option in full, the rest by title only. */
function planLinesOf(r: PriorReport): string[] {
  const plan = r.report as OrthoPlanReport;
  const chosenIdx = r.review?.chosenOption ?? plan.options.findIndex((o) => o.recommended);
  const chosen = plan.options[chosenIdx >= 0 ? chosenIdx : 0];
  const lines: string[] = [`Plan dated ${r.createdAt}${r.signed ? " (signed)" : " (unsigned)"}: ${plan.summary.slice(0, 400)}`];
  if (chosen) {
    lines.push(`Chosen option: ${chosen.title} — ${chosen.approach}, ${chosen.appliance}, ${chosen.durationMonths} months${chosen.extractions.length ? `, extractions ${chosen.extractions.join(", ")}` : ""}`);
    chosen.phases.forEach((p) => lines.push(`Phase ${p.name} (${p.months} mo): ${p.goal}${p.steps.length ? ` — ${p.steps.join("; ")}` : ""}`));
    if (chosen.retention) lines.push(`Retention: ${chosen.retention}`);
  }
  if (r.review?.note) lines.push(`Dentist's note on the plan: ${r.review.note}`);
  return lines;
}
