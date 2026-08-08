import { adminClinicCollection } from "@/lib/adminClinicDb";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

/**
 * Aggregates for questions like "how many crowns did Dr Ahmed do last month".
 *
 * The counting happens here, in code, and the model only gets the finished numbers to phrase.
 * Handing an LLM a pile of rows and asking it to total them produces arithmetic nobody can check,
 * which is the wrong failure mode for a figure someone will act on — the same reasoning the
 * revenue engine documents.
 *
 * Every result carries a `coverage` block. Historical records predate `doctorId` and `serviceIds`,
 * and some rows were written by paths that never set a doctor at all, so a plain GROUP BY silently
 * drops them and returns a total that looks complete. Coverage makes the omission part of the
 * answer instead of an invisible undercount.
 */

export type ReportMetric = "procedure_count" | "revenue" | "appointment_count";
export type ReportGroupBy = "doctor" | "service" | "none";

export interface ReportGroup {
  key: string;
  label: string;
  value: number;
}

export interface ClinicReport {
  metric: ReportMetric;
  groupBy: ReportGroupBy;
  startDate: string;
  endDate: string;
  total: number;
  groups: ReportGroup[];
  coverage: {
    recordsConsidered: number;
    /** Records that could not be attributed to a group and are excluded from `groups`. */
    unattributed: number;
    /** Free-text procedure names that matched no price-list entry, where relevant. */
    unmatchedProcedureNames: string[];
  };
  notes: string[];
}

const SCAN_LIMIT = 4000;

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function inRange(dateStr: unknown, start: string, end: string): boolean {
  if (typeof dateStr !== "string" || !dateStr) return false;
  const key = dateStr.slice(0, 10);
  return key >= start && key <= end;
}

/** Payments carry their value on `paid`; procedures on `amount`/`cost`. */
function rowAmount(row: Record<string, unknown>): number {
  return String(row.type) === "payment"
    ? toNumber(row.paid ?? row.amount)
    : toNumber(row.amount ?? row.cost);
}

export async function runClinicReport(args: {
  clinicId: string;
  metric: ReportMetric;
  groupBy: ReportGroupBy;
  startDate: string;
  endDate: string;
}): Promise<ClinicReport> {
  const { clinicId, metric, groupBy, startDate, endDate } = args;
  const notes: string[] = [];

  // Staff and services are only needed to turn ids into names.
  const [staffSnap, servicesSnap] = await Promise.all([
    adminClinicCollection(clinicId, "staff").limit(500).get(),
    adminClinicCollection(clinicId, "services").limit(1000).get(),
  ]);

  const staffNames = new Map<string, string>();
  staffSnap.forEach((doc) => {
    const n = (doc.data() || {}).name;
    if (typeof n === "string" && n.trim()) staffNames.set(doc.id, n.trim());
  });

  const serviceNames = new Map<string, string>();
  servicesSnap.forEach((doc) => {
    const n = (doc.data() || {}).name;
    if (typeof n === "string" && n.trim()) serviceNames.set(doc.id, n.trim());
  });

  const groups = new Map<string, { label: string; value: number }>();
  const unmatched = new Set<string>();
  let considered = 0;
  let unattributed = 0;
  let total = 0;

  const add = (key: string, label: string, value: number) => {
    const row = groups.get(key) || { label, value: 0 };
    row.value += value;
    groups.set(key, row);
  };

  if (metric === "appointment_count") {
    const snap = await adminClinicCollection(clinicId, "appointments").limit(SCAN_LIMIT).get();
    snap.forEach((doc) => {
      const d = (doc.data() || {}) as Record<string, unknown>;
      if (!inRange(d.date, startDate, endDate)) return;
      // A cancelled appointment is not work done.
      const status = normalizeAppointmentStatus(typeof d.status === "string" ? d.status : "");
      if (status === "Cancelled") return;

      considered++;
      total++;

      if (groupBy === "none") return;
      if (groupBy === "doctor") {
        const id = typeof d.doctorId === "string" ? d.doctorId : "";
        if (!id) {
          unattributed++;
          return;
        }
        add(id, staffNames.get(id) || id, 1);
      } else {
        // Appointments carry no service reference; grouping them by service is not answerable.
        unattributed++;
      }
    });

    if (groupBy === "service") {
      notes.push("Appointments do not record which service was performed, so they cannot be grouped by procedure. Ask about procedures instead, which come from clinical notes.");
    }
  } else {
    // Both remaining metrics come from clinical notes: they are the record of work actually done,
    // and unlike the ledger they exist even when a procedure was never billed.
    const snap = await adminClinicCollection(clinicId, "clinical_notes").limit(SCAN_LIMIT).get();

    snap.forEach((doc) => {
      const d = (doc.data() || {}) as Record<string, unknown>;
      if (!inRange(d.date, startDate, endDate)) return;

      considered++;
      const serviceIds = Array.isArray(d.serviceIds) ? (d.serviceIds as string[]) : [];
      const unmatchedHere = Array.isArray(d.unmatchedProcedures) ? (d.unmatchedProcedures as string[]) : [];
      unmatchedHere.forEach((n) => unmatched.add(String(n)));

      const value = metric === "revenue" ? rowAmount(d) : Math.max(serviceIds.length, 1);
      total += value;

      if (groupBy === "none") return;

      if (groupBy === "doctor") {
        const id = typeof d.doctorId === "string" ? d.doctorId : "";
        // doctorId used to be filled with a display name, so anything that is not a known staff
        // id cannot be trusted as an identity and is reported as unattributed rather than
        // becoming its own phantom "doctor".
        if (!id || !staffNames.has(id)) {
          unattributed++;
          return;
        }
        add(id, staffNames.get(id) as string, value);
        return;
      }

      // groupBy === "service"
      if (serviceIds.length === 0) {
        unattributed++;
        return;
      }
      if (metric === "revenue") {
        // Split evenly across the procedures on the note; the note stores one combined cost.
        const share = value / serviceIds.length;
        serviceIds.forEach((id) => add(id, serviceNames.get(id) || id, share));
      } else {
        serviceIds.forEach((id) => add(id, serviceNames.get(id) || id, 1));
      }
    });
  }

  const groupRows: ReportGroup[] = Array.from(groups.entries())
    .map(([key, row]) => ({ key, label: row.label, value: Math.round(row.value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);

  if (unattributed > 0) {
    notes.push(
      `${unattributed} of ${considered} records could not be attributed and are excluded from the ` +
        "breakdown, so the grouped figures add up to less than the total. Records created before " +
        "this system started storing doctor and service references are the usual cause."
    );
  }
  if (unmatched.size > 0) {
    notes.push(
      `These procedure names matched no entry in the price list and are not counted by service: ${Array.from(unmatched).join(", ")}.`
    );
  }
  if (considered === 0) {
    notes.push("No records fall in that date range.");
  }

  return {
    metric,
    groupBy,
    startDate,
    endDate,
    total: Math.round(total * 100) / 100,
    groups: groupRows,
    coverage: {
      recordsConsidered: considered,
      unattributed,
      unmatchedProcedureNames: Array.from(unmatched),
    },
    notes,
  };
}
