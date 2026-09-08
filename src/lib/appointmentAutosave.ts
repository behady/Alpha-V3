/**
 * When an open appointment panel should write itself to the database, now that nobody presses Save.
 *
 * The rules are here, as plain functions, because getting them wrong is not a layout bug — it
 * writes to a patient's record and, for three of the fields, sends that patient a WhatsApp
 * message. `tests/appointmentAutosave.test.mts` pins every case below.
 *
 * Two things shape all of it:
 *
 * 1. **Some edits speak to the patient and most do not.** `lib/bookingService` messages the
 *    patient when the date, the time or the dentist changes ("your appointment moved"), and when
 *    the status becomes Cancelled. Everything else — notes, duration, reason for visit, any other
 *    status — is silent bookkeeping. So the quiet edits settle quickly and the loud ones wait
 *    longer, which collapses a person still choosing into ONE write and therefore one message
 *    rather than one per keystroke.
 *
 * 2. **The time box is free text.** Typing "03:45 PM" passes through "0", "03", "03:", "03:4" —
 *    and `normalizeTimeKey` hands back whatever it cannot parse rather than refusing it, so a save
 *    fired mid-word would store "03:" as the appointment's time. Autosave therefore refuses to run
 *    at all while a loud field is unusable.
 */

import { normalizeTimeKey } from "@/lib/appointmentTime";

/** Fields whose change sends the patient a message. Mirrors `scheduleChanged` in bookingService. */
export const LOUD_FIELDS = ["date", "time", "doctor"] as const;

/** Everything else the two panels can edit. Silent — nobody outside the clinic hears about these. */
export const QUIET_FIELDS = ["treatment", "duration", "notes", "status", "roomId"] as const;

/** A settled edit nobody hears about. Short enough to feel instant. */
export const QUIET_DELAY_MS = 700;

/**
 * A settled edit the patient hears about. Long enough that changing your mind twice about a time
 * is one message, not two — the same as pressing Save once, which is what it replaces.
 */
export const LOUD_DELAY_MS = 2500;

export type Fields = Record<string, unknown>;

export type AutosaveVerdict =
  | { save: false; reason: "unchanged" | "incomplete" | "unusable_time" | "unusable_date" }
  | { save: true; delayMs: number; loud: boolean; changed: string[] };

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

/** Which of `fields` differ between the record on file and what is on screen. */
export function changedFields(before: Fields, after: Fields, fields: readonly string[]): string[] {
  return fields.filter((key) => {
    // Both sides through the same normaliser, or "3:30 PM" and "03:30 PM" read as a change that
    // is not one — and would message the patient to tell them so.
    if (key === "time") return normalizeTimeKey(text(before[key])) !== normalizeTimeKey(text(after[key]));
    if (key === "duration") return (Number(before[key]) || 0) !== (Number(after[key]) || 0);
    return text(before[key]) !== text(after[key]);
  });
}

/** A time the clinic could actually keep. Anything half-typed fails here. */
export function isUsableTime(value: unknown): boolean {
  const raw = text(value);
  if (!raw) return false;
  const normalized = normalizeTimeKey(raw);
  const shape = normalized.match(/^(\d{2}):(\d{2}) (AM|PM)$/);
  if (!shape) return false;
  // The shape alone is not enough: `normalizeTimeKey` hands back what it could not parse, and
  // "03:75 PM" has the shape of a time while being none. Range-check what came out.
  const hours = Number(shape[1]);
  const mins = Number(shape[2]);
  return hours >= 1 && hours <= 12 && mins >= 0 && mins <= 59;
}

/** A date the clinic could actually keep: a real calendar day, written the way the app stores it. */
export function isUsableDate(value: unknown): boolean {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const ms = Date.parse(`${raw}T12:00:00Z`);
  if (!Number.isFinite(ms)) return false;
  // Rejects 2026-02-31, which Date.parse would otherwise roll forward into March.
  return new Date(ms).toISOString().slice(0, 10) === raw;
}

/**
 * Should the panel save what is on screen, and how long should it wait first?
 *
 * `required` names the fields that must be present before anything is written at all — empty for
 * an appointment that already exists (every field can be blanked back to what it was), and the
 * booking form's own list for one being created.
 */
export function autosaveVerdict(
  before: Fields,
  after: Fields,
  options: { required?: readonly string[]; fields?: readonly string[] } = {}
): AutosaveVerdict {
  const fields = options.fields ?? [...LOUD_FIELDS, ...QUIET_FIELDS];
  const required = options.required ?? [];

  for (const key of required) {
    if (!text(after[key])) return { save: false, reason: "incomplete" };
  }

  const changed = changedFields(before, after, fields);
  if (changed.length === 0) return { save: false, reason: "unchanged" };

  // A half-typed loud field blocks the whole write, not just its own column: the panel saves the
  // form as one payload, so letting a note through would carry "03:" along with it.
  const touchesTime = changed.includes("time") || required.includes("time");
  const touchesDate = changed.includes("date") || required.includes("date");
  if (touchesTime && !isUsableTime(after.time)) return { save: false, reason: "unusable_time" };
  if (touchesDate && !isUsableDate(after.date)) return { save: false, reason: "unusable_date" };

  const loud =
    changed.some((key) => (LOUD_FIELDS as readonly string[]).includes(key)) ||
    // Cancelling is loud too: bookingService tells the patient their visit is off.
    (changed.includes("status") && text(after.status) === "Cancelled");

  return { save: true, delayMs: loud ? LOUD_DELAY_MS : QUIET_DELAY_MS, loud, changed };
}
