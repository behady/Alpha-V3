import { adminClinicDoc } from "@/lib/adminClinicDb";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
import { isSmsBlocked, withSmsOptOutFooter, type PatientContactPreferences } from "@/lib/patientMessaging";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import { normalizeToE164 } from "@/lib/whatsapp";
import type { SmsEventType, SmsSettings } from "./config";
import { sendAfterFor } from "./schedule";
import { loadSmsSettings } from "./serverConfig";
import { hasActiveDevice, wakeSenderPhones } from "./devices";
import { enqueueSms } from "./outbox";

/**
 * The one place a text message gets put in the queue.
 *
 * Both the nightly reminder sweep and the reactions to what staff just did (booked, moved,
 * cancelled, took a payment) come through here, so there is a single answer to "would this patient
 * be texted, and when". When the two had separate implementations the opt-out check and the
 * paired-phone check drifted apart, which is the sort of thing that is only discovered by a patient
 * who asked not to be contacted.
 *
 * Note what this never reports: `sent`. Nothing here sends anything. It writes a row the clinic's
 * phone will collect on its next poll, and only the handset can say a text actually left.
 */

export type SmsQueueOutcome = {
  status: "queued" | "skipped";
  /** Why nothing was queued. Surfaced in the cron summary so a silent night is explainable. */
  reason?: string;
};

/** Values available to every template body as {{placeholders}}. */
export type SmsMergeValues = Record<string, string>;

export interface QueuePatientSmsArgs {
  clinicId: string;
  type: SmsEventType;
  /**
   * Stable id for what this message is *about* — `${appointmentId}_cancel`, and so on. Two calls
   * with the same key queue one message, which is what keeps a double-clicked Save button, or a
   * cron run that overlaps a manual send, from texting a patient twice.
   */
  key: string;
  phone: string;
  patientName: string;
  preferences: PatientContactPreferences;
  values: SmsMergeValues;
  patientId?: string;
  appointmentId?: string;
  /** Loaded already by the caller in the sweep; re-read here when absent. */
  settings?: SmsSettings;
}

export async function clinicDisplayName(clinicId: string): Promise<string> {
  const profile = await getClinicProfileAdmin(clinicId);
  const fromProfile = (profile?.clinicName && profile.clinicName.trim()) || "";
  if (fromProfile) return fromProfile;

  const snap = await adminClinicDoc(clinicId, "settings", "clinic_info").get();
  const data = snap.data() as Record<string, unknown> | undefined;
  return (
    (typeof data?.clinicName === "string" && data.clinicName.trim()) ||
    (typeof data?.name === "string" && data.name.trim()) ||
    "Alpha Dental"
  );
}

export async function queuePatientSms(args: QueuePatientSmsArgs): Promise<SmsQueueOutcome> {
  const { clinicId, type, key, phone, patientName, preferences, values, patientId, appointmentId } = args;

  const settings = args.settings ?? (await loadSmsSettings(clinicId));

  if (!settings.enabled) return { status: "skipped", reason: "sms_disabled" };
  if (settings.reminderChannel === "whatsapp") return { status: "skipped", reason: "sms_not_selected" };
  if (!settings.events[type]) return { status: "skipped", reason: `${type}_sms_off` };

  // Channel-independent: a patient who opted out of WhatsApp and was never asked about SMS is
  // treated as having opted out of both. See lib/patientMessaging for why that inheritance exists.
  if (isSmsBlocked(preferences)) return { status: "skipped", reason: "sms_opt_out" };

  const e164 = normalizeToE164(phone);
  if (!e164) return { status: "skipped", reason: "missing_phone" };

  // Queueing with no phone paired piles messages up where nothing can ever collect them, and the
  // clinic watches a "waiting" list grow that will never move.
  if (!(await hasActiveDevice(clinicId))) return { status: "skipped", reason: "no_paired_phone" };

  const merged = mergeWhatsAppTemplate(settings.templates[type] || "", values).trim();
  if (!merged) return { status: "skipped", reason: "empty_template" };

  // Appended after the emptiness check so an empty body stays a skip rather than becoming a text
  // consisting only of instructions for stopping texts. See SmsSettings.optOutFooterEnabled for
  // why this is off unless the clinic asked: it always costs a second billed segment.
  const text = withSmsOptOutFooter(merged, settings.optOutFooterEnabled);

  const queued = await enqueueSms(clinicId, key, {
    to: e164,
    text,
    type,
    patientId: patientId || undefined,
    patientName,
    appointmentId: appointmentId || undefined,
    sendAfter: sendAfterFor(type, settings),
  });

  // Nudge the phone the moment something lands, rather than leaving it for the next poll.
  // Deliberately not awaited: the caller is finishing a booking or a payment, and a courtesy
  // push must never sit in front of that.
  if (queued) void wakeSenderPhones(clinicId);

  return queued ? { status: "queued" } : { status: "skipped", reason: "already_queued" };
}
