/**
 * The chair popup's decisions, kept out of the component so they can be tested.
 *
 * A dentist at the chair sees every treatment on the patient — theirs and other dentists' —
 * and may press things only on their own. The money that reception attaches to a treatment
 * never appears here; see docs/superpowers/specs/2026-10-08-dentist-chair-mode-design.md.
 */
import { isMine, type DentistIdentity } from "@/lib/dentistHome";
import type { Note } from "@/components/clinical-notes/types";
import { lineStatusOf, type InsuranceClaim, type LineStatus } from "@/lib/insurance/claims";

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
