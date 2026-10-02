/**
 * The monthly claim statement to an insurer, as data.
 *
 * An insured clinic sends each insurer, once a month, a sheet of every case it treated under that
 * insurer's cover: the patient (with their member number), one line per service in the insurer's
 * wording and tariff, a subtotal per visit, a grand total. The insurer pays against it. Until now
 * the receptionist retyped it from the day sheets; this builds it from the ledger rows the desk
 * already recorded, so the statement and the books cannot disagree.
 *
 * Pure and Firebase-free: ledger rows in, statement out. The layout of the file itself is in
 * insuranceStatementXlsx.ts; the sample it copies is docs/samples/insurance-statement-nextcare-2026-02.xlsx.
 *
 * Wording rules, taken from that sample and pinned by tests/insuranceStatement.test.mts:
 *   - `2حشو كمبوزيت رقم 5-6`: the count (only when more than one unit, and never for a flat price),
 *     then the service name, then ` رقم ` and the teeth joined with `-`. No teeth part for `Gen`.
 *   - Teeth are written as the tooth's position within its quadrant (FDI 14 → 4), because that is
 *     what the insurer's forms expect; primary teeth as letters (FDI 55 → E).
 *   - A case is one visit: the rows that share an appointment, or failing that a patient and a day.
 */

import { parseLedgerProcedureDescription } from "@/lib/ledgerProcedureParse";

/** The ledger fields the statement reads. Everything is `unknown` because rows come straight from Firestore. */
export type StatementRowLite = {
  id: string;
  type?: unknown;
  payerId?: unknown;
  patientId?: unknown;
  patientName?: unknown;
  date?: unknown;
  appointmentId?: unknown;
  status?: unknown;
  amount?: unknown;
  cost?: unknown;
  serviceName?: unknown;
  description?: unknown;
  unitsCount?: unknown;
  pricingMode?: unknown;
};

export type StatementLine = { text: string; amount: number; rowId: string };

export type StatementCase = {
  serial: number;
  patientId: string;
  patientName: string;
  memberNumber: string;
  /** yyyy-mm-dd of the visit (the earliest row of the case). */
  date: string;
  lines: StatementLine[];
  subtotal: number;
};

export type Statement = {
  payerId: string;
  payerName: string;
  /** yyyy-mm */
  month: string;
  cases: StatementCase[];
  total: number;
  /** Patients on the statement with no member number for this insurer — the desk must fill them in. */
  missingMemberNumber: Array<{ patientId: string; patientName: string }>;
};

/** Statuses the Reports Center leaves out of every figure. */
const INACTIVE = new Set(["deleted", "cancelled"]);

const PRIMARY_LETTERS = ["A", "B", "C", "D", "E"];

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

/**
 * An FDI tooth number the way an insurer's form wants it.
 *
 * Permanent teeth (quadrants 1–4) are the position within the quadrant: 14 → "4", 36 → "6".
 * Primary teeth (quadrants 5–8) are letters A–E: 55 → "E", 51 → "A". Anything else is "".
 */
export function insurerToothLabel(fdi: number): string {
  if (!Number.isInteger(fdi) || fdi < 11 || fdi > 85) return "";
  const quadrant = Math.floor(fdi / 10);
  const position = fdi % 10;
  if (quadrant >= 1 && quadrant <= 4 && position >= 1 && position <= 8) return String(position);
  if (quadrant >= 5 && quadrant <= 8 && position >= 1 && position <= 5) return PRIMARY_LETTERS[position - 1];
  return "";
}

/** The teeth named in a ledger description, as insurer labels, in the order written. */
function teethLabels(description: string): string[] {
  const parsed = parseLedgerProcedureDescription(description);
  const raw = text(parsed.teeth);
  if (!raw || raw.toLowerCase() === "gen") return [];
  return raw
    .split(/[,\s]+/)
    .map((t) => insurerToothLabel(Number(t)))
    .filter(Boolean);
}

/** `2حشو كمبوزيت رقم 5-6` — count, name, teeth, exactly as the clinic writes it to the insurer. */
export function statementLineText(row: StatementRowLite): string {
  const description = text(row.description);
  const parsed = parseLedgerProcedureDescription(description);
  const name = text(row.serviceName) || text(parsed.procedureLine);
  if (!name) return "—";

  const units = Number(row.unitsCount) || 0;
  const flat = text(row.pricingMode) === "flat";
  const count = units > 1 && !flat ? String(units) : "";

  const teeth = teethLabels(description);
  const where = teeth.length ? ` رقم ${teeth.join("-")}` : "";

  return `${count}${name}${where}`;
}

/** `(A1B2)كريم يوسف سعيد`, or the name alone when no member number is known. */
export function caseLabel(c: Pick<StatementCase, "memberNumber" | "patientName">): string {
  const member = text(c.memberNumber);
  return member ? `(${member})${c.patientName}` : c.patientName;
}

export function buildInsuranceStatement(args: {
  rows: StatementRowLite[];
  payerId: string;
  payerName: string;
  /** yyyy-mm: the statement's month, and the filter unless `range` is given. */
  month: string;
  /** When set, rows inside these dates are taken instead of the month's — the phone builds over the range on screen. */
  range?: { start: string; end: string };
  memberNumbers: ReadonlyMap<string, string>;
}): Statement {
  const { rows, payerId, payerName, month, range, memberNumbers } = args;

  const inPeriod = (date: string) => (range ? date >= range.start && date <= range.end : date.slice(0, 7) === month);
  const inScope = rows.filter(
    (r) =>
      text(r.type) === "procedure" &&
      text(r.payerId) === payerId &&
      inPeriod(text(r.date).slice(0, 10)) &&
      !INACTIVE.has(text(r.status).toLowerCase())
  );

  // One case per visit. Rows that name an appointment share it; rows that do not are grouped by
  // patient and day, which is what "a visit" means when nobody booked one.
  type Acc = { patientId: string; patientName: string; date: string; lines: StatementLine[] };
  const groups = new Map<string, Acc>();
  for (const r of inScope) {
    const patientId = text(r.patientId);
    const date = text(r.date).slice(0, 10);
    const visit = text(r.appointmentId) || date;
    const key = `${patientId}|${visit}`;
    let acc = groups.get(key);
    if (!acc) {
      acc = { patientId, patientName: text(r.patientName), date, lines: [] };
      groups.set(key, acc);
    } else if (date < acc.date) {
      acc.date = date;
    }
    if (!acc.patientName) acc.patientName = text(r.patientName);
    acc.lines.push({ text: statementLineText(r), amount: money(Number(r.amount) || Number(r.cost) || 0), rowId: r.id });
  }

  const ordered = Array.from(groups.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || a.patientName.localeCompare(b.patientName)
  );

  const cases: StatementCase[] = ordered.map((g, i) => ({
    serial: i + 1,
    patientId: g.patientId,
    patientName: g.patientName,
    memberNumber: text(memberNumbers.get(g.patientId)),
    date: g.date,
    lines: g.lines,
    subtotal: money(g.lines.reduce((sum, l) => sum + l.amount, 0)),
  }));

  const seen = new Set<string>();
  const missingMemberNumber: Statement["missingMemberNumber"] = [];
  for (const c of cases) {
    if (c.memberNumber || seen.has(c.patientId)) continue;
    seen.add(c.patientId);
    missingMemberNumber.push({ patientId: c.patientId, patientName: c.patientName });
  }

  return {
    payerId,
    payerName,
    month,
    cases,
    total: money(cases.reduce((sum, c) => sum + c.subtotal, 0)),
    missingMemberNumber,
  };
}
