import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminClinicCollection, adminClinicDoc } from "@/lib/adminClinicDb";
import { adminDb } from "@/lib/firebaseAdmin";
import { clinicTimeZone, ymdInTimeZone } from "@/lib/clinicDate";
import { notifyTiming } from "@/lib/notificationCatalog";
import { readAlertPreferences } from "@/lib/notificationDelivery";
import { isFullAccessRole } from "@/lib/permissions";
import {
  CALL_REMINDERS_COLLECTION,
  cleanReason,
  computeFireAt,
  validateReminderInput,
  type ReminderInput,
} from "@/lib/callReminders";

/**
 * Every write to `call_reminders`. The browser reads the collection live but never writes it
 * (firestore.rules holds it out of the member write grant), so the checks here are the only path:
 * who may delete, a day that is not in the past, and a reminder handled exactly once.
 *
 * Handling (done / call again / book) runs in a transaction, so two people pressing at the same
 * moment get one answer and one "already handled".
 */

export interface Actor {
  uid: string;
  name: string;
  role: string | null | undefined;
}

export type Outcome<T extends object = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const reminders = (clinicId: string) => adminClinicCollection(clinicId, CALL_REMINDERS_COLLECTION);
const todayYmd = () => ymdInTimeZone(clinicTimeZone(), new Date());

async function morningHour(clinicId: string): Promise<number> {
  return notifyTiming("callReminderDue", "hour", await readAlertPreferences(clinicId));
}

export async function createReminder(clinicId: string, actor: Actor, input: ReminderInput, branchId: string | null): Promise<Outcome<{ id: string }>> {
  const checked = validateReminderInput(input, todayYmd());
  if (!checked.ok) return fail(400, checked.error);
  const v = checked.value;

  const patient = await adminClinicDoc(clinicId, "patients", String(v.patientId || "")).get();
  if (!v.patientId || !patient.exists) return fail(404, "not-found");
  const p = patient.data() || {};

  const fireAt = Timestamp.fromDate(computeFireAt(v.date, v.time, await morningHour(clinicId)));
  const ref = reminders(clinicId).doc();
  const doc: Record<string, unknown> = {
    patientId: v.patientId,
    patientName: String(p.name || ""),
    patientPhone: String(p.phone || ""),
    branchId: branchId || null,
    reason: v.reason,
    source: v.source === "booking" || v.source === "treatment" ? v.source : "patient",
    date: v.date,
    time: v.time,
    fireAt,
    pendingFireAt: fireAt,
    recipient: v.recipient.kind === "person" ? { kind: "person", uid: v.recipient.uid, name: String(v.recipient.name || "") } : { kind: "role", role: v.recipient.role },
    status: "open",
    createdBy: { uid: actor.uid, name: actor.name },
    createdAt: FieldValue.serverTimestamp(),
  };
  if (v.sourceNoteId) doc.sourceNoteId = String(v.sourceNoteId);
  await ref.set(doc);
  return { ok: true, id: ref.id };
}

/** Close an open reminder with these fields, once. */
async function handle(
  clinicId: string,
  id: string,
  actor: Actor,
  fields: Record<string, unknown>,
  then?: (tx: FirebaseFirestore.Transaction, current: FirebaseFirestore.DocumentData) => void,
): Promise<Outcome> {
  const ref = reminders(clinicId).doc(String(id || "x"));
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return fail(404, "not-found");
    const current = snap.data() || {};
    if (current.status !== "open") return fail(409, "already-handled");
    tx.update(ref, {
      ...fields,
      handledBy: { uid: actor.uid, name: actor.name },
      handledAt: FieldValue.serverTimestamp(),
      pendingFireAt: FieldValue.delete(),
    });
    then?.(tx, current);
    return { ok: true as const };
  });
}

const noteField = (note: unknown) => {
  const n = cleanReason(String(note ?? ""));
  return n ? { note: n } : {};
};

export function markDone(clinicId: string, actor: Actor, id: string, note?: string): Promise<Outcome> {
  return handle(clinicId, id, actor, { status: "done", ...noteField(note) });
}

export async function reschedule(clinicId: string, actor: Actor, id: string, date: string, time: string | null, note?: string): Promise<Outcome<{ id: string }>> {
  const current = (await reminders(clinicId).doc(String(id || "x")).get()).data();
  if (!current) return fail(404, "not-found");
  const checked = validateReminderInput(
    { patientId: current.patientId, date, time: time ?? null, reason: current.reason, recipient: current.recipient, source: current.source },
    todayYmd(),
  );
  if (!checked.ok) return fail(400, checked.error);

  const fireAt = Timestamp.fromDate(computeFireAt(date, time ?? null, await morningHour(clinicId)));
  const nextRef = reminders(clinicId).doc();
  const result = await handle(clinicId, id, actor, { status: "rescheduled", nextId: nextRef.id, ...noteField(note) }, (tx, cur) => {
    const next: Record<string, unknown> = {
      patientId: cur.patientId,
      patientName: cur.patientName,
      patientPhone: cur.patientPhone,
      branchId: cur.branchId ?? null,
      reason: cur.reason,
      source: cur.source,
      date,
      time: time ?? null,
      fireAt,
      pendingFireAt: fireAt,
      recipient: cur.recipient,
      status: "open",
      previousId: id,
      createdBy: { uid: actor.uid, name: actor.name },
      createdAt: FieldValue.serverTimestamp(),
    };
    if (cur.sourceNoteId) next.sourceNoteId = cur.sourceNoteId;
    tx.set(nextRef, next);
  });
  return result.ok ? { ok: true, id: nextRef.id } : result;
}

export function markBooked(clinicId: string, actor: Actor, id: string, appointmentId: string, appointmentDate: string): Promise<Outcome> {
  if (!appointmentId) return Promise.resolve(fail(400, "bad-action"));
  return handle(clinicId, id, actor, {
    status: "booked",
    appointmentId: String(appointmentId),
    note: `اتحجز ميعاد يوم ${String(appointmentDate || "").slice(0, 10)}`,
  });
}

/** The creator, or an Owner/Admin. */
export async function deleteReminder(clinicId: string, actor: Actor, id: string): Promise<Outcome> {
  const ref = reminders(clinicId).doc(String(id || "x"));
  const snap = await ref.get();
  if (!snap.exists) return fail(404, "not-found");
  const createdBy = String(snap.data()?.createdBy?.uid || "");
  if (createdBy !== actor.uid && !isFullAccessRole(actor.role)) return fail(403, "forbidden");
  await ref.delete();
  return { ok: true };
}
