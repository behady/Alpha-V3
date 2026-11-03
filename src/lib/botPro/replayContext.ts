/**
 * The clinic's own world for a replay of test conversations: real ProArgs (facts, brief, coaching,
 * hours, address, phone, approved answers, persona) and a real ProContext (price list, doctors,
 * calendar) read from Firestore. Read-only: nothing is written.
 *
 * The publish test (api/whatsapp/pro-onboarding/publish) and scripts/pro-battery.mts both build
 * through here, so the price re-check runs against the same clinic words in both. The person and
 * the thread inside the context are placeholders; the replay replaces them per turn, and the
 * plan/credit gate (`blocked`) is dropped by the replay because it is not what is under test.
 */
import { adminDb } from "@/lib/firebaseAdmin";
import { arabicClock } from "@/lib/arabicDateTime";
import { cleanBrief } from "@/lib/bot/brief";
import { loadPublicClinicProfile } from "@/lib/publicBooking";
import { loadProContext, type ProArgs, type ProContext } from "./proContext";

const ARABIC_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export type ReplayWorld = { clinicName: string; baseArgs: ProArgs; context: ProContext };

/** null when the clinic does not exist. `chatId` only names the (empty) thread the loader looks at. */
export async function loadReplayContext(clinicId: string, opts: { chatId?: string } = {}): Promise<ReplayWorld | null> {
  const db = adminDb();
  const clinicRef = db.collection("clinics").doc(clinicId);
  const clinicDoc = await clinicRef.get();
  if (!clinicDoc.exists) return null;
  const clinicName = String(clinicDoc.data()?.name || "Alpha Dental Clinic");

  // The clinic's real prices, schedule, doctors and calendar through the production loader (reads
  // only). The profile is read once and handed over.
  const profile = await loadPublicClinicProfile(clinicId, { requireEnabled: false, loadDoctors: true }).catch(() => null);
  const shell: ProArgs = {
    clinicId,
    clinicName,
    question: "",
    history: [],
    mode: "sales",
    chatId: opts.chatId || "pro-replay",
    canBook: true,
    ...(profile ? { profile } : {}),
  };
  const context = await loadProContext(shell);

  let hoursText = "";
  if (profile?.schedule?.isConfigured) {
    const sc = profile.schedule;
    const lines = [`من ${arabicClock(sc.startHour, sc.startMinute)} إلى ${arabicClock(sc.endHour, sc.endMinute)}`];
    const off = sc.offDays.map((d: string) => ARABIC_DAYS[DAY_KEYS.indexOf(d)]).filter(Boolean);
    if (off.length) lines.push(`الإجازة: ${off.join(" و")}`);
    hoursText = lines.join("\n");
  }
  const addressText = profile?.address || "";
  const clinicPhone = profile?.phone || "";

  const wa = (await clinicRef.collection("settings").doc("whatsapp").get()).data() || {};
  const facts = (wa.botFacts && typeof wa.botFacts === "object" ? wa.botFacts : {}) as ProArgs["facts"];
  const brief = cleanBrief(wa.botBrief);
  const coaching = typeof wa.botCoaching === "string" ? wa.botCoaching : "";
  const personaName = typeof wa.botPersonaName === "string" ? wa.botPersonaName.trim() : "";
  const knowledgeSnap = await clinicRef.collection("bot_knowledge").where("status", "==", "approved").limit(40).get().catch(() => null);
  const knowledge = (knowledgeSnap?.docs ?? []).map((d) => {
    const k = d.data() || {};
    return { q: String(k.question || ""), a: String(k.answer || "") };
  });

  const baseArgs: ProArgs = { ...shell, hoursText, addressText, clinicPhone, facts, brief, coaching, personaName, knowledge };
  return { clinicName, baseArgs, context };
}
