"use client";

import { auth } from "@/lib/firebase";
import type { CephAnalysis, CephCalibration, CephConfidence, CephLandmarkId, CephLandmarks } from "@/lib/orthoCeph";
import type { Lang, OrthoAiKind, OrthoClinicalFindings, OrthoReport, OrthoReview } from "@/lib/orthoAi";

/** A report as it sits in `ortho_ai_reports`, plus its id. */
export interface SavedOrthoReport {
  id: string;
  kind: OrthoAiKind;
  patientId: string;
  patientName?: string;
  language?: Lang;
  mode?: "deep" | "standard";
  note?: string;
  media?: { id: string; url: string; category?: string; filename?: string; takenAt?: string }[];
  report: OrthoReport;
  review?: OrthoReview | null;
  signed?: boolean;
  credits?: number;
  createdAt?: { toDate?: () => Date } | string | null;
  createdByName?: string;
  lessonsUsed?: number;
  // ceph
  imageSize?: { width: number; height: number } | null;
  landmarks?: CephLandmarks;
  landmarkConfidence?: Partial<Record<CephLandmarkId, CephConfidence>>;
  facing?: "right" | "left";
  quality?: "good" | "acceptable" | "poor";
  qualityNotes?: string;
  calibration?: CephCalibration | null;
  calibrationSource?: "ruler" | "none";
  analysis?: CephAnalysis;
  // diagnosis
  findings?: OrthoClinicalFindings;
  cephReportId?: string | null;
  // plan / followup
  diagnosisReportId?: string | null;
  planReportId?: string | null;
  monthsIn?: number | null;
}

export const errMessage = (e: unknown, lang: Lang) =>
  e instanceof Error && e.message ? e.message : lang === "ar" ? "حصل خطأ. جرّب تاني." : "Something went wrong. Please try again.";

/** One door to the three routes. Throws with the server's message, which the toast shows as-is. */
export async function callOrthoApi<T = Record<string, unknown>>(path: "analyze" | "review" | "coach", body: Record<string, unknown>, lang: Lang): Promise<T> {
  const u = auth.currentUser;
  if (!u) throw new Error(lang === "ar" ? "سجّل الدخول الأول." : "Please sign in first.");
  const token = await u.getIdToken();
  const res = await fetch(`/api/ai/ortho/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...body, language: lang }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.ok) {
    throw new Error(String(data?.error || (lang === "ar" ? "فشل الطلب" : "The request failed")));
  }
  return data as T;
}

export function reportDate(r: SavedOrthoReport): Date | null {
  const c = r.createdAt;
  if (!c) return null;
  if (typeof c === "string") {
    const d = new Date(c);
    return isNaN(d.getTime()) ? null : d;
  }
  return c.toDate?.() ?? null;
}
