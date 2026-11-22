/**
 * Which month a contract company's (GASCO's) monthly sheet lists each procedure on.
 *
 * From November 2026 the company is billed procedure by procedure, each on ONE month's sheet:
 *
 * - a finished procedure goes on the month it was finished (its end date);
 * - the clinic can move any procedure to another month with the month picker (`months`), and can
 *   even place one that is not finished yet (the screen warns first);
 * - an unfinished procedure nobody placed is on no sheet;
 * - a sent month is frozen: it prints exactly the list stored when it was sent, and a procedure
 *   that would land on it afterwards goes on the next month that is not sent.
 *
 * A patient is listed on a month once, with the procedures of his that are on it.
 *
 * Pure: no Firebase, no React. Charges before the start month are never placed.
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
/** Why a procedure is not on a month's sheet. not_finished: not done and no month picked; moved: its month was already sent. */
export type HeldReason = "not_finished" | "moved";
export type SheetPatient = { patientId: string; patientName: string; charges: SheetCharge[]; value: number };
export type HeldPatient = SheetPatient & { reason: HeldReason };
export type MonthSheet = { month: string; printed: SheetPatient[]; held: HeldPatient[]; sent: SentMonth | null };
/** Where one procedure stands. `month`: the sheet it is on ("" = none); `auto`: where it goes with no pick ("" = nowhere). */
export type Placement = {
  month: string;
  auto: string;
  /** The month picked by hand, or "". */
  picked: string;
  /** It is on a sent month's stored list: locked. */
  sent: boolean;
  /** Its month was already sent without it, so it rolled on to `month`. */
  moved: boolean;
  done: boolean;
  /** The end date (done only). */
  finishDate: string;
};
export type SheetInputs = {
  charges: readonly SheetCharge[];
  cards: readonly SheetCard[];
  /** The month picked by hand for a procedure: charge id -> yyyy-mm. */
  months: Readonly<Record<string, string>>;
  sent: readonly SentMonth[];
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const round2 = (n: number) => Math.round(n * 100) / 100;
const amountOf = (c: SheetCharge) => round2(Number(c.cost) || Number(c.amount) || 0);

/** Document ids in `settings`: the company's picked months, and each month's sent list. */
export const monthsDocId = (payerId: string) => `company_sheet_${payerId}`;
export const sentDocId = (payerId: string, month: string) => `company_sheet_${payerId}_${month}`;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month after `month` (yyyy-mm). */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

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

/**
 * Where every procedure of the company stands, by charge id. Only live charges dated from the
 * start month on are placed.
 */
export function placeCharges(inputs: SheetInputs & { payerId: string }): Map<string, Placement> {
  const cards = new Map(inputs.cards.map((c) => [c.id, c]));
  const children = cardChildren(inputs.cards);
  const sentMonths = new Set(inputs.sent.map((s) => s.month));
  const sentOf = new Map<string, string>();
  for (const s of inputs.sent) for (const id of s.chargeIds) sentOf.set(id, s.month);

  const out = new Map<string, Placement>();
  for (const charge of inputs.charges) {
    if (!inScope(charge, inputs.payerId) || !text(charge.patientId)) continue;
    const id = text(charge.id);
    const state = chargeDone(charge, cards, children);
    const first = `${COMPANY_SHEET_START}`;
    const finishedIn = state.done && state.date ? state.date.slice(0, 7) : "";
    const auto = finishedIn ? (finishedIn < first ? first : finishedIn) : "";
    const raw = text(inputs.months[id]);
    const picked = MONTH_RE.test(raw) && raw >= first ? raw : "";
    const base = { auto, picked, done: state.done, finishDate: state.done ? state.date : "" };

    // On a sent list: that month, whatever happened to it since.
    const sentMonth = sentOf.get(id);
    if (sentMonth) {
      out.set(id, { ...base, month: sentMonth, sent: true, moved: false });
      continue;
    }
    // A sent month takes nothing new: roll on to the next month that is not sent.
    const want = picked || auto;
    let month = want;
    for (let hops = 0; month && sentMonths.has(month) && hops < 240; hops++) month = nextMonth(month);
    out.set(id, { ...base, month, sent: false, moved: month !== want });
  }
  return out;
}

/** One MonthSheet per month from COMPANY_SHEET_START to `through` (yyyy-mm), inclusive; [] when `through` is earlier. */
export function buildCompanySheets(inputs: SheetInputs & { payerId: string; through: string }): MonthSheet[] {
  const months = monthsBetween(`${COMPANY_SHEET_START}-01`, `${inputs.through}-01`);
  if (months.length === 0) return [];

  const placed = placeCharges(inputs);
  const sentByMonth = new Map(inputs.sent.map((s) => [s.month, s]));
  const sentMonths = new Set(sentByMonth.keys());

  type Bucket = Map<string, { name: string; charges: SheetCharge[] }>;
  const add = (bucket: Bucket, charge: SheetCharge) => {
    const patientId = text(charge.patientId);
    const entry = bucket.get(patientId);
    if (entry) entry.charges.push(charge);
    else bucket.set(patientId, { name: text(charge.patientName), charges: [charge] });
  };
  const printedBy = new Map<string, Bucket>();
  const movedBy = new Map<string, Bucket>();
  const waiting: SheetCharge[] = [];
  const bucketOf = (map: Map<string, Bucket>, month: string) => {
    let b = map.get(month);
    if (!b) map.set(month, (b = new Map()));
    return b;
  };
  for (const charge of inputs.charges) {
    const at = placed.get(text(charge.id));
    if (!at) continue; // not this company's live charge, or dated before the sheet began
    if (!at.month) waiting.push(charge);
    else add(bucketOf(printedBy, at.month), charge);
    // It wanted a month that was already sent: that month says so.
    if (at.moved) add(bucketOf(movedBy, at.picked || at.auto), charge);
  }

  const firstDate = (p: SheetPatient) => p.charges.reduce((m, c) => (toYmd(c.date) < m ? toYmd(c.date) : m), "9999-99-99");
  const order = (a: SheetPatient, b: SheetPatient) =>
    firstDate(a).localeCompare(firstDate(b)) || a.patientName.localeCompare(b.patientName);
  const rows = (bucket: Bucket | undefined): SheetPatient[] =>
    [...(bucket ?? new Map())].map(([patientId, e]) => ({
      patientId,
      patientName: e.name,
      charges: e.charges,
      value: round2(e.charges.reduce((sum: number, c: SheetCharge) => sum + amountOf(c), 0)),
    }));

  return months.map((month) => {
    const sent = sentByMonth.get(month) ?? null;
    const printed = rows(printedBy.get(month)).sort(order);
    const held: HeldPatient[] = [];
    if (sentMonths.has(month)) {
      for (const p of rows(movedBy.get(month))) held.push({ ...p, reason: "moved" });
    } else {
      // Not finished and not placed: on no sheet, shown from the month the procedure started.
      const bucket: Bucket = new Map();
      for (const c of waiting) if (toYmd(c.date).slice(0, 7) <= month) add(bucket, c);
      for (const p of rows(bucket)) held.push({ ...p, reason: "not_finished" });
    }
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
