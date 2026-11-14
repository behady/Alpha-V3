/**
 * Which month a contract company's (GASCO's) monthly sheet lists each patient on.
 *
 * The company is billed for a patient once his treatment is FINISHED, not visit by visit:
 *
 * - from November 2026 each month's sheet lists a patient whose work is all Done, with everything
 *   that was waiting on him (old finished visits and new ones together);
 * - a patient with any treatment still Planned or Ongoing is held, whatever the clinic tapped: he
 *   carries to the next month with his work waiting;
 * - a patient who finished AFTER the month ended is held as "finished late" and printed the month
 *   after, unless the clinic ticked "include" to pull him into the month he was treated in;
 * - ticking "hold" carries a finished patient to the next month;
 * - once printed, the waiting list is empty: a patient who comes back prints only his new work.
 *
 * Pure: no Firebase, no React. Charges before the start month never enter the walk.
 */
import { monthsBetween } from "@/lib/insurance/billingMonth";
import type { StatementRowLite } from "@/lib/insuranceStatement";
import { toYmd } from "@/lib/reports/patientStats";

export const COMPANY_SHEET_START = "2026-11";

export type SheetChoice = "include" | "hold";
export type SheetCharge = StatementRowLite & { clinicalNoteId?: unknown; branchId?: unknown };
export type SheetCard = { id: string; status?: unknown; date?: unknown; completedDate?: unknown; continuedFromNoteId?: unknown };
export type SentMonth = { month: string; chargeIds: string[]; sentAt?: string; sentByName?: string };
export type HeldReason = "not_finished" | "finished_late" | "moved";
export type SheetPatient = { patientId: string; patientName: string; charges: SheetCharge[]; value: number; choice: SheetChoice | null };
export type HeldPatient = SheetPatient & { reason: HeldReason };
export type MonthSheet = { month: string; printed: SheetPatient[]; held: HeldPatient[]; sent: SentMonth | null };
export type SheetInputs = {
  charges: readonly SheetCharge[];
  cards: readonly SheetCard[];
  marks: Readonly<Record<string, SheetChoice>>;
  sent: readonly SentMonth[];
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const round2 = (n: number) => Math.round(n * 100) / 100;
const amountOf = (c: SheetCharge) => round2(Number(c.cost) || Number(c.amount) || 0);

export function markKey(patientId: string, month: string): string {
  return `${patientId}__${month}`;
}

/** Done state of the treatment behind a charge: newest card of its chain; no card / no status = done on the charge date. */
export function chargeDone(
  charge: SheetCharge,
  cards: ReadonlyMap<string, SheetCard>,
  children: ReadonlyMap<string, SheetCard[]>,
): { done: boolean; date: string } {
  const chargeDate = toYmd(charge.date);
  const start = cards.get(text(charge.clinicalNoteId));
  if (!start) return { done: true, date: chargeDate };

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
  const status = text(latest.status);
  if (!status) return { done: true, date: chargeDate };
  if (status !== "Completed") return { done: false, date: "" };
  return { done: true, date: toYmd(latest.completedDate) || toYmd(latest.date) || chargeDate };
}

const inScope = (c: SheetCharge, payerId: string) => {
  const status = text(c.status).toLowerCase();
  return (
    c.type === "procedure" &&
    text(c.payerId) === payerId &&
    status !== "deleted" &&
    status !== "cancelled" &&
    toYmd(c.date) >= `${COMPANY_SHEET_START}-01`
  );
};

/** One MonthSheet per month from COMPANY_SHEET_START to `through` (yyyy-mm), inclusive; [] when `through` is earlier. */
export function buildCompanySheets(inputs: SheetInputs & { payerId: string; through: string }): MonthSheet[] {
  const months = monthsBetween(`${COMPANY_SHEET_START}-01`, `${inputs.through}-01`);
  if (months.length === 0) return [];

  const cards = new Map(inputs.cards.map((c) => [c.id, c]));
  const children = new Map<string, SheetCard[]>();
  for (const c of inputs.cards) {
    const parent = text(c.continuedFromNoteId);
    if (!parent) continue;
    const list = children.get(parent);
    if (list) list.push(c);
    else children.set(parent, [c]);
  }

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
        const status = text(c.status).toLowerCase();
        if (c.type !== "procedure" || text(c.payerId) !== inputs.payerId || status === "deleted" || status === "cancelled") continue;
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
          choice: inputs.marks[markKey(patientId, month)] ?? null,
        });
      }
    }

    for (const [patientId, p] of byPatient) {
      const list = [...(waiting.get(patientId) ?? []), ...(p.byMonth.get(month) ?? [])];
      if (list.length === 0) continue;
      const states = list.map((c) => chargeDone(c, cards, children));
      const choice = inputs.marks[markKey(patientId, month)] ?? null;
      const row: SheetPatient = {
        patientId,
        patientName: p.name,
        charges: list,
        value: round2(list.reduce((s, c) => s + amountOf(c), 0)),
        choice,
      };

      let reason: HeldReason | null;
      if (states.some((s) => !s.done)) reason = "not_finished";
      else if (choice === "hold") reason = "moved";
      else if (choice === "include") reason = null;
      else reason = states.some((s) => s.date > `${month}-31`) ? "finished_late" : null;

      // a sent month takes no new patients
      if (!reason && sent) reason = states.some((s) => s.date > `${month}-31`) ? "finished_late" : "moved";

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
