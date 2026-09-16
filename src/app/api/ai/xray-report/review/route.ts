import { reportServerError } from "@/lib/server/reportError";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { isFullAccessRole } from "@/lib/permissions";
import { normalizeToothData, type ToothData } from "@/lib/diagnosisCatalog";
import {
  applyReviewPatch,
  effectiveFinding,
  normalizeReviewPatch,
  normalizeXrayReport,
  XRAY_REPORTS_COLLECTION,
  type XrayReview,
} from "@/lib/xrayReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The dentist's review of an AI x-ray report.
 *
 * POST { clinicId, reportId, verdicts?, edits?, boxes?, patientSummary?, sign?, chart? }
 *
 * `xray_reports` is server-only on purpose (see firestore.rules), so this is the one door through
 * which a report changes after the model wrote it — and every change is the dentist's, kept
 * separately under `review` so the model's original text is never overwritten. That separation is
 * what makes the review worth anything: it records where the AI was right and where it was wrong.
 *
 * `chart` pushes confirmed rows onto the odontogram: the catalogue id is added to
 * `patients/{id}.teethData[tooth].statuses`, and a dated note names the report it came from. The
 * same clinical gate as the reading itself; the chart write is Admin SDK so it needs no rule.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const clinicId = typeof body?.clinicId === "string" ? body.clinicId.trim() : "";
    const reportId = typeof body?.reportId === "string" ? body.reportId.trim() : "";
    if (!clinicId || !reportId) {
      return NextResponse.json({ ok: false, error: "clinicId and reportId are required." }, { status: 400 });
    }

    const authz = await requireStaffUser(req, clinicId);
    if (!authz.ok) return authz.response;
    const clinical = isFullAccessRole(authz.role) || authz.role === "Dentist" || authz.permissions.includes("access.clinical");
    if (!clinical) {
      return NextResponse.json({ ok: false, error: "Reviewing x-ray reports needs clinical access." }, { status: 403 });
    }

    const ref = adminClinicDoc(clinicId, XRAY_REPORTS_COLLECTION, reportId);
    const snap = await ref.get();
    const data = snap.data() as Record<string, unknown> | undefined;
    if (!snap.exists || !data) return NextResponse.json({ ok: false, error: "Report not found." }, { status: 404 });
    const report = normalizeXrayReport(data.report);
    if (!report) return NextResponse.json({ ok: false, error: "Report is unreadable." }, { status: 500 });

    const patch = normalizeReviewPatch(body, report);
    const review = applyReviewPatch(data.review as XrayReview | undefined, patch, {
      uid: authz.uid,
      name: authz.name,
      nowIso: new Date().toISOString(),
    });

    // Chart push: one write per tooth, merged into whatever the odontogram already holds.
    let charted = 0;
    if (patch.chart && Object.keys(patch.chart).length) {
      const patientId = String(data.patientId || "");
      const patientRef = adminClinicDoc(clinicId, "patients", patientId);
      const patientSnap = await patientRef.get();
      if (!patientSnap.exists) return NextResponse.json({ ok: false, error: "Patient not found." }, { status: 404 });
      const teethData = { ...((patientSnap.data()?.teethData as Record<string, unknown>) || {}) };
      const when = new Date().toISOString().slice(0, 10);
      const updates: Record<string, unknown> = {};
      for (const [k, statusId] of Object.entries(patch.chart)) {
        const row = effectiveFinding(report, review, Number(k));
        if (!/^\d{2}$/.test(row.tooth)) continue; // a region label cannot be charted
        if (row.verdict === "rejected") continue;
        const current: ToothData = normalizeToothData(teethData[row.tooth]);
        const statuses = Array.from(new Set([...(current.statuses || []).filter((s) => s !== "healthy"), statusId]));
        const line = `[${when} AI x-ray] ${row.finding}`;
        const notes = current.notes && current.notes.includes(line) ? current.notes : [current.notes || "", line].filter(Boolean).join("\n");
        const next: ToothData = { ...current, statuses, notes, notesBy: authz.name, notesAt: new Date().toISOString() };
        // Firestore rejects undefined; ToothData's optional fields must be absent, not undefined.
        const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
        updates[`teethData.${row.tooth}`] = clean;
        charted += 1;
      }
      if (charted > 0) {
        await patientRef.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
        await adminClinicCollection(clinicId, "system_logs")
          // Same shape logActivity() writes from the browser, so the Activity Log screen reads it.
          .add({
            userId: authz.uid,
            userName: authz.name,
            userRole: authz.role,
            user: authz.name,
            action: "Odontogram updated from AI x-ray report",
            details: `${charted} finding(s) charted from report ${reportId} for patient ${patientId}`,
            severity: "INFO",
            module: "clinical",
            timestamp: FieldValue.serverTimestamp(),
            date: new Date().toISOString().split("T")[0],
          })
          .catch(() => {});
      }
    }

    await ref.set(
      {
        review,
        signed: review.signed,
        reviewedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, review, charted });
  } catch (error: any) {
    reportServerError("X-ray report review failed:", error);
    return NextResponse.json({ ok: false, error: error?.message || "Review failed." }, { status: 500 });
  }
}
