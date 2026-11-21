/**
 * The company sheet seen one patient at a time: the patient list, the procedures under each
 * patient, and each procedure's history.
 *
 * Everything here reads `placeCharges` — the same placement the month sheets and the Excel are
 * built from — so the list can never disagree with what is sent.
 *
 * Pure: no Firebase, no React.
 */
import { toYmd } from "@/lib/reports/patientStats";
import {
  chargeDone,
  treatmentChain,
  type Placement,
  type SentMonth,
  type SheetCard,
  type SheetCharge,
} from "@/lib/insurance/companySheet";

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const round2 = (n: number) => Math.round(n * 100) / 100;
const amountOf = (c: SheetCharge) => round2(Number(c.cost) || Number(c.amount) || 0);
const sum = (list: readonly SheetCharge[]) => round2(list.reduce((s, c) => s + amountOf(c), 0));

/**
 * Where a patient stands against the dates picked on screen.
 * - on_sheet: he has procedures on a sheet inside the dates (`sent`: all of those went already);
 * - waiting: none inside the dates, and some procedure of his is on no sheet yet;
 * - later: his nearest procedures are on a month after the dates;
 * - earlier: everything he had is on months before the dates.
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
  /** The procedures the standing is about, and their value. */
  charges: SheetCharge[];
  value: number;
  /** Every procedure of his that has a placement, oldest first. */
  all: SheetCharge[];
};

const ORDER: Record<Standing["kind"], number> = { on_sheet: 0, waiting: 1, later: 2, earlier: 3 };

/** One row per patient with a placed procedure. `charges`: the company's charges (already narrowed to the branch on screen); `from`/`to`: yyyy-mm. */
export function patientRows(
  charges: readonly SheetCharge[],
  placed: ReadonlyMap<string, Placement>,
  from: string,
  to: string,
): PatientRow[] {
  const byPatient = new Map<string, { name: string; list: { c: SheetCharge; at: Placement }[] }>();
  for (const c of charges) {
    const at = placed.get(text(c.id));
    if (!at) continue;
    const patientId = text(c.patientId);
    const entry = byPatient.get(patientId);
    if (entry) entry.list.push({ c, at });
    else byPatient.set(patientId, { name: text(c.patientName), list: [{ c, at }] });
  }

  const rows: PatientRow[] = [];
  for (const [patientId, { name, list }] of byPatient) {
    const inRange = list.filter((x) => x.at.month && x.at.month >= from && x.at.month <= to);
    const open = inRange.filter((x) => !x.at.sent);
    const waiting = list.filter((x) => !x.at.month);
    const after = list.filter((x) => x.at.month > to).sort((a, b) => a.at.month.localeCompare(b.at.month));
    const before = list.filter((x) => x.at.month && x.at.month < from).sort((a, b) => a.at.month.localeCompare(b.at.month));

    let standing: Standing;
    let about: { c: SheetCharge; at: Placement }[];
    if (inRange.length) {
      const pick = open.length ? open : inRange;
      standing = { kind: "on_sheet", month: pick.map((x) => x.at.month).sort().pop() as string, sent: open.length === 0 };
      about = pick;
    } else if (waiting.length) {
      standing = { kind: "waiting" };
      about = waiting;
    } else if (after.length) {
      standing = { kind: "later", month: after[0].at.month };
      about = after.filter((x) => x.at.month === after[0].at.month);
    } else {
      const last = before[before.length - 1];
      if (!last) continue;
      standing = { kind: "earlier", month: last.at.month };
      about = before.filter((x) => x.at.month === last.at.month);
    }
    const all = list.map((x) => x.c).sort((a, b) => toYmd(a.date).localeCompare(toYmd(b.date)));
    rows.push({ patientId, patientName: name, standing, charges: about.map((x) => x.c), value: sum(about.map((x) => x.c)), all });
  }
  return rows.sort((a, b) => ORDER[a.standing.kind] - ORDER[b.standing.kind] || a.patientName.localeCompare(b.patientName));
}

/** A line of the log a card carries (written by the company-sheet route). */
export type FinishLogEntry = {
  day: string;
  kind: "date" | "reopened" | "finished" | "start" | "month";
  byName: string;
  from: string;
  to: string;
};

const LOG_KINDS = new Set(["date", "reopened", "finished", "start", "month"]);

export function parseFinishLog(raw: unknown): FinishLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const r = e as Record<string, unknown>;
    const kind = text(r.kind);
    if (!LOG_KINDS.has(kind)) return [];
    const day = toYmd(r.day);
    if (!day) return [];
    // A month line carries months (yyyy-mm), the rest carry days.
    const part = (v: unknown) => (kind === "month" ? text(v) : toYmd(v));
    return [{ day, kind: kind as FinishLogEntry["kind"], byName: text(r.byName), from: part(r.from), to: part(r.to) }];
  });
}

export type StoryKind =
  | "started"
  | "visit"
  | "finished"
  | "date_changed"
  | "start_changed"
  | "month_changed"
  | "reopened"
  | "marked_finished"
  | "sent";
export type StoryEvent = { date: string; kind: StoryKind; by?: string; from?: string; to?: string; month?: string };

/** Same-day order: the visits, then the finish, then the changes made on the sheet in the order they were made, then sent. */
const STORY_ORDER: Record<StoryKind, number> = {
  started: 0,
  visit: 1,
  finished: 2,
  marked_finished: 3,
  date_changed: 3,
  start_changed: 3,
  month_changed: 3,
  reopened: 3,
  sent: 4,
};

const LOG_STORY: Record<FinishLogEntry["kind"], StoryKind> = {
  date: "date_changed",
  reopened: "reopened",
  finished: "marked_finished",
  start: "start_changed",
  month: "month_changed",
};

/** The timeline of one procedure: started, each visit, finished, every change made on the sheet, sent. */
export function serviceStory(
  charge: SheetCharge,
  cards: ReadonlyMap<string, SheetCard>,
  children: ReadonlyMap<string, SheetCard[]>,
  sent: readonly SentMonth[],
): StoryEvent[] {
  const events: StoryEvent[] = [];
  const found = treatmentChain(text(charge.clinicalNoteId), cards, children);
  const doctor = (c: SheetCard) => text(c.doctor).replace(/^Dr\.?\s*/i, "") || undefined;
  let lastLog: StoryKind | null = null;
  if (!found) {
    events.push({ date: toYmd(charge.date), kind: "started" });
  } else {
    found.chain.forEach((c, i) => {
      events.push({ date: toYmd(c.date), kind: i === 0 ? "started" : "visit", by: doctor(c) ?? (i === 0 ? text(c.createdByName) || undefined : undefined) });
      for (const e of parseFinishLog(c.finishLog)) {
        const kind = LOG_STORY[e.kind];
        events.push({ date: e.day, kind, by: e.byName || undefined, from: e.from || undefined, to: e.to || undefined });
        if (kind === "marked_finished" || kind === "reopened" || kind === "date_changed") lastLog = kind;
      }
    });
  }
  const done = chargeDone(charge, cards, children);
  // "Marked finished" already says it was finished that day.
  if (done.done && done.date && lastLog !== "marked_finished") events.push({ date: done.date, kind: "finished" });
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

/** What one procedure's line shows, and what can be done to it. */
export type ServiceState = {
  /** The card that speaks for the treatment (the one the route acts on); "" when it has no card. */
  noteId: string;
  done: boolean;
  /** The start date: the charge's own day. */
  startDate: string;
  /** The end date (done only). */
  finishDate: string;
  /** The newest card's own day: an end date cannot be earlier. */
  lastVisit: string;
  /** The first visit after the start, or "": the start date cannot pass it. */
  nextVisit: string;
  dentist: string;
};

export function serviceState(
  charge: SheetCharge,
  cards: ReadonlyMap<string, SheetCard>,
  children: ReadonlyMap<string, SheetCard[]>,
): ServiceState {
  const found = treatmentChain(text(charge.clinicalNoteId), cards, children);
  const done = chargeDone(charge, cards, children);
  const row = charge as Record<string, unknown>;
  const dentist = (text(row.doctorName) || text(row.doctor) || text(found?.latest.doctor)).replace(/^Dr\.?\s*/i, "");
  return {
    noteId: found ? found.latest.id : "",
    done: done.done,
    startDate: toYmd(charge.date),
    finishDate: done.done ? done.date : "",
    lastVisit: found ? toYmd(found.latest.date) : toYmd(charge.date),
    nextVisit: found && found.chain.length > 1 ? toYmd(found.chain[1].date) : "",
    dentist,
  };
}

/** The twelve months the picker offers: from six months before `today`'s month, but never before `first`. */
export function pickerMonths(today: string, first: string): string[] {
  const ym = (y: number, m0: number) => {
    const at = new Date(Date.UTC(y, m0, 1));
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const back = ym(y, m - 1 - 6);
  const [sy, sm] = (back < first ? first : back).split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => ym(sy, sm - 1 + i));
}
