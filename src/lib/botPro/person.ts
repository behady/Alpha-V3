/**
 * Who is writing: the patients on this number, and every appointment that belongs to them.
 *
 * Before every Pro reply the model must know who it is talking to. Three things make that harder
 * than "find the patient":
 *   - Family shares one phone, so a number can belong to several patients. All of them are
 *     collected, never just the first.
 *   - Reception books by phone and often writes only `patientPhone` on the appointment, with no
 *     `patientId`. Looking appointments up by patient id alone would miss exactly those.
 *   - On the QR line WhatsApp hides the number behind an `...@lid` id. Then the only identity left
 *     is the patient the conversation was linked to, and that alone must still be enough.
 *
 * The helpers are pure (tested in tests/botProPerson.test.mts); loadProPerson is a thin Firestore
 * layer over them, and a failed read degrades to fewer results rather than throwing.
 */
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";
import { phoneMatchKey } from "@/lib/patientPhone";

/** Every phone-like field `pickPatientPhone` knows. Kept in step with that list. */
const PHONE_FIELDS = [
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
] as const;

/** A key shorter than this is a fragment, not a number (same bar as samePhone). */
const MIN_KEY = 7;

export interface ProAppointment {
  id: string;
  patientId?: string;
  patientName?: string;
  date: string;
  time: string;
  doctor: string;
  status: string;
  service?: string;
}

export interface ProPerson {
  patientId: string | null;
  family: Array<{ id: string; name: string }>;
  upcoming: ProAppointment[];
  past: ProAppointment[];
  /** True when any patient or appointment read failed: empty lists then mean "unknown", not "none". */
  degraded: boolean;
}

/** The match key of every phone field on a patient file, deduped, empties dropped. */
export function phoneKeysOf(patient: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const field of PHONE_FIELDS) {
    const v = patient?.[field];
    if (typeof v !== "string") continue;
    const key = phoneMatchKey(v);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

function nameOf(data: Record<string, unknown>): string {
  return typeof data.name === "string" ? data.name.trim() : "";
}

/**
 * Everyone on this number, plus the patient the conversation is linked to.
 * With no sender key (QR line) only the linked patient can be returned.
 */
export function familyOnNumber(
  patients: Array<{ id: string; data: Record<string, unknown> }>,
  senderKey: string,
  linkedPatientId?: string
): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  const add = (id: string, name: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name });
  };

  if (senderKey.length >= MIN_KEY) {
    for (const pt of patients) {
      if (phoneKeysOf(pt.data).includes(senderKey)) add(pt.id, nameOf(pt.data));
    }
  }
  if (linkedPatientId) {
    const known = patients.find((pt) => pt.id === linkedPatientId);
    add(linkedPatientId, known ? nameOf(known.data) : "");
  }
  return out;
}

/** "05:00 PM" or "17:00" as minutes since midnight, so 10:00 AM sorts before 05:00 PM. */
function minutesOf(time: string): number {
  const m = /(\d{1,2}):(\d{2})\s*([AaPp])?/.exec(time || "");
  if (!m) return 0;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
  return h * 60 + Number(m[2]);
}

/**
 * Is this row a visit that is (or was) really going to happen? Cancelled, no-show and rescheduled
 * rows are not: a reschedule leaves the original marked "Rescheduled" and books a new document, so
 * counting it would show the patient the same visit twice. Tolerant of case and spelling
 * (Canceled, no-show, noshow), like the older `/cancel|no.?show/i` checks.
 */
function isRealVisit(status: string): boolean {
  const s = normalizeAppointmentStatus(status);
  return !/cancel|no[\s_-]?show|reschedul/i.test(s);
}

/**
 * From every appointment row fetched, the ones that belong to these people (by patient id or by the
 * phone written on the row), split into what is still ahead and what is behind.
 * Upcoming skips cancelled and no-show rows: telling someone a cancelled visit is still on is
 * worse than telling them nothing. Past is the ten most recent, whatever their status.
 */
export function splitAppointments(
  rows: Array<ProAppointment & { patientPhone?: string }>,
  people: { ids: string[]; phoneKeys: string[] },
  todayKey: string
): { upcoming: ProAppointment[]; past: ProAppointment[] } {
  const ids = new Set(people.ids.filter(Boolean));
  const keys = new Set(people.phoneKeys.filter((k) => k.length >= MIN_KEY));

  const mine: ProAppointment[] = [];
  for (const row of rows) {
    const byId = !!row.patientId && ids.has(row.patientId);
    const rowKey = row.patientPhone ? phoneMatchKey(row.patientPhone) : "";
    const byPhone = rowKey.length >= MIN_KEY && keys.has(rowKey);
    if (!byId && !byPhone) continue;
    const clean: ProAppointment & { patientPhone?: string } = { ...row };
    delete clean.patientPhone;
    mine.push(clean);
  }

  const byTime = (a: ProAppointment, b: ProAppointment) =>
    a.date === b.date ? minutesOf(a.time) - minutesOf(b.time) : a.date.localeCompare(b.date);

  const upcoming = mine
    .filter((a) => a.date >= todayKey && isRealVisit(a.status))
    .sort(byTime);

  // Real visits only, filtered BEFORE the cap so a run of cancellations cannot push them out.
  const past = mine
    .filter((a) => a.date < todayKey && isRealVisit(a.status))
    .sort((a, b) => byTime(b, a))
    .slice(0, 10);

  return { upcoming, past };
}

type Doc = { id: string; data: Record<string, unknown> };

/** Set when any read failed, so a gap in the data is never mistaken for "nothing booked". */
interface Health {
  degraded: boolean;
}

async function safely<T>(health: Health, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    health.degraded = true;
    console.warn("[botPro] person read failed:", err instanceof Error ? err.message : String(err));
    return fallback;
  }
}

/** Patients on this number: the direct `phone` hit first, then a capped scan for every other shape. */
async function patientsOnNumber(health: Health, clinicId: string, phone: string, senderKey: string): Promise<Doc[]> {
  if (senderKey.length < MIN_KEY) return [];
  const found = new Map<string, Doc>();

  const digits = phone.replace(/\D/g, "");
  if (digits) {
    const direct = await safely(
      health,
      () => adminClinicCollection(clinicId, "patients").where("phone", "==", `+${digits}`).limit(20).get(),
      null
    );
    for (const d of direct?.docs ?? []) found.set(d.id, { id: d.id, data: (d.data() || {}) as Record<string, unknown> });
  }

  const scan = await safely(health, () => adminClinicCollection(clinicId, "patients").limit(3000).get(), null);
  for (const d of scan?.docs ?? []) {
    const data = (d.data() || {}) as Record<string, unknown>;
    if (phoneKeysOf(data).includes(senderKey)) found.set(d.id, { id: d.id, data });
  }
  return [...found.values()];
}

function appointmentFrom(id: string, a: Record<string, unknown>): ProAppointment & { patientPhone?: string } {
  const service = String(a.treatment || a.service || "").trim();
  return {
    id,
    ...(a.patientId ? { patientId: String(a.patientId) } : {}),
    ...(a.patientName ? { patientName: String(a.patientName) } : {}),
    ...(a.patientPhone ? { patientPhone: String(a.patientPhone) } : {}),
    date: String(a.date || ""),
    time: String(a.time || ""),
    doctor: String(a.doctor || ""),
    status: String(a.status || ""),
    ...(service ? { service } : {}),
  };
}

/** Load who is writing and every appointment of theirs. Never throws: a failed read means less. */
export async function loadProPerson(args: {
  clinicId: string;
  chatId: string;
  phone?: string;
  conversationPatientId?: string;
  todayKey: string;
}): Promise<ProPerson> {
  const { clinicId, phone = "", conversationPatientId, todayKey } = args;
  const senderKey = phoneMatchKey(phone);

  const health: Health = { degraded: false };
  const patients = await patientsOnNumber(health, clinicId, phone, senderKey);

  // The linked patient is the only identity behind a hidden number; fetch their file for the name
  // and their own phones when the scan did not already return it.
  if (conversationPatientId && !patients.some((p) => p.id === conversationPatientId)) {
    const snap = await safely(health, () => adminClinicDoc(clinicId, "patients", conversationPatientId).get(), null);
    if (snap?.exists) patients.push({ id: snap.id, data: (snap.data() || {}) as Record<string, unknown> });
  }

  const family = familyOnNumber(patients, senderKey, conversationPatientId);
  const ids = family.map((f) => f.id);

  const phoneKeys = senderKey ? [senderKey] : [];
  for (const f of family) {
    const doc = patients.find((p) => p.id === f.id);
    if (doc) for (const k of phoneKeysOf(doc.data)) if (!phoneKeys.includes(k)) phoneKeys.push(k);
  }

  const rows = new Map<string, ProAppointment & { patientPhone?: string }>();
  const appts = adminClinicCollection(clinicId, "appointments");

  // Firestore `in` takes at most 10 values.
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const snap = await safely(health, () => appts.where("patientId", "in", chunk).get(), null);
    for (const d of snap?.docs ?? []) rows.set(d.id, appointmentFrom(d.id, (d.data() || {}) as Record<string, unknown>));
  }

  // Reception bookings carry only the phone, written in whatever shape the receptionist typed.
  if (senderKey.length >= MIN_KEY) {
    const digits = phone.replace(/\D/g, "");
    const variants = [
      ...new Set([`+${digits}`, digits, `0${senderKey}`, senderKey, `+20${senderKey}`, `20${senderKey}`]),
    ].filter((v) => v.replace(/\D/g, "").length >= MIN_KEY);
    const snap = await safely(health, () => appts.where("patientPhone", "in", variants).get(), null);
    for (const d of snap?.docs ?? []) rows.set(d.id, appointmentFrom(d.id, (d.data() || {}) as Record<string, unknown>));
  }

  const { upcoming, past } = splitAppointments([...rows.values()], { ids, phoneKeys }, todayKey);
  return { patientId: conversationPatientId || family[0]?.id || null, family, upcoming, past, degraded: health.degraded };
}
