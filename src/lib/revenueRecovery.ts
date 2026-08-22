import { adminClinicCollection } from "@/lib/adminClinicDb";

/**
 * Revenue Recovery Engine — finds money a clinic has earned but not collected.
 *
 * Detection here is deliberately deterministic rather than AI-driven. Every finding is a
 * reproducible query result with the evidence attached, so a clinic owner can click through and
 * verify it against their own records. An LLM asked to "find lost revenue" over a ledger would
 * produce confident, unverifiable numbers — which is exactly the wrong failure mode when the
 * output is a financial claim someone will act on. AI is layered on top to write the summary,
 * not to decide what counts as a finding.
 *
 * Findings are flagged for review, never auto-corrected. A zero-cost note or a deliberate
 * discount is a legitimate business decision, and this engine cannot tell one from an error.
 */

export type FindingKind =
  | "unbilled_work"
  | "outstanding_balance"
  | "duplicate_entry"
  | "underpriced_procedure";

export interface RecoveryFinding {
  kind: FindingKind;
  patientId: string;
  patientName: string;
  /** Money involved, in clinic currency. For duplicates, the amount of the surplus copy. */
  amount: number;
  /** One-line explanation of what was detected. */
  detail: string;
  /** Where to look to verify it — collection + document id. */
  evidence: { collection: string; docId: string }[];
  /** Days since the underlying record, used to rank staleness. */
  ageDays?: number;
}

export interface RecoveryReport {
  scannedAt: string;
  clinicId: string;
  totals: {
    recoverable: number;
    unbilledWork: number;
    outstandingBalance: number;
    duplicates: number;
    underpriced: number;
  };
  counts: Record<FindingKind, number>;
  findings: RecoveryFinding[];
  /** True when a scan limit was hit, so the totals are a floor rather than the full picture. */
  truncated: boolean;
  notes: string[];
}

/** Ledger and note volume is unbounded; cap reads so one huge clinic can't stall the request. */
const SCAN_LIMIT = 4000;

/** Below this, a balance is rounding noise and not worth a clinic's attention. */
const MIN_BALANCE = 1;

/** How stale an unpaid balance must be before it's worth chasing. */
const STALE_BALANCE_DAYS = 45;

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "object" && v !== null && "toDate" in v) {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysSince(d: Date | null): number | undefined {
  if (!d) return undefined;
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000));
}

/**
 * The money value of a ledger row, resolved per row type.
 *
 * Some write paths in this app (an older payment flow, confirmed against real clinic data) store
 * the real amount in `paid` while leaving `amount: 0` as a placeholder rather than omitting it.
 * A plain `row.amount ?? row.paid` is wrong for those rows: `??` only falls through on
 * null/undefined, and 0 is neither, so it locks in the placeholder and hides the real value —
 * which also makes unrelated payments of different sizes collide in the duplicate detector below.
 * Payments must resolve through `paid` first; procedures through `amount`/`cost` first.
 */
export function rowAmount(row: Record<string, unknown>): number {
  return String(row.type) === "payment"
    ? toNumber(row.paid ?? row.amount)
    : toNumber(row.amount ?? row.cost);
}

/**
 * Work recorded clinically but never posted to the ledger.
 *
 * The app's own documented workflow is: write clinical_notes → write ledger → link them back via
 * ledgerId. A note carrying a cost but no ledgerId means that chain broke, so the patient was
 * treated and never invoiced.
 *
 * clinical_notes documents never store a patientName field in this app (confirmed against real
 * clinic data — only patientId is written), so `note.patientName` below is always undefined in
 * practice. Without patientNameById every finding here would read "Unknown", which is exactly the
 * kind of detail that makes a report easy to dismiss as unreliable.
 */
function findUnbilledWork(notes: Record<string, unknown>[], patientNameById: Map<string, string>): RecoveryFinding[] {
  const out: RecoveryFinding[] = [];

  for (const note of notes) {
    const ledgerId = typeof note.ledgerId === "string" ? note.ledgerId.trim() : "";
    if (ledgerId) continue;

    const cost = toNumber(note.cost);
    if (cost <= 0) continue; // A zero-cost note is usually a follow-up or a comped visit.

    const patientId = String(note.patientId || "");
    const when = parseDate(note.date);
    out.push({
      kind: "unbilled_work",
      patientId,
      patientName: String(note.patientName || note.patient || patientNameById.get(patientId) || "Unknown"),
      amount: cost,
      detail: `"${String(note.procedure || "Procedure")}" was recorded clinically but never posted to the ledger.`,
      evidence: [{ collection: "clinical_notes", docId: String(note.id || "") }],
      ageDays: daysSince(when),
    });
  }

  return out;
}

/**
 * Per-patient balance: everything charged, minus everything paid.
 *
 * Only balances that have gone quiet are reported — a patient mid-treatment always shows a
 * balance, and surfacing those would bury the genuinely stalled ones in noise.
 */
function findOutstandingBalances(ledger: Record<string, unknown>[]): RecoveryFinding[] {
  const byPatient = new Map<
    string,
    { name: string; charged: number; paid: number; lastActivity: Date | null; docIds: string[] }
  >();

  for (const row of ledger) {
    const patientId = String(row.patientId || "");
    if (!patientId) continue;

    const type = String(row.type || "");
    if (type === "expense") continue; // Clinic overheads aren't owed by a patient.

    const entry = byPatient.get(patientId) ?? {
      name: String(row.patientName || "Unknown"),
      charged: 0,
      paid: 0,
      lastActivity: null,
      docIds: [],
    };

    if (type === "procedure") entry.charged += rowAmount(row);
    else entry.paid += rowAmount(row);

    const when = parseDate(row.date);
    if (when && (!entry.lastActivity || when > entry.lastActivity)) entry.lastActivity = when;
    if (entry.docIds.length < 5) entry.docIds.push(String(row.id || ""));

    byPatient.set(patientId, entry);
  }

  const out: RecoveryFinding[] = [];
  for (const [patientId, entry] of byPatient) {
    const balance = entry.charged - entry.paid;
    if (balance < MIN_BALANCE) continue;

    const age = daysSince(entry.lastActivity);
    if (age !== undefined && age < STALE_BALANCE_DAYS) continue;

    out.push({
      kind: "outstanding_balance",
      patientId,
      patientName: entry.name,
      amount: balance,
      detail:
        age === undefined
          ? `Owes ${balance.toFixed(2)} with no dated activity on record.`
          : `Owes ${balance.toFixed(2)} and hasn't paid or been seen in ${age} days.`,
      evidence: entry.docIds.map((docId) => ({ collection: "ledger", docId })),
      ageDays: age,
    });
  }

  return out;
}

/**
 * Identical ledger rows — the same charge or payment entered twice.
 *
 * A duplicated *payment* is the costly direction: it credits money the clinic never received,
 * making a real debt look settled.
 */
function findDuplicates(ledger: Record<string, unknown>[]): RecoveryFinding[] {
  const seen = new Map<string, Record<string, unknown>>();
  const out: RecoveryFinding[] = [];

  for (const row of ledger) {
    const amount = rowAmount(row);
    // A zero-value row (a placeholder, a comped line) duplicated is not a financial finding —
    // there's no money at stake, so it would just be noise in a report about missing money.
    if (amount <= 0) continue;

    const key = [row.patientId, row.type, amount.toFixed(2), String(row.date ?? ""), String(row.description ?? "")].join(
      "|"
    );

    const first = seen.get(key);
    if (!first) {
      seen.set(key, row);
      continue;
    }

    out.push({
      kind: "duplicate_entry",
      patientId: String(row.patientId || ""),
      patientName: String(row.patientName || "Unknown"),
      amount,
      detail:
        String(row.type) === "payment"
          ? `A payment of ${amount.toFixed(2)} appears twice — the patient may still owe it.`
          : `A charge of ${amount.toFixed(2)} appears twice on the same date.`,
      evidence: [
        { collection: "ledger", docId: String(first.id || "") },
        { collection: "ledger", docId: String(row.id || "") },
      ],
      ageDays: daysSince(parseDate(row.date)),
    });
  }

  return out;
}

/**
 * Ledger descriptions for a procedure aren't written the same way everywhere in the app.
 * ServiceEditorDrawer (the clinical-notes billing screen) writes a composite string —
 * "Composite Filling (T: 14) | Flat=400" — so the tooth and pricing formula show in the ledger.
 * AppointmentSidePanel and bookingService write the plain service name instead. Cutting at the
 * first " (" or " | " normalizes both shapes to the same lookup key; without it, procedures
 * billed through the clinical-notes screen would never match the price list at all.
 */
function extractServiceLabel(raw: string): string {
  const cut = raw.search(/ \(| \|/);
  return (cut === -1 ? raw : raw.slice(0, cut)).trim();
}

/**
 * Procedures charged below the clinic's own price list.
 *
 * Reported as "worth checking" rather than an error: discounts, family rates and partial work are
 * all normal.
 *
 * Rows now carry `serviceId`, which is matched first: a service renamed in the price list keeps
 * the same id, so its charges stay comparable instead of silently dropping out of this check.
 * Name matching (see extractServiceLabel above for why that isn't simply `description`) remains
 * for rows written before that field existed. Fuzzy matching is deliberately not attempted —
 * a wrong match here is a false accusation about a colleague's pricing.
 */
function findUnderpriced(
  ledger: Record<string, unknown>[],
  services: Record<string, unknown>[]
): RecoveryFinding[] {
  const priceByName = new Map<string, number>();
  const priceById = new Map<string, number>();
  const nameById = new Map<string, string>();
  for (const s of services) {
    const name = String(s.name || "").trim();
    const id = String(s.id || "").trim();
    const price = toNumber(s.price);
    if (price <= 0) continue;
    if (name) priceByName.set(name.toLowerCase(), price);
    if (id) {
      priceById.set(id, price);
      if (name) nameById.set(id, name);
    }
  }
  if (priceByName.size === 0 && priceById.size === 0) return [];

  const out: RecoveryFinding[] = [];
  for (const row of ledger) {
    if (String(row.type) !== "procedure") continue;

    const serviceId = typeof row.serviceId === "string" ? row.serviceId.trim() : "";
    const descriptionLabel = extractServiceLabel(String(row.description || row.category || ""));
    const listPrice = serviceId
      ? priceById.get(serviceId)
      : priceByName.get(descriptionLabel.toLowerCase());
    const label = serviceId ? nameById.get(serviceId) || descriptionLabel : descriptionLabel;
    if (!listPrice) continue;

    const charged = rowAmount(row);
    // Units legitimately scale the price, so only compare when it's a single unit.
    const units = toNumber(row.unitsCount);
    if (units > 1) continue;
    if (charged <= 0 || charged >= listPrice) continue;

    out.push({
      kind: "underpriced_procedure",
      patientId: String(row.patientId || ""),
      patientName: String(row.patientName || "Unknown"),
      amount: listPrice - charged,
      detail: `Charged ${charged.toFixed(2)} for "${label}" — the price list says ${listPrice.toFixed(2)}. Worth confirming this was an intended discount.`,
      evidence: [{ collection: "ledger", docId: String(row.id || "") }],
      ageDays: daysSince(parseDate(row.date)),
    });
  }

  return out;
}

async function readCollection(clinicId: string, path: string): Promise<Record<string, unknown>[]> {
  const snap = await adminClinicCollection(clinicId, path).limit(SCAN_LIMIT).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Pure analysis over already-loaded records. Kept separate from the Firestore reads so the
 * money math can be tested directly with fixtures — a financial report nobody can test is a
 * financial report nobody should trust.
 */
export function analyzeRecovery(
  clinicId: string,
  ledger: Record<string, unknown>[],
  notes: Record<string, unknown>[],
  services: Record<string, unknown>[],
  patientNameById: Map<string, string> = new Map()
): RecoveryReport {
  const findings = [
    ...findUnbilledWork(notes, patientNameById),
    ...findOutstandingBalances(ledger),
    ...findDuplicates(ledger),
    ...findUnderpriced(ledger, services),
  ];

  // Biggest money first — this list is a work queue, and staff will start at the top.
  findings.sort((a, b) => b.amount - a.amount);

  const sumOf = (kind: FindingKind) =>
    findings.filter((f) => f.kind === kind).reduce((sum, f) => sum + f.amount, 0);

  const totals = {
    unbilledWork: sumOf("unbilled_work"),
    outstandingBalance: sumOf("outstanding_balance"),
    duplicates: sumOf("duplicate_entry"),
    underpriced: sumOf("underpriced_procedure"),
    recoverable: 0,
  };

  // Underpriced entries are excluded from the headline figure: most are real discounts, and
  // inflating the number with them would make the whole report easy to dismiss.
  totals.recoverable = totals.unbilledWork + totals.outstandingBalance + totals.duplicates;

  const counts = findings.reduce(
    (acc, f) => {
      acc[f.kind] += 1;
      return acc;
    },
    {
      unbilled_work: 0,
      outstanding_balance: 0,
      duplicate_entry: 0,
      underpriced_procedure: 0,
    } as Record<FindingKind, number>
  );

  const truncated = ledger.length >= SCAN_LIMIT || notes.length >= SCAN_LIMIT;
  const notesOut: string[] = [];
  if (truncated) {
    notesOut.push(
      `Scan capped at ${SCAN_LIMIT} records per collection, so these totals are a floor rather than the full picture.`
    );
  }
  notesOut.push("Underpriced procedures are listed for review but excluded from the recoverable total.");

  return {
    scannedAt: new Date().toISOString(),
    clinicId,
    totals,
    counts,
    findings,
    truncated,
    notes: notesOut,
  };
}

/** Load a clinic's records and run every detector. Returns a ranked report. */
export async function scanForLostRevenue(clinicId: string): Promise<RecoveryReport> {
  const [ledger, notes, services, patients] = await Promise.all([
    readCollection(clinicId, "ledger"),
    readCollection(clinicId, "clinical_notes"),
    readCollection(clinicId, "services"),
    readCollection(clinicId, "patients"),
  ]);

  const patientNameById = new Map<string, string>(
    patients
      .map((p): [string, string] => [String(p.id), String(p.name || "")])
      .filter(([, name]) => name)
  );

  return analyzeRecovery(clinicId, ledger, notes, services, patientNameById);
}
