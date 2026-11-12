/**
 * What is planned, what is in progress, and what got finished — one line per treatment.
 *
 * Every treatment card already carries a state (Planned / Ongoing / Completed). This turns the
 * cards into the list a clinic asks for at the end of a month, and the rules below are the whole
 * meaning of that list, so they live here, pure, where a test can pin them:
 *
 *  - **Done counts in the month it was FINISHED.** A crown started in October and marked done in
 *    November is November's. The finish day is stamped when the card is switched to Completed
 *    (`completedDate`); a card finished before that stamp existed falls back to its own date.
 *  - **Planned and Ongoing count in the month they were last worked on**, and only while they are
 *    still open today. This is a list of what is open now, not a history of what was open then.
 *  - **Open work from before the period is kept apart** (`older`), not dropped: the oldest
 *    unfinished treatment is the one closest to being forgotten, so the screen offers it in one tap
 *    rather than mixing it into this month's numbers.
 *  - **A treatment continued into a later visit is ONE treatment.** The continuation is a second
 *    card that points at the first; the pair shows once, with the newest card's state, the first
 *    card's price, and the newest card's date.
 *  - **"No booking" means nothing ahead with anyone**, the same rule the recall list uses. A
 *    visit later today counts as booked.
 *
 * No database, no React.
 */

import type { DateRange } from "@/lib/reportHelpers";
import { toYmd } from "@/lib/reports/patientStats";

export type TreatmentState = "Planned" | "Ongoing" | "Completed";
export const TREATMENT_STATES: readonly TreatmentState[] = ["Planned", "Ongoing", "Completed"];

type Row = Record<string, unknown> & { id: string };

export type TreatmentLine = {
  /** The first card of the treatment. */
  id: string;
  patientId: string;
  patientName: string;
  phone: string;
  treatment: string;
  tooth: string;
  doctorId: string;
  doctorName: string;
  state: TreatmentState;
  /** The day this line is filed under: the finish day when done, the last visit's day otherwise. */
  date: string;
  price: number;
  /** The patient's next visit, "" when nothing is booked. Blank on finished work: nobody calls for it. */
  nextVisit: string;
  /** Still open, and last touched before the period on screen. */
  older: boolean;
};

export type StateTotal = { count: number; value: number };

export type TreatmentStatus = {
  /** The period's lines, then the older open ones; newest first within each. */
  lines: TreatmentLine[];
  /** Totals of the period's lines only. */
  totals: Record<TreatmentState, StateTotal>;
  /** Open work from before the period. */
  older: StateTotal;
};

const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function stateOf(note: Row): TreatmentState | null {
  const s = text(note.status);
  return s === "Planned" || s === "Ongoing" || s === "Completed" ? s : null;
}

const noteDate = (note: Row) => toYmd(note.date) || toYmd(note.createdAt);

/** What to call the treatment: what was typed, else the price-list name. */
export function treatmentLabel(note: Row): string {
  const typed = Array.isArray(note.procedures) ? note.procedures.map(text).filter(Boolean) : [];
  if (typed.length > 0) return typed.join(" + ");
  return text(note.procedure) || text(note.serviceName) || text(note.title) || "—";
}

/** "Gen" is what a treatment with no tooth is stored as; it is not a tooth. */
function toothOf(note: Row): string {
  const t = text(note.tooth);
  return t.toLowerCase() === "gen" ? "" : t;
}

const NOT_COMING = /cancel|no.?show|resched/i;
const ALREADY_SEEN = /completed|checking out/i;

/** Each patient's next visit that is still going to happen: later today, or any day after. */
export function nextVisits(appointments: readonly Row[], today: string): Map<string, string> {
  const next = new Map<string, string>();
  for (const a of appointments) {
    const patientId = text(a.patientId);
    const date = toYmd(a.date);
    const status = text(a.status);
    if (!patientId || !date || date < today || NOT_COMING.test(status)) continue;
    if (date === today && ALREADY_SEEN.test(status)) continue;
    const known = next.get(patientId);
    if (!known || date < known) next.set(patientId, date);
  }
  return next;
}

/**
 * A continuation with no charge of its own belongs to the branch of the treatment it continues.
 *
 * The page hides rows that carry no branch when one branch is on screen. A continuation is a card
 * with no charge, so it would vanish there and leave the first card showing a state the dentist
 * has since moved on from.
 */
export function inheritBranch<T extends Row>(notes: readonly T[]): T[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  return notes.map((n) => {
    if (n.branchId) return n;
    let parent = byId.get(text(n.continuedFromNoteId));
    for (let hops = 0; parent && hops < 20; hops++) {
      if (parent.branchId) return { ...n, branchId: parent.branchId };
      parent = byId.get(text(parent.continuedFromNoteId));
    }
    return n;
  });
}

export function buildTreatmentStatus(
  notes: readonly Row[],
  patients: readonly Row[],
  appointmentsAhead: readonly Row[],
  range: DateRange,
  today: string,
): TreatmentStatus {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const patientById = new Map(patients.map((p) => [p.id, p]));
  const next = nextVisits(appointmentsAhead, today);

  // The first card of each treatment: walk back through the continuations that are on hand.
  const rootOf = (note: Row): Row => {
    let at = note;
    for (let hops = 0; hops < 20; hops++) {
      const parent = byId.get(text(at.continuedFromNoteId));
      if (!parent || parent.id === at.id) break;
      at = parent;
    }
    return at;
  };
  const chains = new Map<string, Row[]>();
  for (const note of notes) {
    const root = rootOf(note);
    const chain = chains.get(root.id);
    if (chain) chain.push(note);
    else chains.set(root.id, [note]);
  }

  const lines: TreatmentLine[] = [];
  for (const [rootId, chain] of chains) {
    const root = byId.get(rootId) as Row;
    // The newest card speaks for the treatment; on the same day, the continuation does.
    const latest = chain.reduce((a, b) => {
      const da = noteDate(a);
      const db = noteDate(b);
      if (db !== da) return db > da ? b : a;
      return b.id !== rootId ? b : a;
    });
    const state = stateOf(latest);
    if (!state) continue;

    const date = state === "Completed" ? toYmd(latest.completedDate) || noteDate(latest) : noteDate(latest);
    if (!date || date > range.end) continue;
    const older = date < range.start;
    // Finished work from before the period is history, and this is not a history screen.
    if (older && state === "Completed") continue;

    const patientId = text(root.patientId);
    const patient = patientById.get(patientId);
    lines.push({
      id: rootId,
      patientId,
      patientName: text(patient?.name) || text(root.patientName) || "—",
      phone: text(patient?.phone),
      treatment: treatmentLabel(root),
      tooth: toothOf(root),
      doctorId: text(latest.doctorId) || text(root.doctorId),
      doctorName: text(latest.doctor) || text(root.doctor),
      state,
      date,
      price: Number(chain.reduce((sum, n) => sum + num(n.cost), 0).toFixed(2)),
      nextVisit: state === "Completed" ? "" : next.get(patientId) || "",
      older,
    });
  }

  lines.sort(
    (a, b) => Number(a.older) - Number(b.older) || b.date.localeCompare(a.date) || a.patientName.localeCompare(b.patientName),
  );

  const totals: TreatmentStatus["totals"] = {
    Planned: { count: 0, value: 0 },
    Ongoing: { count: 0, value: 0 },
    Completed: { count: 0, value: 0 },
  };
  const olderTotal: StateTotal = { count: 0, value: 0 };
  for (const line of lines) {
    const bucket = line.older ? olderTotal : totals[line.state];
    bucket.count += 1;
    bucket.value = Number((bucket.value + line.price).toFixed(2));
  }
  return { lines, totals, older: olderTotal };
}

/* --- filtering ---------------------------------------------------------------------------- */

export type TreatmentFilters = {
  /** "" shows every state. */
  state: TreatmentState | "";
  doctorId: string;
  /** Matches the patient's name or phone. */
  search: string;
  /** Only open work whose patient has nothing booked — the list to phone. */
  unbookedOnly: boolean;
  /** Also show open work from before the period. */
  includeOlder: boolean;
};

export const NO_TREATMENT_FILTERS: TreatmentFilters = {
  state: "",
  doctorId: "",
  search: "",
  unbookedOnly: false,
  includeOlder: false,
};

/** Arabic and Latin folded to something comparable — see caseSheet.foldForSearch for why. */
function fold(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ً-ْـ]/g, "")
    .replace(/\s+/g, " ");
}

export function filterTreatments(lines: readonly TreatmentLine[], f: TreatmentFilters): TreatmentLine[] {
  const needle = fold(f.search);
  const digits = f.search.replace(/\D/g, "");
  return lines.filter((l) => {
    if (l.older && !f.includeOlder) return false;
    if (f.state && l.state !== f.state) return false;
    if (f.doctorId && l.doctorId !== f.doctorId) return false;
    if (f.unbookedOnly && (l.state === "Completed" || l.nextVisit)) return false;
    if (needle && !fold(l.patientName).includes(needle) && !(digits.length >= 3 && l.phone.replace(/\D/g, "").includes(digits))) return false;
    return true;
  });
}

/** The dentists present in the list, for its dropdown. */
export function dentistOptions(lines: readonly TreatmentLine[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const l of lines) if (l.doctorId && l.doctorName && !seen.has(l.doctorId)) seen.set(l.doctorId, l.doctorName);
  return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}
