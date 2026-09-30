import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import {
  addLandmarkDeltas,
  analyzeCeph,
  facingSign,
  landmarkDeltas,
  normalizeCalibration,
  normalizeLandmarkBias,
  normalizeLandmarks,
  type CephAnalysis,
} from "@/lib/orthoCeph";
import {
  applyReviewPatch,
  normalizeOrthoReport,
  normalizeReviewPatch,
  ORTHO_AI_KINDS,
  ORTHO_AI_REPORTS_COLLECTION,
  ORTHO_COACHING_BIAS_DOC,
  ORTHO_COACHING_COLLECTION,
  type OrthoAiKind,
  type OrthoReview,
} from "@/lib/orthoAi";
import { gateOrthoAi, loadOrthoCoaching } from "@/lib/server/orthoAiServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The dentist's review of an ortho AI report.
 *
 * POST { clinicId, reportId, verdicts?, edits?, summary?, patientSummary?, landmarks?,
 *        calibration?, chosenOption?, note?, sign? }
 *
 * `ortho_ai_reports` is server-only (see firestore.rules), so this is the one door through which
 * a report changes after the model wrote it — and every change is the dentist's, kept under
 * `review` so the model's text is never overwritten. That separation is what the coaching loop
 * feeds on: it records exactly where the AI was right and where it was wrong.
 *
 * On a ceph, moved landmarks or a new calibration re-run the analysis here (same function the
 * browser used for the live preview) and the result is stored beside the original. When such a
 * ceph is SIGNED, the moves are added to the clinic's landmark tally — once per report — so the
 * next tracing is told where this clinic keeps correcting it.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const reportId = typeof body?.reportId === "string" ? body.reportId.trim() : "";
    if (!clinicId || !reportId) return NextResponse.json({ ok: false, error: "clinicId and reportId are required." }, { status: 400 });

    const gate = await gateOrthoAi(req, clinicId, body?.language === "ar" ? "ar" : "en");
    if (!gate.ok) return gate.response;
    const { authz } = gate;

    const ref = adminClinicDoc(clinicId, ORTHO_AI_REPORTS_COLLECTION, reportId);
    const snap = await ref.get();
    const data = snap.data() as Record<string, any> | undefined;
    if (!snap.exists || !data) return NextResponse.json({ ok: false, error: "Report not found." }, { status: 404 });
    const kind = data.kind as OrthoAiKind;
    if (!ORTHO_AI_KINDS.includes(kind)) return NextResponse.json({ ok: false, error: "Report is unreadable." }, { status: 500 });
    const report = normalizeOrthoReport(kind, data.report);
    if (!report) return NextResponse.json({ ok: false, error: "Report is unreadable." }, { status: 500 });

    const patch = normalizeReviewPatch(body, kind, report, { normalizeLandmarks, normalizeCalibration });
    const wasSigned = data.signed === true;
    const review = applyReviewPatch(data.review as OrthoReview | undefined, patch, { uid: authz.uid, name: authz.name, nowIso: new Date().toISOString() });

    const updates: Record<string, unknown> = {};

    if (kind === "ceph" && (patch.landmarks !== undefined || patch.calibration !== undefined)) {
      const coaching = await loadOrthoCoaching(clinicId);
      const landmarks = review.landmarks || normalizeLandmarks(data.landmarks);
      const calibration = review.calibration !== undefined ? review.calibration : normalizeCalibration(data.calibration);
      const size = data.imageSize as { width: number; height: number } | null | undefined;
      const aspect = size && size.width > 0 && size.height > 0 ? size.width / size.height : 1;
      const analysis: CephAnalysis = analyzeCeph(landmarks, { aspect, calibration, norms: coaching.norms });
      review.analysis = analysis;
    }

    // The tally of where this clinic moves the model's dots. Counted when the ceph is signed
    // with corrected landmarks, and never twice for one report.
    if (kind === "ceph" && review.signed && !wasSigned && review.landmarks && data.biasCounted !== true) {
      const original = normalizeLandmarks(data.landmarks);
      const deltas = landmarkDeltas(original, review.landmarks, facingSign(original));
      if (Object.keys(deltas).length) {
        const biasRef = adminClinicDoc(clinicId, ORTHO_COACHING_COLLECTION, ORTHO_COACHING_BIAS_DOC);
        const biasSnap = await biasRef.get();
        const stats = addLandmarkDeltas(normalizeLandmarkBias(biasSnap.data()?.stats), deltas);
        await biasRef.set({ stats, updatedAt: FieldValue.serverTimestamp(), reports: FieldValue.increment(1) }, { merge: true });
        updates.biasCounted = true;
      }
    }

    await ref.set({ ...updates, review, signed: review.signed, reviewedAt: FieldValue.serverTimestamp(), reviewedBy: authz.uid }, { merge: true });

    if (review.signed && !wasSigned) {
      const patientId = String(data.patientId || "");
      const caseRef = adminClinicDoc(clinicId, "ortho_cases", patientId);
      const caseSnap = await caseRef.get();
      if (caseSnap.exists && caseSnap.data()?.lastAi?.reportId === reportId) {
        await caseRef.set({ lastAi: { ...(caseSnap.data()?.lastAi || {}), signed: true } }, { merge: true }).catch(() => {});
      }
      await adminClinicCollection(clinicId, "system_logs")
        .add({
          userId: authz.uid,
          userName: authz.name,
          userRole: authz.role,
          user: authz.name,
          action: `AI ortho ${kind} report signed`,
          details: `Report ${reportId} for patient ${patientId}: ${Object.values(review.verdicts).filter((v) => v === "confirmed").length} confirmed, ${Object.values(review.verdicts).filter((v) => v === "edited").length} edited, ${Object.values(review.verdicts).filter((v) => v === "rejected").length} rejected`,
          severity: "INFO",
          module: "clinical",
          timestamp: FieldValue.serverTimestamp(),
          date: new Date().toISOString().split("T")[0],
        })
        .catch(() => {});
    }

    return NextResponse.json({ ok: true, review });
  } catch (error: any) {
    reportServerError("Ortho AI review failed:", error);
    return NextResponse.json({ ok: false, error: error?.message || "Review failed." }, { status: 500 });
  }
}
