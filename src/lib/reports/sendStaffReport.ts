import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { buildBriefing } from "@/lib/automation/briefing/build";
import type { Briefing, BriefingAccess } from "@/lib/automation/briefing/types";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import {
  notifyTiming,
  reportEvents,
  reportPrefs,
  resolveNotify,
  type NotifyEvent,
} from "@/lib/notificationCatalog";
import {
  clinicHourNow,
  deliverClinicNotification,
  readAlertPreferences,
  type DeliverResult,
} from "@/lib/notificationDelivery";
import { renderStaffReport, reportPushLine } from "@/lib/reports/staffReportText";
import { getOrWriteOwnerSummary } from "@/lib/ownerSummary";
import { digestMessage } from "@/lib/ownerSummaryText";

/**
 * The scheduled reports, on WhatsApp.
 *
 * The push versions of these — the 07:30 brief and the 21:00 digest — have run from Cloud
 * Functions for months, one short line each. The WhatsApp versions live here instead, because the
 * gateways (Meta, Wapilot, the platform line) are web-server code and the Functions package has no
 * copy of them. So the hourly cron in `/api/automation/staff-reports` sends WhatsApp ONLY: the
 * bell row and the push still come from the Functions job at the clinic's chosen hour, and
 * sending them twice would teach every owner to ignore both.
 *
 * Money is redacted per reader, never per clinic. The briefing is built once with full access and
 * each recipient's text is rendered with their own: an owner's close-out has the takings, the
 * receptionist's has the diary.
 */

/** What a role may see in a report. Owner and Admin see everything; nobody else sees money or HR. */
export function reportAccessForRole(role: string): BriefingAccess {
  const full = role === "Owner" || role === "Admin";
  return { money: full, hr: full };
}

function shiftDays(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function clinicName(clinicId: string): Promise<string> {
  try {
    const snap = await adminDb().collection("clinics").doc(clinicId).get();
    return String(snap.data()?.name || "").trim() || "Alpha Dental";
  } catch {
    return "Alpha Dental";
  }
}

async function handoffsWaiting(clinicId: string): Promise<number> {
  try {
    const snap = await adminClinicCollection(clinicId, "whatsapp_conversations").where("needsHuman", "==", true).get();
    return snap.size;
  } catch {
    return 0;
  }
}

/** Staff rows with a login, for matching a dentist's appointments to a person. */
async function dentistsOf(clinicId: string): Promise<{ uid: string; id: string; name: string }[]> {
  try {
    const snap = await adminClinicCollection(clinicId, "staff").get();
    return snap.docs
      .map((d) => ({ uid: String(d.data()?.uid || "").trim(), id: d.id, name: String(d.data()?.name || "").trim() }))
      .filter((s) => s.uid && s.name);
  } catch {
    return [];
  }
}

/** The same match the Functions brief uses: by doctorId when present, by name otherwise. */
function appointmentsForDentist(briefing: Briefing, dentist: { id: string; name: string }) {
  const name = dentist.name.toLowerCase();
  return briefing.appointments.filter((a) => {
    const doc = String(a.doctor || "").trim().toLowerCase();
    return doc !== "" && (name === doc || name.includes(doc) || doc.includes(name));
  });
}

export interface SendStaffReportArgs {
  clinicId: string;
  event: NotifyEvent;
  /** Only these people. A test from the settings page; the cron leaves it unset. */
  uids?: string[];
  /** A test: also write the bell row and push, so the person sees something arrive on every channel. */
  test?: boolean;
  /** The tester is a platform superadmin with no role at this clinic; treat them as its owner. */
  allowOutsiders?: boolean;
  /** Asked for on the staff line: WhatsApp only, to these uids, whether or not the clinic's switch is on. */
  onDemand?: boolean;
  /** The day the report is about. Defaults to today in the clinic's zone. */
  dateKey?: string;
}

export async function sendStaffReport(args: SendStaffReportArgs): Promise<DeliverResult> {
  const { clinicId, event } = args;
  const kind = event.report;
  if (!kind) return { raised: false, bellWritten: false, pushed: 0, whatsapped: 0, reason: "unknown-event" };

  const today = args.dateKey || ymdInTimeZone(clinicTimeZone());
  const prefs = await readAlertPreferences(clinicId);
  const rp = reportPrefs(event.id, prefs);
  const full: BriefingAccess = { money: true, hr: true };

  /*
   * The AI three-liner. Written once per day and stored (lib/ownerSummary), so the owner's home
   * next morning and this evening's WhatsApp are the same text and the credit is spent once.
   * Owner and Admin only by its role ceiling, so no per-reader redaction is needed.
   */
  if (kind === "summary") {
    const [name, summary] = await Promise.all([clinicName(clinicId), getOrWriteOwnerSummary(clinicId, today)]);
    const lines = rp.language === "ar" ? summary.ar : summary.en;
    const text = digestMessage(summary.facts, lines, name, rp.language);
    const title = args.test ? `🧪 ${name}` : name;
    return deliverClinicNotification(
      clinicId,
      { title, body: lines[0] || "" },
      {
        event: event.id,
        ...(args.uids ? { uids: args.uids } : {}),
        whatsappOnly: !args.test,
        ...(args.allowOutsiders ? { allowOutsiders: true } : {}),
        ...(args.onDemand ? { forceWhatsapp: true } : {}),
        data: { screen: "money" },
        whatsappText: text,
      },
    );
  }

  const [name, todayBriefing, yesterdayBriefing, handoffs, staff] = await Promise.all([
    clinicName(clinicId),
    buildBriefing({ clinicId, period: "day", endDate: today, access: full }),
    kind === "morning"
      ? buildBriefing({ clinicId, period: "day", endDate: shiftDays(today, -1), access: full })
      : Promise.resolve(undefined),
    kind === "dentistDay" ? Promise.resolve(0) : handoffsWaiting(clinicId),
    kind === "dentistDay" ? dentistsOf(clinicId) : Promise.resolve([]),
  ]);

  const push = reportPushLine(kind, todayBriefing, rp.language);
  const title = args.test ? `🧪 ${push.title}` : push.title;

  return deliverClinicNotification(
    clinicId,
    { title, body: push.body },
    {
      event: event.id,
      ...(args.uids ? { uids: args.uids } : {}),
      whatsappOnly: !args.test,
      ...(args.allowOutsiders ? { allowOutsiders: true } : {}),
      ...(args.onDemand ? { forceWhatsapp: true } : {}),
      data: { screen: kind === "evening" ? "money" : "day" },
      whatsappTextFor: ({ uid, role }) => {
        const access = reportAccessForRole(role);
        if (kind === "dentistDay") {
          const me = staff.find((s) => s.uid === uid);
          if (!me) return null;
          const mine = appointmentsForDentist(todayBriefing, me);
          // A dentist with nothing today is not woken up to be told so — unless they asked for a test.
          if (mine.length === 0 && !args.test) return null;
          return renderStaffReport({ kind, clinicName: name, today: todayBriefing, prefs: rp, access, dentist: { name: me.name, appointments: mine } });
        }
        // A day the clinic did not work is not worth a report at any hour — except as a test.
        if (kind === "evening" && !args.test && todayBriefing.counts.total === 0 && (todayBriefing.money?.collected ?? 0) === 0) return null;
        return renderStaffReport({
          kind,
          clinicName: name,
          today: todayBriefing,
          yesterday: yesterdayBriefing,
          handoffsWaiting: handoffs,
          prefs: rp,
          access,
        });
      },
    },
  );
}

/**
 * One hourly tick for one clinic: every report whose WhatsApp is on and whose hour is now.
 *
 * Guarded per clinic, per report, per day by a marker document, because Vercel retries a cron
 * that times out and the second run must not send the owner the same close-out twice.
 */
export async function runStaffReportsForClinic(clinicId: string, now = new Date()): Promise<{ sent: string[]; skipped: string[] }> {
  const prefs = await readAlertPreferences(clinicId);
  const hour = clinicHourNow(now);
  const today = ymdInTimeZone(clinicTimeZone(), now);
  const sent: string[] = [];
  const skipped: string[] = [];

  for (const event of reportEvents()) {
    const resolved = resolveNotify(event.id, prefs);
    if (!resolved?.whatsapp) continue;
    if (notifyTiming(event.id, "hour", prefs) !== hour) continue;

    const marker = adminClinicDoc(clinicId, "report_sends", `${event.id}_${today}`);
    try {
      await marker.create({ event: event.id, date: today, startedAt: FieldValue.serverTimestamp() });
    } catch {
      skipped.push(`${event.id}:already-sent`);
      continue;
    }

    try {
      const result = await sendStaffReport({ clinicId, event, dateKey: today });
      await marker.set({ whatsapped: result.whatsapped, reason: result.whatsappReason || null, finishedAt: FieldValue.serverTimestamp() }, { merge: true });
      sent.push(`${event.id}:${result.whatsapped}${result.whatsappReason ? `:${result.whatsappReason}` : ""}`);
    } catch (error) {
      await marker.set({ error: error instanceof Error ? error.message : String(error) }, { merge: true }).catch(() => {});
      skipped.push(`${event.id}:failed`);
    }
  }
  return { sent, skipped };
}
