import { Note, RelatedAppointment } from "./types";

/**
 * How the services in a patient's clinical note are arranged.
 *
 * These are display preferences, held per user (see UIContext), with one exception: manual order
 * is stored on the notes themselves, because a hand-arranged treatment sequence is something the
 * whole clinic needs to see the same way. See `Note.sortIndex`.
 */
export type ClinicalNoteSort = "newest" | "oldest" | "manual";
export type ClinicalNoteGrouping = "flat" | "visit";
export type ClinicalNoteDensity = "detailed" | "compact";

export const CLINICAL_NOTE_SORTS: ClinicalNoteSort[] = ["newest", "oldest", "manual"];
export const CLINICAL_NOTE_GROUPINGS: ClinicalNoteGrouping[] = ["flat", "visit"];
export const CLINICAL_NOTE_DENSITIES: ClinicalNoteDensity[] = ["detailed", "compact"];

export function isClinicalNoteSort(v: unknown): v is ClinicalNoteSort {
  return typeof v === "string" && (CLINICAL_NOTE_SORTS as string[]).includes(v);
}
export function isClinicalNoteGrouping(v: unknown): v is ClinicalNoteGrouping {
  return typeof v === "string" && (CLINICAL_NOTE_GROUPINGS as string[]).includes(v);
}
export function isClinicalNoteDensity(v: unknown): v is ClinicalNoteDensity {
  return typeof v === "string" && (CLINICAL_NOTE_DENSITIES as string[]).includes(v);
}

/**
 * The moment a note sits at on the timeline.
 *
 * The treatment date the user chose always wins over when it was typed in — a procedure backdated
 * to correct a late entry belongs at its real place in the history, not at today. createdAt is the
 * fallback for a note with no date at all.
 */
export function noteDateKey(note: Note): number {
  const chosen = note.date ? new Date(`${note.date}T00:00:00`).getTime() : NaN;
  if (!Number.isNaN(chosen)) return chosen;
  return note.createdAt?.toMillis?.() ?? 0;
}

function createdKey(note: Note): number {
  return note.createdAt?.toMillis?.() ?? 0;
}

/**
 * A note's manual position.
 *
 * Notes saved before manual order was ever used have no sortIndex. Rather than dumping them all at
 * position 0 — where they would pile up in arbitrary order above everything deliberately arranged —
 * they fall to the end, still in date order among themselves.
 */
function manualKey(note: Note): number {
  return typeof note.sortIndex === "number" && Number.isFinite(note.sortIndex)
    ? note.sortIndex
    : Number.MAX_SAFE_INTEGER;
}

/** Order a flat list of services. Never mutates the input. */
export function sortNotes(notes: Note[], mode: ClinicalNoteSort): Note[] {
  const list = [...notes];

  if (mode === "manual") {
    return list.sort((a, b) => {
      const keyA = manualKey(a);
      const keyB = manualKey(b);
      if (keyA !== keyB) return keyA - keyB;
      // Two un-arranged notes: newest first, matching the default view they came from.
      const dateDiff = noteDateKey(b) - noteDateKey(a);
      return dateDiff !== 0 ? dateDiff : createdKey(b) - createdKey(a);
    });
  }

  const direction = mode === "oldest" ? 1 : -1;
  return list.sort((a, b) => {
    const dateDiff = (noteDateKey(a) - noteDateKey(b)) * direction;
    if (dateDiff !== 0) return dateDiff;
    // Same day: fall back to entry order, in the same direction.
    return (createdKey(a) - createdKey(b)) * direction;
  });
}

export interface NoteGroup {
  /** Stable React key. The literal "__general__" for services attached to no appointment. */
  key: string;
  appointment: RelatedAppointment | null;
  notes: Note[];
  /** Timeline position of the group as a whole, used to order groups against each other. */
  dateKey: number;
}

export const GENERAL_GROUP_KEY = "__general__";

/**
 * Cluster services under the visit they were performed at.
 *
 * A service whose appointmentId points at an appointment that no longer exists (deleted, or moved
 * to another patient) still has to appear somewhere — losing a billed procedure from the screen
 * because its appointment was tidied up would be the worst possible failure here. Those fall into
 * the general group alongside services that were never tied to a visit.
 */
export function groupNotesByVisit(
  notes: Note[],
  appointments: RelatedAppointment[],
  mode: ClinicalNoteSort
): NoteGroup[] {
  const appointmentById = new Map(appointments.map((a) => [a.id, a]));
  const groups = new Map<string, NoteGroup>();

  for (const note of sortNotes(notes, mode)) {
    const apptId = note.appointmentId || "";
    const appointment = apptId ? appointmentById.get(apptId) ?? null : null;
    const key = appointment ? appointment.id : GENERAL_GROUP_KEY;

    const existing = groups.get(key);
    if (existing) {
      existing.notes.push(note);
      continue;
    }

    const apptDate = appointment?.date ? new Date(`${appointment.date}T00:00:00`).getTime() : NaN;
    groups.set(key, {
      key,
      appointment,
      notes: [note],
      dateKey: Number.isNaN(apptDate) ? noteDateKey(note) : apptDate,
    });
  }

  const ordered = Array.from(groups.values());

  if (mode === "manual") {
    // Groups follow the manual order of their first service, so dragging a service to the top
    // carries its visit with it rather than leaving the group behind.
    return ordered;
  }

  const direction = mode === "oldest" ? 1 : -1;
  return ordered.sort((a, b) => {
    // The loose "general" bucket has no date of its own and always sits last, whichever way the
    // timeline runs — it is a holding area, not a point in the patient's history.
    if (a.key === GENERAL_GROUP_KEY) return 1;
    if (b.key === GENERAL_GROUP_KEY) return -1;
    return (a.dateKey - b.dateKey) * direction;
  });
}

/**
 * The sortIndex values to persist after a drag.
 *
 * Returns only the notes whose index actually changes, so a drag writes two or three documents
 * instead of rewriting the patient's entire history on every nudge.
 */
export function reorderedIndexes(ordered: Note[]): { id: string; sortIndex: number }[] {
  const changes: { id: string; sortIndex: number }[] = [];
  ordered.forEach((note, index) => {
    if (note.sortIndex !== index) changes.push({ id: note.id, sortIndex: index });
  });
  return changes;
}

/** Move an item within a list. Returns a new array; out-of-range indexes are a no-op. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
