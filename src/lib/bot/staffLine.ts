import { adminClinicCollection } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { notifyEvent } from "@/lib/notificationCatalog";
import { readAlertPreferences, readClinicMembers } from "@/lib/notificationDelivery";
import { sendStaffReport } from "@/lib/reports/sendStaffReport";
import { sendStaffWhatsApp } from "@/lib/staffWhatsapp";
import { normalizeToE164 } from "@/lib/whatsapp";

/**
 * The staff line: what happens when the clinic's own people write to the clinic's number.
 *
 * Until this existed the bot treated the owner as whichever patient shared his phone, greeted him
 * by that patient's name, and offered to book him a check-up. The numbers a clinic enters on
 * Settings → Alerts & reports (and the owner number on Settings → WhatsApp) are the clinic's
 * people, so a message from one of them is answered as staff: by name and role, never through the
 * patient pipeline, with no opt-out footer and no handoff row.
 *
 * What it can do today is small and deliberate: send the reports on request. "Ask me anything
 * about the clinic" is milestone 4, and it must go through the assistant's own permission model —
 * the same one the in-app assistant uses — not a prompt bolted onto the patient bot.
 */

export interface StaffSender {
  uid: string;
  role: string;
  name: string;
}

function samePhone(a: string, b: string): boolean {
  const x = normalizeToE164(a);
  const y = normalizeToE164(b);
  return Boolean(x) && x === y;
}

/** The clinic member this phone belongs to, or null. Phones come from the recipients block only. */
export async function findStaffByPhone(clinicId: string, phone: string): Promise<StaffSender | null> {
  if (!phone) return null;
  const prefs = await readAlertPreferences(clinicId);
  const members = await readClinicMembers(clinicId);
  const roleOf = new Map(members.map((m) => [m.uid, m.role]));

  let uid = "";
  for (const [id, p] of Object.entries(prefs.people || {})) {
    if (p?.phone && samePhone(p.phone, phone) && roleOf.has(id)) {
      uid = id;
      break;
    }
  }
  if (!uid) {
    // The owner's fallback number on Settings → WhatsApp is the owner.
    try {
      const wa = await adminDb().doc(`clinics/${clinicId}/settings/whatsapp`).get();
      const ownerNumber = String(wa.data()?.ownerNumber || "");
      if (ownerNumber && samePhone(ownerNumber, phone)) {
        uid = members.find((m) => m.role === "Owner")?.uid || "";
      }
    } catch {
      /* no fallback number */
    }
  }
  if (!uid) return null;

  let name = "";
  try {
    const staffSnap = await adminClinicCollection(clinicId, "staff").where("uid", "==", uid).limit(1).get();
    name = String(staffSnap.docs[0]?.data()?.name || "").trim();
    if (!name) {
      const userSnap = await adminDb().collection("users").doc(uid).get();
      name = String(userSnap.data()?.name || "").trim();
    }
  } catch {
    /* unnamed is fine */
  }
  return { uid, role: roleOf.get(uid) || "Admin", name };
}

export type StaffIntent = "evening" | "morning" | "summary" | "help";

/** What a staff member asked for, from a few words in either language. */
export function staffIntent(text: string): StaffIntent {
  const t = text.trim().toLowerCase();
  if (/(تقرير|اقفال|إقفال|الاقفال|الإقفال|close|report|حساب اليوم|فلوس)/.test(t)) return "evening";
  if (/(ملخص|summary|سطور|lines)/.test(t)) return "summary";
  if (/(النهارده|النهاردة|اليوم|صباح|مواعيد|today|morning|schedule|brief)/.test(t)) return "morning";
  return "help";
}

export function staffLanguage(text: string): "ar" | "en" {
  return /[؀-ۿ]/.test(text) ? "ar" : "en";
}

const ROLE_AR: Record<string, string> = { Owner: "المالك", Admin: "مدير", Dentist: "دكتور", Receptionist: "استقبال", Assistant: "مساعد" };

/** The line's own greeting: who you are to the system, and the three words it understands. */
export function staffHelpText(sender: StaffSender, clinicName: string, language: "ar" | "en"): string {
  const name = sender.name || (language === "ar" ? "يا فندم" : "there");
  if (language === "ar") {
    return [
      `أهلاً ${name} 👋`,
      `ده خط الفريق في *${clinicName}*. إنت متسجل عندنا كـ${ROLE_AR[sender.role] || sender.role}، مش كمريض.`,
      "التنبيهات والتقارير اللي فعّلتها من الإعدادات ← التنبيهات والتقارير بتوصلك هنا.",
      "",
      "اكتب كلمة وأبعتلك:",
      "• *تقرير* — إقفال اليوم",
      "• *النهارده* — مواعيد اليوم",
      "• *ملخص* — اليوم في تلات سطور",
      "",
      "_الأسئلة الحرة عن أرقام العيادة جاية في الخطوة الجاية._",
    ].join("\n");
  }
  return [
    `Hello ${name} 👋`,
    `This is the team line at *${clinicName}*. You are registered as ${sender.role}, not as a patient.`,
    "The alerts and reports you switched on under Settings → Alerts & reports arrive here.",
    "",
    "Send one word and I will send it back:",
    "• *report* — the day's close-out",
    "• *today* — today's appointments",
    "• *summary* — the day in three lines",
    "",
    "_Free questions about the clinic's numbers come in the next step._",
  ].join("\n");
}

async function clinicName(clinicId: string): Promise<string> {
  try {
    const snap = await adminDb().collection("clinics").doc(clinicId).get();
    return String(snap.data()?.name || "").trim() || "Alpha Dental";
  } catch {
    return "Alpha Dental";
  }
}

export type StaffLineOutcome = { status: "replied"; text: string; handoff: false; reason: string } | { status: "skipped"; reason: string };

/**
 * Answer a staff member. Reports go through the same sender as the scheduled ones, redacted by
 * role the same way; the greeting goes out over the clinic's own gateway.
 */
export async function respondToStaffMessage(args: {
  clinicId: string;
  to: string;
  text: string;
  sender: StaffSender;
}): Promise<StaffLineOutcome> {
  const { clinicId, to, text, sender } = args;
  const intent = staffIntent(text);
  const language = staffLanguage(text);

  if (intent !== "help") {
    const eventId =
      intent === "evening" ? "eveningDigest" : intent === "summary" ? "ownerSummary" : sender.role === "Dentist" ? "morningBriefDentist" : "morningBriefClinic";
    const event = notifyEvent(eventId);
    if (event) {
      // Asked for by name, so the clinic's switch for that report does not apply — but the role
      // ceiling does: a receptionist asking for "report" gets the diary and no money.
      const result = await sendStaffReport({ clinicId, event, uids: [sender.uid], onDemand: true });
      if (result.whatsapped > 0) return { status: "replied", text: `[${eventId}]`, handoff: false, reason: `staff_${intent}` };
      const sorry =
        language === "ar"
          ? "مفيش حاجة تتقال عن النهارده لسه — مفيش مواعيد ولا تحصيل اتسجل."
          : "Nothing to report yet today — no appointments or payments recorded.";
      const sent = await sendStaffWhatsApp({ clinicId, to, text: sorry });
      return sent.sent ? { status: "replied", text: sorry, handoff: false, reason: `staff_${intent}_empty` } : { status: "skipped", reason: "staff_send_failed" };
    }
  }

  const help = staffHelpText(sender, await clinicName(clinicId), language);
  const sent = await sendStaffWhatsApp({ clinicId, to, text: help });
  return sent.sent ? { status: "replied", text: help, handoff: false, reason: "staff_help" } : { status: "skipped", reason: "staff_send_failed" };
}
