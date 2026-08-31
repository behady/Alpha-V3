import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
import { patientSendablePhone, pickPatientPhone } from "@/lib/patientPhone";
import { sendClinicPush } from "@/lib/push";
import type { SmsEventType } from "@/lib/sms/config";
import { clinicDisplayName, queuePatientSms } from "@/lib/sms/events";
import {
  type WhatsAppTemplatePack,
  isTemplatePack,
  resolveWhatsappTemplateForPatient,
} from "@/lib/whatsappDefaultBodies";
import { applyPatientOptOutFooter, deliverWhatsAppMessage } from "@/lib/whatsappDelivery";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import type { WhatsAppTemplateType } from "@/types/whatsapp";
import { arabicDayLabel, arabicTimeLabel } from "@/lib/arabicDateTime";

/**
 * Telling the patient what just happened to them — booked, moved, cancelled, paid.
 *
 * This used to live inside the send-patient-message route, which meant only flows that went
 * through that route ever messaged anyone. The assistant's approved actions run on the Admin SDK
 * and never pass through it, so an appointment moved by hand messaged the patient while the
 * identical move approved in the chat stayed silent. Both doors now come through here, so
 * "would the patient be told, and through which gates?" has exactly one answer.
 *
 * Every entry point sends two independent legs:
 *   - SMS, with its own enable switch, per-event toggle, template and opt-out (see lib/sms/events).
 *   - WhatsApp, behind the clinic's patient-automation switch, the template's on/off state, the
 *     patient's opt-out and a phone number existing at all.
 * A skip on one leg never silences the other.
 */

export type PatientMessageOutcome =
  /** The gateway delivered it, unattended. */
  | { status: "sent" }
  /** No gateway — the message waits in whatsapp_outbox for a person to tap send. */
  | { status: "queued" }
  /** No gateway and nothing to queue into — the composed text goes back to the caller. */
  | { status: "manual"; phone: string; text: string }
  /** A gate said no. Not an error: the clinic or the patient asked for this silence. */
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export type AppointmentPatientTemplate = Extract<WhatsAppTemplateType, "new" | "edit" | "cancel">;

/**
 * A Firestore document id may not contain a slash, and the parts these keys are built from are
 * user-facing strings (a date, a time like "02:00 PM") rather than ids.
 */
export function outboxKey(...parts: string[]): string {
  return parts
    .map((p) => p.trim().replace(/[/\s]+/g, "-"))
    .filter(Boolean)
    .join("_");
}

export function isDeletedLedger(d: Record<string, unknown>) {
  return d.status === "deleted" || d.status === "cancelled";
}

/** Which built-in wording answers for a template the clinic never edited. Bilingual when unset. */
function pickTemplatePack(settings: Record<string, unknown> | undefined): WhatsAppTemplatePack {
  return isTemplatePack(settings?.templatePack) ? settings.templatePack : "bilingual";
}

/**
 * A receipt fired off the back of a payment save can race the ledger write it is about; a few
 * short retries beat telling the patient nothing because the read came 100ms too early.
 */
export async function getLedgerDocWithRetry(clinicId: string, ledgerId: string, attempts = 4, delayMs = 150) {
  for (let i = 0; i < attempts; i++) {
    const snap = await adminClinicDoc(clinicId, "ledger", ledgerId).get();
    if (snap.exists) return snap;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

export async function computePatientBalance(clinicId: string, patientId: string): Promise<number> {
  const snap = await adminClinicCollection(clinicId, "ledger").where("patientId", "==", patientId).get();
  let billed = 0;
  let paid = 0;
  snap.forEach((doc) => {
    const d = doc.data();
    if (isDeletedLedger(d)) return;
    if (d.type === "procedure") billed += Number(d.cost) || 0;
    if (d.type === "payment") paid += Number(d.paid) || 0;
  });
  return billed - paid;
}

/**
 * Queue the SMS half of a patient message.
 *
 * Deliberately independent of everything WhatsApp around it: its own enable switch, its own
 * per-event toggle, its own template, its own opt-out. A clinic with WhatsApp automation switched
 * off — or with no gateway configured at all, which is every clinic that has not done the Meta
 * paperwork — still gets its texts out. It also never throws into the caller: a queue write that
 * fails must not turn a successful booking into an error on screen.
 */
async function queueEventSms(args: {
  clinicId: string;
  type: SmsEventType;
  key: string;
  patient: Record<string, unknown>;
  patientId: string;
  values: Record<string, string>;
}): Promise<void> {
  const { clinicId, type, key, patient, patientId, values } = args;
  try {
    const clinicName = await clinicDisplayName(clinicId);
    await queuePatientSms({
      clinicId,
      type,
      key,
      patientId,
      // Normalised here rather than passed as stored: a patient written down as
      // "01024348877" was skipped as missing_phone every single time.
      phone: patientSendablePhone(patient),
      patientName: (typeof patient.name === "string" && patient.name.trim()) || "Patient",
      preferences: {
        whatsappOptOut: patient.whatsappOptOut === true,
        smsOptOut: typeof patient.smsOptOut === "boolean" ? patient.smsOptOut : undefined,
      },
      values: { ...values, clinic_name: clinicName },
    });
  } catch (e) {
    console.warn(`Could not queue ${type} SMS:`, e);
  }
}

/**
 * Queue the "we received your payment" text.
 *
 * Only for rows that are actually a payment. A procedure being invoiced is money owed, not money
 * received, and telling a patient "we received 1500" when they have just been charged 1500 is the
 * kind of message that produces a phone call and a lost afternoon.
 */
export async function queuePaymentSms(args: {
  clinicId: string;
  patient: Record<string, unknown>;
  patientId: string;
  ledgerId: string;
}): Promise<void> {
  const { clinicId, patient, patientId, ledgerId } = args;
  try {
    const snap = await getLedgerDocWithRetry(clinicId, ledgerId);
    if (!snap?.exists) return;

    const ledger = snap.data() as Record<string, unknown>;
    if (String(ledger.patientId) !== patientId) return;
    if (isDeletedLedger(ledger)) return;
    if (String(ledger.type || "") !== "payment") return;

    const amount = Number(ledger.paid) || 0;
    const balance = await computePatientBalance(clinicId, patientId);

    await queueEventSms({
      clinicId,
      type: "invoice",
      key: outboxKey(ledgerId, "invoice"),
      patient,
      patientId,
      values: {
        patient_name: (typeof patient.name === "string" && patient.name.trim()) || "Patient",
        amount: amount.toLocaleString("en-US"),
        balance: balance.toLocaleString("en-US"),
        date: String(ledger.date || "—"),
        method: String(ledger.method || "—"),
        description: String(ledger.description || ledger.category || "—"),
        doctor: String(ledger.doctorName || ledger.doctor || "—"),
      },
    });
  } catch (e) {
    console.warn("Could not queue payment SMS:", e);
  }
}

/** Send-or-queue one composed WhatsApp message and record it, whatever the delivery mode. */
async function deliverPatientWhatsApp(args: {
  clinicId: string;
  patientId: string;
  patientName: string;
  phone: string;
  text: string;
  /** Written to whatsapp_logs and onto the queued row — the Messages page knows these slugs. */
  type: string;
  queueKey: string;
  /** Template kind + params for the official channel; see deliverWhatsAppMessage. */
  metaTemplate?: { kind: string; params: string[] };
}): Promise<PatientMessageOutcome> {
  const { clinicId, patientId, patientName, phone, type, queueKey } = args;
  // The footer is applied here as well as inside delivery (appending is idempotent), so that the
  // text logged below is byte-for-byte the text the patient receives. The log used to record the
  // pre-footer body, which meant the patient timeline showed a message nobody was ever sent —
  // and lid learning (lib/whatsappLid) matches the gateway's echo of the SENT text against this
  // log, so the two being identical is now load-bearing, not cosmetic.
  const text = await applyPatientOptOutFooter(clinicId, args.text);
  try {
    const delivery = await deliverWhatsAppMessage({
      clinicId,
      to: phone,
      text,
      audience: "patient",
      // Worth queueing: the patient needs this whether or not a staff member is at a screen
      // right now. The key is derived from what the message is about, so saving the same change
      // twice queues one message while a genuinely new change queues another.
      queue: { key: queueKey, type, patientId, patientName },
      metaTemplate: args.metaTemplate,
    });
    await adminClinicCollection(clinicId, "whatsapp_logs").add({
      patientId,
      type,
      message: text,
      // Neither "manual" nor "queued" is a delivery. A log claiming otherwise would make the
      // patient timeline lie about what the patient actually saw.
      status: delivery.mode === "auto" ? "success" : delivery.mode,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (delivery.mode === "manual") {
      return { status: "manual", phone: delivery.phone, text: delivery.text };
    }
    if (delivery.mode === "queued") {
      void sendClinicPush(clinicId, {
        title: "رسالة واتساب في الانتظار",
        body: "رسالة جاهزة للإرسال من التطبيق — a WhatsApp message is waiting in the app.",
      });
      return { status: "queued" };
    }
    return { status: "sent" };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "Send failed";
    await adminClinicCollection(clinicId, "whatsapp_logs").add({
      patientId,
      type,
      message: text,
      status: "failed",
      createdAt: FieldValue.serverTimestamp(),
    });
    return { status: "failed", error };
  }
}

/**
 * The booking templates — `new`, `edit`, `cancel` — with the SMS leg attached.
 *
 * `date`/`time`/`doctor` are the values the patient should read, i.e. the slot as it now stands
 * (for a cancel, the slot being cancelled).
 */
export async function sendAppointmentPatientMessage(args: {
  clinicId: string;
  patientId: string;
  template: AppointmentPatientTemplate;
  date: string;
  time: string;
  doctor: string;
  /** Pass the already-loaded patient document to save a read; it is fetched when absent. */
  patient?: Record<string, unknown>;
}): Promise<PatientMessageOutcome> {
  const { clinicId, patientId, template } = args;
  const date = args.date.trim();
  const time = args.time.trim();
  const doctor = args.doctor.trim();

  // A blocked-out slot has no patient behind it; there is nobody to message.
  if (!patientId) return { status: "skipped", reason: "no_patient" };

  let patient = args.patient;
  if (!patient) {
    const snap = await adminClinicDoc(clinicId, "patients", patientId).get();
    if (!snap.exists) return { status: "skipped", reason: "patient_not_found" };
    patient = snap.data() as Record<string, unknown>;
  }

  // Before any WhatsApp gate below, because the SMS is not a WhatsApp fallback — it is its own
  // channel with its own switches. Keyed on the slot rather than just the appointment so that
  // moving a patient twice sends two texts, while saving the same change twice sends one.
  await queueEventSms({
    clinicId,
    type: template,
    key: outboxKey(patientId, template, date, time),
    patient,
    patientId,
    values: {
      patient_name: (typeof patient.name === "string" && patient.name.trim()) || "Patient",
      date: date || "—",
      time: time || "—",
      doctor: doctor || "—",
    },
  });

  const settingsSnap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  if (!Boolean(settings?.isPatientAutomationEnabled)) {
    return { status: "skipped", reason: "patient_automation_disabled" };
  }

  const tplText = resolveWhatsappTemplateForPatient(settings?.templates, template, pickTemplatePack(settings));
  if (!tplText?.trim()) {
    return { status: "skipped", reason: "template_disabled" };
  }

  if (patient.whatsappOptOut === true) {
    return { status: "skipped", reason: "whatsapp_opt_out" };
  }

  const phone = patientSendablePhone(patient);
  if (!phone) {
    return { status: "skipped", reason: "missing_phone" };
  }

  const patientName = typeof patient.name === "string" ? patient.name : "Patient";
  const profile = await getClinicProfileAdmin(clinicId);
  let clinicName = (profile?.clinicName && profile.clinicName.trim()) || "";
  if (!clinicName) {
    const ci = await adminClinicDoc(clinicId, "settings", "clinic_info").get();
    const d = ci.data() as Record<string, unknown> | undefined;
    clinicName =
      (typeof d?.clinicName === "string" && d.clinicName.trim()) ||
      (typeof d?.name === "string" && d.name.trim()) ||
      "Alpha Dental";
  }
  const reviewUrl = String(profile?.googleReviewUrl || "").trim();
  const mapsUrl = String(profile?.googleMapsUrl || "").trim();
  const googleLink = reviewUrl || mapsUrl;

  const merged = mergeWhatsAppTemplate(tplText, {
    patient_name: patientName,
    clinic_name: clinicName,
    doctor: doctor || "—",
    date: date || "—",
    time: time || "—",
    google_link: googleLink,
  });

  return deliverPatientWhatsApp({
    clinicId,
    patientId,
    patientName,
    phone,
    text: merged,
    type: `appointment_${template}`,
    queueKey: outboxKey(patientId, template, date, time),
    /*
     * The approved template's placeholders, filled the way a patient reads — "الثلاثاء 1/9" and
     * "6:30 م", not "2026-09-02" and "06:30 PM". The stored values are the canonical ones the
     * calendar needs; this is only how they are spoken.
     */
    metaTemplate: {
      kind: template,
      params:
        template === "cancel"
          ? [clinicName, arabicDayLabel(date) || "—"]
          : [clinicName, arabicDayLabel(date) || "—", arabicTimeLabel(time) || "—"],
    },
  });
}

/**
 * The receipt for one ledger payment — the `invoice` template — with the SMS leg attached.
 *
 * Automation semantics throughout: every reason not to send is a skip, never a thrown error,
 * because this runs off the back of a payment that has already been recorded.
 */
export async function sendPaymentReceiptMessage(args: {
  clinicId: string;
  patientId: string;
  ledgerId: string;
  /** Pass the already-loaded patient document to save a read; it is fetched when absent. */
  patient?: Record<string, unknown>;
}): Promise<PatientMessageOutcome> {
  const { clinicId, patientId, ledgerId } = args;

  if (!patientId) return { status: "skipped", reason: "no_patient" };
  if (!ledgerId) return { status: "skipped", reason: "no_ledger" };

  let patient = args.patient;
  if (!patient) {
    const snap = await adminClinicDoc(clinicId, "patients", patientId).get();
    if (!snap.exists) return { status: "skipped", reason: "patient_not_found" };
    patient = snap.data() as Record<string, unknown>;
  }

  // Above the WhatsApp opt-out check on purpose. The two opt-outs are separate settings, and a
  // patient who asked for no WhatsApp but explicitly kept SMS on would otherwise be dropped here
  // by a check that has nothing to do with their SMS preference.
  await queuePaymentSms({ clinicId, patient, patientId, ledgerId });

  if (patient.whatsappOptOut === true) {
    return { status: "skipped", reason: "whatsapp_opt_out" };
  }

  const phone = patientSendablePhone(patient);
  if (!phone) {
    return { status: "skipped", reason: "missing_phone" };
  }

  const settingsSnap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  if (!Boolean(settings?.isPatientAutomationEnabled)) {
    return { status: "skipped", reason: "patient_automation_disabled" };
  }

  const tplText = resolveWhatsappTemplateForPatient(settings?.templates, "invoice", pickTemplatePack(settings));
  if (!tplText?.trim()) {
    return { status: "skipped", reason: "template_disabled" };
  }

  const ledgerSnap = await getLedgerDocWithRetry(clinicId, ledgerId);
  if (!ledgerSnap?.exists) {
    return { status: "skipped", reason: "ledger_not_ready" };
  }
  const L = ledgerSnap.data() as Record<string, unknown>;
  if (String(L.patientId) !== patientId) {
    return { status: "failed", error: "Ledger entry does not belong to this patient" };
  }
  if (isDeletedLedger(L)) {
    return { status: "skipped", reason: "ledger_deleted" };
  }
  // A procedure row is money owed, not money received — see queuePaymentSms above.
  if (String(L.type || "") !== "payment") {
    return { status: "skipped", reason: "not_a_payment" };
  }

  const amount = Number(L.paid) || 0;
  const balance = await computePatientBalance(clinicId, patientId);
  const clinicName = await clinicDisplayName(clinicId);
  const patientName = typeof patient.name === "string" ? patient.name : "Patient";

  const merged = mergeWhatsAppTemplate(tplText, {
    patient_name: patientName,
    description: String(L.description || L.category || "payment"),
    amount: amount.toLocaleString(),
    date: String(L.date || "—"),
    type: "payment",
    method: String(L.method || "—"),
    balance: balance.toLocaleString(),
    clinic_name: clinicName,
    doctor: String(L.doctorName || L.doctor || "—"),
  });

  return deliverPatientWhatsApp({
    clinicId,
    patientId,
    patientName,
    phone,
    text: merged,
    type: "invoice",
    queueKey: outboxKey(ledgerId, "invoice"),
    metaTemplate: { kind: "invoice", params: [amount.toLocaleString("en-US"), clinicName, balance.toLocaleString("en-US")] },
  });
}
