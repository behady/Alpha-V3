/**
 * The patient-base reports: who comes back, who is worth what, who is due, and who they are.
 *
 * Pure functions over plain rows. "A visit" here means a day on which a patient had a treatment
 * or paid — the ledger is the one record every clinic keeps completely — plus, where the caller
 * passes appointments, a day they were seen (checked in or further). Nothing is estimated.
 */

import { ledgerCashValue } from "@/lib/reportHelpers";
import { rowDate, type ReportLedgerRow } from "@/lib/reportPatients";
import { attributeService, buildProcedureIndex, type AttributableRow } from "@/lib/serviceAttribution";
import { daysBetween, monthsApart } from "@/lib/reports/periods";
import { normalizeAppointmentStatus } from "@/lib/appointmentStages";

export type PatientDoc = {
  id: string;
  name?: string;
  phone?: string;
  referral?: string;
  source?: string;
  gender?: string;
  dateOfBirth?: unknown;
  age?: unknown;
  createdAt?: unknown;
  whatsappOptOut?: unknown;
  recallSentAt?: unknown;
  recallCount?: unknown;
};

export type AppointmentDoc = Record<string, unknown>;

/** Statuses meaning the patient was actually in the clinic. Same set as ownerHome's SEEN. */
export const ATTENDED = new Set(["Checked In", "In Chair", "Checking Out", "Completed"]);

export function wasAttended(appointment: AppointmentDoc): boolean {
  return ATTENDED.has(normalizeAppointmentStatus(String(appointment.status || "")));
}

export function toYmd(value: unknown): string {
  if (!value) return "";
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
    } catch {
      return "";
    }
  }
  if (typeof value === "number") return new Date(value).toISOString().slice(0, 10);
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Every day each patient was seen, from ledger rows and attended appointments. */
export function visitDays(ledger: readonly ReportLedgerRow[], appointments: readonly AppointmentDoc[] = []): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (pid: string, day: string) => {
    if (!pid || !day) return;
    let s = out.get(pid);
    if (!s) {
      s = new Set();
      out.set(pid, s);
    }
    s.add(day);
  };
  for (const row of ledger) {
    if (String(row.type) === "expense") continue;
    add(String(row.patientId || ""), rowDate(row));
  }
  for (const a of appointments) {
    if (!wasAttended(a)) continue;
    add(String(a.patientId || ""), toYmd(a.date));
  }
  return out;
}

// --- retention -----------------------------------------------------------------------------------

export type Retention = {
  /** Patients active in the earlier window. */
  before: number;
  /** Of those, active again in the later window. */
  retained: number;
  lost: number;
  /** Active in the later window with no visit in the earlier one. */
  newcomers: number;
  retentionPct: number | null;
  /** New files opened in the earlier window who came back in the later one. */
  newReturned: { opened: number; returned: number; pct: number | null };
  /** Median months between consecutive visits, over patients with two or more. */
  medianGapMonths: number | null;
  /** Months since last visit, bucketed, for the whole base seen in either window. */
  lastSeen: { label: string; count: number }[];
  lostPatients: string[];
};

export function retention(
  ledger: readonly ReportLedgerRow[],
  appointments: readonly AppointmentDoc[],
  patients: readonly PatientDoc[],
  earlier: { start: string; end: string },
  later: { start: string; end: string },
  today: string,
): Retention {
  const days = visitDays(ledger, appointments);
  const inWin = (s: Set<string>, w: { start: string; end: string }) => [...s].some((d) => d >= w.start && d <= w.end);

  const before = new Set<string>();
  const after = new Set<string>();
  for (const [pid, s] of days) {
    if (inWin(s, earlier)) before.add(pid);
    if (inWin(s, later)) after.add(pid);
  }
  const retained = [...before].filter((p) => after.has(p));
  const lost = [...before].filter((p) => !after.has(p));
  const newcomers = [...after].filter((p) => !before.has(p));

  const opened = patients.filter((p) => {
    const c = toYmd(p.createdAt);
    return c >= earlier.start && c <= earlier.end;
  });
  const returned = opened.filter((p) => after.has(p.id));

  const gaps: number[] = [];
  for (const s of days.values()) {
    const sorted = [...s].sort();
    for (let i = 1; i < sorted.length; i++) gaps.push(monthsApart(sorted[i - 1], sorted[i]));
  }
  gaps.sort((a, b) => a - b);
  const medianGapMonths = gaps.length ? Number(gaps[Math.floor(gaps.length / 2)].toFixed(1)) : null;

  const buckets = [
    { label: "0-3", max: 3 },
    { label: "3-6", max: 6 },
    { label: "6-12", max: 12 },
    { label: "12-24", max: 24 },
    { label: "24+", max: Infinity },
  ];
  const lastSeen = buckets.map((b) => ({ label: b.label, count: 0 }));
  for (const s of days.values()) {
    const last = [...s].sort().pop()!;
    const months = monthsApart(last, today);
    const i = buckets.findIndex((b) => months < b.max);
    lastSeen[i === -1 ? lastSeen.length - 1 : i].count += 1;
  }

  const name = new Map(patients.map((p) => [p.id, String(p.name || "").trim()]));
  return {
    before: before.size,
    retained: retained.length,
    lost: lost.length,
    newcomers: newcomers.length,
    retentionPct: before.size ? Number(((retained.length / before.size) * 100).toFixed(1)) : null,
    newReturned: { opened: opened.length, returned: returned.length, pct: opened.length ? Number(((returned.length / opened.length) * 100).toFixed(1)) : null },
    medianGapMonths,
    lastSeen,
    lostPatients: lost.map((p) => name.get(p) || p).sort(),
  };
}

// --- lifetime value ------------------------------------------------------------------------------

export type LifetimeLine = {
  patientId: string;
  name: string;
  phone: string;
  source: string;
  firstVisit: string;
  lastVisit: string;
  visits: number;
  procedures: number;
  paid: number;
  perVisit: number;
  /** Months between first and last visit. */
  tenureMonths: number;
};

export type SourceValue = { source: string; patients: number; paid: number; average: number };

export function lifetimeValue(
  ledger: readonly ReportLedgerRow[],
  patients: readonly PatientDoc[],
  unknownSource = "Unknown / Walk-in",
): { lines: LifetimeLine[]; bySource: SourceValue[]; average: number; median: number; distribution: { label: string; count: number }[] } {
  const files = new Map(patients.map((p) => [p.id, p]));
  const days = visitDays(ledger);
  type Acc = { paid: number; procedures: number; name: string };
  const acc = new Map<string, Acc>();
  for (const row of ledger) {
    const type = String(row.type || "");
    if (type === "expense" || type === "income") continue;
    const pid = String(row.patientId || "");
    if (!pid) continue;
    const a = acc.get(pid) || { paid: 0, procedures: 0, name: String(row.patientName || "").trim() };
    if (type === "procedure") a.procedures += 1;
    else a.paid += ledgerCashValue(row);
    acc.set(pid, a);
  }
  const lines: LifetimeLine[] = [];
  for (const [pid, a] of acc) {
    const f = files.get(pid);
    const sorted = [...(days.get(pid) || [])].sort();
    const first = sorted[0] || "";
    const last = sorted[sorted.length - 1] || "";
    const visits = sorted.length;
    lines.push({
      patientId: pid,
      name: String(f?.name || a.name || "").trim(),
      phone: String(f?.phone || "").trim(),
      source: String(f?.referral || f?.source || "").trim() || unknownSource,
      firstVisit: first,
      lastVisit: last,
      visits,
      procedures: a.procedures,
      paid: Number(a.paid.toFixed(2)),
      perVisit: visits ? Number((a.paid / visits).toFixed(2)) : 0,
      tenureMonths: first && last ? Number(monthsApart(first, last).toFixed(1)) : 0,
    });
  }
  lines.sort((x, y) => y.paid - x.paid || y.visits - x.visits);

  const src = new Map<string, SourceValue>();
  for (const l of lines) {
    const s = src.get(l.source) || { source: l.source, patients: 0, paid: 0, average: 0 };
    s.patients += 1;
    s.paid += l.paid;
    src.set(l.source, s);
  }
  const bySource = [...src.values()]
    .map((s) => ({ ...s, paid: Number(s.paid.toFixed(2)), average: Number((s.paid / s.patients).toFixed(2)) }))
    .sort((a, b) => b.average - a.average);

  const paids = lines.map((l) => l.paid).sort((a, b) => a - b);
  const average = paids.length ? Number((paids.reduce((s, v) => s + v, 0) / paids.length).toFixed(2)) : 0;
  const median = paids.length ? paids[Math.floor(paids.length / 2)] : 0;
  const edges = [0, 500, 1000, 2500, 5000, 10000, Infinity];
  const distribution = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    return { label: hi === Infinity ? `${lo.toLocaleString()}+` : `${lo.toLocaleString()}–${hi.toLocaleString()}`, count: paids.filter((p) => p >= lo && p < hi).length };
  });
  return { lines, bySource, average, median, distribution };
}

// --- demographics --------------------------------------------------------------------------------

export const AGE_BANDS = ["0-11", "12-17", "18-25", "26-35", "36-45", "46-60", "60+", "?"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export function ageOf(p: PatientDoc, today: string): number | null {
  const dob = toYmd(p.dateOfBirth);
  if (dob) {
    const years = daysBetween(dob, today) / 365.25;
    return years >= 0 && years < 120 ? Math.floor(years) : null;
  }
  const n = Number(p.age);
  return Number.isFinite(n) && n > 0 && n < 120 ? Math.floor(n) : null;
}

export function ageBand(age: number | null): AgeBand {
  if (age === null) return "?";
  if (age < 12) return "0-11";
  if (age < 18) return "12-17";
  if (age < 26) return "18-25";
  if (age < 36) return "26-35";
  if (age < 46) return "36-45";
  if (age <= 60) return "46-60";
  return "60+";
}

export type Gender = "Male" | "Female" | "?";

export function genderOf(p: PatientDoc): Gender {
  const g = String(p.gender || "").trim().toLowerCase();
  if (g.startsWith("m") || g === "ذكر") return "Male";
  if (g.startsWith("f") || g === "أنثى" || g === "انثى") return "Female";
  return "?";
}

export type Demographics = {
  total: number;
  /** New files in the period, by band. */
  newInPeriod: number;
  bands: { band: AgeBand; count: number; newCount: number; female: number; male: number; paid: number; topServices: { name: string; count: number }[] }[];
  gender: { gender: Gender; count: number; paid: number }[];
  averageAge: number | null;
  known: number;
};

export function demographics(
  patients: readonly PatientDoc[],
  ledger: readonly ReportLedgerRow[],
  range: { start: string; end: string },
  today: string,
): Demographics {
  const bandOf = new Map<string, AgeBand>();
  const genderMap = new Map<string, Gender>();
  const ages: number[] = [];
  const bands = AGE_BANDS.map((band) => ({ band, count: 0, newCount: 0, female: 0, male: 0, paid: 0, services: new Map<string, { name: string; count: number }>() }));
  const gender: Record<Gender, { gender: Gender; count: number; paid: number }> = {
    Male: { gender: "Male", count: 0, paid: 0 },
    Female: { gender: "Female", count: 0, paid: 0 },
    "?": { gender: "?", count: 0, paid: 0 },
  };
  let newInPeriod = 0;
  for (const p of patients) {
    const age = ageOf(p, today);
    if (age !== null) ages.push(age);
    const band = ageBand(age);
    const g = genderOf(p);
    bandOf.set(p.id, band);
    genderMap.set(p.id, g);
    const b = bands[AGE_BANDS.indexOf(band)];
    b.count += 1;
    if (g === "Female") b.female += 1;
    if (g === "Male") b.male += 1;
    gender[g].count += 1;
    const created = toYmd(p.createdAt);
    if (created >= range.start && created <= range.end) {
      newInPeriod += 1;
      b.newCount += 1;
    }
  }
  const procedures = ledger.filter((r) => String(r.type) === "procedure") as AttributableRow[];
  const index = buildProcedureIndex(procedures);
  for (const row of ledger) {
    const type = String(row.type || "");
    const pid = String(row.patientId || "");
    if (!pid) continue;
    const band = bandOf.get(pid);
    const g = genderMap.get(pid);
    if (type === "procedure" && band) {
      const svc = attributeService(row as AttributableRow, index);
      const b = bands[AGE_BANDS.indexOf(band)];
      const s = b.services.get(svc.key) || { name: svc.name, count: 0 };
      s.count += 1;
      b.services.set(svc.key, s);
    } else if (type === "payment") {
      const cash = ledgerCashValue(row);
      if (band) bands[AGE_BANDS.indexOf(band)].paid += cash;
      if (g) gender[g].paid += cash;
    }
  }
  return {
    total: patients.length,
    newInPeriod,
    bands: bands.map(({ services, ...b }) => ({
      ...b,
      paid: Number(b.paid.toFixed(2)),
      topServices: [...services.values()].sort((x, y) => y.count - x.count).slice(0, 3),
    })),
    gender: Object.values(gender).map((g) => ({ ...g, paid: Number(g.paid.toFixed(2)) })),
    averageAge: ages.length ? Number((ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1)) : null,
    known: ages.length,
  };
}

// --- recall due ----------------------------------------------------------------------------------

export type RecallLine = {
  patientId: string;
  name: string;
  phone: string;
  lastVisit: string;
  /** Days past the recall interval. */
  overdueDays: number;
  bucket: "due" | "1-3m" | "3-6m" | "6m+";
  whatsappOptOut: boolean;
  recallSentAt: string;
  recallCount: number;
};

export type RecallDue = {
  intervalMonths: number;
  lines: RecallLine[];
  buckets: { bucket: RecallLine["bucket"]; count: number }[];
  /** Patients skipped because they already have a booking ahead. */
  booked: number;
  /** Patients with no recorded visit at all, who cannot be recalled from a date. */
  neverSeen: number;
};

export function recallDue(
  patients: readonly PatientDoc[],
  ledger: readonly ReportLedgerRow[],
  appointments: readonly AppointmentDoc[],
  today: string,
  intervalMonths: number,
): RecallDue {
  const days = visitDays(ledger, appointments);
  const upcoming = new Set<string>();
  for (const a of appointments) {
    const status = normalizeAppointmentStatus(String(a.status || ""));
    if (status === "Cancelled" || status === "No Show") continue;
    if (toYmd(a.date) >= today) upcoming.add(String(a.patientId || ""));
  }
  const thresholdDays = Math.round(intervalMonths * 30.44);
  const lines: RecallLine[] = [];
  let booked = 0;
  let neverSeen = 0;
  for (const p of patients) {
    const seen = days.get(p.id);
    if (!seen || seen.size === 0) {
      neverSeen += 1;
      continue;
    }
    if (upcoming.has(p.id)) {
      booked += 1;
      continue;
    }
    const last = [...seen].sort().pop()!;
    const since = daysBetween(last, today);
    const overdueDays = since - thresholdDays;
    if (overdueDays < 0) continue;
    lines.push({
      patientId: p.id,
      name: String(p.name || "").trim(),
      phone: String(p.phone || "").trim(),
      lastVisit: last,
      overdueDays,
      bucket: overdueDays <= 30 ? "due" : overdueDays <= 90 ? "1-3m" : overdueDays <= 180 ? "3-6m" : "6m+",
      whatsappOptOut: Boolean(p.whatsappOptOut),
      recallSentAt: toYmd(p.recallSentAt),
      recallCount: Number(p.recallCount) || 0,
    });
  }
  lines.sort((a, b) => a.overdueDays - b.overdueDays);
  const order: RecallLine["bucket"][] = ["due", "1-3m", "3-6m", "6m+"];
  return {
    intervalMonths,
    lines,
    buckets: order.map((bucket) => ({ bucket, count: lines.filter((l) => l.bucket === bucket).length })),
    booked,
    neverSeen,
  };
}
