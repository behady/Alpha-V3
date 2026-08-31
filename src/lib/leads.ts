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

  // --- Intake findings, stamped once when the lead is written (see findLeadMatches) ---
  /** This phone already belongs to a patient file. The clinic knows this person. */
  existingPatientId?: string | null;
  existingPatientName?: string | null;
  /** An earlier lead carries the same phone — the same person asking twice. */
  duplicateOfLeadId?: string | null;

  /**
   * True when converting linked to a patient who already existed. Marketing reports count
   * their money separately: a channel may claim the patients it brought, not the treatment
   * an old patient was going to have anyway.
   */
  isReturningPatient?: boolean;

  /**
   * The instant WhatsApp reply, if the clinic switched it on: whether it went out by itself
   * or is waiting in the send queue for a person. Its presence is also the guard that stops
   * anybody being greeted twice.
   */
  welcomeMessage?: {
    status: "sent" | "queued";
    mode: "auto" | "manual";
    text?: string;
    error?: string;
  } | null;

  /**
   * Stamped by the Meta webhook: which page, form, ad and campaign this lead arrived through.
   * `adName`/`campaignName` stay null unless the connected token carries an ads permission —
   * Meta simply omits those fields otherwise, rather than erroring.
   */
  meta?: {
    leadgenId?: string;
    pageId?: string;
    pageName?: string | null;
    formId?: string;
    adName?: string | null;
    campaignName?: string | null;
    createdTime?: string | null;
    fetchFailed?: boolean;
  } | null;

  /** First moment this lead stopped being untouched — the clock behind time-to-contact. */
  firstContactedAt?: { seconds: number } | null;
  /** Last stage movement, so a lead nobody has touched in a month can say so. */
  stageChangedAt?: { seconds: number } | null;
}

/** A lead with no movement for this long is stale — visible as such rather than "in progress". */
export const STALE_AFTER_DAYS = 30;

export function isLeadStale(lead: Lead, nowSeconds = Date.now() / 1000): boolean {
  if (lead.stage === "won" || lead.stage === "lost") return false;
  const last = lead.stageChangedAt?.seconds || lead.updatedAt?.seconds || lead.createdAt?.seconds || 0;
  if (!last) return false;
  return nowSeconds - last > STALE_AFTER_DAYS * 24 * 60 * 60;
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
      return { pill: "bg-surface-muted text-ink-body", dot: "bg-slate-400" };
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
 * Looks up what the clinic already knows about this phone, at the moment a lead arrives.
 *
 * Two different facts, deliberately kept apart: an existing *patient* means the clinic has
 * treated this person before (so their money is not new business a channel can claim), while
 * an earlier *lead* means the same enquiry arrived twice (so reception should not work it
 * twice, and the funnel should not count two people where there is one).
 *
 * Both are stamped once at intake rather than computed on every render — the answer is about
 * the moment the lead arrived, and recomputing it later would quietly rewrite history.
 */
export async function findLeadMatches(
  phone: string,
  ignoreLeadId?: string
): Promise<{ existingPatientId: string | null; existingPatientName: string | null; duplicateOfLeadId: string | null }> {
  const clean = (phone || "").trim();
  const empty = { existingPatientId: null, existingPatientName: null, duplicateOfLeadId: null };
  if (!clean) return empty;

  try {
    const [patientSnap, leadSnap] = await Promise.all([
      getDocs(query(getClinicCollection("patients"), where("phone", "==", clean), limit(1))),
      getDocs(query(getClinicCollection("leads"), where("phone", "==", clean), limit(2))),
    ]);

    const patient = patientSnap.empty ? null : patientSnap.docs[0];
    const earlier = leadSnap.docs.find((d) => d.id !== ignoreLeadId) || null;

    return {
      existingPatientId: patient ? patient.id : null,
      existingPatientName: patient ? String(patient.data().name || "") : null,
      duplicateOfLeadId: earlier ? earlier.id : null,
    };
  } catch (e) {
    // Never block an arriving lead over a lookup: a lead written without its badges is a
    // small loss, a lead not written at all is the failure this whole system exists to avoid.
    console.warn("findLeadMatches failed:", e);
    return empty;
  }
}

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
    // See bookingService: balance is derived from the ledger, never stored on the patient.
    createdAt: serverTimestamp(),
    searchableName: lead.name.toLowerCase(),
    searchablePhone: phone.replace(/\D/g, ""),
    teethData: {},
  });

  return { patientId: pRef.id, existed: false };
}
