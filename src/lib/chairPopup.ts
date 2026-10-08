/**
 * The chair popup's decisions, kept out of the component so they can be tested.
 *
 * A dentist at the chair sees every treatment on the patient — theirs and other dentists' —
 * and may press things only on their own. The money that reception attaches to a treatment
 * never appears here; see docs/superpowers/specs/2026-10-08-dentist-chair-mode-design.md.
 */
import { isMine, type DentistIdentity } from "@/lib/dentistHome";
import type { Note } from "@/components/clinical-notes/types";
import { parseTeethString } from "@/components/clinical-notes/utils";
import { lineStatusOf, type InsuranceClaim, type LineStatus } from "@/lib/insurance/claims";
import type { ProcedureWriteArgs } from "@/lib/moneyApi";

/**
 * May this dentist change this note? Only with a real staff identity, and only on their own
 * work. A note with no dentist belongs to the clinic and is locked for everyone here. The name
 * fallback is `isMine`'s: rows written before `doctorId` existed carry only the display name.
 */
export function canTouch(note: Pick<Note, "doctorId" | "doctor">, me: Pick<DentistIdentity, "staffId" | "name"> | null): boolean {
  if (!me || !me.staffId) return false;
  return isMine(note as Record<string, unknown>, { ...me, commissionPct: 0 });
}

export type ChairGroup = {
  key: string;
  title: { ar: string; en: string };
  notes: Note[];
  isToday: boolean;
};

const NONE_KEY = "__none__";

/**
 * A patient's treatments in the order a dentist at the chair wants them: today's visit first
 * (there even when nothing has been written yet, so the new treatment has a home), then each
 * earlier visit newest first, then whatever was never tied to a visit.
 */
export function groupForChair(notes: Note[], todayAppointmentId: string | null, visitDates: Record<string, string>): ChairGroup[] {
  const byVisit = new Map<string, Note[]>();
  const unlinked: Note[] = [];
  for (const n of notes) {
    const id = n.appointmentId ? String(n.appointmentId) : "";
    if (!id) {
      unlinked.push(n);
      continue;
    }
    byVisit.set(id, [...(byVisit.get(id) ?? []), n]);
  }

  const out: ChairGroup[] = [];
  if (todayAppointmentId) {
    out.push({
      key: todayAppointmentId,
      title: { ar: "زيارة النهارده", en: "Today's visit" },
      notes: byVisit.get(todayAppointmentId) ?? [],
      isToday: true,
    });
    byVisit.delete(todayAppointmentId);
  }

  const dateOf = (id: string, list: Note[]) => visitDates[id] || String(list[0]?.date || "");
  const earlier = [...byVisit.entries()]
    .map(([id, list]) => ({ id, list, date: dateOf(id, list) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const v of earlier) {
    const label = v.date ? `${v.date}` : "";
    out.push({ key: v.id, title: { ar: `زيارة ${label}`.trim(), en: `Visit ${label}`.trim() }, notes: v.list, isToday: false });
  }

  if (unlinked.length > 0) {
    out.push({ key: NONE_KEY, title: { ar: "مش مرتبط بزيارة", en: "Not linked to a visit" }, notes: unlinked, isToday: false });
  }
  return out;
}

/**
 * What a status tap sends: the note exactly as stored, plus the new state.
 *
 * The procedures route re-prices a treatment from whatever body it gets. The first version sent
 * only the name and the state, so one tap re-priced the work from the catalogue: a continued
 * crown (cost 0, no charge) was billed a second time at the follow-up, an "A + B" note matched
 * nothing and lost its charge, and reception's typed price or discount vanished. So every
 * pricing field the note carries goes back as it is, and "bill it" is true only when it already
 * is billed.
 */
export type StatusPayload = ProcedureWriteArgs & { discountMode: string | null; discountValue: number | null; discountReason: string | null };
export function statusPayload(note: Note, me: { staffId: string }, next: "Planned" | "Ongoing" | "Completed"): StatusPayload {
  const raw = note as Note & {
    patientId?: string;
    priceListId?: string | null;
    discountMode?: string | null;
    discountValue?: number | null;
    discountReason?: string | null;
  };
  const unitCost = raw.unitCost === undefined || raw.unitCost === null || raw.unitCost === "" ? null : Number(raw.unitCost);
  return {
    patientId: String(raw.patientId || ""),
    appointmentId: note.appointmentId ?? null,
    procedures: note.procedures && note.procedures.length > 0 ? note.procedures : [String(note.procedure || "")],
    selectedTeeth: parseTeethString(note.tooth || ""),
    tooth: note.tooth,
    unitCost,
    pricingMode: note.pricingMode ?? null,
    doctorId: me.staffId,
    status: next,
    note: note.note ?? "",
    date: note.date,
    addToLedger: !!note.ledgerId || Number(note.cost) > 0,
    priceListId: raw.priceListId ?? null,
    payerId: note.payerId ?? null,
    discountMode: raw.discountMode ?? null,
    discountValue: raw.discountValue ?? null,
    discountReason: raw.discountReason ?? null,
  };
}

export type ApprovalLine = {
  claimId: string;
  lineIndex: number;
  name: string;
  /** "44, 46" — empty when the paper names no teeth (MetLife's never does). */
  teeth: string;
  status: LineStatus;
  mine: boolean;
};

/**
 * Every approved line on the patient's live approvals, flagged with whether it is this
 * dentist's. Status is all the chair sees of a line; what the insurer and the patient pay is
 * reception's.
 */
export function approvalLinesForChair(claims: InsuranceClaim[], me: { staffId: string } | null): ApprovalLine[] {
  const out: ApprovalLine[] = [];
  for (const c of claims) {
    if (c.status === "cancelled") continue;
    c.lines.forEach((line, i) => {
      out.push({
        claimId: c.id,
        lineIndex: i,
        name: line.description?.trim() || line.code,
        teeth: (line.teeth ?? []).join(", "),
        status: lineStatusOf(c, i),
        mine: !!me?.staffId && c.dentists?.[i]?.staffId === me.staffId,
      });
    });
  }
  return out;
}
