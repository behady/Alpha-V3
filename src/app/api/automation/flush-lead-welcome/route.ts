import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { clinicDisplayName } from "@/lib/sms/events";
import { loadMetaWhatsappConfig, sendMetaTemplate } from "@/lib/metaWhatsapp";
import { isWhatsAppBlocked } from "@/lib/patientMessaging";
import { phoneMatchKey } from "@/lib/patientPhone";
import { conversationKey } from "@/lib/bot/conversation";
import { recordThreadMessage } from "@/lib/bot/thread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The leads nobody ever answered, sent the moment it becomes legal to send them.
 *
 * Every lead from a Meta ad got a welcome message that failed and was queued for a human to send
 * by hand — the lead-welcome function still spoke to the gateway this clinic had left. Nobody
 * empties a queue they were never told about, so thirty-eight real people who asked a dental
 * clinic to contact them heard nothing at all.
 *
 * They cannot simply be sent: a lead from an ad form has never written to us, so WhatsApp's
 * 24-hour service window is shut and only a pre-approved template delivers — free text is
 * accepted by the API and then dropped, which looks exactly like success. So this waits for
 * `alpha_lead_welcome_ar` to be approved and checks that on every run.
 *
 * The backlog is NOT sent. A greeting that arrives a week after somebody filled in a form reads
 * as a clinic that does not know what day it is, and the clinic's own instruction was to start
 * with the new leads. Everything queued before this job first ran is marked as skipped, with the
 * moment of that decision stored, so a lead that arrives from now on is greeted within the hour
 * and nobody is greeted about a form they have forgotten filling in.
 */

const TEMPLATE = "alpha_lead_welcome_ar";
const DAY_MS = 24 * 60 * 60 * 1000;
/** Older than this and a "thanks for getting in touch" is stranger than silence. */
const MAX_AGE_MS = 14 * DAY_MS;
/** The number is on TIER_250 until the business is verified; leave room for the day's reminders. */
const MAX_PER_RUN = 60;

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
}

async function authorize(request: Request) {
  if (isCronAuthorized(request)) return { ok: true as const, cron: true as const };
  const staff = await requireStaffUser(request);
  if (!staff.ok) return staff;
  return { ok: true as const, cron: false as const, uid: staff.uid };
}

/** Is the template Meta must approve actually approved yet? One Graph call per clinic per run. */
async function templateApproved(token: string, wabaId: string): Promise<boolean> {
  if (!wabaId) return false;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${wabaId}/message_templates?fields=name,status&limit=100&access_token=${encodeURIComponent(token)}`
    );
    const json = (await res.json().catch(() => ({}))) as { data?: Array<{ name?: string; status?: string }> };
    return (json.data || []).some((t) => t.name === TEMPLATE && t.status === "APPROVED");
  } catch {
    return false;
  }
}

function ageMs(raw: unknown): number {
  const ms =
    typeof raw === "string"
      ? Date.parse(raw)
      : raw && typeof (raw as { toMillis?: () => number }).toMillis === "function"
        ? (raw as { toMillis: () => number }).toMillis()
        : NaN;
  return Number.isFinite(ms) ? Date.now() - ms : Number.POSITIVE_INFINITY;
}

interface FlushResult {
  sent: number;
  expired: number;
  skipped: number;
  waiting: number;
  reason?: string;
}

async function runForClinic(clinicId: string): Promise<FlushResult> {
  const out: FlushResult = { sent: 0, expired: 0, skipped: 0, waiting: 0 };
  const queued = await adminClinicCollection(clinicId, "whatsapp_outbox").where("status", "==", "queued").limit(500).get();
  const rows = queued.docs.filter((d) => String((d.data() || {}).type || "") === "lead_welcome");
  if (!rows.length) return out;

  /*
   * Where "new" starts.
   *
   * The first time this runs for a clinic it draws the line at that moment and retires everything
   * already waiting: those leads were never greeted because of a broken gateway, and a welcome
   * that arrives days late does more harm than the silence did. From then on the line stays put,
   * so a lead queued a minute ago is sent and one queued before the fix never is.
   */
  const markerRef = adminClinicDoc(clinicId, "settings", "bot_alerts");
  const marker = (await markerRef.get()).data() || {};
  let startFrom = Number(marker.leadFlushFromMs) || 0;
  if (!startFrom) {
    startFrom = Date.now();
    await markerRef.set({ leadFlushFromMs: startFrom }, { merge: true });
  }
  for (const doc of rows) {
    const created = Date.now() - ageMs((doc.data() || {}).createdAt);
    if (Number.isFinite(created) && created < startFrom) {
      await doc.ref.set(
        { status: "expired", expiredAt: FieldValue.serverTimestamp(), expiredReason: "backlog_before_automation" },
        { merge: true }
      );
      out.expired += 1;
    }
  }
  const fresh = rows.filter((d) => {
    const created = Date.now() - ageMs((d.data() || {}).createdAt);
    return Number.isFinite(created) && created >= startFrom;
  });
  if (!fresh.length) return out;

  const config = await loadMetaWhatsappConfig(clinicId);
  if (!config?.token) {
    out.waiting = fresh.length;
    out.reason = "no_meta_config";
    return out;
  }
  if (!(await templateApproved(config.token, config.wabaId || ""))) {
    out.waiting = fresh.length;
    out.reason = "template_pending";
    return out;
  }

  const clinicName = await clinicDisplayName(clinicId);
  // One read of the patient list, used to honour an opt-out however the number is spelled.
  const patients = await adminClinicCollection(clinicId, "patients").limit(3000).get();
  const blocked = new Set(
    patients.docs
      .map((p) => p.data() as Record<string, unknown>)
      .filter((p) => isWhatsAppBlocked(p))
      .map((p) => phoneMatchKey(String(p.phone || "")))
      .filter((k) => k.length >= 7)
  );

  for (const doc of fresh) {
    if (out.sent >= MAX_PER_RUN) break;
    const d = doc.data() || {};
    const to = String(d.to || "").trim();
    if (!to) {
      out.skipped += 1;
      continue;
    }
    if (ageMs(d.createdAt) > MAX_AGE_MS) {
      await doc.ref.set({ status: "expired", expiredAt: FieldValue.serverTimestamp(), expiredReason: "too_old_to_welcome" }, { merge: true });
      out.expired += 1;
      continue;
    }
    if (blocked.has(phoneMatchKey(to))) {
      await doc.ref.set({ status: "expired", expiredAt: FieldValue.serverTimestamp(), expiredReason: "opted_out" }, { merge: true });
      out.skipped += 1;
      continue;
    }
    const conv = await adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(to)).get().catch(() => null);
    if (conv?.data()?.optedOut === true) {
      await doc.ref.set({ status: "expired", expiredAt: FieldValue.serverTimestamp(), expiredReason: "opted_out" }, { merge: true });
      out.skipped += 1;
      continue;
    }

    const name = String(d.patientName || "").trim() || "عميلنا العزيز";
    const result = await sendMetaTemplate({ config, to, templateName: TEMPLATE, params: [name, clinicName] });
    if (!result.ok) {
      await doc.ref.set({ lastError: String(result.error || "send_failed").slice(0, 300), lastTriedAt: FieldValue.serverTimestamp() }, { merge: true });
      out.skipped += 1;
      continue;
    }
    await doc.ref.set({ status: "sent", sentAt: FieldValue.serverTimestamp(), channel: "meta", template: TEMPLATE }, { merge: true });
    // Into the thread staff read, so the chat does not start mid-conversation.
    await recordThreadMessage(clinicId, to, {
      direction: "out",
      author: "bot",
      text: String(d.text || "").slice(0, 1000),
      kind: "lead_welcome",
      channel: "meta",
      waMessageId: result.messageId,
    }).catch(() => {});
    out.sent += 1;
  }
  return out;
}

export async function GET(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;
  try {
    if (!authz.cron) {
      const clinicId = await resolveUserClinicId(authz.uid as string);
      return NextResponse.json({ ok: true, clinicId, ...(await runForClinic(clinicId)) });
    }
    const clinics = await forEachActiveClinic((clinicId) => runForClinic(clinicId));
    const all = clinics.map((c) => c.result).filter(Boolean) as FlushResult[];
    return NextResponse.json({
      ok: true,
      sent: all.reduce((n, r) => n + r.sent, 0),
      expired: all.reduce((n, r) => n + r.expired, 0),
      waiting: all.reduce((n, r) => n + r.waiting, 0),
      clinics: clinics.map((c) => ({ clinicId: c.clinicId, ok: c.ok, ...(c.result || {}) })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
