import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebaseAdmin";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { conversationKey } from "@/lib/bot/conversation";
import { isWhatsAppBlocked } from "@/lib/patientMessaging";
import { pickPatientPhone } from "@/lib/patientPhone";
import { normalizeToE164, normalizeToInternationalDigits } from "@/lib/whatsapp";
import { deliverWhatsAppMessage, resolveWhatsappDeliveryMode } from "@/lib/whatsappDelivery";
import { mergeWhatsAppTemplate } from "@/lib/whatsappTemplateMerge";
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
  firstNameOf,
  hasBlockingIssue,
  perTickRelease,
  versionFor,
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
      en: "Link the clinic's WhatsApp number first: Settings → WhatsApp setup → Connect by QR.",
      ar: "اربط رقم واتساب العيادة الأول: الإعدادات ← إعداد واتساب ← الربط بالـ QR.",
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
      en: "The clinic's number is not connected right now. Open Settings → WhatsApp setup and scan the QR again.",
      ar: "رقم العيادة مش متصل دلوقتي. افتح الإعدادات ← إعداد واتساب وامسح الـ QR تاني.",
    };
  }
  if (!line.autoSending) {
    return {
      en: "Automatic sending is off for this clinic (Settings → WhatsApp setup, or the WhatsApp messages add-on).",
      ar: "الإرسال التلقائي مقفول للعيادة دي (الإعدادات ← إعداد واتساب، أو إضافة رسائل واتساب).",
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

/**
 * Every patient who may be messaged, once per number.
 *
 * The three stop lists are read in bulk here rather than per patient, because twelve hundred
 * patients × three point reads is the slowest way to answer one question. The delivery
 * chokepoint checks each one again at the moment it sends, so a STOP between building the list
 * and reaching that patient is still honoured.
 */
export async function buildAudience(clinicId: string): Promise<Audience> {
  const [patientsSnap, optOutSnap, convoSnap] = await Promise.all([
    adminClinicCollection(clinicId, "patients").get(),
    adminClinicCollection(clinicId, "messaging_opt_outs").select().get(),
    adminClinicCollection(clinicId, "whatsapp_conversations").where("optedOut", "==", true).select().get(),
  ]);
  const optedOutDigits = new Set(optOutSnap.docs.map((d) => d.id));
  const optedOutConvos = new Set(convoSnap.docs.map((d) => d.id));

  const seen = new Set<string>();
  const recipients: AudienceRecipient[] = [];
  let excludedOptedOut = 0;
  let excludedDuplicates = 0;
  let excludedNoPhone = 0;

  // Oldest record first, so the adult who registered the family keeps the number, not the child.
  const docs = [...patientsSnap.docs].sort((a, b) => {
    const t = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
      const v = d.data()?.createdAt as { toMillis?: () => number } | string | number | undefined;
      if (v && typeof v === "object" && typeof v.toMillis === "function") return v.toMillis();
      const n = typeof v === "number" ? v : Date.parse(String(v || ""));
      return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
    };
    return t(a) - t(b);
  });

  for (const doc of docs) {
    const data = (doc.data() || {}) as Record<string, unknown>;
    if (data.deleted === true || data.isDeleted === true) continue;
    const raw = pickPatientPhone(data);
    const digits = raw ? normalizeToInternationalDigits(raw) : "";
    if (!digits || !looksLikeMobile(digits)) {
      excludedNoPhone += 1;
      continue;
    }
    if (isWhatsAppBlocked(data as { whatsappOptOut?: boolean }) || optedOutDigits.has(digits) || optedOutConvos.has(conversationKey(raw))) {
      excludedOptedOut += 1;
      continue;
    }
    if (seen.has(digits)) {
      excludedDuplicates += 1;
      continue;
    }
    seen.add(digits);
    recipients.push({ patientId: doc.id, name: String(data.name || data.fullName || "").trim(), phone: `+${digits}` });
  }

  return { recipients, totalPatients: patientsSnap.size, excludedOptedOut, excludedDuplicates, excludedNoPhone };
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
    createdAt: ms(d.createdAt) || 0,
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

  const line = await broadcastLine(clinicId);
  const problem = lineProblem(line);
  if (problem) throw new BroadcastError(problem.en, problem.ar, 409);

  // Filtered in memory: one equality filter needs no composite index.
  const existing = await adminDb().collection(BROADCASTS).where("clinicId", "==", clinicId).get();
  if (existing.docs.some((d) => d.data().status === "running" || d.data().status === "paused")) {
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

  const ref = adminDb().collection(BROADCASTS).doc();
  await ref.set({
    clinicId,
    name,
    versions,
    status: "running" as BroadcastStatus,
    pausedReason: null,
    dailyLimit,
    total: audience.recipients.length,
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
    createdBy: uid,
    createdByName: userName,
    lastSentAt: null,
    finishedAt: null,
    tickLockUntil: 0,
  });

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
      });
    });
    await batch.commit();
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

/** The rows the screen shows under a broadcast: the latest failures, to fix a number or two. */
export async function broadcastFailures(clinicId: string, id: string): Promise<{ name: string; phone: string; error: string }[]> {
  const ref = adminDb().collection(BROADCASTS).doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.clinicId !== clinicId) return [];
  const rows = await ref.collection(RECIPIENTS).where("status", "in", ["failed", "skipped"]).limit(50).get();
  return rows.docs.map((d) => ({ name: String(d.data().name || ""), phone: String(d.data().phone || ""), error: String(d.data().error || "") }));
}

/* ------------------------------------------------------------------------------------------ */
/* Merging                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export function mergeBroadcast(template: string, vars: { name: string; clinicName: string }): string {
  const merged = mergeWhatsAppTemplate(template, {
    first_name: firstNameOf(vars.name),
    patient_name: vars.name,
    clinic_name: vars.clinicName,
  });
  // A patient with no name on file is greeted without one, rather than as "أهلاً أ/ 🌷".
  return merged
    .replace(/أ\/\s*(?=[^؀-ۿA-Za-z]|$)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Send one finished message to one number now — the "send me a test" button. */
export async function sendBroadcastTest(clinicId: string, phone: string, template: string): Promise<void> {
  const to = normalizeToE164(phone);
  if (!to) throw new BroadcastError("That phone number is not valid.", "رقم الموبايل ده مش صحيح.");
  if (hasBlockingIssue(checkBroadcastMessage(template))) {
    throw new BroadcastError("Fix the red items in the message first.", "صلّح النقط الحمرا في الرسالة الأول.");
  }
  const problem = lineProblem(await broadcastLine(clinicId));
  if (problem) throw new BroadcastError(problem.en, problem.ar, 409);
  const profile = await getClinicProfileAdmin(clinicId);
  const text = mergeBroadcast(template, { name: "أحمد", clinicName: profile?.clinicName?.trim() || "" });
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

/**
 * One cron tick for one broadcast: decide how many may leave now, send them, record it.
 *
 * Everything that can say "not now" is asked before anything is sent: clinic hours, the
 * number's state, the gateway's own backlog, today's count against the clinic's ceiling and
 * against what the warm-up leaves after reserving room for reminders. A tick that finds any of
 * them closed sends nothing and waits for the next one; a restricted or disconnected number
 * pauses the broadcast so it cannot quietly restart when the line comes back.
 */
export async function runBroadcastTick(id: string, now = new Date()): Promise<TickResult> {
  const ref = adminDb().collection(BROADCASTS).doc(id);

  // Claim the tick: two overlapping cron runs must not both send this broadcast's next batch.
  const claimed = await adminDb().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.data();
    if (!d || d.status !== "running") return null;
    if (Number(d.tickLockUntil) > now.getTime()) return null;
    tx.update(ref, { tickLockUntil: now.getTime() + 8 * 60_000 });
    return d;
  });
  if (!claimed) return { id, clinicId: "", sent: 0, note: "not running or locked" };
  const clinicId = String(claimed.clinicId);
  const release = (patch: Record<string, unknown> = {}) => ref.update({ tickLockUntil: 0, ...patch });

  try {
    const { ymd, minutes } = cairoParts(now);
    const open = BROADCAST_WINDOW.startHour * 60;
    const close = BROADCAST_WINDOW.endHour * 60;
    if (minutes < open || minutes >= close) {
      await release();
      return { id, clinicId, sent: 0, note: "outside clinic hours" };
    }

    const line = await broadcastLine(clinicId);
    if (line.state === "restricted" || line.officialChannel || !line.onGateway || ["logged_out", "qr", "qr_expired"].includes(line.state)) {
      const reason = line.state === "restricted" ? "restricted" : "disconnected";
      await release({ status: "paused", pausedReason: reason });
      return { id, clinicId, sent: 0, note: `paused: ${reason}` };
    }
    if (line.state !== "open" || !line.autoSending) {
      await release();
      return { id, clinicId, sent: 0, note: `line ${line.state}` };
    }
    if ((line.queued ?? 0) > GATEWAY_BACKLOG_LIMIT) {
      await release();
      return { id, clinicId, sent: 0, note: "gateway still sending the last batch" };
    }

    const sentOnDay = claimed.dayKey === ymd ? Number(claimed.sentOnDay) || 0 : 0;
    const dailyLimit = Number(claimed.dailyLimit) || BROADCAST_MIN_DAILY;
    let leftToday = dailyLimit - sentOnDay;
    if (line.dailyCap !== null) {
      // The broadcast's share of the warm-up, and never more than the number has left today at all.
      leftToday = Math.min(leftToday, broadcastShareOfAllowance(line.dailyCap) - sentOnDay);
      if (line.sentToday !== null) leftToday = Math.min(leftToday, line.dailyCap - line.sentToday);
    }
    const n = perTickRelease({ leftToday, minutesLeftInWindow: close - minutes, tickMinutes: TICK_MINUTES });
    if (n <= 0) {
      await release({ dayKey: ymd, sentOnDay });
      return { id, clinicId, sent: 0, note: "today's share is used" };
    }

    const cursor = Number(claimed.cursor) || 0;
    const rows = await ref.collection(RECIPIENTS).orderBy(FieldPath.documentId()).startAt(pad(cursor)).limit(n).get();
    const versions: string[] = Array.isArray(claimed.versions) ? claimed.versions.map(String) : [];
    const profile = await getClinicProfileAdmin(clinicId);
    const clinicName = profile?.clinicName?.trim() || "";

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let consecutiveErrors = 0;
    let processed = 0;
    for (const row of rows.docs) {
      const r = row.data();
      if (r.status !== "queued") {
        processed += 1;
        continue;
      }
      const template = versions[Number(r.version) || 0] || versions[0] || "";
      const text = mergeBroadcast(template, { name: String(r.name || ""), clinicName });
      try {
        const result = await deliverWhatsAppMessage({ clinicId, to: String(r.phone), text, audience: "patient" });
        if (result.mode === "auto") {
          sent += 1;
          consecutiveErrors = 0;
          await row.ref.update({ status: "sent", sentAt: FieldValue.serverTimestamp() });
          await adminClinicCollection(clinicId, "whatsapp_logs").add({
            patientId: r.patientId,
            type: "broadcast",
            broadcastId: id,
            message: text,
            status: "success",
            createdAt: FieldValue.serverTimestamp(),
          });
        } else if (result.mode === "blocked") {
          skipped += 1;
          await row.ref.update({ status: "skipped", error: result.reason === "opted_out" ? "asked to stop" : "messaged too often this hour" });
        } else {
          // The line went to manual between the check and this send: stop here, retry next tick.
          break;
        }
      } catch (e) {
        failed += 1;
        consecutiveErrors += 1;
        await row.ref.update({ status: "failed", error: e instanceof Error ? e.message.slice(0, 200) : "send failed" });
        if (consecutiveErrors >= 3) {
          processed += 1;
          break;
        }
      }
      processed += 1;
    }

    const newCursor = cursor + processed;
    const total = Number(claimed.total) || 0;
    const finished = newCursor >= total;
    await release({
      cursor: newCursor,
      sent: FieldValue.increment(sent),
      skipped: FieldValue.increment(skipped),
      failed: FieldValue.increment(failed),
      dayKey: ymd,
      sentOnDay: sentOnDay + sent,
      ...(sent ? { lastSentAt: FieldValue.serverTimestamp() } : {}),
      ...(finished ? { status: "done", finishedAt: FieldValue.serverTimestamp() } : {}),
      // Three gateway errors in a row is the gateway, not three bad numbers: pause and say so.
      ...(consecutiveErrors >= 3 && !finished ? { status: "paused", pausedReason: "errors" } : {}),
    });
    return { id, clinicId, sent, note: finished ? "finished" : `sent ${sent}, skipped ${skipped}, failed ${failed}` };
  } catch (e) {
    await release().catch(() => {});
    throw e;
  }
}

/** Every running broadcast, one tick each. Called by the cron. */
export async function runAllBroadcastTicks(now = new Date()): Promise<TickResult[]> {
  const snap = await adminDb().collection(BROADCASTS).where("status", "==", "running").get();
  const out: TickResult[] = [];
  for (const doc of snap.docs) {
    try {
      out.push(await runBroadcastTick(doc.id, now));
    } catch (e) {
      out.push({ id: doc.id, clinicId: String(doc.data().clinicId || ""), sent: 0, note: `error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return out;
}

/** Usage counter for the AI check, on the clinic's monthly ai_usage doc. */
export function aiUsageDoc(clinicId: string) {
  return adminClinicDoc(clinicId, "ai_usage", new Date().toISOString().slice(0, 7));
}
