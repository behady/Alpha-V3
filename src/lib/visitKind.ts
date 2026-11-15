/**
 * The two answers reception gives when booking, beside the appointment's status: is this a new
 * patient or an old one, and is the visit new work or a follow-up on work already started.
 *
 * They exist for the dentist (owner's ask, 2026-11-13): the dentist's home shows them as tags, so
 * a first visit is not opened like the fifth sitting of a crown. Both are optional — a booking
 * made before the pickers existed, or by a path that has none (the bot, the side drawer), simply
 * has no answer and shows no tag. Stored on the appointment as `patientKind` and `workKind`.
 *
 * Pure: no database, no imports from the app.
 */

export type PatientKind = "new" | "old";
export type WorkKind = "new" | "followup";

export function normalizePatientKind(v: unknown): PatientKind | null {
  return v === "new" || v === "old" ? v : null;
}

export function normalizeWorkKind(v: unknown): WorkKind | null {
  return v === "new" || v === "followup" ? v : null;
}

/** The tag as the dentist reads it. */
export function patientKindLabel(kind: PatientKind, lang: "ar" | "en"): string {
  if (kind === "new") return lang === "ar" ? "مريض جديد" : "New patient";
  return lang === "ar" ? "مريض قديم" : "Old patient";
}

export function workKindLabel(kind: WorkKind, lang: "ar" | "en"): string {
  if (kind === "new") return lang === "ar" ? "شغل جديد" : "New work";
  return lang === "ar" ? "متابعة" : "Follow-up";
}

/** Statuses that mean the patient was actually in the clinic for that visit. */
const SEEN = new Set(["Checked In", "In Chair", "Checking Out", "Completed"]);
/** Statuses that mean the visit never happened, whatever its date. */
const NEVER_HAPPENED = new Set(["Cancelled", "No Show", "Rescheduled"]);

/**
 * The answer the Patient picker starts on, so reception only taps when it is wrong.
 *
 * "Old" means the clinic has actually seen this person: a visit they attended, a past booking
 * that was not cancelled or missed, or treatments on their file (a patient imported from the
 * clinic's old records has those and no bookings at all). A first visit still in the future does
 * not make them old — booking a second visit before the first has happened is still a new patient.
 */
export function guessPatientKind(args: {
  isNewPatient: boolean;
  visits: ReadonlyArray<{ date?: unknown; status?: unknown }>;
  hasNotes: boolean;
  today: string;
}): PatientKind {
  if (args.isNewPatient) return "new";
  if (args.hasNotes) return "old";
  const seen = args.visits.some((v) => {
    const status = String(v.status || "");
    if (NEVER_HAPPENED.has(status)) return false;
    if (SEEN.has(status)) return true;
    const date = String(v.date || "");
    return !!date && date < args.today;
  });
  return seen ? "old" : "new";
}
