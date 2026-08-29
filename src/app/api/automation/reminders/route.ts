import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminClinicCollection, adminClinicDoc, resolveUserClinicId } from "@/lib/adminClinicDb";
import { forEachActiveClinic } from "@/lib/automation/forEachActiveClinic";
import { clinicTimeZone, tomorrowYmdInTimeZone } from "@/lib/clinicDate";
import { pickPatientPhone } from "@/lib/patientPhone";
import { resolveWhatsappTemplateForPatient } from "@/lib/whatsappDefaultBodies";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import { normalizeToE164 } from "@/lib/whatsapp";
import { deliverWhatsAppMessage } from "@/lib/whatsappDelivery";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
import { isSmsBlocked, isWhatsAppBlocked, type PatientContactPreferences } from "@/lib/patientMessaging";
import { channelIncludesSms, channelIncludesWhatsApp } from "@/lib/sms/config";
import { loadSmsSettings } from "@/lib/sms/serverConfig";
import { queuePatientSms } from "@/lib/sms/events";
import { sendClinicPush } from "@/lib/push";
import { wakeSenderPhones } from "@/lib/sms/devices";

/**
 * The nightly run walks every active clinic and sends one message per patient booked tomorrow, so
 * its length grows with the number of clinics on the platform, not with any one clinic's size.
 * Being cut off halfway means some clinics' patients are reminded and others silently are not —
 * the kind of failure nobody notices until a clinic asks why Tuesday had three empty chairs.
 * Requires a Vercel Pro plan to take effect.
 */
export const maxDuration = 300;

type AppointmentRecord = {
  id: string;
  patientId?: string;
  patientName?: string;
  date?: string;
  time?: string;
  doctor?: string;
  status?: string;
};

type ReminderMode = "upcoming24h" | "single";

function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${secret}`;
}

async function authorize(request: Request) {
  if (isCronAuthorized(request)) return { ok: true as const, cron: true as const };
  const staff = await requireStaffUser(request);
  if (!staff.ok) return staff;
  return { ok: true as const, cron: false as const, uid: staff.uid };
}

function fallbackReminderMessage(args: {
  name: string;
  doctor?: string;
  date: string;
  time: string;
  clinicName: string;
}) {
  const { name, doctor, date, time, clinicName } = args;
  return `مرحباً ${name}، تذكير بموعدك غداً ${date} الساعة ${time}${doctor ? ` مع د. ${doctor}` : ""} في ${clinicName}.`;
}

async function getClinicDisplayName(clinicId: string): Promise<string> {
  const profile = await getClinicProfileAdmin(clinicId);
  let name = (profile?.clinicName && profile.clinicName.trim()) || "";
  if (!name) {
    const ci = await adminClinicDoc(clinicId, "settings", "clinic_info").get();
    const d = ci.data() as Record<string, unknown> | undefined;
    name =
      (typeof d?.clinicName === "string" && d.clinicName.trim()) ||
      (typeof d?.name === "string" && d.name.trim()) ||
      "Alpha Dental";
  }
  return name;
}

async function getAppointmentById(clinicId: string, appointmentId: string): Promise<AppointmentRecord | null> {
  const snap = await adminClinicDoc(clinicId, "appointments", appointmentId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    id: snap.id,
    patientId: typeof data.patientId === "string" ? data.patientId : "",
    patientName: typeof data.patientName === "string" ? data.patientName : "",
    date: typeof data.date === "string" ? data.date : "",
    time: typeof data.time === "string" ? data.time : "",
    doctor: typeof data.doctor === "string" ? data.doctor : "",
    status: typeof data.status === "string" ? data.status : "",
  };
}

async function getPatientContactForAppointment(
  clinicId: string,
  appointment: AppointmentRecord
): Promise<{ phone: string; preferences: PatientContactPreferences; patientName: string }> {
  if (appointment.patientId) {
    const patientSnap = await adminClinicDoc(clinicId, "patients", appointment.patientId).get();
    if (patientSnap.exists) {
      const data = patientSnap.data() || {};
      return {
        phone: pickPatientPhone(data as Record<string, unknown>),
        // Passed through untouched, including an absent smsOptOut — the tri-state is what lets
        // an existing WhatsApp opt-out keep covering SMS. See lib/patientMessaging.
        preferences: {
          whatsappOptOut: data.whatsappOptOut === true,
          smsOptOut: typeof data.smsOptOut === "boolean" ? data.smsOptOut : undefined,
        },
        patientName:
          (typeof data.name === "string" && data.name.trim()) || appointment.patientName || "Patient",
      };
    }
  }

  if (appointment.patientName) {
    const byName = await adminClinicCollection(clinicId, "patients")
      .where("name", "==", appointment.patientName)
      .limit(1)
      .get();
    if (!byName.empty) {
      const data = byName.docs[0].data() || {};
      return {
        phone: pickPatientPhone(data as Record<string, unknown>),
        // Passed through untouched, including an absent smsOptOut — the tri-state is what lets
        // an existing WhatsApp opt-out keep covering SMS. See lib/patientMessaging.
        preferences: {
          whatsappOptOut: data.whatsappOptOut === true,
          smsOptOut: typeof data.smsOptOut === "boolean" ? data.smsOptOut : undefined,
        },
        patientName:
          (typeof data.name === "string" && data.name.trim()) || appointment.patientName || "Patient",
      };
    }
  }
  return { phone: "", preferences: {}, patientName: appointment.patientName || "Patient" };
}

async function buildReminderText(
  clinicId: string,
  appointment: AppointmentRecord,
  patientName: string,
  clinicName: string
): Promise<{ text: string; skipped?: string }> {
  const settingsSnap = await adminClinicDoc(clinicId, "settings", "whatsapp").get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};

  if (!Boolean(settings?.isPatientAutomationEnabled)) {
    return { text: "", skipped: "patient_automation_disabled" };
  }

  const tpl = resolveWhatsappTemplateForPatient(settings?.templates, "reminder24h");
  if (!tpl?.trim()) {
    return { text: "", skipped: "reminder_template_disabled" };
  }

  const merged = mergeWhatsAppTemplate(tpl, {
    patient_name: patientName,
    date: appointment.date || "—",
    time: appointment.time || "—",
    doctor: appointment.doctor || "—",
    clinic_name: clinicName,
  });
  return { text: merged };
}

/** One channel's outcome for one appointment. `queued` means handed to the clinic phone, not sent. */
type LegResult = { status: "sent" | "queued" | "skipped" | "failed"; reason?: string };

/**
 * The WhatsApp leg: unchanged behaviour, now one of two possible channels.
 */
async function sendWhatsAppLeg(args: {
  clinicId: string;
  appointment: AppointmentRecord;
  patientName: string;
  clinicName: string;
  e164: string;
  force: boolean;
}): Promise<LegResult> {
  const { clinicId, appointment, patientName, clinicName, e164, force } = args;

  const reminderRef = adminClinicDoc(clinicId, "appointment_reminders", `${appointment.id}_24h`);
  const already = await reminderRef.get();
  if (already.exists && !force) return { status: "skipped", reason: "already_sent" };

  const { text, skipped } = await buildReminderText(clinicId, appointment, patientName, clinicName);
  if (skipped) return { status: "skipped", reason: skipped };

  const msg =
    text.trim() ||
    fallbackReminderMessage({
      name: patientName,
      doctor: appointment.doctor,
      date: appointment.date || "",
      time: appointment.time || "",
      clinicName,
    });

  // Click-to-send has no meaning here: this runs before dawn, so there is nobody to open WhatsApp
  // and press send. It used to give up at that point, which meant a clinic without a paid gateway
  // had its WhatsApp reminders silently never go out at all — the failure looked identical to a
  // patient ignoring the message. Now the message goes into a list the clinic works through in the
  // morning, and only a clinic with no phone paired is turned away.
  const delivery = await deliverWhatsAppMessage({
    clinicId,
    to: e164,
    text: msg,
    audience: "patient",
    queue: {
      key: `${appointment.id}_24h`,
      type: "reminder24h",
      patientId: appointment.patientId,
      patientName,
      appointmentId: appointment.id,
    },
  });

  if (delivery.mode === "manual") return { status: "skipped", reason: "no_whatsapp_connection" };

  // Queued is not sent. No reminder record is written, because that record is what stops the
  // message being prepared again — and writing it now would permanently mark an appointment as
  // handled when the patient has not been told anything yet.
  if (delivery.mode === "queued") return { status: "queued", reason: "awaiting_clinic_phone" };

  await reminderRef.set({
    appointmentId: appointment.id,
    sentAt: new Date().toISOString(),
    channel: "whatsapp",
    type: "24h",
    phone: e164,
  });

  if (appointment.patientId) {
    await adminClinicCollection(clinicId, "whatsapp_logs").add({
      patientId: appointment.patientId,
      type: "reminder24h",
      message: msg,
      status: "success",
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return { status: "sent" };
}

/**
 * The SMS leg: hand the message to the clinic's own phone.
 *
 * This reports `queued`, never `sent`, and that distinction is the whole point. The server has not
 * sent anything — it has written a message the clinic's handset will pick up when it next polls.
 * Only the phone can say the text actually left, and it does that by acking the outbox. Reporting
 * a queue write as a send is how a clinic ends up believing patients were reminded when the phone
 * was flat in a drawer.
 *
 * The message is stamped with the hour the clinic chose and the phone holds it until then, so this
 * sweep can run early without every patient being woken at dawn.
 */
async function queueSmsLeg(args: {
  clinicId: string;
  appointment: AppointmentRecord;
  patientName: string;
  clinicName: string;
  preferences: PatientContactPreferences;
  phone: string;
}): Promise<LegResult> {
  const { clinicId, appointment, patientName, clinicName, preferences, phone } = args;

  return queuePatientSms({
    clinicId,
    type: "reminder24h",
    key: `${appointment.id}_24h`,
    phone,
    patientName,
    preferences,
    patientId: appointment.patientId,
    appointmentId: appointment.id,
    values: {
      patient_name: patientName,
      date: appointment.date || "—",
      time: appointment.time || "—",
      doctor: appointment.doctor || "—",
      clinic_name: clinicName,
    },
  });
}

/**
 * Remind one patient, over whichever channels the clinic has chosen.
 *
 * The two legs are independent: a clinic on "both" whose WhatsApp gateway is down still gets the
 * SMS out, and a failure to queue an SMS never costs the patient their WhatsApp message.
 */
async function sendForAppointment(clinicId: string, appointment: AppointmentRecord, force = false) {
  const base = { appointmentId: appointment.id, patientName: appointment.patientName || "" };

  if (appointment.status === "Cancelled") {
    return { ...base, status: "skipped" as const, reason: "cancelled", whatsapp: null, sms: null };
  }

  const { phone, preferences, patientName } = await getPatientContactForAppointment(clinicId, appointment);

  // Judged per channel rather than once for both. A patient with no WhatsApp can be marked as
  // reachable by text alone, and a patient who wants no contact at all is still covered because an
  // unset SMS preference inherits the WhatsApp one.
  const whatsappBlocked = isWhatsAppBlocked(preferences);
  const smsBlocked = isSmsBlocked(preferences);

  if (whatsappBlocked && smsBlocked) {
    return { ...base, status: "skipped" as const, reason: "patient_opted_out", whatsapp: null, sms: null };
  }

  const e164 = normalizeToE164(phone);
  if (!e164) {
    return { ...base, status: "failed" as const, reason: "missing_phone", whatsapp: null, sms: null };
  }

  const clinicName = await getClinicDisplayName(clinicId);
  const { reminderChannel } = await loadSmsSettings(clinicId);

  const whatsapp = !channelIncludesWhatsApp(reminderChannel)
    ? ({ status: "skipped", reason: "whatsapp_not_selected" } as LegResult)
    : whatsappBlocked
      ? ({ status: "skipped", reason: "whatsapp_opt_out" } as LegResult)
      : await sendWhatsAppLeg({ clinicId, appointment, patientName, clinicName, e164, force });

  const sms = !channelIncludesSms(reminderChannel)
    ? ({ status: "skipped", reason: "sms_not_selected" } as LegResult)
    : smsBlocked
      ? ({ status: "skipped", reason: "sms_opt_out" } as LegResult)
      : await queueSmsLeg({ clinicId, appointment, patientName, clinicName, preferences, phone: e164 });

  // The appointment counts as handled if any channel got somewhere. "queued" is reported as its
  // own outcome rather than folded into "sent" so the summary never overstates what happened.
  const status =
    whatsapp.status === "sent" || sms.status === "sent"
      ? ("sent" as const)
      : sms.status === "queued"
        ? ("queued" as const)
        : whatsapp.status === "failed" || sms.status === "failed"
          ? ("failed" as const)
          : ("skipped" as const);

  const reason = status === "skipped" || status === "failed" ? whatsapp.reason || sms.reason : undefined;

  return { ...base, status, reason, channel: reminderChannel, whatsapp, sms, phone: e164 };
}

/**
 * Appointments on **tomorrow's calendar date** in the clinic timezone (~24h before visit day).
 */
async function runUpcoming24hForClinic(clinicId: string) {
  const tz = clinicTimeZone();
  const tomorrowStr = tomorrowYmdInTimeZone(tz);

  const appointmentsSnap = await adminClinicCollection(clinicId, "appointments")
    .where("date", "==", tomorrowStr)
    .get();

  const candidates: AppointmentRecord[] = [];
  appointmentsSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const status = typeof data.status === "string" ? data.status : "";
    if (status === "Cancelled") return;

    candidates.push({
      id: docSnap.id,
      patientId: typeof data.patientId === "string" ? data.patientId : "",
      patientName: typeof data.patientName === "string" ? data.patientName : "",
      date: typeof data.date === "string" ? data.date : "",
      time: typeof data.time === "string" ? data.time : "",
      doctor: typeof data.doctor === "string" ? data.doctor : "",
      status,
    });
  });

  const results = [];
  for (const appointment of candidates) {
    results.push(await sendForAppointment(clinicId, appointment, false));
  }
  return { results, tomorrowStr, timeZone: tz };
}

/**
 * Cron has no user to resolve a clinic from, so it sweeps every active clinic. A staff member
 * triggering the same sweep manually only ever acts on their own clinic.
 */
async function runUpcoming24h(authz: { cron: boolean; uid?: string }) {
  if (!authz.cron) {
    const clinicId = await resolveUserClinicId(authz.uid as string);
    const run = await runUpcoming24hForClinic(clinicId);
    return { clinics: [{ clinicId, ok: true, result: run }], ...run };
  }

  const clinics = await forEachActiveClinic((clinicId) => runUpcoming24hForClinic(clinicId));

  // One summary push per clinic, not one per message: the sweep can queue twenty reminders at
  // once, and twenty pings teach a phone's owner to mute the app by Wednesday. Fire-and-forget —
  // a failed courtesy must not fail the sweep.
  for (const clinic of clinics) {
    const queuedHere = (clinic.result?.results ?? []).filter(
      (r: { whatsapp?: { status?: string } | null }) => r.whatsapp?.status === "queued"
    ).length;
    const smsQueuedHere = (clinic.result?.results ?? []).filter(
      (r: { sms?: { status?: string } | null }) => r.sms?.status === "queued"
    ).length;
    // One wake per clinic after the whole sweep, not one per message: the phone drains the entire
    // queue in a single run, so twenty nudges would do exactly what one does.
    if (smsQueuedHere > 0) void wakeSenderPhones(clinic.clinicId);

    if (queuedHere > 0) {
      void sendClinicPush(clinic.clinicId, {
        title: "رسائل واتساب في الانتظار",
        body: `${queuedHere} رسالة جاهزة للإرسال من التطبيق — ${queuedHere} WhatsApp message(s) waiting in the app.`,
      });
    }
  }

  const results = clinics.flatMap((c) => c.result?.results ?? []);
  const first = clinics.find((c) => c.result)?.result;
  return {
    clinics,
    results,
    tomorrowStr: first?.tomorrowStr ?? "",
    timeZone: first?.timeZone ?? "",
  };
}

export async function GET(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;

  try {
    const { results, tomorrowStr, timeZone, clinics } = await runUpcoming24h(authz);
    const sent = results.filter((r) => r.status === "sent").length;
    // Reported apart from `sent`: these are with the clinic's phone, not with the patient yet.
    const queued = results.filter((r) => r.status === "queued").length;
    return NextResponse.json({ ok: true, mode: "upcoming24h", sent, queued, tomorrowStr, timeZone, clinics, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      mode?: ReminderMode;
      appointmentId?: string;
      force?: boolean;
    };

    const mode: ReminderMode = body.mode || "upcoming24h";
    if (mode === "single") {
      if (!body.appointmentId) {
        return NextResponse.json({ ok: false, error: "appointmentId is required for single mode" }, { status: 400 });
      }
      // Sending one reminder is always a staff action against their own clinic — cron only ever
      // runs the sweep, so there is no tenant to infer for a cron-authorized single send.
      if (authz.cron) {
        return NextResponse.json({ ok: false, error: "single mode requires a signed-in staff user" }, { status: 400 });
      }
      const clinicId = await resolveUserClinicId(authz.uid as string);
      const appointment = await getAppointmentById(clinicId, body.appointmentId);
      if (!appointment) {
        return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
      }
      const result = await sendForAppointment(clinicId, appointment, Boolean(body.force));
      return NextResponse.json({ ok: true, mode, result });
    }

    const { results, tomorrowStr, timeZone, clinics } = await runUpcoming24h(authz);
    const sent = results.filter((r) => r.status === "sent").length;
    const queued = results.filter((r) => r.status === "queued").length;
    return NextResponse.json({ ok: true, mode, sent, queued, tomorrowStr, timeZone, clinics, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
