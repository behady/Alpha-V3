import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { conversationKey } from "@/lib/bot/conversation";
import { isWhatsAppBlocked, WHATSAPP_OPT_OUT_FOOTER_AR, WHATSAPP_OPT_OUT_FOOTER_BILINGUAL } from "@/lib/patientMessaging";
import { pickPatientPhone } from "@/lib/patientPhone";
import { normalizeToE164AssumingCountry } from "@/lib/phoneNumber";
import { deliverWhatsAppMessage, resolveWhatsappDeliveryMode } from "@/lib/whatsappDelivery";
import { loadMetaWhatsappConfig } from "@/lib/metaWhatsapp";
import { getClinicProfileAdmin } from "@/lib/clinicProfileServer";
import {
  gatewayConfigured,
  gatewayInstanceIdForClinic,
  gatewayInstanceStatus,
  isAlphaGatewayCredentials,
  type GatewayInstanceStatus,
} from "@/lib/waGateway";
import { CLINIC_SECRETS_COLLECTION, WAPILOT_SECRET_FIELD } from "@/types/wapilot";
import {
  BROADCAST_MAX_DAILY,
  BROADCAST_MIN_DAILY,
  BROADCAST_WINDOW,
  broadcastShareOfAllowance,
  checkBroadcastMessage,
  hasBlockingIssue,
  mergeBroadcast,
  missingClinicName,
  perTickRelease,
  versionFor,
  type BroadcastRecipientRow,
  type BroadcastStatus,
  type BroadcastSummary,
} from "@/lib/broadcast/shared";

/**
 * The server half of patient broadcasts: who is on the list, and the slow release.
 *
 * Stored at the top level (`patient_broadcasts/{id}`, recipients beneath it) rather than under the
 * clinic, because the clinic subtree is writable by members under the general rule, and a
 * broadcast's status field is what makes the server send. Top-level collections without a rule
 * are closed to every browser; the page reads and changes broadcasts only through the API.
 */

export const BROADCASTS = "patient_broadcasts";
const RECIPIENTS = "recipients";
const TICK_MINUTES = 10;
/** Messages the gateway may still be holding before this tick adds more. */
const GATEWAY_BACKLOG_LIMIT = 5;
const TZ = "Africa/Cairo";

const pad = (i: number) => String(i).padStart(6, "0");

/* ------------------------------------------------------------------------------------------ */
/* The number                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export type BroadcastLine = {
  /** Connected through Alpha's own gateway — the only channel broadcasts go out on. */
  onGateway: boolean;
  /** The official Meta channel is connected; free text to people who did not write is dropped there. */
  officialChannel: boolean;
  state: GatewayInstanceStatus["state"] | "none";
  phone: string | null;
  daysLinked: number | null;
  dailyCap: number | null;
  sentToday: number | null;
  queued: number | null;
  /** True when automatic sending is switched on for this clinic (add-on + not set to manual). */
  autoSending: boolean;
};

export async function broadcastLine(clinicId: string): Promise<BroadcastLine> {
  const line: BroadcastLine = {
    onGateway: false,
    officialChannel: false,
    state: "none",
    phone: null,
    daysLinked: null,
    dailyCap: null,
    sentToday: null,
    queued: null,
    autoSending: false,
  };
  try {
    line.officialChannel = Boolean(await loadMetaWhatsappConfig(clinicId));
  } catch {
    /* treated as not connected */
  }
  line.autoSending = (await resolveWhatsappDeliveryMode(clinicId).catch(() => "manual")) === "auto";
  if (!gatewayConfigured()) return line;

  const secrets = await adminDb().collection(CLINIC_SECRETS_COLLECTION).doc(clinicId).get();
  const stored = secrets.exists ? (secrets.data()?.[WAPILOT_SECRET_FIELD] as Record<string, unknown> | undefined) : undefined;
  line.onGateway = isAlphaGatewayCredentials(stored);
  if (!line.onGateway) return line;

  const status = await gatewayInstanceStatus(gatewayInstanceIdForClinic(clinicId)).catch(() => null);
  if (!status) return line;
  line.state = status.state;
  line.phone = status.phone;
  line.daysLinked = status.connectedAt ? Math.max(0, Math.floor((Date.now() - status.connectedAt) / 86_400_000)) : null;
  line.dailyCap = status.sending?.dailyCap ?? null;
  line.sentToday = status.sending?.sentToday ?? null;
  line.queued = status.sending ? status.sending.queued + status.sending.waiting : null;
  return line;
}

/** Why this clinic cannot start a broadcast right now, or null. Bilingual, for the screen. */
export function lineProblem(line: BroadcastLine): { en: string; ar: string } | null {
  if (line.officialChannel) {
    return {
      en: "This clinic sends through the official WhatsApp channel, where a message to someone who has not written first must be a template Meta approved. Broadcasts go out through the clinic's own linked number only.",
      ar: "العيادة دي بتبعت من القناة الرسمية لواتساب، وهناك أي رسالة لحد مكتبلكش الأول لازم تكون قالب موافق عليه من ميتا. الرسائل الجماعية بتطلع من رقم العيادة المربوط بس.",
    };
  }
  if (!line.onGateway) {
    return {
      en: "Link the clinic's WhatsApp number first: WhatsApp → Settings → Connect by QR.",
      ar: "اربط رقم واتساب العيادة الأول: واتساب ← الإعدادات ← الربط بالـ QR.",
    };
  }
  if (line.state === "restricted") {
    return {
      en: "WhatsApp restricted this number and the system stopped every send to protect it. Do not resume until the phone shows no warning.",
      ar: "واتساب قيّد الرقم ده والسيستم وقّف كل الإرسال علشان يحميه. متكملش غير لما الموبايل ميبقاش فيه أي تحذير.",
    };
  }
  if (line.state !== "open") {
    return {
      en: "The clinic's number is not connected right now. Open WhatsApp → Settings and scan the QR again.",
      ar: "رقم العيادة مش متصل دلوقتي. افتح واتساب ← الإعدادات وامسح الـ QR تاني.",
    };
  }
  if (!line.autoSending) {
    return {
      en: "Automatic sending is off for this clinic (WhatsApp → Settings, or the WhatsApp messages add-on).",
      ar: "الإرسال التلقائي مقفول للعيادة دي (واتساب ← الإعدادات، أو إضافة رسائل واتساب).",
    };
  }
  return null;
}

/* ------------------------------------------------------------------------------------------ */
/* The list                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export type AudienceRecipient = { patientId: string; name: string; phone: string };

export type Audience = {
  recipients: AudienceRecipient[];
  totalPatients: number;
  excludedOptedOut: number;
  /** A second patient on a number already on the list — a mother and her children. */
  excludedDuplicates: number;
  /** No number, or a number that cannot be a mobile (landlines have no WhatsApp). */
  excludedNoPhone: number;
};

/** Egyptian landlines start 20 + area code (2, 3, 4…); mobiles 20 1x. Elsewhere, trust the number. */
function looksLikeMobile(digits: string): boolean {
  if (digits.length < 9 || digits.length > 15) return false;
  if (digits.startsWith("20")) return /^201[0125]\d{8}$/.test(digits);
  return true;
}

/** Only the fields the list is built from: a patient record can carry a whole chart. */
const AUDIENCE_FIELDS = [
  "name",
  "fullName",
  "createdAt",
  "whatsappOptOut",
  "deleted",
  "isDeleted",
  "phone",
  "phoneNumber",
  "phoneE164",
  "patientPhone",
  "mobile",
  "whatsapp",
  "whatsApp",
  "contactNumber",
  "telephone",
  "primaryPhone",
];

/** The international digits a patient record is reached on, or "" when it is not a mobile. */
function recordDigits(data: Record<string, unknown>): { raw: string; digits: string } {
  const raw = pickPatientPhone(data);
  // Numbers typed or imported without the country code ("010…") are read as Egyptian.
  const digits = raw ? normalizeToE164AssumingCountry(raw).replace(/\D/g, "") : "";
  return { raw, digits: digits && looksLikeMobile(digits) ? digits : "" };
}

/**
 * Every patient who may be messaged, once per number.
 *
 * A stop is a property of the NUMBER, not of one record: a mother who asked to be left alone must
 * not be reached through her child's record on the same phone. So the stop lists are gathered
 * first, across every record, and only then is anyone added.
 *
 * Read in bulk rather than per patient, because twelve hundred patients × three point reads is
 * the slowest way to answer one question. The tick re-reads each patient's record just before
 * sending, and the delivery chokepoint checks the stop lists again, so a stop that arrives after
 * launch is honoured too.
 */
export async function buildAudience(clinicId: string): Promise<Audience> {
  const [patientsSnap, optOutSnap, convoSnap] = await Promise.all([
    adminClinicCollection(clinicId, "patients").select(...AUDIENCE_FIELDS).get(),
    adminClinicCollection(clinicId, "messaging_opt_outs").select().get(),
    adminClinicCollection(clinicId, "whatsapp_conversations").where("optedOut", "==", true).select().get(),
  ]);
  const stoppedDigits = new Set(optOutSnap.docs.map((d) => d.id));
  const stoppedConvos = new Set(convoSnap.docs.map((d) => d.id));

  // Oldest record first, so the adult who registered the family keeps the number, not the child.
  const millis = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
    const v = d.get("createdAt") as { toMillis?: () => number } | string | number | undefined;
    if (v && typeof v === "object" && typeof v.toMillis === "function") return v.toMillis();
    const n = typeof v === "number" ? v : Date.parse(String(v || ""));
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };
  const rows = [...patientsSnap.docs]
    .sort((a, b) => millis(a) - millis(b))
    .map((doc) => {
      const data = (doc.data() || {}) as Record<string, unknown>;
      return { doc, data, ...recordDigits(data) };
    })
    .filter((r) => r.data.deleted !== true && r.data.isDeleted !== true);

  // Pass 1: every number someone asked to stop, through any record or channel.
  for (const r of rows) {
    if (!r.digits) continue;
    if (isWhatsAppBlocked(r.data as { whatsappOptOut?: boolean }) || stoppedConvos.has(conversationKey(r.raw))) {
      stoppedDigits.add(r.digits);
    }
  }

  // Pass 2: everyone else, once per number.
  const seen = new Set<string>();
  const recipients: AudienceRecipient[] = [];
  let excludedOptedOut = 0;
  let excludedDuplicates = 0;
  let excludedNoPhone = 0;
  for (const r of rows) {
    if (!r.digits) {
      excludedNoPhone += 1;
      continue;
    }
    if (stoppedDigits.has(r.digits)) {
      excludedOptedOut += 1;
      continue;
    }
    if (seen.has(r.digits)) {
      excludedDuplicates += 1;
      continue;
    }
    seen.add(r.digits);
    recipients.push({ patientId: r.doc.id, name: String(r.data.name || r.data.fullName || "").trim(), phone: `+${r.digits}` });
  }

  return { recipients, totalPatients: rows.length, excludedOptedOut, excludedDuplicates, excludedNoPhone };
}

/* ------------------------------------------------------------------------------------------ */
/* What every message is merged with                                                            */
/* ------------------------------------------------------------------------------------------ */

/** The clinic name {{clinic_name}} becomes, and the stop line every broadcast ends with. */
export async function broadcastContext(clinicId: string): Promise<{ clinicName: string; footer: string }> {
  const [profile, settings] = await Promise.all([
    getClinicProfileAdmin(clinicId).catch(() => null),
    adminClinicDoc(clinicId, "settings", "whatsapp").get().catch(() => null),
  ]);
  const arabicOnly = settings?.exists ? settings.data()?.templatePack === "arabic" : false;
  return {
    clinicName: profile?.clinicName?.trim() || "",
    footer: arabicOnly ? WHATSAPP_OPT_OUT_FOOTER_AR : WHATSAPP_OPT_OUT_FOOTER_BILINGUAL,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Creating and steering                                                                        */
/* ------------------------------------------------------------------------------------------ */

const ms = (v: unknown): number | null => {
  if (!v) return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null && "toMillis" in v) return (v as { toMillis: () => number }).toMillis();
  return null;
};

export function summarize(id: string, d: FirebaseFirestore.DocumentData): BroadcastSummary {
  return {
    id,
    name: String(d.name || ""),
    versions: Array.isArray(d.versions) ? d.versions.map(String) : [],
    status: (d.status || "paused") as BroadcastStatus,
    pausedReason: d.pausedReason || null,
    dailyLimit: Number(d.dailyLimit) || 0,
    total: Number(d.total) || 0,
    sent: Number(d.sent) || 0,
    skipped: Number(d.skipped) || 0,
    failed: Number(d.failed) || 0,
    excludedOptedOut: Number(d.excludedOptedOut) || 0,
    excludedDuplicates: Number(d.excludedDuplicates) || 0,
    excludedNoPhone: Number(d.excludedNoPhone) || 0,
    createdAt: ms(d.createdAt) || Number(d.createdAtMs) || 0,
    createdByName: d.createdByName || null,
    lastSentAt: ms(d.lastSentAt),
    finishedAt: ms(d.finishedAt),
  };
}

export async function listBroadcasts(clinicId: string): Promise<BroadcastSummary[]> {
  const snap = await adminDb().collection(BROADCASTS).where("clinicId", "==", clinicId).get();
  return snap.docs.map((d) => summarize(d.id, d.data())).sort((a, b) => b.createdAt - a.createdAt);
}

export class BroadcastError extends Error {
  constructor(public en: string, public ar: string, public status = 400) {
    super(en);
  }
}

export function cleanVersions(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((v) => (typeof v === "string" ? v.trim().slice(0, 1500) : ""))
    .filter(Boolean)
    .slice(0, 3);
}

/** A launch that died while writing its rows stops blocking new ones after this long. */
const BUILDING_STALE_MS = 15 * 60_000;

function isLive(d: FirebaseFirestore.DocumentData): boolean {
  if (d.status === "running" || d.status === "paused") return true;
  return d.status === "building" && Date.now() - (Number(d.createdAtMs) || 0) < BUILDING_STALE_MS;
}

export async function createBroadcast(args: {
  clinicId: string;
  uid: string;
  userName: string | null;
  name: string;
  versions: string[];
  dailyLimit: number;
}): Promise<BroadcastSummary> {
  const { clinicId, uid, userName } = args;
  const name = args.name.trim().slice(0, 120);
  const versions = cleanVersions(args.versions);
  if (!name) throw new BroadcastError("Give the broadcast a name.", "اكتب اسم للرسالة الجماعية.");
  if (!versions.length) throw new BroadcastError("Write the message first.", "اكتب الرسالة الأول.");
  for (const [i, v] of versions.entries()) {
    const block = checkBroadcastMessage(v).find((c) => c.level === "block");
    if (block) throw new BroadcastError(`Version ${i + 1}: ${block.en}`, `النسخة ${i + 1}: ${block.ar}`);
  }
  const dailyLimit = Math.max(BROADCAST_MIN_DAILY, Math.min(BROADCAST_MAX_DAILY, Math.floor(Number(args.dailyLimit) || 0)));

  const { clinicName } = await broadcastContext(clinicId);
  if (missingClinicName(versions, clinicName)) {
    throw new BroadcastError(
      "The message uses the clinic name, but the clinic profile has none. Write the name into the message, or fill it in Settings → Clinic profile.",
      "الرسالة فيها اسم العيادة، بس ملف العيادة مفيهوش اسم. اكتب الاسم في الرسالة بنفسك، أو املاه من الإعدادات ← بيانات العيادة."
    );
  }

  const line = await broadcastLine(clinicId);
  const problem = lineProblem(line);
  if (problem) throw new BroadcastError(problem.en, problem.ar, 409);

  // Filtered in memory: one equality filter needs no composite index.
  const existing = await adminDb().collection(BROADCASTS).where("clinicId", "==", clinicId).get();
  if (existing.docs.some((d) => isLive(d.data()))) {
    throw new BroadcastError(
      "Another broadcast is still going. Finish or cancel it first — two at once would double the pace.",
      "فيه رسالة جماعية تانية لسه شغالة. خلّصها أو الغيها الأول — اتنين مع بعض يضاعفوا السرعة.",
      409
    );
  }

  const audience = await buildAudience(clinicId);
  if (!audience.recipients.length) {
    throw new BroadcastError("No patient on file can be messaged.", "مفيش ولا مريض متسجل ينفع نبعتله.");
  }

  // Written as `building` first: the cron only picks up `running`, so it can never see a broadcast
  // whose rows are half written and decide there is nobody left to send to.
  const ref = adminDb().collection(BROADCASTS).doc();
  await ref.set({
    clinicId,
    name,
    versions,
    status: "building" as BroadcastStatus,
    pausedReason: null,
    dailyLimit,
    total: audience.recipients.length,
    // Rows to walk. Grows past `total` when a patient is put back at the end of the line.
    rowCount: audience.recipients.length,
    cursor: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    excludedOptedOut: audience.excludedOptedOut,
    excludedDuplicates: audience.excludedDuplicates,
    excludedNoPhone: audience.excludedNoPhone,
    dayKey: "",
    sentOnDay: 0,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: Date.now(),
    createdBy: uid,
    createdByName: userName,
    lastSentAt: null,
    finishedAt: null,
    tickLockUntil: 0,
  });

  try {
    // The list is frozen at launch: a patient added next week was not part of what was approved.
    for (let start = 0; start < audience.recipients.length; start += 400) {
      const batch = adminDb().batch();
      audience.recipients.slice(start, start + 400).forEach((r, j) => {
        const i = start + j;
        batch.set(ref.collection(RECIPIENTS).doc(pad(i)), {
          i,
          patientId: r.patientId,
          name: r.name,
          phone: r.phone,
          version: versionFor(i, versions.length),
          status: "queued",
          deferrals: 0,
        });
      });
      await batch.commit();
    }
    await ref.update({ status: "running" as BroadcastStatus });
  } catch (e) {
    await ref.update({ status: "cancelled", pausedReason: "build_failed", finishedAt: FieldValue.serverTimestamp() }).catch(() => {});
    throw e;
  }

  return summarize(ref.id, (await ref.get()).data() || {});
}

/** Pause, resume or cancel. Resume re-checks the number, so a restricted line cannot be restarted from here. */
export async function steerBroadcast(clinicId: string, id: string, action: "pause" | "resume" | "cancel"): Promise<BroadcastSummary> {
  const ref = adminDb().collection(BROADCASTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.clinicId !== clinicId) throw new BroadcastError("Broadcast not found.", "الرسالة الجماعية مش موجودة.", 404);
  const status = snap.data()?.status as BroadcastStatus;
  if (status === "done" || status === "cancelled") throw new BroadcastError("This broadcast has finished.", "الرسالة الجماعية دي خلصت.");
  if (status === "building") throw new BroadcastError("It is still being prepared. Try again in a minute.", "لسه بتتجهز. جرّب كمان دقيقة.", 409);

  if (action === "resume") {
    const problem = lineProblem(await broadcastLine(clinicId));
    if (problem) throw new BroadcastError(problem.en, problem.ar, 409);
    await ref.update({ status: "running", pausedReason: null });
  } else if (action === "pause") {
    await ref.update({ status: "paused", pausedReason: null });
  } else {
    await ref.update({ status: "cancelled", pausedReason: null, finishedAt: FieldValue.serverTimestamp() });
  }
  return summarize(id, (await ref.get()).data() || {});
}

/**
 * Everyone on a broadcast and where they stand — the "Patients" list under each broadcast.
 *
 * Returned whole (a clinic's list is a couple of thousand rows of a few short fields) so the
 * screen can switch tabs and search without asking again. A row the flood guard moved to the
 * back of the line exists twice; only its live copy is returned, so nobody is listed twice.
 */
export async function broadcastRecipients(clinicId: string, id: string): Promise<BroadcastRecipientRow[]> {
  const ref = adminDb().collection(BROADCASTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.clinicId !== clinicId) throw new BroadcastError("Broadcast not found.", "الرسالة الجماعية مش موجودة.", 404);
  const rows = await ref.collection(RECIPIENTS).select("i", "patientId", "name", "phone", "status", "sentAt", "error").get();
  const out: BroadcastRecipientRow[] = [];
  for (const d of rows.docs) {
    const r = d.data();
    if (r.status === "deferred") continue;
    out.push({
      i: Number(r.i) || 0,
      patientId: String(r.patientId || ""),
      name: String(r.name || ""),
      phone: String(r.phone || ""),
      state: r.status === "sent" ? "sent" : r.status === "queued" ? "waiting" : "not_sent",
      sentAt: ms(r.sentAt),
      reason: r.status === "failed" ? "failed" : String(r.error || ""),
    });
  }
  return out.sort((a, b) => a.i - b.i);
}

/** Send one finished message to one number now — the "send me a test" button. */
export async function sendBroadcastTest(clinicId: string, phone: string, template: string): Promise<void> {
  const to = normalizeToE164AssumingCountry(phone);
  if (!to) throw new BroadcastError("That phone number is not valid.", "رقم الموبايل ده مش صحيح.");
  if (hasBlockingIssue(checkBroadcastMessage(template))) {
    throw new BroadcastError("Fix the red items in the message first.", "صلّح النقط الحمرا في الرسالة الأول.");
  }
  const problem = lineProblem(await broadcastLine(clinicId));
  if (problem) throw new BroadcastError(problem.en, problem.ar, 409);
  const ctx = await broadcastContext(clinicId);
  if (missingClinicName([template], ctx.clinicName)) {
    throw new BroadcastError("The clinic profile has no name for {{clinic_name}}.", "ملف العيادة مفيهوش اسم لـ {{clinic_name}}.");
  }
  const text = mergeBroadcast(template, { name: "أحمد", ...ctx });
  const result = await deliverWhatsAppMessage({ clinicId, to, text, audience: "patient" });
  if (result.mode !== "auto") {
    throw new BroadcastError(
      result.mode === "blocked" && result.reason === "opted_out" ? "That number asked not to receive messages." : "The message could not be sent from the clinic's number.",
      result.mode === "blocked" && result.reason === "opted_out" ? "الرقم ده طلب ميستلمش رسايل." : "الرسالة متبعتتش من رقم العيادة."
    );
  }
}

/* ------------------------------------------------------------------------------------------ */
/* The slow release                                                                             */
/* ------------------------------------------------------------------------------------------ */

function cairoParts(now: Date): { ymd: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return { ymd: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export type TickResult = { id: string; clinicId: string; sent: number; note: string };

/** A flood-guard refusal is retried this many times (at the back of the line) before it is a skip. */
const MAX_DEFERRALS = 2;

/**
 * One cron tick for one broadcast: decide how many may leave now, send them, record it.
 *
 * Everything that can say "not now" is asked before anything is sent: clinic hours, the
 * number's state, the gateway's own backlog, today's count against the clinic's ceiling and
 * against what the warm-up leaves after reserving room for reminders. A tick that finds any of
 * them closed sends nothing and waits for the next one; a restricted or disconnected number
 * pauses the broadcast so it cannot quietly restart when the line comes back.
 *
 * Progress is written after EVERY message, not once at the end: a tick cut short by the
 * function's time limit must not leave messages that went out uncounted, or the next tick would
 * hand out today's ceiling a second time. And the status is only ever changed while it still
 * says `running`, so a Cancel or Pause pressed while a tick is sending is never overwritten.
 */
export async function runBroadcastTick(id: string, now = new Date(), deadline = Number.POSITIVE_INFINITY): Promise<TickResult> {
  const db = adminDb();
  const ref = db.collection(BROADCASTS).doc(id);

  // Claim the tick: two overlapping cron runs must not both send this broadcast's next batch.
  const claimed = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.data();
    if (!d || d.status !== "running") return null;
    if (Number(d.tickLockUntil) > now.getTime()) return null;
    tx.update(ref, { tickLockUntil: now.getTime() + 8 * 60_000 });
    return d;
  });
  if (!claimed) return { id, clinicId: "", sent: 0, note: "not running or locked" };
  const clinicId = String(claimed.clinicId);

  const unlock = () => ref.update({ tickLockUntil: 0 });
  /** Change the status only if nobody paused or cancelled it meanwhile. Always unlocks. */
  const settle = (patch: Record<string, unknown>) =>
    db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      tx.update(ref, s.data()?.status === "running" ? { ...patch, tickLockUntil: 0 } : { tickLockUntil: 0 });
    });
  const stillRunning = async () => (await ref.get()).data()?.status === "running";

  try {
    const { ymd, minutes } = cairoParts(now);
    const open = BROADCAST_WINDOW.startHour * 60;
    const close = BROADCAST_WINDOW.endHour * 60;
    if (minutes < open || minutes >= close) {
      await unlock();
      return { id, clinicId, sent: 0, note: "outside clinic hours" };
    }

    const line = await broadcastLine(clinicId);
    if (line.state === "restricted" || line.officialChannel || !line.onGateway || ["logged_out", "qr", "qr_expired"].includes(line.state)) {
      const reason = line.state === "restricted" ? "restricted" : "disconnected";
      await settle({ status: "paused", pausedReason: reason });
      return { id, clinicId, sent: 0, note: `paused: ${reason}` };
    }
    if (line.state !== "open" || !line.autoSending) {
      await unlock();
      return { id, clinicId, sent: 0, note: `line ${line.state}` };
    }
    if ((line.queued ?? 0) > GATEWAY_BACKLOG_LIMIT) {
      await unlock();
      return { id, clinicId, sent: 0, note: "gateway still sending the last batch" };
    }

    // A new day starts its count from zero.
    let sentOnDay = claimed.dayKey === ymd ? Number(claimed.sentOnDay) || 0 : 0;
    if (claimed.dayKey !== ymd) await ref.update({ dayKey: ymd, sentOnDay: 0 });

    const dailyLimit = Number(claimed.dailyLimit) || BROADCAST_MIN_DAILY;
    let leftToday = dailyLimit - sentOnDay;
    if (line.dailyCap !== null) {
      // The broadcast's share of the warm-up, and never more than the number has left today at all.
      leftToday = Math.min(leftToday, broadcastShareOfAllowance(line.dailyCap) - sentOnDay);
      if (line.sentToday !== null) leftToday = Math.min(leftToday, line.dailyCap - line.sentToday);
    }
    const n = perTickRelease({ leftToday, minutesLeftInWindow: close - minutes, tickMinutes: TICK_MINUTES });
    if (n <= 0) {
      await unlock();
      return { id, clinicId, sent: 0, note: "today's share is used" };
    }

    const cursor = Number(claimed.cursor) || 0;
    // More rows than sends: a skipped or deferred patient must not use up one of today's sends.
    const rows = await ref.collection(RECIPIENTS).orderBy(FieldPath.documentId()).startAt(pad(cursor)).limit(n + 20).get();
    if (rows.empty) {
      await settle({ status: "done", finishedAt: FieldValue.serverTimestamp() });
      return { id, clinicId, sent: 0, note: "finished" };
    }
    const versions: string[] = Array.isArray(claimed.versions) ? claimed.versions.map(String) : [];
    const ctx = await broadcastContext(clinicId);

    // Each patient's record as it is NOW: removed from the clinic, or told the desk to stop,
    // since the list was frozen at launch.
    const patientRefs = rows.docs.map((r) => adminClinicDoc(clinicId, "patients", String(r.get("patientId") || "_")));
    const patientSnaps = await db.getAll(...patientRefs);
    const patients = new Map(patientSnaps.map((s) => [s.ref.id, s]));

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let consecutiveErrors = 0;

    /** Record one row's outcome on the broadcast at once, moving the cursor past it. */
    const advance = (rowIndex: number, counters: Record<string, number>) =>
      ref.update({
        cursor: rowIndex + 1,
        ...Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, FieldValue.increment(v)])),
        ...(counters.sent ? { lastSentAt: FieldValue.serverTimestamp() } : {}),
      });

    for (const row of rows.docs) {
      if (sent >= n || Date.now() > deadline) break;
      if (!(await stillRunning())) break;
      const r = row.data();
      const rowIndex = Number(r.i);
      if (r.status !== "queued") {
        await advance(rowIndex, {});
        continue;
      }

      const patient = patients.get(String(r.patientId || "_"));
      const pdata = patient?.exists ? ((patient.data() || {}) as Record<string, unknown>) : null;
      const gone = !pdata || pdata.deleted === true || pdata.isDeleted === true;
      if (gone || isWhatsAppBlocked(pdata as { whatsappOptOut?: boolean })) {
        skipped += 1;
        await row.ref.update({ status: "skipped", error: gone ? "patient removed" : "asked to stop" });
        await advance(rowIndex, { skipped: 1 });
        continue;
      }

      const template = versions[Number(r.version) || 0] || versions[0] || "";
      const text = mergeBroadcast(template, { name: String(r.name || ""), ...ctx });
      let result: Awaited<ReturnType<typeof deliverWhatsAppMessage>>;
      try {
        result = await deliverWhatsAppMessage({ clinicId, to: String(r.phone), text, audience: "patient" });
      } catch (e) {
        failed += 1;
        consecutiveErrors += 1;
        await row.ref.update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 200) : "send failed" });
        await advance(rowIndex, { failed: 1 });
        if (consecutiveErrors >= 3) break;
        continue;
      }

      if (result.mode === "auto") {
        sent += 1;
        sentOnDay += 1;
        consecutiveErrors = 0;
        await advance(rowIndex, { sent: 1, sentOnDay: 1 });
        // Bookkeeping after a message that went out: a failure here must not count it as failed.
        try {
          await row.ref.update({ status: "sent", sentAt: FieldValue.serverTimestamp() });
          await adminClinicCollection(clinicId, "whatsapp_logs").add({
            patientId: r.patientId,
            type: "broadcast",
            broadcastId: id,
            message: text,
            status: "success",
            createdAt: FieldValue.serverTimestamp(),
          });
        } catch (e) {
          console.warn("[broadcast] bookkeeping after a send failed", e);
        }
      } else if (result.mode === "blocked" && result.reason === "flood") {
        // Too many automatic messages to this patient this hour — not a refusal. Back of the line.
        const deferrals = Number(r.deferrals) || 0;
        if (deferrals >= MAX_DEFERRALS) {
          skipped += 1;
          await row.ref.update({ status: "skipped", error: "messaged too often by the clinic" });
          await advance(rowIndex, { skipped: 1 });
        } else {
          await db.runTransaction(async (tx) => {
            const s = await tx.get(ref);
            const at = Number(s.data()?.rowCount) || Number(s.data()?.total) || 0;
            tx.set(ref.collection(RECIPIENTS).doc(pad(at)), { ...r, i: at, status: "queued", deferrals: deferrals + 1 });
            tx.update(ref, { rowCount: at + 1 });
            tx.update(row.ref, { status: "deferred", error: "moved to the end of the list" });
          });
          await advance(rowIndex, {});
        }
      } else if (result.mode === "blocked") {
        skipped += 1;
        await row.ref.update({ status: "skipped", error: "asked to stop" });
        await advance(rowIndex, { skipped: 1 });
      } else {
        // The line went to manual between the check and this send: stop here, retry next tick.
        break;
      }
    }

    // Three gateway errors in a row is the gateway, not three bad numbers: pause and say so.
    if (consecutiveErrors >= 3) {
      await settle({ status: "paused", pausedReason: "errors" });
      return { id, clinicId, sent, note: "paused: errors" };
    }
    const after = (await ref.get()).data() || {};
    const rowCount = Number(after.rowCount) || Number(after.total) || 0;
    if ((Number(after.cursor) || 0) >= rowCount) {
      await settle({ status: "done", finishedAt: FieldValue.serverTimestamp() });
      return { id, clinicId, sent, note: "finished" };
    }
    await unlock();
    return { id, clinicId, sent, note: `sent ${sent}, skipped ${skipped}, failed ${failed}` };
  } catch (e) {
    await unlock().catch(() => {});
    throw e;
  }
}

/** Ticks running at once. The gateway paces each clinic's number itself; this only bounds the cron. */
const TICK_CONCURRENCY = 4;
/** Stop starting sends this long into the cron's 300-second allowance. */
const TICK_BUDGET_MS = 240_000;

/** Every running broadcast, one tick each, a few at a time. Called by the cron. */
export async function runAllBroadcastTicks(now = new Date()): Promise<TickResult[]> {
  const deadline = Date.now() + TICK_BUDGET_MS;
  const snap = await adminDb().collection(BROADCASTS).where("status", "==", "running").get();
  const queue = [...snap.docs];
  const out: TickResult[] = [];
  const worker = async () => {
    for (let doc = queue.shift(); doc; doc = queue.shift()) {
      try {
        out.push(await runBroadcastTick(doc.id, now, deadline));
      } catch (e) {
        out.push({ id: doc.id, clinicId: String(doc.data().clinicId || ""), sent: 0, note: `error: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TICK_CONCURRENCY, queue.length) }, worker));
  return out;
}

/** Usage counter for the AI check, on the clinic's monthly ai_usage doc. */
export function aiUsageDoc(clinicId: string) {
  return adminClinicDoc(clinicId, "ai_usage", new Date().toISOString().slice(0, 7));
}
