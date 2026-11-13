/**
 * Everything the Pro brain reads from Firestore for one turn, and the two places it writes.
 *
 * answerWithPro never touches a database itself: it takes a ProContext (who is writing, the
 * thread, the price list, the plan verdict, the calendar helpers) and a ProSink (credits and the
 * ai_debug flight recorder). This file builds both for production. Tests and the battery inject
 * their own, so they never read a clinic or spend its credits.
 */
import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { logAiCreditUsage, type AiTokenUsage } from "@/lib/aiCreditLog";
import { arabicDayLabel, arabicTimeLabel } from "@/lib/arabicDateTime";
import { clinicNow, computeAvailableSlots, isClinicClosedOn, loadPublicClinicProfile, type PublicClinicProfile } from "@/lib/publicBooking";
import { getAiCreditLimit, hasFeature } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";
import type { AiArgs, AiThreadLine } from "@/lib/bot/aiTypes";
import { conversationKey } from "@/lib/bot/conversation";
import { dossierLines, loadPatientDossier } from "@/lib/bot/patientDossier";
import { loadProPerson, type ProPerson } from "./person";
import { sanitizeLayer, type ClinicLayer } from "./layer";
import { layerRef, onboardingStateRef, readState } from "./onboarding/store";
import type { ToolEnv } from "./tools";

/**
 * One credit per reply — the retired standard brain's price, so no clinic's bill changed on the day
 * it became the only brain (owner, 2026-11-07). The token log measures the real cost; the price is
 * reviewed after a month.
 */
export const PRO_CREDITS_PER_REPLY = 1;

/** How much of the thread the Pro brain reads: more than the standard brain's 16. */
export const PRO_THREAD_LINES = 40;

export type ProArgs = AiArgs & {
  chatId: string;
  phone?: string;
  conversationPatientId?: string;
  /** The conversation's pendingSlots keys from the last turn, so "الأول" can still be booked. */
  previousSlotKeys?: string[];
  /** The branch the booking would land in; the calendar is searched for it. */
  branchId?: string | null;
  /** The caller's already-loaded clinic profile (schedule, doctors). Loaded here when absent. */
  profile?: PublicClinicProfile;
  /** "draft": answer with the owner's unsaved draft layer. Only the admin test chat sets it. */
  proLayer?: "draft";
};

export interface ProContext {
  /** Set when the plan, the add-on or the credits say no: the reason the turn is unavailable. */
  blocked?: string;
  /** Today in the clinic's timezone, YYYY-MM-DD. */
  todayKey: string;
  person: ProPerson;
  /** Who is writing, read again — the re-check before a booking is returned. */
  reloadPerson(): Promise<ProPerson>;
  /** The last PRO_THREAD_LINES lines of the conversation, oldest first, every voice. */
  thread: AiThreadLine[];
  prices: Array<{ name: string; price: number }>;
  /** The price list as the prompt shows it: "name: يبدأ من 1,200 ج.م" per line. */
  priceLines: string;
  /** The clinic's real dentists; a doctor the model names must be one of these. */
  doctors: string[];
  openDays: ToolEnv["openDays"];
  freeTimes: ToolEnv["freeTimes"];
  dayLabel: ToolEnv["dayLabel"];
  patientFile: ToolEnv["patientFile"];
  /** What the owner taught Pro (the live version, or the draft in the test chat); null when nothing. */
  layer: ClinicLayer | null;
}

export interface ProSink {
  charge(credits: number, usage: AiTokenUsage): Promise<void>;
  debug(row: Record<string, unknown>): Promise<void>;
}

/** The words a slot is offered in: absolute day name and date, never "tomorrow". */
export function slotLabel(dateKey: string, time: string, doctor: string): string {
  return `${arabicDayLabel(dateKey)} الساعة ${arabicTimeLabel(time)}${doctor ? ` مع ${doctor}` : ""}`;
}

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function gateOf(clinicId: string): Promise<string | undefined> {
  const db = adminDb();
  const snap = await db.collection("clinics").doc(clinicId).get();
  if (!snap.exists) return "no_clinic";
  const clinic = { id: snap.id, ...snap.data() } as Clinic;
  if (!hasFeature(clinic, "aiChat")) return "plan";
  const monthKey = new Date().toISOString().slice(0, 7);
  const usage = await db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey).get();
  const used = usage.exists ? Number(usage.data()?.creditsUsed) || 0 : 0;
  const limit = getAiCreditLimit(clinic);
  if (limit > 0 && used + PRO_CREDITS_PER_REPLY > limit) return "no_credits";
  return undefined;
}

async function priceList(clinicId: string): Promise<Array<{ name: string; price: number }>> {
  try {
    const snap = await adminClinicCollection(clinicId, "services").limit(200).get();
    return snap.docs
      .map((d) => {
        const s = (d.data() || {}) as Record<string, unknown>;
        return { name: String(s.name || "").trim(), price: Number(s.price) || 0 };
      })
      .filter((p) => p.name && p.price > 0)
      .slice(0, 80);
  } catch {
    // No list means the model must refuse price questions; get_price finds nothing.
    return [];
  }
}

/** The price list's service names only (the same read as the price list itself), for the owner chat. */
export async function priceNames(clinicId: string): Promise<string[]> {
  return (await priceList(clinicId)).map((p) => p.name);
}

async function threadOf(clinicId: string, chatId: string): Promise<AiThreadLine[]> {
  const snap = await adminClinicDoc(clinicId, "whatsapp_conversations", conversationKey(chatId))
    .collection("messages")
    .orderBy("at", "desc")
    .limit(PRO_THREAD_LINES)
    .get()
    .catch(() => null);
  return (snap?.docs ?? [])
    .map((d) => d.data() || {})
    .reverse()
    .map((m) => ({ author: (m.author as AiThreadLine["author"]) || "bot", text: String(m.text || "") }))
    .filter((l) => l.text.trim() && !l.text.startsWith("["));
}

/** Where the layer is read from; the production reader is below, tests inject their own. */
export interface LayerReader {
  state(): Promise<unknown>;
  version(id: string): Promise<unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The layer for one turn: the live version's, or the draft's. Any failure, a missing doc or
 * nothing live gives null, and a null layer leaves the reply exactly as it was without one.
 */
export async function loadClinicLayerWith(read: LayerReader, which: "live" | "draft"): Promise<ClinicLayer | null> {
  try {
    const raw = await read.state();
    if (!isObj(raw)) return null;
    const state = readState(raw);
    if (which === "draft") return state.draft;
    if (!state.liveVersion) return null;
    const version = await read.version(state.liveVersion);
    if (!isObj(version) || !isObj(version.layer)) return null;
    return sanitizeLayer(version.layer).layer;
  } catch {
    return null;
  }
}

export function loadClinicLayer(clinicId: string, which: "live" | "draft"): Promise<ClinicLayer | null> {
  return loadClinicLayerWith(
    {
      state: async () => (await onboardingStateRef(clinicId).get()).data(),
      version: async (id) => (await layerRef(clinicId, id).get()).data(),
    },
    which
  );
}

export async function loadProContext(args: ProArgs): Promise<ProContext> {
  const { clinicId } = args;
  const todayKey = clinicNow().dateKey;
  const loadPerson = () =>
    loadProPerson({ clinicId, chatId: args.chatId, phone: args.phone, conversationPatientId: args.conversationPatientId, todayKey });

  const [blocked, person, thread, prices, profile, layer] = await Promise.all([
    gateOf(clinicId),
    loadPerson(),
    threadOf(clinicId, args.chatId),
    priceList(clinicId),
    args.profile ? Promise.resolve(args.profile) : loadPublicClinicProfile(clinicId, { requireEnabled: false, loadDoctors: true }).catch(() => null),
    loadClinicLayer(clinicId, args.proLayer === "draft" ? "draft" : "live"),
  ]);
  const schedule = profile?.schedule;
  const branchId = args.branchId ?? null;

  return {
    ...(blocked ? { blocked } : {}),
    todayKey,
    person,
    reloadPerson: loadPerson,
    thread,
    prices,
    priceLines: prices.map((p) => `${p.name}: يبدأ من ${p.price.toLocaleString("en-US")} ج.م`).join("\n"),
    doctors: profile?.doctors ?? [],
    // A clinic that never set its hours parses as open every day 9-9; offer nothing rather than that.
    openDays: (from, to) => {
      if (!schedule?.isConfigured) return [];
      const out: string[] = [];
      for (let d = from; d <= to && out.length < 31; d = addDays(d, 1)) if (!isClinicClosedOn(d, schedule)) out.push(d);
      return out;
    },
    freeTimes: (dateKey, doctor) =>
      profile
        ? computeAvailableSlots({ clinicId, dateKey, doctorName: doctor || null, branchId, profile, ignoreAppointmentId: null })
        : Promise.resolve([]),
    dayLabel: slotLabel,
    patientFile: async (id) => {
      const file = await loadPatientDossier(clinicId, id);
      // The owner's "don't mention dentists' names" switch: the usual dentist stays out of the file.
      return dossierLines(args.hideDoctorNames === true && file ? { ...file, usualDoctor: undefined } : file);
    },
    layer,
  };
}

/** Firestore rejects undefined; the flight recorder drops it rather than losing the row. */
function defined(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
}

export function firestoreProSink(clinicId: string, question: string): ProSink {
  return {
    async charge(credits, usage) {
      const monthKey = new Date().toISOString().slice(0, 7);
      await adminDb()
        .collection("clinics")
        .doc(clinicId)
        .collection("ai_usage")
        .doc(monthKey)
        .set({ monthKey, creditsUsed: FieldValue.increment(credits), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await logAiCreditUsage({
        clinicId,
        feature: "whatsapp_pro",
        credits,
        userId: "whatsapp_bot",
        userName: "WhatsApp Bot",
        detail: question.slice(0, 120),
        usage,
      }).catch(() => {});
    },
    async debug(row) {
      await adminClinicCollection(clinicId, "ai_debug")
        .doc(new Date().toISOString().replace(/[:.]/g, "-") + "-pro")
        .set({ ...defined(row), createdAt: FieldValue.serverTimestamp() })
        .catch(() => {});
    },
  };
}
