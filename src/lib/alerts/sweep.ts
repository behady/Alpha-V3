import { FieldValue } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { LAB_CASES_COLLECTION, LAB_CASE_STATUSES, daysUntil, statusFor } from "@/lib/labCases";
import { NOTIFY_EVENTS, notifyEvent, notifyTiming, reportPrefs, resolveNotify, type AlertPreferences } from "@/lib/notificationCatalog";
import { clinicHourNow, deliverClinicNotification, readAlertPreferences } from "@/lib/notificationDelivery";
import { getAiCreditLimit } from "@/lib/subscriptions";
import type { Clinic } from "@/types/saas";

/**
 * The alerts that nobody's click raises: they are true for a while before anyone notices.
 *
 * A patient who has been in the waiting room twenty minutes, a dentist whose shift started and
 * who has not clocked in, a lab case a day past its due date, an AI balance about to run out.
 * A ten-minute tick asks each question against the clinic's own thresholds and raises the alert
 * once — a marker document per subject per day means the owner is told a patient has waited
 * twenty minutes, not told again at thirty, forty and fifty.
 *
 * The same tick flushes the batched alerts: those the clinic asked to receive as an hourly digest
 * go at the top of the hour, those folded into the evening go at the close-out hour.
 */

const TZ = clinicTimeZone();
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === "object" && v !== null && typeof (v as { toMillis?: () => number }).toMillis === "function") return (v as { toMillis: () => number }).toMillis();
  if (typeof v === "object" && v !== null && "seconds" in v) return num((v as { seconds: unknown }).seconds) * 1000;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

/** Minutes past midnight on the clinic's clock. */
function clinicMinutesNow(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

function hhmmToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Claim a marker; false when this subject was already alerted. */
async function once(clinicId: string, key: string): Promise<boolean> {
  try {
    await adminClinicDoc(clinicId, "alert_marks", key.replace(/[^\w.\-]+/g, "_").slice(0, 300)).create({ at: FieldValue.serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}

async function raise(clinicId: string, event: string, title: string, body: string, opts: { screen?: string; channel?: string; uids?: string[] } = {}) {
  try {
    await deliverClinicNotification(
      clinicId,
      { title, body },
      { event, channel: opts.channel || "alpha_bookings", data: { screen: opts.screen || "day" }, whatsappText: `*${title}*\n${body}`, ...(opts.uids ? { uids: opts.uids } : {}) },
    );
  } catch (error) {
    console.warn(`${event} failed:`, error);
  }
}

/** Switched on somewhere — bell, phone or WhatsApp. */
function isOn(eventId: string, prefs: AlertPreferences): boolean {
  const r = resolveNotify(eventId, prefs);
  return Boolean(r && (r.bell || r.push || r.whatsapp));
}

/* --- the checks -------------------------------------------------------------------------------- */

async function waitingPatients(clinicId: string, prefs: AlertPreferences, today: string, now: Date, out: string[]) {
  if (!isOn("patientWaitingLong", prefs)) return;
  const minutes = notifyTiming("patientWaitingLong", "minutes", prefs);
  const snap = await adminClinicCollection(clinicId, "appointments").where("date", "==", today).get();
  for (const doc of snap.docs) {
    const a = doc.data() || {};
    const status = str(a.status);
    if (status !== "Checked In" && status !== "Arrived") continue;
    const since = toMs(a.checkInTime);
    if (!since) continue;
    const waited = Math.round((now.getTime() - since) / 60_000);
    if (waited < minutes) continue;
    if (!(await once(clinicId, `patientWaitingLong_${doc.id}`))) continue;
    const name = str(a.patientName) || "A patient";
    const doctor = str(a.doctorName) || str(a.doctor);
    await raise(clinicId, "patientWaitingLong", `⏳ ${name} has waited ${waited} min`, `${doctor ? `${doctor} · ` : ""}${str(a.time)}`, { screen: "day" });
    out.push(`patientWaitingLong:${doc.id}`);
  }
}

type StaffRow = { uid: string; name: string; start: string | null };

async function rosteredToday(clinicId: string, today: string): Promise<StaffRow[]> {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const snap = await adminClinicCollection(clinicId, "staff").get();
  const rows: StaffRow[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const uid = str(d.uid);
    if (!uid) continue;
    const cfg = (d.attendanceSchedule as Record<string, { active?: boolean; start?: string }> | undefined)?.[String(weekday)];
    if (!cfg || !cfg.active) continue;
    rows.push({ uid, name: str(d.name) || "Staff", start: str(cfg.start) || null });
  }
  return rows;
}

async function punchedToday(clinicId: string, today: string): Promise<Set<string>> {
  const snap = await adminClinicCollection(clinicId, "attendance").where("date", "==", today).get();
  const uids = new Set<string>();
  for (const doc of snap.docs) {
    const uid = str(doc.data()?.userId);
    if (uid) uids.add(uid);
  }
  return uids;
}

async function staffAttendance(clinicId: string, prefs: AlertPreferences, today: string, now: Date, out: string[]) {
  const late = isOn("staffLate", prefs);
  const absent = isOn("staffAbsent", prefs);
  if (!late && !absent) return;
  const roster = await rosteredToday(clinicId, today);
  if (roster.length === 0) return;
  const punched = await punchedToday(clinicId, today);
  const minutesNow = clinicMinutesNow(now);
  const hourNow = clinicHourNow(now);

  if (late) {
    const grace = notifyTiming("staffLate", "minutes", prefs);
    for (const s of roster) {
      if (punched.has(s.uid) || !s.start) continue;
      const startMin = hhmmToMinutes(s.start);
      if (startMin === null || minutesNow < startMin + grace) continue;
      // Past the absent hour this is the other alert's business.
      if (absent && hourNow >= notifyTiming("staffAbsent", "hour", prefs)) continue;
      if (!(await once(clinicId, `staffLate_${s.uid}_${today}`))) continue;
      await raise(clinicId, "staffLate", `⏰ ${s.name} has not clocked in`, `Shift started ${s.start} · ${minutesNow - startMin} min ago`, { screen: "settings" });
      out.push(`staffLate:${s.uid}`);
    }
  }
  if (absent && hourNow >= notifyTiming("staffAbsent", "hour", prefs)) {
    for (const s of roster) {
      if (punched.has(s.uid)) continue;
      if (!(await once(clinicId, `staffAbsent_${s.uid}_${today}`))) continue;
      await raise(clinicId, "staffAbsent", `🚫 ${s.name} is absent today`, `Rostered${s.start ? ` from ${s.start}` : ""}, no clock-in by ${String(notifyTiming("staffAbsent", "hour", prefs)).padStart(2, "0")}:00`, { screen: "settings" });
      out.push(`staffAbsent:${s.uid}`);
    }
  }
}

async function overdueLabCases(clinicId: string, prefs: AlertPreferences, today: string, out: string[]) {
  if (!isOn("labCaseOverdue", prefs)) return;
  const days = notifyTiming("labCaseOverdue", "days", prefs);
  // Only the cases still at the lab, by status — not the clinic's whole lab history every hour.
  const atLab = LAB_CASE_STATUSES.filter((m) => m.atLab).map((m) => m.id);
  const snap = await adminClinicCollection(clinicId, LAB_CASES_COLLECTION).where("status", "in", atLab).get();
  for (const doc of snap.docs) {
    const c = doc.data() || {};
    if (!statusFor(str(c.status)).atLab) continue;
    const due = str(c.dueDate);
    if (!due) continue;
    const d = daysUntil(due, today);
    if (d === null || -d < days) continue;
    if (!(await once(clinicId, `labCaseOverdue_${doc.id}_${due}`))) continue;
    const label = str(c.code) || str(c.patientName) || doc.id;
    await raise(clinicId, "labCaseOverdue", `🧪 Lab case ${label} is ${-d} day${-d === 1 ? "" : "s"} overdue`, `${str(c.patientName)}${str(c.labName) ? ` · ${str(c.labName)}` : ""} · due ${due}`, { screen: "lab" });
    out.push(`labCaseOverdue:${doc.id}`);
  }
}

async function aiCreditsLow(clinicId: string, prefs: AlertPreferences, out: string[]) {
  if (!isOn("aiCreditsLow", prefs)) return;
  const floor = notifyTiming("aiCreditsLow", "credits", prefs);
  const db = adminDb();
  const clinicSnap = await db.collection("clinics").doc(clinicId).get();
  if (!clinicSnap.exists) return;
  const clinic = { id: clinicSnap.id, ...clinicSnap.data() } as Clinic;
  const limit = getAiCreditLimit(clinic);
  if (limit <= 0) return;
  const monthKey = new Date().toISOString().slice(0, 7);
  const usage = await db.collection("clinics").doc(clinicId).collection("ai_usage").doc(monthKey).get();
  const used = usage.exists ? num(usage.data()?.creditsUsed) : 0;
  const left = limit - used;
  if (left > floor || left <= 0) return;
  if (!(await once(clinicId, `aiCreditsLow_${monthKey}`))) return;
  await raise(clinicId, "aiCreditsLow", `🤖 ${left} AI credits left this month`, `Out of ${limit}. The bot's AI answers stop when they run out.`, { screen: "settings", channel: "alpha_system" });
  out.push("aiCreditsLow");
}

/* --- the batched alerts ------------------------------------------------------------------------ */

export interface QueuedAlert {
  id: string;
  event: string;
  title: string;
  body: string;
  whatsappText: string;
  bucket: "hourly" | "daily";
  date: string;
}

/** One message per event, listing what queued up. Pure, so the wording is testable. */
export function groupQueued(items: QueuedAlert[], language: "ar" | "en"): { event: string; title: string; body: string; whatsappText: string }[] {
  const byEvent = new Map<string, QueuedAlert[]>();
  for (const it of items) byEvent.set(it.event, [...(byEvent.get(it.event) || []), it]);
  const out: { event: string; title: string; body: string; whatsappText: string }[] = [];
  for (const [event, list] of byEvent) {
    const meta = notifyEvent(event);
    const label = meta ? (language === "ar" ? meta.ar : meta.en) : event;
    const title = `${list.length} × ${label}`;
    const lines = list.slice(0, 20).map((it) => `• ${it.body || it.title}`);
    if (list.length > 20) lines.push(language === "ar" ? `… و${list.length - 20} كمان` : `… and ${list.length - 20} more`);
    out.push({ event, title, body: lines.slice(0, 3).join(" · ").slice(0, 300), whatsappText: `*${title}*\n${lines.join("\n")}` });
  }
  return out;
}

async function flushQueue(clinicId: string, bucket: "hourly" | "daily", prefs: AlertPreferences, today: string, out: string[]) {
  const snap = await adminClinicCollection(clinicId, "alert_queue").where("bucket", "==", bucket).limit(400).get();
  if (snap.empty) return;
  const items: QueuedAlert[] = snap.docs.map((d) => {
    const x = d.data() || {};
    return { id: d.id, event: str(x.event), title: str(x.title), body: str(x.body), whatsappText: str(x.whatsappText), bucket, date: str(x.date) };
  });
  // Daily items from an earlier day (a clinic whose close-out hour moved) go out now too.
  const language = reportPrefs("eveningDigest", prefs).language;
  for (const group of groupQueued(items, language)) {
    try {
      await deliverClinicNotification(clinicId, { title: group.title, body: group.body }, { event: group.event, whatsappText: group.whatsappText, flushingBatch: true, data: { screen: "day" } });
      out.push(`flush:${bucket}:${group.event}:${items.filter((i) => i.event === group.event).length}`);
    } catch (error) {
      console.warn("queue flush failed:", error);
    }
  }
  const db = adminDb();
  let batch = db.batch();
  let n = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    if (++n % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
  void today;
}

/* --- the tick ------------------------------------------------------------------------------------ */

export async function runAlertSweep(clinicId: string, now = new Date()): Promise<{ raised: string[] }> {
  const prefs = await readAlertPreferences(clinicId);
  const today = ymdInTimeZone(TZ, now);
  const out: string[] = [];

  // Anything switched on that this sweep knows how to check.
  const wanted = new Set(NOTIFY_EVENTS.filter((e) => isOn(e.id, prefs)).map((e) => e.id));
  const any = (...ids: string[]) => ids.some((id) => wanted.has(id));

  // Every ten minutes: the two that are about people standing in the building.
  if (any("patientWaitingLong")) await waitingPatients(clinicId, prefs, today, now, out).catch((e) => console.warn("waiting sweep:", e));
  if (any("staffLate", "staffAbsent")) await staffAttendance(clinicId, prefs, today, now, out).catch((e) => console.warn("attendance sweep:", e));

  // Once an hour, in the first tick: the slow-moving ones, and the batched digests.
  const minute = clinicMinutesNow(now) % 60;
  if (minute < 10) {
    if (any("labCaseOverdue")) await overdueLabCases(clinicId, prefs, today, out).catch((e) => console.warn("lab sweep:", e));
    if (any("aiCreditsLow")) await aiCreditsLow(clinicId, prefs, out).catch((e) => console.warn("credits sweep:", e));
    await flushQueue(clinicId, "hourly", prefs, today, out).catch((e) => console.warn("hourly flush:", e));
    if (clinicHourNow(now) === notifyTiming("eveningDigest", "hour", prefs)) {
      await flushQueue(clinicId, "daily", prefs, today, out).catch((e) => console.warn("daily flush:", e));
    }
  }
  return { raised: out };
}
