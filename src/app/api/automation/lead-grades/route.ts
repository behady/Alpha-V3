import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { gradeLead, isOpenStage, loadLeadGradingSettings } from "@/lib/leads/gradeLeadServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nightly: every open lead is re-scored by the rules, so a grade cools on silence.
 *
 * The model is not consulted here — the inbound hook already reads every conversation the
 * moment it moves, and re-reading three hundred unchanged threads at 3am would be paying for
 * nothing. The one exception is a lead whose thread moved and was never graded (a webhook
 * that timed out); those get the model, up to a small cap per clinic per night.
 */

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LEADS = 400;
const MODEL_CAP = 20;

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function runForClinic(clinicId: string): Promise<{ leads: number; graded: number; model: number; skipped?: string }> {
  const settings = await loadLeadGradingSettings(clinicId);
  if (!settings.enabled) return { leads: 0, graded: 0, model: 0, skipped: "off" };
  const since = Timestamp.fromMillis(Date.now() - LOOKBACK_MS);
  const snap = await adminClinicCollection(clinicId, "leads").where("updatedAt", ">=", since).limit(MAX_LEADS).get();
  let graded = 0;
  let model = 0;
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (!isOpenStage(d.stage)) continue;
    const neverModelled = !d.aiGradeModelAtMs;
    const allowModel = neverModelled && model < MODEL_CAP;
    const r = await gradeLead(clinicId, doc, { trigger: "nightly", allowModel, settings }).catch(() => null);
    if (!r) continue;
    graded += 1;
    if (r.by === "model" && !r.modelSkipped) model += 1;
  }
  return { leads: snap.size, graded, model };
}

export async function GET(request: Request) {
  try {
    if (isCronAuthorized(request)) {
      const clinics = await forEachActiveClinic((clinicId) => runForClinic(clinicId));
      return NextResponse.json({ ok: true, clinics: clinics.map((c) => ({ clinicId: c.clinicId, ok: c.ok, ...(c.result || {}), error: c.error })) });
    }
    const staff = await requireStaffUser(request);
    if (!staff.ok) return staff.response;
    const url = new URL(request.url);
    const clinicId = await resolveUserClinicId(staff.uid, url.searchParams.get("clinicId") || "");
    if (!clinicId) return NextResponse.json({ ok: false, error: "No clinic for this user" }, { status: 400 });
    return NextResponse.json({ ok: true, clinicId, ...(await runForClinic(clinicId)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
