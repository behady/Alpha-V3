/**
 * Which month a contract company's (GASCO's) monthly sheet lists each patient on.
 *
 * The company is billed for a patient once his treatment is FINISHED, not visit by visit:
 *
 * - from November 2026 each month's sheet lists a patient whose work is all Done, with everything
 *   that was waiting on him (old finished visits and new ones together);
 * - a patient with any treatment still Planned or Ongoing is held: he carries to the next month
 *   with his work waiting;
 * - a patient who finished AFTER the month ended is held as "finished late" and printed in the
 *   month he finished — so his work goes on the sheet of the month his LAST service was finished.
 *   To move him, the clinic changes that finish date (there is no per-patient switch any more);
 * - once printed, the waiting list is empty: a patient who comes back prints only his new work.
 *
 * Pure: no Firebase, no React. Charges before the start month never enter the walk.
 */
import { monthsBetween } from "@/lib/insurance/billingMonth";
import {
  buildInsuranceStatement,
  statementLineText,
  type Statement,
  type StatementCase,
  type StatementRowLite,
} from "@/lib/insuranceStatement";
import { toYmd } from "@/lib/reports/patientStats";

export const COMPANY_SHEET_START = "2026-11";

export type SheetCharge = StatementRowLite & { clinicalNoteId?: unknown; branchId?: unknown };
/** A treatment card. The fields after `continuedFromNoteId` are read only for the drawer's story. */
export type SheetCard = {
  id: string;
  status?: unknown;
  date?: unknown;
  completedDate?: unknown;
  continuedFromNoteId?: unknown;
  doctor?: unknown;
  createdByName?: unknown;
  finishLog?: unknown;
};
export type SentMonth = { month: string; chargeIds: string[]; sentAt?: string; sentByName?: string };
/** not_finished: some work is not done; finished_late: finished after the month ended; moved: the month was already sent. */
export type HeldReason = "not_finished" | "finished_late" | "moved";
export type SheetPatient = { patientId: string; patientName: string; charges: SheetCharge[]; value: number };
export type HeldPatient = SheetPatient & { reason: HeldReason };
export type MonthSheet = { month: string; printed: SheetPatient[]; held: HeldPatient[]; sent: SentMonth | null };
export type SheetInputs = {
  charges: readonly SheetCharge[];
  cards: readonly SheetCard[];
  sent: readonly SentMonth[];
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const round2 = (n: number) => Math.round(n * 100) / 100;
const amountOf = (c: SheetCharge) => round2(Number(c.cost) || Number(c.amount) || 0);

/** Document id of each month's sent document, in `settings`. */
export const sentDocId = (payerId: string, month: string) => `company_sheet_${payerId}_${month}`;

/** Cards by the card they continue. */
export function cardChildren(cards: readonly SheetCard[]): Map<string, SheetCard[]> {
  const children = new Map<string, SheetCard[]>();
  for (const c of cards) {
    const parent = text(c.continuedFromNoteId);
    if (!parent) continue;
    const list = children.get(parent);
    if (list) list.push(c);
    else children.set(parent, [c]);
  }
  return children;
}

/**
 * The whole treatment a card belongs to: every card of it, oldest first (the first card leads a
 * same-day tie), and the card that speaks for it — the newest; on the same day, a continuation.
 * null when the card is not in `cards`.
 */
export function treatmentChain(
  noteId: string,
  cards: ReadonlyMap<string, SheetCard>,
  children: ReadonlyMap<string, SheetCard[]>,
): { chain: SheetCard[]; latest: SheetCard } | null {
  const start = cards.get(noteId);
  if (!start) return null;

  // The first card of the treatment, then every card that continues it.
  let root = start;
  for (let hops = 0; hops < 20; hops++) {
    const parent = cards.get(text(root.continuedFromNoteId));
    if (!parent || parent.id === root.id) break;
    root = parent;
  }
  const chain: SheetCard[] = [];
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length) {
    const at = queue.shift() as SheetCard;
    if (seen.has(at.id)) continue;
    seen.add(at.id);
    chain.push(at);
    queue.push(...(children.get(at.id) ?? []));
  }

  // The newest card speaks for the treatment; on the same day, the continuation does.
  const latest = chain.reduce((a, b) => {
    const da = toYmd(a.date);
    const db = toYmd(b.date);
    if (db !== da) return db > da ? b : a;
    return b.id !== root.id ? b : a;
  });
  const rootId = root.id;
  const ordered = [...chain].sort(
    (a, b) => toYmd(a.date).localeCompare(toYmd(b.date)) || (a.id === rootId ? -1 : b.id === rootId ? 1 : 0),
  );
  return { chain: ordered, latest };
}

/** Done state of the treatment behind a charge: newest card of its chain; no card / no status = done on the charge date. */
export function chargeDone(
  charge: SheetCharge,
  cards: ReadonlyMap<string, SheetCard>,
  children: ReadonlyMap<string, SheetCard[]>,
): { done: boolean; date: string } {
  const chargeDate = toYmd(charge.date);
  const found = treatmentChain(text(charge.clinicalNoteId), cards, children);
  if (!found) return { done: true, date: chargeDate };
  const { latest } = found;
  const status = text(latest.status);
  if (!status) return { done: true, date: chargeDate };
  if (status !== "Completed") return { done: false, date: "" };
  return { done: true, date: toYmd(latest.completedDate) || toYmd(latest.date) || chargeDate };
}

/** A live procedure charge of this company: not deleted, not cancelled. */
const isLiveCharge = (c: SheetCharge, payerId: string) => {
  const status = text(c.status).toLowerCase();
  return c.type === "procedure" && text(c.payerId) === payerId && status !== "deleted" && status !== "cancelled";
};

/** A live charge dated from the start month on: the only ones that enter the walk. */
const inScope = (c: SheetCharge, payerId: string) => isLiveCharge(c, payerId) && toYmd(c.date) >= `${COMPANY_SHEET_START}-01`;

/** One MonthSheet per month from COMPANY_SHEET_START to `through` (yyyy-mm), inclusive; [] when `through` is earlier. */
export function buildCompanySheets(inputs: SheetInputs & { payerId: string; through: string }): MonthSheet[] {
  const months = monthsBetween(`${COMPANY_SHEET_START}-01`, `${inputs.through}-01`);
  if (months.length === 0) return [];

  const cards = new Map(inputs.cards.map((c) => [c.id, c]));
  const children = cardChildren(inputs.cards);

  // A charge in any sent list belongs to that sent month only, wherever it is dated now.
  const sentIds = new Set<string>();
  const sentByMonth = new Map<string, SentMonth>();
  for (const s of inputs.sent) {
    sentByMonth.set(s.month, s);
    for (const id of s.chargeIds) sentIds.add(id);
  }
  const chargeById = new Map(inputs.charges.map((c) => [text(c.id), c]));

  // Each patient's charges by month.
  const byPatient = new Map<string, { name: string; byMonth: Map<string, SheetCharge[]> }>();
  for (const charge of inputs.charges) {
    if (sentIds.has(text(charge.id))) continue;
    if (!inScope(charge, inputs.payerId)) continue;
    const patientId = text(charge.patientId);
    if (!patientId) continue;
    const month = toYmd(charge.date).slice(0, 7);
    let p = byPatient.get(patientId);
    if (!p) byPatient.set(patientId, (p = { name: text(charge.patientName), byMonth: new Map() }));
    const list = p.byMonth.get(month);
    if (list) list.push(charge);
    else p.byMonth.set(month, [charge]);
  }

  const waiting = new Map<string, SheetCharge[]>();
  const firstDate = (p: SheetPatient) => p.charges.reduce((m, c) => (toYmd(c.date) < m ? toYmd(c.date) : m), "9999-99-99");
  const order = (a: SheetPatient, b: SheetPatient) =>
    firstDate(a).localeCompare(firstDate(b)) || a.patientName.localeCompare(b.patientName);

  return months.map((month) => {
    const printed: SheetPatient[] = [];
    const held: HeldPatient[] = [];
    const sent = sentByMonth.get(month) ?? null;

    // A sent month prints only its stored list, minus charges since deleted / cancelled / no longer this payer's.
    if (sent) {
      const listed = new Map<string, { name: string; charges: SheetCharge[] }>();
      for (const id of sent.chargeIds) {
        const c = chargeById.get(id);
        if (!c) continue;
        if (!isLiveCharge(c, inputs.payerId)) continue;
        const patientId = text(c.patientId);
        if (!patientId) continue;
        const entry = listed.get(patientId);
        if (entry) entry.charges.push(c);
        else listed.set(patientId, { name: text(c.patientName), charges: [c] });
      }
      for (const [patientId, e] of listed) {
        printed.push({
          patientId,
          patientName: e.name,
          charges: e.charges,
          value: round2(e.charges.reduce((s, c) => s + amountOf(c), 0)),
        });
      }
    }

    for (const [patientId, p] of byPatient) {
      const list = [...(waiting.get(patientId) ?? []), ...(p.byMonth.get(month) ?? [])];
      if (list.length === 0) continue;
      const states = list.map((c) => chargeDone(c, cards, children));
      const row: SheetPatient = {
        patientId,
        patientName: p.name,
        charges: list,
        value: round2(list.reduce((s, c) => s + amountOf(c), 0)),
      };

      let reason: HeldReason | null = null;
      if (states.some((s) => !s.done)) reason = "not_finished";
      else if (states.some((s) => s.date > `${month}-31`)) reason = "finished_late";
      // a sent month takes no new patients
      else if (sent) reason = "moved";

      if (reason) {
        held.push({ ...row, reason });
        waiting.set(patientId, list);
      } else {
        printed.push(row);
        waiting.delete(patientId);
      }
    }
    printed.sort(order);
    held.sort(order);
    return { month, printed, held, sent };
  });
}

/** Why `month` cannot be marked sent, or null when it can. */
export function sendRefusal(sheets: readonly MonthSheet[], month: string): "empty" | "earlier_open" | "already_sent" | null {
  const sheet = sheets.find((s) => s.month === month);
  if (sheet?.sent) return "already_sent";
  if (!sheet || sheet.printed.length === 0) return "empty";
  if (sheets.some((s) => s.month < month && s.printed.length > 0 && s.sent === null)) return "earlier_open";
  return null;
}

/** Why `month` cannot be marked not sent, or null when it can. */
export function unsendRefusal(sheets: readonly MonthSheet[], month: string): "not_sent" | "later_sent" | null {
  const sheet = sheets.find((s) => s.month === month);
  if (!sheet?.sent) return "not_sent";
  if (sheets.some((s) => s.month > month && s.sent)) return "later_sent";
  return null;
}

/** The charge ids a `send` stores: every printed charge of the month. */
export function sheetChargeIds(sheet: MonthSheet): string[] {
  return sheet.printed.flatMap((p) => p.charges.map((c) => text(c.id)));
}

/** Sheets with only the charges `keep` accepts; a patient left with none is dropped. */
export function scopeSheets(sheets: readonly MonthSheet[], keep: (charge: SheetCharge) => boolean): MonthSheet[] {
  const scope = <T extends SheetPatient>(patients: readonly T[]): T[] =>
    patients.flatMap((p) => {
      const charges = p.charges.filter(keep);
      if (charges.length === 0) return [];
      return [{ ...p, charges, value: round2(charges.reduce((sum, c) => sum + amountOf(c), 0)) }];
    });
  return sheets.map((s) => ({ ...s, printed: scope(s.printed), held: scope(s.held) }));
}

/**
 * The company's statement for [start, end]: today's per-visit cases for the part of the range
 * before 2026-11-01, then one case per printed patient for each month the range touches from
 * 2026-11 on. Serials run through; `total` is the sum.
 */
export function companyStatement(
  args: SheetInputs & {
    payerId: string;
    payerName: string;
    range: { start: string; end: string };
    memberNumbers: ReadonlyMap<string, string>;
    keep?: (charge: SheetCharge) => boolean; // the branch on screen; applied after the walk
  },
): { statement: Statement; sheets: MonthSheet[] } {
  const { payerId, payerName, range, memberNumbers, keep } = args;
  const firstSheetDay = `${COMPANY_SHEET_START}-01`;
  const month = range.start.slice(0, 7);
  const cases: StatementCase[] = [];
  let sheets: MonthSheet[] = [];

  if (range.start <= range.end) {
    if (range.start < firstSheetDay) {
      const legacy = buildInsuranceStatement({
        rows: keep ? args.charges.filter(keep) : [...args.charges],
        payerId,
        payerName,
        month,
        range: { start: range.start, end: range.end < firstSheetDay ? range.end : "2026-10-31" },
        memberNumbers,
      });
      cases.push(...legacy.cases);
    }

    if (range.end >= firstSheetDay) {
      const touched = new Set(monthsBetween(range.start > firstSheetDay ? range.start : firstSheetDay, range.end));
      const walked = buildCompanySheets({ ...args, through: range.end.slice(0, 7) }).filter((s) => touched.has(s.month));
      sheets = keep ? scopeSheets(walked, keep) : walked;
      for (const sheet of sheets) {
        for (const p of sheet.printed) {
          const charges = [...p.charges].sort((a, b) => toYmd(a.date).localeCompare(toYmd(b.date)));
          const lines = charges.map((c) => ({ text: statementLineText(c), amount: amountOf(c), rowId: text(c.id) }));
          cases.push({
            serial: 0,
            patientId: p.patientId,
            patientName: p.patientName,
            memberNumber: text(memberNumbers.get(p.patientId)),
            date: toYmd(charges[0].date),
            lines,
            subtotal: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
          });
        }
      }
    }
  }

  cases.forEach((c, i) => {
    c.serial = i + 1;
  });
  const seen = new Set<string>();
  const missingMemberNumber: Statement["missingMemberNumber"] = [];
  for (const c of cases) {
    if (c.memberNumber || seen.has(c.patientId)) continue;
    seen.add(c.patientId);
    missingMemberNumber.push({ patientId: c.patientId, patientName: c.patientName });
  }
  return {
    statement: {
      payerId,
      payerName,
      month,
      cases,
      total: round2(cases.reduce((sum, c) => sum + c.subtotal, 0)),
      missingMemberNumber,
    },
    sheets,
  };
}
