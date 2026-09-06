import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { clinicNow } from "@/lib/publicBooking";
import { clinicDisplayName } from "@/lib/sms/events";
import { isWhatsAppBlocked } from "@/lib/patientMessaging";
import { phoneMatchKey } from "@/lib/patientPhone";
import { conversationKey } from "@/lib/bot/conversation";
import { deliverWhatsAppMessage } from "@/lib/whatsappDelivery";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The one follow-up to a lead the bot could not close.
 *
 * Somebody asked about a price yesterday, got the answer, and went quiet. Every sales desk knows
 * the next day's "still interested?" recovers a share of those — and that nobody at the clinic
 * has time to send it by hand. This sends exactly one, the day after, to leads that are still
 * open, still not booked, and not opted out. Business-initiated, so it goes as the approved
 * template with a "book me" button; the tap lands in the bot's booking flow.
 *
 * It used to ask only for leads the bot itself created (`botLead`), which quietly excluded the
 * ones the clinic pays for: a lead from a Meta ad form is written by the ads webhook, not by a
 * conversation, so it never carried that flag. Those were supposed to be covered by the welcome
 * message instead — and the welcome had been failing since the gateway changed, so sixty-six
 * people who filled in a form asking a dental clinic to contact them heard nothing from either
 * path. The age window is what keeps this honest: 18 to 72 hours, so widening it reaches the
 * leads arriving now and never wakes up a form somebody filled in last month.
 */

const HOUR_MS = 60 * 60 * 1000;
const MIN_AGE_MS = 18 * HOUR_MS;
const MAX_AGE_MS = 72 * HOUR_MS;
const MAX_PER_RUN = 40;
/** Where a lead the clinic paid for comes from: the ads webhook writes "Meta ads". */
const PAID_SOURCE = /meta|facebook|instagram|ads?/i;

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

interface FollowupResult {
  leadId: string;
  status: "sent" | "queued" | "skipped" | "failed";
  reason?: string;
}

async function hasUpcomingAppointment(clinicId: string, phone: string): Promise<boolean> {
  const today = clinicNow().dateKey;
  const snap = await adminClinicCollection(clinicId, "appointments").where("patientPhone", "==", phone).limit(20).get();
  return snap.docs.some((d) => {
    const a = d.data() || {};
    const status = normalizeAppointmentStatus(String(a.status || ""));
    return String(a.date || "") >= today && status !== "Cancelled" && status !== "No Show";
  });
}

async function runForClinic(clinicId: string): Promise<{ results: FollowupResult[] }> {
  const settingsSnap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
  const settings = (settingsSnap.data() || {}) as Record<string, unknown>;
  if (settings.isLeadFollowupEnabled !== true) return { results: [] };

  const clinicName = await clinicDisplayName(clinicId);
  /*
   * Every open lead, then filtered here rather than in the query.
   *
   * "botLead == true AND stage == new" needs a composite index and, worse, encodes the assumption
   * that only the bot makes leads worth chasing. A single-field query and a predicate covers both
   * origins with no index and no second code path.
   */
  const leads = await adminClinicCollection(clinicId, "leads").where("stage", "==", "new").limit(500).get();
  const results: FollowupResult[] = [];
  let sent = 0;
  for (const d of leads.docs) {
    if (sent >= MAX_PER_RUN) break;
    const lead = d.data() || {};
    if (lead.followUpSentAt) continue;
    // From the bot, or from an ad the clinic paid for. Anything else is a lead somebody typed in
    // by hand, and chasing those without being asked is the clinic's call, not this job's.
    if (lead.botLead !== true && !PAID_SOURCE.test(String(lead.source || ""))) continue;
    const createdMs = lead.createdAt?.toMillis?.() ?? 0;
    const age = Date.now() - createdMs;
    if (!createdMs || age < MIN_AGE_MS || age > MAX_AGE_MS) continue;
    const phone = String(lead.phone || "");
    if (!phone) { results.push({ leadId: d.id, status: "skipped", reason: "no_phone" }); continue; }

    // Opted out on their patient record, if they have one; and never chase someone already booked.
    /*
     * An exact-string phone match is not an opt-out check in this database: numbers are stored
     * as "+2010…", "0010…", "0100…" and with Arabic digits, so the one patient who said STOP was
     * looked up under a spelling nobody had and messaged anyway. Matched on the last nine digits,
     * the same rule patientPhone uses everywhere else.
     */
    const wantKey = phoneMatchKey(phone);
    const patients = await adminClinicCollection(clinicId, "patients").limit(3000).get();
    const patient = patients.docs
      .map((p) => p.data() as Record<string, unknown>)
      .find((p) => phoneMatchKey(String(p.phone || "")) === wantKey && wantKey.length >= 7);
    if (patient && isWhatsAppBlocked(patient)) { results.push({ leadId: d.id, status: "skipped", reason: "opted_out" }); continue; }
    // A number that opted out from a thread the clinic has no patient record for still counts.
    const convOptOut = await adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(phone)).get().catch(() => null);
    if (convOptOut?.data()?.optedOut === true) { results.push({ leadId: d.id, status: "skipped", reason: "opted_out" }); continue; }
    if (await hasUpcomingAppointment(clinicId, phone)) {
      await d.ref.set({ stage: "booked", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      results.push({ leadId: d.id, status: "skipped", reason: "already_booked" });
      continue;
    }

    const interest = String(lead.interest || "").trim() || "خدماتنا";
    const text = `أهلاً 👋 حضرتك سألت ${clinicName} عن ${interest} ولسه محجزتش. لو حابب نحجزلك كشف أو عندك أي سؤال، ابعتلنا رسالة وهنرد عليك فوراً 🦷`;
    try {
      const delivery = await deliverWhatsAppMessage({
        clinicId,
        to: phone,
        text,
        audience: "patient",
        queue: { key: `lead_followup_${d.id}`, type: "lead_welcome", patientId: String(lead.patientId || lead.existingPatientId || ""), patientName: String(lead.name || ""), appointmentId: "" },
        metaTemplate: { kind: "lead_followup", params: [clinicName, interest] },
      });
      await d.ref.set({ followUpSentAt: FieldValue.serverTimestamp(), stage: "contacted", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      results.push({ leadId: d.id, status: delivery.mode === "auto" ? "sent" : "queued" });
      sent += 1;
    } catch (e) {
      results.push({ leadId: d.id, status: "failed", reason: e instanceof Error ? e.message : "send_failed" });
    }
  }
  return { results };
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
    const results = clinics.flatMap((c) => c.result?.results ?? []);
    return NextResponse.json({
      ok: true,
      sent: results.filter((r) => r.status === "sent").length,
      queued: results.filter((r) => r.status === "queued").length,
      clinics: clinics.map((c) => ({ clinicId: c.clinicId, ok: c.ok, sent: (c.result?.results ?? []).filter((r) => r.status === "sent").length })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
