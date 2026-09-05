import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection } from "@/lib/adminClinicDb";
import { phoneMatchKey } from "@/lib/patientPhone";

/**
 * The people who asked and did not book, written where the clinic already works its leads.
 *
 * A price question on WhatsApp is the warmest lead a clinic gets, and until now it left no trace
 * anywhere a person would look: answered, closed, forgotten. This writes (or refreshes) one lead
 * per phone in `clinics/{id}/leads` — the same collection the Leads page and the funnel report
 * read — with what they asked about and a follow-up date of tomorrow, so the morning list has
 * them at the top. When the bot books them, the lead flips to "booked" by itself.
 *
 * One open lead per phone: the same person asking three questions is one lead asked three
 * things, not three leads. Admin SDK, server-side only.
 */

const OPEN_STAGES = ["new", "contacted"];

function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function e164(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

async function findOpenLead(clinicId: string, phone: string) {
  const key = phoneMatchKey(phone);
  if (key.length < 7) return null;
  const snap = await adminClinicCollection(clinicId, "leads").where("phone", "==", e164(phone)).limit(5).get();
  return snap.docs.find((d) => OPEN_STAGES.includes(String((d.data() || {}).stage || ""))) ?? null;
}

export async function upsertBotLead(args: {
  clinicId: string;
  phone: string;
  name?: string;
  /** The service they named, if any — becomes the lead's interest. */
  interest?: string;
  /** What they actually wrote, kept short, so the caller knows what to say. */
  question: string;
  reason: string;
  existingPatientId?: string;
  existingPatientName?: string;
}): Promise<void> {
  const phone = e164(args.phone);
  if (!phone || phone.length < 8) return;
  const question = args.question.trim().slice(0, 200);
  const now = new Date();
  const noteLine = `${now.toISOString().slice(0, 16).replace("T", " ")} — ${question}`;

  const open = await findOpenLead(args.clinicId, phone);
  if (open) {
    const d = open.data() || {};
    const notes = String(d.notes || "");
    await open.ref.set(
      {
        ...(args.interest && !d.interest ? { interest: args.interest } : {}),
        lastQuestion: question,
        lastQuestionReason: args.reason,
        lastQuestionAt: FieldValue.serverTimestamp(),
        questionCount: FieldValue.increment(1),
        notes: (notes ? `${notes}\n${noteLine}` : noteLine).slice(-1500),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }

  await adminClinicCollection(args.clinicId, "leads").add({
    name: args.name?.trim() || args.existingPatientName || phone,
    phone,
    interest: args.interest || "",
    source: "WhatsApp",
    stage: "new",
    branchId: null,
    branchName: null,
    lostReason: null,
    notes: `سأل عبر البوت:\n${noteLine}`,
    followUpDate: tomorrowKey(),
    patientId: null,
    createdBy: "whatsapp_bot",
    botLead: true,
    lastQuestion: question,
    lastQuestionReason: args.reason,
    lastQuestionAt: FieldValue.serverTimestamp(),
    questionCount: 1,
    existingPatientId: args.existingPatientId ?? null,
    existingPatientName: args.existingPatientName ?? null,
    duplicateOfLeadId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** The bot booked this phone: its open lead is now a booking, and needs no follow-up. */
export async function markBotLeadBooked(clinicId: string, phone: string, patientId: string): Promise<void> {
  const open = await findOpenLead(clinicId, phone).catch(() => null);
  if (!open) return;
  await open.ref.set(
    { stage: "booked", patientId, bookedVia: "whatsapp_bot", followUpDate: null, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}
