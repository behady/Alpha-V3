/**
 * "General" — a visit the clinic owns rather than one dentist.
 *
 * Stored as an empty `doctor` with a null `doctorId`: exactly the shape an appointment has always
 * had when nobody was named on it. So every reader that already falls back to "Unassigned" keeps
 * working, the conflict check keeps treating the visit as occupying the chair (lib/appointmentConflicts
 * decides that for rows with no dentist on them), and nothing can mistake it for a real staff id —
 * a charge posted against a made-up id would pay commission to nobody and drop out of the payout
 * report, which is worse than the warning it would save.
 *
 * The sentinel below is a PICKER value only and never reaches Firestore. A `<select>` cannot tell
 * "General is chosen" from "nothing is chosen yet" if both are the empty string, and the booking
 * modal deliberately repairs an empty dentist by snapping to the first one on staff — which would
 * undo the choice the instant it was made.
 */

export const GENERAL_DOCTOR_VALUE = "__general__";

/** Is this picker value the General option? */
export function isGeneralDoctorValue(value: string | null | undefined): boolean {
  return String(value || "").trim() === GENERAL_DOCTOR_VALUE;
}

/** The `doctor` field to store for a picker value. General — and anything blank — stores as "". */
export function doctorFieldFromPicker(value: string | null | undefined): string {
  return isGeneralDoctorValue(value) ? "" : String(value || "");
}

/**
 * The picker value for a stored appointment. An appointment with no dentist on it — whether it was
 * booked as General or predates this option — opens on General rather than being silently handed to
 * whoever happens to be first on staff.
 */
export function pickerValueFromDoctorField(name: string | null | undefined): string {
  const trimmed = String(name || "").trim();
  return trimmed ? trimmed : GENERAL_DOCTOR_VALUE;
}

/** What the option and the columns call it. */
export function generalDoctorLabel(language?: string | null): string {
  return language === "ar" ? "عام" : "General";
}

/**
 * How the dentist reads on an appointment card: the short form for a real dentist, "General" when
 * there is none. Without this the cards render a bare "Dr." with nothing after it.
 *
 * The second word is used because clinic staff records are usually kept as "Dr. Ahmed".
 */
export function doctorCardLabel(name: string | null | undefined, language?: string | null): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) return generalDoctorLabel(language);
  return `Dr. ${trimmed.split(" ")[1] || trimmed}`;
}
