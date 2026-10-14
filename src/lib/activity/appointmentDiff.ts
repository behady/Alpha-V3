/**
 * What an appointment save, a drag or a room move says in the activity log. Pure: no Firebase, so
 * it is unit-tested on its own (tests/activityAppointmentDiff.test.mts).
 *
 * The booking modal autosaves, and the old log wrote "Appointment Updated" on every save whatever
 * it carried. Here a save that changed none of the fields below is no event at all, so a notes-only
 * autosave, an untouched re-save or a re-typed time writes nothing.
 */

import { normalizeDateKey, normalizeTimeKey } from "../appointmentTime";
import { diffChanges, discountEvent } from "./diff";
import type { ActivityEvent, Change, Scalar } from "./types";

/** The appointment fields an edit is reported on, in the order the changes are listed. */
export const APPOINTMENT_FIELDS: readonly string[] = [
  "date", "time", "duration", "doctor", "status", "roomName", "branchId", "treatment", "cost",
];

/** The label each stored field is shown under, where the stored key is not itself a label. */
const SHOWN_AS: Record<string, string> = { roomName: "room", branchId: "branch" };

type Doc = Record<string, unknown>;
type Ctx = { patientId?: string; patientName?: string; appointmentId: string };

const has = (o: Doc, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const textOf = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/**
 * One side of the record as the diff should see it: date and time in their stored form (so "5:00
 * PM" and "05:00 PM" are the same slot), and the booking defaults an old doc never stored (30
 * minutes, "Scheduled") filled in, so its first save is not reported as setting them.
 */
function comparable(doc: Doc, fields: readonly string[], defaults: boolean): Doc {
  const out: Doc = {};
  for (const f of fields) {
    let v = doc[f];
    if (f === "date" && typeof v === "string") v = normalizeDateKey(v) || v;
    if (f === "time" && typeof v === "string") v = normalizeTimeKey(v) || v;
    if (defaults && (v === undefined || v === null || v === "")) {
      if (f === "duration") v = 30;
      if (f === "status") v = "Scheduled";
    }
    out[f] = v;
  }
  return out;
}

/**
 * The branch is stored as an id, which must never reach a sentence: it is shown by name, from the
 * `branchName` each side carries. When either side's name is not known, the change is the label
 * alone ("Branch") rather than an id or a misleading "—".
 */
function branchChange(prev: Doc, next: Doc): Change {
  const side = (doc: Doc, idKnown: boolean): { known: boolean; name: Scalar } => {
    if (!textOf(doc.branchId)) return { known: true, name: null };
    const name = idKnown ? textOf(doc.branchName) : null;
    return { known: name !== null, name };
  };
  const a = side(prev, true);
  const b = side(next, has(next, "branchName"));
  if (!a.known || !b.known) return { field: "branch", from: null, to: null };
  return { field: "branch", from: a.name, to: b.name };
}

/** The branch an event about this appointment is filed under; none = the writer uses the branch on screen. */
function branchOf(...docs: Doc[]): string | undefined {
  for (const d of docs) {
    if (has(d, "branchId")) return textOf(d.branchId) ?? undefined;
  }
  return undefined;
}

/**
 * The events one appointment save writes: one `appointment.edited` listing what changed (if
 * anything), then one discount event when the visit discount changed. Only the fields the save
 * actually carries are compared — a room move sends two fields, not the whole appointment.
 * `notes`, `modifiedBy`, `updatedAt` and `waitingMood` are never reported.
 */
export function appointmentEvents(prev: Doc, next: Doc, ctx: Ctx): ActivityEvent[] {
  const p = prev ?? {};
  const n = next ?? {};
  const fields = APPOINTMENT_FIELDS.filter((f) => has(n, f));
  const raw = diffChanges(comparable(p, fields, true), comparable(n, fields, true), fields);
  const changes: Change[] = raw.map((c) =>
    c.field === "branchId" ? branchChange(p, n) : { ...c, field: SHOWN_AS[c.field] ?? c.field },
  );

  const base = {
    patientId: ctx.patientId,
    patientName: ctx.patientName,
    branchId: branchOf(n, p),
  };
  const day = textOf(has(n, "date") ? n.date : p.date);
  const time = textOf(has(n, "time") ? n.time : p.time);
  const refs = {
    appointmentId: ctx.appointmentId,
    ...(day ? { date: normalizeDateKey(day) || day } : {}),
    ...(time ? { time: normalizeTimeKey(time) || time } : {}),
  };

  const out: ActivityEvent[] = [];
  if (changes.length) out.push({ event: "appointment.edited", ...base, changes, refs });

  // Only a save that sent a discount can have changed it. Old docs without one, and an uncharged
  // visit's null, read as 0.
  if (has(n, "discountAmount")) {
    const d = discountEvent(Number(p.discountAmount) || 0, Number(n.discountAmount) || 0);
    if (d) out.push({ event: d.event, ...base, amount: d.amount, refs });
  }
  return out;
}

/**
 * A card dragged to another day or time: `appointment.moved` with the date and/or time change, or
 * null when it was dropped on the slot it already had.
 */
export function appointmentMoveEvent(prev: Doc, appointmentId: string, newDate: string, newTime: string): ActivityEvent | null {
  const p = prev ?? {};
  const fields = ["date", "time"];
  const changes = diffChanges(comparable(p, fields, false), comparable({ date: newDate, time: newTime }, fields, false), fields);
  if (!changes.length) return null;
  const doctor = textOf(p.doctor);
  return {
    event: "appointment.moved",
    patientId: textOf(p.patientId) ?? undefined,
    patientName: textOf(p.patientName) ?? undefined,
    branchId: branchOf(p),
    changes,
    refs: {
      appointmentId,
      date: normalizeDateKey(newDate) || newDate,
      time: normalizeTimeKey(newTime) || newTime,
      ...(doctor ? { doctor } : {}),
    },
  };
}
