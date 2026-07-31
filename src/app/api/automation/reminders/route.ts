import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireStaffUser } from "@/lib/apiStaffAuth";
import { adminDb } from "@/lib/firebaseAdmin";
import { clinicTimeZone, tomorrowYmdInTimeZone } from "@/lib/clinicDate";
import { pickPatientPhone } from "@/lib/patientPhone";
import { resolveWhatsappTemplateForPatient } from "@/lib/whatsappDefaultBodies";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
import { normalizeToE164, sendWhatsApp } from "@/lib/whatsapp";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";

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
  if (isCronAuthorized(request)) return { ok: true as const };
  return requireStaffUser(request);
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

async function getClinicDisplayName(): Promise<string> {
  const profile = await getClinicProfileAdmin();
  let name = (profile?.clinicName && profile.clinicName.trim()) || "";
  if (!name) {
    const ci = await adminDb().collection("settings").doc("clinic_info").get();
    const d = ci.data() as Record<string, unknown> | undefined;
    name =
      (typeof d?.clinicName === "string" && d.clinicName.trim()) ||
      (typeof d?.name === "string" && d.name.trim()) ||
      "Alpha Dental";
  }
  return name;
}

async function getAppointmentById(appointmentId: string): Promise<AppointmentRecord | null> {
  const snap = await adminDb().collection("appointments").doc(appointmentId).get();
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
  appointment: AppointmentRecord
): Promise<{ phone: string; optOut: boolean; patientName: string }> {
  if (appointment.patientId) {
    const patientSnap = await adminDb().collection("patients").doc(appointment.patientId).get();
    if (patientSnap.exists) {
      const data = patientSnap.data() || {};
      return {
        phone: pickPatientPhone(data as Record<string, unknown>),
        optOut: Boolean(data.whatsappOptOut),
        patientName:
          (typeof data.name === "string" && data.name.trim()) || appointment.patientName || "Patient",
      };
    }
  }

  if (appointment.patientName) {
    const byName = await adminDb()
      .collection("patients")
      .where("name", "==", appointment.patientName)
      .limit(1)
      .get();
    if (!byName.empty) {
      const data = byName.docs[0].data() || {};
      return {
        phone: pickPatientPhone(data as Record<string, unknown>),
        optOut: Boolean(data.whatsappOptOut),
        patientName:
          (typeof data.name === "string" && data.name.trim()) || appointment.patientName || "Patient",
      };
    }
  }
  return { phone: "", optOut: false, patientName: appointment.patientName || "Patient" };
}

async function buildReminderText(
  appointment: AppointmentRecord,
  patientName: string,
  clinicName: string
): Promise<{ text: string; skipped?: string }> {
  const settingsSnap = await adminDb().collection("settings").doc("whatsapp").get();
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

async function sendForAppointment(appointment: AppointmentRecord, force = false) {
  if (appointment.status === "Cancelled") {
    return { status: "skipped", reason: "cancelled", appointmentId: appointment.id };
  }

  const reminderDocId = `${appointment.id}_24h`;
  const reminderRef = adminDb().collection("appointment_reminders").doc(reminderDocId);
  const already = await reminderRef.get();
  if (already.exists && !force) {
    return { status: "skipped", reason: "already_sent", appointmentId: appointment.id };
  }

  const { phone, optOut, patientName } = await getPatientContactForAppointment(appointment);
  if (optOut) {
    return { status: "skipped", reason: "whatsapp_opt_out", appointmentId: appointment.id };
  }

  const e164 = normalizeToE164(phone);
  if (!e164) {
    return {
      status: "failed",
      reason: "missing_phone",
      appointmentId: appointment.id,
      patientName: appointment.patientName || "",
    };
  }

  const clinicName = await getClinicDisplayName();
  const { text, skipped } = await buildReminderText(appointment, patientName, clinicName);
  if (skipped) {
    return { status: "skipped", reason: skipped, appointmentId: appointment.id };
  }

  const msg =
    text.trim() ||
    fallbackReminderMessage({
      name: patientName,
      doctor: appointment.doctor,
      date: appointment.date || "",
      time: appointment.time || "",
      clinicName,
    });

  await sendWhatsApp({ to: e164, text: msg });
  await reminderRef.set({
    appointmentId: appointment.id,
    sentAt: new Date().toISOString(),
    channel: "whatsapp",
    type: "24h",
    phone: e164,
  });

  if (appointment.patientId) {
    await adminDb().collection("whatsapp_logs").add({
      patientId: appointment.patientId,
      type: "reminder24h",
      message: msg,
      status: "success",
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return { status: "sent", appointmentId: appointment.id, phone: e164 };
}

/**
 * Appointments on **tomorrow's calendar date** in the clinic timezone (~24h before visit day).
 */
async function runUpcoming24h() {
  const tz = clinicTimeZone();
  const tomorrowStr = tomorrowYmdInTimeZone(tz);

  const appointmentsSnap = await adminDb()
    .collection("appointments")
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
    results.push(await sendForAppointment(appointment, false));
  }
  return { results, tomorrowStr, timeZone: tz };
}

export async function GET(request: Request) {
  const authz = await authorize(request);
  if (!authz.ok) return authz.response;

  try {
    const { results, tomorrowStr, timeZone } = await runUpcoming24h();
    const sent = results.filter((r) => r.status === "sent").length;
    return NextResponse.json({ ok: true, mode: "upcoming24h", sent, tomorrowStr, timeZone, results });
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
      const appointment = await getAppointmentById(body.appointmentId);
      if (!appointment) {
        return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });
      }
      const result = await sendForAppointment(appointment, Boolean(body.force));
      return NextResponse.json({ ok: true, mode, result });
    }

    const { results, tomorrowStr, timeZone } = await runUpcoming24h();
    const sent = results.filter((r) => r.status === "sent").length;
    return NextResponse.json({ ok: true, mode, sent, tomorrowStr, timeZone, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
