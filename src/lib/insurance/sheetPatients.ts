/**
 * The company sheet seen one patient at a time: the list beside the drawer, the drawer's groups,
 * and each service's story.
 *
 * Everything here reads the month sheets `buildCompanySheets` already walked, so the list, the
 * drawer, the pop-up and the Excel can never disagree about which month a patient goes on.
 *
 * Pure: no Firebase, no React.
 */
import { monthsBetween } from "@/lib/insurance/billingMonth";
import { toYmd } from "@/lib/reports/patientStats";
import {
  chargeDone,
  treatmentChain,
  type HeldReason,
  type MonthSheet,
  type SentMonth,
  type SheetCard,
  type SheetCharge,
} from "@/lib/insurance/companySheet";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const round2 = (n: number) => Math.round(n * 100) / 100;
const amountOf = (c: SheetCharge) => round2(Number(c.cost) || Number(c.amount) || 0);
const sum = (list: readonly SheetCharge[]) => round2(list.reduce((s, c) => s + amountOf(c), 0));

/** The month after `month` (yyyy-mm). */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Where a patient stands against the dates picked on screen.
 * - on_sheet: his work is on a sheet inside the dates (`sent`: that month went already);
 * - waiting: some of his work is not finished, so it is on no sheet yet;
 * - later: finished, but it goes on a month after the dates;
 * - earlier: everything he had went on a month before the dates, nothing is pending.
 */
export type Standing =
  | { kind: "on_sheet"; month: string; sent: boolean }
  | { kind: "waiting" }
  | { kind: "later"; month: string }
  | { kind: "earlier"; month: string };

export type PatientRow = {
  patientId: string;
  patientName: string;
  standing: Standing;
  /** The charges the standing is about, and their value. */
  charges: SheetCharge[];
  value: number;
};

const ORDER: Record<Standing["kind"], number> = { on_sheet: 0, waiting: 1, later: 2, earlier: 3 };

/**
 * One row per patient found in `sheets` (walked from the start month through today or the end of
 * the dates, whichever is later). `from`/`to` are yyyy-mm.
 */
export function patientStandings(sheets: readonly MonthSheet[], from: string, to: string): PatientRow[] {
  const last = sheets[sheets.length - 1];
  const ids = new Map<string, string>();
  for (const s of sheets) for (const p of [...s.printed, ...s.held]) if (!ids.has(p.patientId)) ids.set(p.patientId, p.patientName);

  const rows: PatientRow[] = [];
  for (const [patientId, patientName] of ids) {
    const printed = sheets.flatMap((s) => {
      const p = s.printed.find((x) => x.patientId === patientId);
      return p ? [{ month: s.month, sent: s.sent !== null, charges: p.charges }] : [];
    });
    const inRange = printed.filter((p) => p.month >= from && p.month <= to);
    const after = printed.filter((p) => p.month > to);
    const heldEnd = last?.held.find((h) => h.patientId === patientId) ?? null;

    let standing: Standing;
    let charges: SheetCharge[];
    if (inRange.length) {
      const at = inRange[inRange.length - 1];
      standing = { kind: "on_sheet", month: at.month, sent: at.sent };
      charges = inRange.flatMap((p) => p.charges);
    } else if (after.length) {
      standing = { kind: "later", month: after[0].month };
      charges = after[0].charges;
    } else if (heldEnd) {
      standing = heldEnd.reason === "not_finished" ? { kind: "waiting" } : { kind: "later", month: nextMonth(last.month) };
      charges = heldEnd.charges;
    } else {
      const at = printed[printed.length - 1];
      if (!at) continue;
      standing = { kind: "earlier", month: at.month };
      charges = at.charges;
    }
    rows.push({ patientId, patientName, standing, charges, value: sum(charges) });
  }
  return rows.sort((a, b) => ORDER[a.standing.kind] - ORDER[b.standing.kind] || a.patientName.localeCompare(b.patientName));
}

/** One block of the drawer: a month's sheet (sent or not), or the work still waiting. */
export type DrawerGroup =
  | { kind: "month"; month: string; sent: SentMonth | null; charges: SheetCharge[]; value: number }
  | { kind: "pending"; reason: HeldReason; month: string; charges: SheetCharge[]; value: number };

/**
 * The patient's work as the drawer shows it: what is still pending first, then each month's sheet
 * he is on, newest first. A pending group's `month` is the one it would go on next.
 */
export function patientGroups(sheets: readonly MonthSheet[], patientId: string): DrawerGroup[] {
  const groups: DrawerGroup[] = [];
  const last = sheets[sheets.length - 1];
  const held = last?.held.find((h) => h.patientId === patientId);
  if (held) groups.push({ kind: "pending", reason: held.reason, month: nextMonth(last.month), charges: held.charges, value: held.value });
  for (const s of [...sheets].reverse()) {
    const p = s.printed.find((x) => x.patientId === patientId);
    if (p) groups.push({ kind: "month", month: s.month, sent: s.sent, charges: p.charges, value: p.value });
  }
  return groups;
}

/** A line of the finish log a card carries (written by the company-sheet route). */
export type FinishLogEntry = { day: string; kind: "date" | "reopened" | "finished"; byName: string; from: string; to: string };

export function parseFinishLog(raw: unknown): FinishLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const r = e as Record<string, unknown>;
    const kind = r.kind;
    if (kind !== "date" && kind !== "reopened" && kind !== "finished") return [];
    const day = toYmd(r.day);
    if (!day) return [];
    return [{ day, kind, byName: text(r.byName), from: toYmd(r.from), to: toYmd(r.to) }];
  });
}

export type StoryKind = "started" | "visit" | "finished" | "date_changed" | "reopened" | "marked_finished" | "sent";
export type StoryEvent = { date: string; kind: StoryKind; by?: string; from?: string; to?: string; month?: string };

const STORY_ORDER: Record<StoryKind, number> = {
  started: 0,
  visit: 1,
  marked_finished: 2,
  finished: 3,
  date_changed: 4,
  reopened: 5,
  sent: 6,
};

/** The timeline of one service: started, each visit, finished, every change made in the drawer, sent. */
export function serviceStory(
  charge: SheetCharge,
  cards: ReadonlyMap<string, SheetCard>,
  children: ReadonlyMap<string, SheetCard[]>,
  sent: readonly SentMonth[],
): StoryEvent[] {
  const events: StoryEvent[] = [];
  const found = treatmentChain(text(charge.clinicalNoteId), cards, children);
  const doctor = (c: SheetCard) => text(c.doctor).replace(/^Dr\.?\s*/i, "") || undefined;
  if (!found) {
    events.push({ date: toYmd(charge.date), kind: "started" });
  } else {
    found.chain.forEach((c, i) => {
      events.push({ date: toYmd(c.date), kind: i === 0 ? "started" : "visit", by: doctor(c) ?? (i === 0 ? text(c.createdByName) || undefined : undefined) });
      for (const e of parseFinishLog(c.finishLog)) {
        if (e.kind === "date") events.push({ date: e.day, kind: "date_changed", by: e.byName || undefined, from: e.from, to: e.to });
        else if (e.kind === "reopened") events.push({ date: e.day, kind: "reopened", by: e.byName || undefined, from: e.from });
        else events.push({ date: e.day, kind: "marked_finished", by: e.byName || undefined });
      }
    });
  }
  const done = chargeDone(charge, cards, children);
  if (done.done && done.date) events.push({ date: done.date, kind: "finished" });
  const id = text(charge.id);
  const went = sent.find((s) => s.chargeIds.includes(id));
  if (went) events.push({ date: went.sentAt ?? "", kind: "sent", month: went.month, by: went.sentByName });
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      if (!a.e.date !== !b.e.date) return a.e.date ? -1 : 1;
      return a.e.date.localeCompare(b.e.date) || STORY_ORDER[a.e.kind] - STORY_ORDER[b.e.kind] || a.i - b.i;
    })
    .map(({ e }) => e);
}

/** What the drawer can do with one service, and what it shows on it. */
export type ServiceState = {
  /** The card that speaks for the treatment (the one the route acts on); "" when it has no card. */
  noteId: string;
  done: boolean;
  /** The finish day (done only). */
  finishDate: string;
  /** The newest card's own day: a finish date cannot be earlier. */
  lastVisit: string;
  /** The month whose sent list holds it, or "". */
  sentMonth: string;
};

export function serviceState(
  charge: SheetCharge,
  cards: ReadonlyMap<string, SheetCard>,
  children: ReadonlyMap<string, SheetCard[]>,
  sent: readonly SentMonth[],
): ServiceState {
  const found = treatmentChain(text(charge.clinicalNoteId), cards, children);
  const done = chargeDone(charge, cards, children);
  const id = text(charge.id);
  return {
    noteId: found ? found.latest.id : "",
    done: done.done,
    finishDate: done.done ? done.date : "",
    lastVisit: found ? toYmd(found.latest.date) : toYmd(charge.date),
    sentMonth: sent.find((s) => s.chargeIds.includes(id))?.month ?? "",
  };
}

/** The months [from, to] touches (yyyy-mm-dd bounds), in order. */
export function rangeMonths(from: string, to: string): string[] {
  return from && to && from <= to ? monthsBetween(from, to) : [];
}
