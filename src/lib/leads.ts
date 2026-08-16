/**
 * Leads — people who contacted the clinic but are not patients yet.
 *
 * The CRM's front half. A lead moves New → Contacted → Booked → Won (became a patient) or Lost
 * (with a reason), and always carries the channel it came from, which is what makes per-channel
 * marketing reporting possible. Stored per clinic in `clinics/{id}/leads`.
 */

import { runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getClinicCollection, getClinicDoc } from "@/lib/db-utils";
import { addDoc, getDocs, query, where, limit } from "firebase/firestore";

export const LEAD_STAGES = ["new", "contacted", "booked", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export interface Lead {
  id: string;
  name: string;
  phone: string;
  /** What they asked about — a service name or free text. */
  interest?: string;
  source: string;
  branchId?: string | null;
  branchName?: string | null;
  stage: LeadStage;
  lostReason?: string | null;
  notes?: string;
  /** YYYY-MM-DD; leads due today or overdue float to the top of the inbox. */
  followUpDate?: string | null;
  /** Set once converted — the proof a lead became revenue. */
  patientId?: string | null;
  createdBy?: string;
  createdAt?: { seconds: number } | null;
  updatedAt?: { seconds: number } | null;
}

export function leadStageLabel(stage: string, language: "en" | "ar"): string {
  const map: Record<string, { en: string; ar: string }> = {
    new: { en: "New", ar: "جديد" },
    contacted: { en: "Contacted", ar: "تم التواصل" },
    booked: { en: "Booked", ar: "محجوز" },
    won: { en: "In the chair", ar: "أصبح مريض" },
    lost: { en: "Lost", ar: "مفقود" },
  };
  const row = map[stage] || map.new;
  return language === "ar" ? row.ar : row.en;
}

/** Pill classes per stage — matches the app's status-pill idiom. */
export function leadStageStyles(stage: string): { pill: string; dot: string } {
  switch (stage) {
    case "new":
      return { pill: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500" };
    case "contacted":
      return { pill: "bg-sky-100 text-sky-700", dot: "bg-sky-500" };
    case "booked":
      return { pill: "bg-amber-100 text-amber-700", dot: "bg-amber-500" };
    case "won":
      return { pill: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" };
    case "lost":
      return { pill: "bg-rose-100 text-rose-600", dot: "bg-rose-400" };
    default:
      return { pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" };
  }
}

/** Sources every clinic starts with; merged with the clinic's own Patient Sources list. */
export const DEFAULT_LEAD_SOURCES = [
  "Walk-in",
  "Phone call",
  "WhatsApp",
  "Meta ads",
  "Google",
  "Instagram",
  "TikTok",
  "Friend referral",
];

/**
 * Finds an existing patient with this exact phone, or creates one carrying the lead's source.
 *
 * Phones are stored in E.164 across the system (see the demo-clinic seeding notes) — the caller
 * must pass the normalized form, or the duplicate check will miss and a twin record appears.
 * Patient creation mirrors bookingService's new-patient flow, including the fileId counter.
 */
export async function findOrCreatePatientForLead(lead: {
  name: string;
  phone: string;
  source: string;
}): Promise<{ patientId: string; existed: boolean }> {
  const phone = lead.phone.trim();

  const dup = await getDocs(query(getClinicCollection("patients"), where("phone", "==", phone), limit(1)));
  if (!dup.empty) return { patientId: dup.docs[0].id, existed: true };

  const counterRef = getClinicDoc("settings", "counters");
  const newIdNumber = await runTransaction(db, async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    let nextId = 1000;
    if (counterDoc.exists() && counterDoc.data().patientId) {
      nextId = counterDoc.data().patientId + 1;
      transaction.update(counterRef, { patientId: nextId });
    } else {
      transaction.set(counterRef, { patientId: nextId }, { merge: true });
    }
    return nextId;
  });

  const pRef = await addDoc(getClinicCollection("patients"), {
    fileId: `PT-${newIdNumber}`,
    name: lead.name,
    phone,
    address: "",
    dateOfBirth: "",
    gender: "Male",
    referral: lead.source,
    source: lead.source,
    medicalHistory: "",
    status: "New",
    balance: 0,
    totalSpent: 0,
    createdAt: serverTimestamp(),
    searchableName: lead.name.toLowerCase(),
    searchablePhone: phone.replace(/\D/g, ""),
    teethData: {},
  });

  return { patientId: pRef.id, existed: false };
}
