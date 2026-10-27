/**
 * The patient fields a message the clinic sent can write onto its chat, or null when it knows nobody.
 *
 * A booking confirmation, reminder or receipt is addressed to a patient the sender already looked
 * up, so the chat it opens can carry their name from the first line instead of waiting for the
 * patient to write back. "Patient" is the senders' stand-in for a missing name and never a name.
 */
export function knownPatientPatch(
  patientId: string | null | undefined,
  patientName: string | null | undefined
): { patientId: string; patientName?: string } | null {
  const id = String(patientId ?? "").trim();
  if (!id) return null;
  const name = String(patientName ?? "").trim();
  return name && name !== "Patient" ? { patientId: id, patientName: name } : { patientId: id };
}
