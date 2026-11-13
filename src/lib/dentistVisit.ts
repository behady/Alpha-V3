/**
 * What the dentist's home says about one booking beyond its time and name: which insurer the
 * patient is on, what is still to do on them, and the notes the clinic left on their file.
 *
 * Plain functions over plain rows, like lib/dentistHome — the screen subscribes and renders, the
 * decisions are here so they can be tested without a browser. Nothing here reads or shows money.
 */

import { parseClaimLinks } from "@/lib/insurance/appointments";
import { readInsurance } from "@/lib/patientInsurance";
import { findPayer, payerForPriceList, payerOf, PRIVATE_PAYER_ID, type Payer } from "@/lib/payers";
import type { Row } from "@/lib/dentistHome";

export type TodoItem = {
  id: string;
  name: string;
  /** "16" or "44, 46"; empty for a whole-mouth treatment. */
  teeth: string;
  status: "Planned" | "Ongoing";
  /** The insurer the treatment is charged to; null for the clinic's own (private) work. */
  payerId: string | null;
  /**
   * The insurer's name as stored on the row, when one was. Rows written by an approval carry the
   * id alone, so the screen looks the name up from the id first and uses this only as a fallback.
   */
  payerName: string | null;
};

/**
 * The patient's treatments that are not finished: started ones first, then the planned ones in
 * the order they were planned.
 *
 * An approved insurance service is already one of these — the approval writes its treatment into
 * the patient's file — so it needs no second source; it is recognised by the payer on the row.
 */
export function openTreatments(notes: readonly Row[], patientId: string): TodoItem[] {
  if (!patientId) return [];
  const out: Array<TodoItem & { date: string }> = [];
  for (const n of notes) {
    if (String(n.patientId || "") !== patientId) continue;
    const status = String(n.status || "");
    if (status !== "Planned" && status !== "Ongoing") continue;
    const name = String(n.procedure || "").trim() || String(n.serviceName || "").trim();
    if (!name) continue;
    const tooth = String(n.tooth || "").trim();
    const insured = payerOf(n).payerId !== PRIVATE_PAYER_ID;
    out.push({
      id: String(n.id || ""),
      name,
      teeth: tooth && tooth !== "Gen" ? tooth : "",
      status,
      payerId: insured ? payerOf(n).payerId : null,
      // The row's own name only — `payerOf` answers "Private" for a missing one, which is wrong here.
      payerName: insured ? String(n.payerName || "").trim() || null : null,
      date: String(n.date || ""),
    });
  }
  out.sort((a, b) => (a.status === b.status ? a.date.localeCompare(b.date) : a.status === "Ongoing" ? -1 : 1));
  return out.map(({ date: _date, ...item }) => item);
}

const insurerOrNull = (payer: Payer | null | undefined): Payer | null =>
  payer && payer.active && payer.id !== PRIVATE_PAYER_ID ? payer : null;

/**
 * The insurer whose badge this booking wears, or null for private work.
 *
 * Asked in the order of how sure each answer is: the approval this very visit was booked against,
 * then an insurer the patient is a member of, then the insurer that owns the patient's price list
 * (a company patient with no membership number). An approval that could not be read names nobody.
 */
export function visitInsurer(args: {
  apt: Row;
  patient: Row | null | undefined;
  payers: readonly Payer[];
  /** claim id → payer id, for the approvals the day's bookings are linked to. */
  claimPayerIds: Readonly<Record<string, string>>;
}): Payer | null {
  const { apt, patient, payers, claimPayerIds } = args;
  for (const link of parseClaimLinks(apt)) {
    const hit = insurerOrNull(findPayer(payers, claimPayerIds[link.claimId]));
    if (hit) return hit;
  }
  if (!patient) return null;
  for (const payerId of Object.keys(readInsurance(patient))) {
    const hit = insurerOrNull(findPayer(payers, payerId));
    if (hit) return hit;
  }
  const listId = typeof patient.defaultPriceListId === "string" ? patient.defaultPriceListId : null;
  return insurerOrNull(payerForPriceList(payers, listId));
}

/** The open notes on the patient's file (the Notes page), earliest first, as the text to show. */
export function patientNotes(
  reminders: ReadonlyArray<{ patientId?: unknown; status?: unknown; reason?: unknown; fireAtMs?: unknown }>,
  patientId: string,
): string[] {
  if (!patientId) return [];
  return reminders
    .filter((r) => String(r.patientId || "") === patientId && r.status === "open" && String(r.reason || "").trim())
    .sort((a, b) => (Number(a.fireAtMs) || 0) - (Number(b.fireAtMs) || 0))
    .map((r) => String(r.reason).trim());
}
