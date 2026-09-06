import { adminClinicCollection } from "@/lib/adminClinicDb";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

/**
 * What the clinic already knows about the person who just wrote, gathered for the assistant.
 *
 * A receptionist answering the phone has the file open: what was done, what it cost, what is
 * still owed, what the dentist prescribed, who usually treats them. Without any of that the
 * assistant could only ever talk about prices and free slots, so "كام باقي عليا؟" and "الدكتور
 * كتبلي إيه؟" — two of the commonest questions a desk gets — always cost a staff interruption.
 *
 * Everything here is the patient's OWN record, read only, and only for a number the clinic has
 * already identified. Nothing is inferred and nothing is calculated twice: the balance is the
 * same arithmetic every screen in the app uses (procedure charges minus payments received), so
 * the number the patient is told is the number the desk sees.
 */

export interface PatientDossier {
  /** Money, in EGP. Absent when the clinic has never charged them anything. */
  finance?: {
    charged: number;
    paid: number;
    balance: number;
    lastPayment?: { date: string; amount: number; method: string };
  };
  /** What has actually been done, most recent first. */
  treatments: Array<{ name: string; date: string; doctor?: string; cost?: number }>;
  /** What the dentist prescribed, most recent first, exactly as written. */
  prescriptions: Array<{ date: string; items: string[]; notes?: string }>;
  /** The dentist they have seen most — the one to offer first when they book again. */
  usualDoctor?: string;
  /** Completed visits, so a first-timer is not spoken to like a regular. */
  visits: number;
  /** Their last completed visit, YYYY-MM-DD. */
  lastVisit?: string;
}

const MONEY_TYPES = new Set(["payment", "procedure"]);

export async function loadPatientDossier(clinicId: string, patientId: string): Promise<PatientDossier> {
  const empty: PatientDossier = { treatments: [], prescriptions: [], visits: 0 };
  if (!patientId) return empty;

  const [ledgerSnap, rxSnap, apptSnap] = await Promise.all([
    adminClinicCollection(clinicId, "ledger").where("patientId", "==", patientId).limit(200).get().catch(() => null),
    adminClinicCollection(clinicId, "prescriptions").where("patientId", "==", patientId).limit(20).get().catch(() => null),
    adminClinicCollection(clinicId, "appointments").where("patientId", "==", patientId).limit(100).get().catch(() => null),
  ]);

  // --- money ---------------------------------------------------------------------------------
  let charged = 0;
  let paid = 0;
  let lastPayment: { date: string; amount: number; method: string } | undefined;
  const treatments: PatientDossier["treatments"] = [];
  for (const d of ledgerSnap?.docs ?? []) {
    const r = (d.data() || {}) as Record<string, unknown>;
    const type = String(r.type || "");
    if (!MONEY_TYPES.has(type)) continue;
    const date = String(r.date || "");
    if (type === "procedure") {
      const cost = Number(r.cost) || 0;
      charged += cost;
      const name = String(r.labOrderService || r.description || r.category || "").trim();
      if (name) treatments.push({ name: name.slice(0, 60), date, doctor: String(r.doctorName || "") || undefined, cost: cost || undefined });
    } else {
      const amount = Number(r.paid) || 0;
      paid += amount;
      if (amount > 0 && (!lastPayment || date > lastPayment.date)) {
        lastPayment = { date, amount, method: String(r.method || "").trim() || "Cash" };
      }
    }
  }
  treatments.sort((a, b) => b.date.localeCompare(a.date));

  // --- what the dentist prescribed -----------------------------------------------------------
  const prescriptions: PatientDossier["prescriptions"] = [];
  for (const d of rxSnap?.docs ?? []) {
    const r = (d.data() || {}) as Record<string, unknown>;
    const rawItems = Array.isArray(r.items) ? r.items : Array.isArray(r.medications) ? r.medications : [];
    const items = rawItems
      .map((it) => {
        if (typeof it === "string") return it.trim();
        const o = (it || {}) as Record<string, unknown>;
        // The name plus whatever instruction the dentist actually wrote — never anything else.
        return [o.name || o.drug || o.tradeName, o.dose, o.frequency, o.duration, o.instructions]
          .map((v) => String(v || "").trim())
          .filter(Boolean)
          .join(" — ");
      })
      .filter(Boolean)
      .slice(0, 8) as string[];
    if (!items.length) continue;
    const date = String(r.date || "") || (r.createdAt && typeof (r.createdAt as { toDate?: () => Date }).toDate === "function"
      ? (r.createdAt as { toDate: () => Date }).toDate().toISOString().slice(0, 10)
      : "");
    prescriptions.push({ date, items, notes: String(r.notes || "").trim().slice(0, 200) || undefined });
  }
  prescriptions.sort((a, b) => b.date.localeCompare(a.date));

  // --- who usually treats them, and how often they come --------------------------------------
  const seen = new Map<string, number>();
  let visits = 0;
  let lastVisit = "";
  for (const d of apptSnap?.docs ?? []) {
    const a = (d.data() || {}) as Record<string, unknown>;
    if (normalizeAppointmentStatus(String(a.status || "")) !== "Completed") continue;
    visits += 1;
    const date = String(a.date || "");
    if (date > lastVisit) lastVisit = date;
    const doc = String(a.doctor || "").trim();
    if (doc && doc.toLowerCase() !== "any") seen.set(doc, (seen.get(doc) || 0) + 1);
  }
  const usualDoctor = [...seen.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    ...(charged || paid
      ? { finance: { charged, paid, balance: Math.max(0, charged - paid), ...(lastPayment ? { lastPayment } : {}) } }
      : {}),
    treatments: treatments.slice(0, 8),
    prescriptions: prescriptions.slice(0, 3),
    ...(usualDoctor ? { usualDoctor } : {}),
    visits,
    ...(lastVisit ? { lastVisit } : {}),
  };
}

/** The dossier as prompt lines. Empty when the clinic knows nothing worth saying. */
export function dossierLines(d: PatientDossier | undefined): string {
  if (!d) return "";
  const out: string[] = [];
  if (d.visits) out.push(`- زار العيادة ${d.visits} مرة${d.lastVisit ? `، آخر زيارة ${d.lastVisit}` : ""}.`);
  if (d.usualDoctor) out.push(`- بيتعالج عادةً عند ${d.usualDoctor} — اعرضه عليه الأول لما يحجز.`);
  if (d.treatments.length) {
    out.push(`- آخر علاجات اتعملتله: ${d.treatments.slice(0, 5).map((t) => `${t.name}${t.date ? ` (${t.date})` : ""}`).join("، ")}.`);
  }
  if (d.finance) {
    const f = d.finance;
    out.push(
      `- الحساب: إجمالي العلاج ${f.charged.toLocaleString("en-US")} ج.م، مدفوع ${f.paid.toLocaleString("en-US")} ج.م، المتبقي ${f.balance.toLocaleString("en-US")} ج.م.` +
        (f.lastPayment ? ` آخر دفعة ${f.lastPayment.amount.toLocaleString("en-US")} ج.م يوم ${f.lastPayment.date}.` : "")
    );
  }
  if (d.prescriptions.length) {
    const rx = d.prescriptions[0];
    out.push(`- آخر روشتة كتبها الدكتور${rx.date ? ` يوم ${rx.date}` : ""}: ${rx.items.join(" | ")}${rx.notes ? ` — ملاحظات: ${rx.notes}` : ""}.`);
  }
  return out.length ? `\nملف المريض ده عندنا (بيانات حقيقية من النظام — اتكلم منها، ومتخترعش حاجة مش مكتوبة):\n${out.join("\n")}` : "";
}
