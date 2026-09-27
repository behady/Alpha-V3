import { NextResponse } from "next/server";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicDoc } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { clinicDisplayName } from "@/lib/sms/events";
import { getOrWriteOwnerSummary } from "@/lib/ownerSummary";
import { digestMessage } from "@/lib/ownerSummaryText";
import { sendOwnerWhatsAppAlertIfEnabled } from "@/lib/whatsappOwnerAlerts";
import { WHATSAPP_SETTINGS_DOC_REF } from "@/types/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The evening digest: the day's three-line summary, to the owner's WhatsApp.
 *
 * Runs once an evening (vercel.json) for every clinic whose owner switched it on under
 * Settings → WhatsApp → Owner alerts. Same text the owner's home shows the next morning, from
 * the same stored summary, so the day is paid for once. A clinic without a number, without the
 * switch, or without a connected gateway is skipped, not failed — the cron must never trip over
 * one clinic's setup.
 */
function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function runForClinic(clinicId: string): Promise<{ status: "sent" | "skipped"; reason?: string }> {
  const settings = ((await adminClinicDoc(clinicId, WHATSAPP_SETTINGS_DOC_REF.collection, WHATSAPP_SETTINGS_DOC_REF.docId).get()).data() || {}) as Record<string, unknown>;
  const alerts = (settings.ownerAlerts || {}) as Record<string, boolean>;
  if (!alerts.daily_digest) return { status: "skipped", reason: "off" };

  const dateKey = ymdInTimeZone(clinicTimeZone());
  const summary = await getOrWriteOwnerSummary(clinicId, dateKey);
  // The clinic's own language for the message: Arabic unless the clinic says otherwise.
  const language: "en" | "ar" = String(settings.language || settings.ownerLanguage || "ar") === "en" ? "en" : "ar";
  const text = digestMessage(summary.facts, language === "ar" ? summary.ar : summary.en, await clinicDisplayName(clinicId), language);

  const sent = await sendOwnerWhatsAppAlertIfEnabled(clinicId, "daily_digest", text);
  return sent.sent ? { status: "sent" } : { status: "skipped", reason: sent.reason };
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    const staff = await requireStaffUser(request);
    if (!staff.ok) return staff.response;
    if (staff.role !== "Owner" && staff.role !== "Admin" && staff.role !== "Clinic Admin") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }
  const results = await forEachActiveClinic(runForClinic);
  return NextResponse.json({ ok: true, results });
}
