/**
 * Treatment plans: proposed, accepted, and actually done.
 *
 * The biggest leak in most clinics is not a patient who never came — it is one who was shown a
 * plan, said yes, and then had a third of it. Plans carry their steps and a total; the ledger
 * carries what was done. Nothing links the two, so "realised" is read the only honest way there
 * is: treatment rows for the same patient, for a service the plan named, dated on or after the
 * plan — capped at the plan's total, because the ledger will happily show more than was planned.
 *
 * Pure. No React, no database.
 */

import { rowDate, type ReportLedgerRow } from "@/lib/reportPatients";
import { monthKeyOf, type MonthKey } from "@/lib/reports/periods";
import { toYmd } from "@/lib/reports/patientStats";

export type PlanDoc = Record<string, unknown>;

export const PLAN_STATUSES = ["draft", "presented", "accepted", "declined"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export type PlanLine = {
  id: string;
  patientId: string;
  patientName: string;
  title: string;
  status: PlanStatus;
  doctorName: string;
  source: string;
  created: string;
  total: number;
  steps: number;
  realized: number;
  realizedPct: number | null;
  remaining: number;
};

export type PlanStats = {
  total: number;
  byStatus: { status: PlanStatus; count: number; value: number }[];
  /** accepted / (presented + accepted + declined) — drafts were never shown to anyone. */
  acceptancePct: number | null;
  acceptedValue: number;
  realizedValue: number;
  remainingValue: number;
  realizedPct: number | null;
  byDoctor: { doctor: string; plans: number; accepted: number; acceptancePct: number | null; value: number; realized: number }[];
  byMonth: { month: MonthKey; presented: number; accepted: number; value: number; realized: number }[];
  lines: PlanLine[];
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number) => Number(n.toFixed(2));

function statusOf(p: PlanDoc): PlanStatus {
  const s = String(p.status || "draft");
  return (PLAN_STATUSES as readonly string[]).includes(s) ? (s as PlanStatus) : "draft";
}

export function planStats(plans: readonly PlanDoc[], ledger: readonly ReportLedgerRow[], months: readonly MonthKey[], unassigned = "—"): PlanStats {
  // Treatment rows per patient, oldest first, so a plan's realisation can be read off them.
  const byPatient = new Map<string, { date: string; serviceId: string; amount: number }[]>();
  for (const row of ledger) {
    if (String(row.type) !== "procedure") continue;
    const pid = String(row.patientId || "");
    if (!pid) continue;
    const list = byPatient.get(pid) || [];
    list.push({ date: rowDate(row), serviceId: String(row.serviceId || ""), amount: num(row.cost) || num(row.amount) });
    byPatient.set(pid, list);
  }

  const lines: PlanLine[] = plans.map((p) => {
    const status = statusOf(p);
    const steps = Array.isArray(p.steps) ? (p.steps as { serviceId?: unknown }[]) : [];
    const wanted = new Set(steps.map((s) => String(s.serviceId || "")).filter(Boolean));
    const created = toYmd(p.createdAt);
    const total = num(p.total);
    const pid = String(p.patientId || "");
    let realized = 0;
    if (status === "accepted" && wanted.size) {
      for (const proc of byPatient.get(pid) || []) {
        if (proc.date && created && proc.date < created) continue;
        if (wanted.has(proc.serviceId)) realized += proc.amount;
      }
      realized = Math.min(realized, total);
    }
    return {
      id: String(p.id || ""),
      patientId: pid,
      patientName: String(p.patientName || "").trim(),
      title: String(p.title || "").trim(),
      status,
      doctorName: String(p.doctorName || "").replace(/^Dr\.?\s*/i, "").trim() || unassigned,
      source: String(p.source || "manual"),
      created,
      total: money(total),
      steps: steps.length,
      realized: money(realized),
      realizedPct: status === "accepted" && total > 0 ? Number(((realized / total) * 100).toFixed(0)) : null,
      remaining: status === "accepted" ? money(Math.max(0, total - realized)) : 0,
    };
  });

  const byStatus = PLAN_STATUSES.map((status) => {
    const of = lines.filter((l) => l.status === status);
    return { status, count: of.length, value: money(of.reduce((s, l) => s + l.total, 0)) };
  });
  const shown = lines.filter((l) => l.status !== "draft");
  const accepted = lines.filter((l) => l.status === "accepted");
  const acceptedValue = money(accepted.reduce((s, l) => s + l.total, 0));
  const realizedValue = money(accepted.reduce((s, l) => s + l.realized, 0));

  const doctors = new Map<string, { doctor: string; plans: number; accepted: number; shown: number; value: number; realized: number }>();
  for (const l of lines) {
    const d = doctors.get(l.doctorName) || { doctor: l.doctorName, plans: 0, accepted: 0, shown: 0, value: 0, realized: 0 };
    d.plans += 1;
    if (l.status !== "draft") d.shown += 1;
    if (l.status === "accepted") {
      d.accepted += 1;
      d.value += l.total;
      d.realized += l.realized;
    }
    doctors.set(l.doctorName, d);
  }

  const idx = new Map(months.map((m, i) => [m, i]));
  const byMonth = months.map((month) => ({ month, presented: 0, accepted: 0, value: 0, realized: 0 }));
  for (const l of lines) {
    const i = idx.get(monthKeyOf(l.created));
    if (i === undefined) continue;
    if (l.status !== "draft") byMonth[i].presented += 1;
    if (l.status === "accepted") {
      byMonth[i].accepted += 1;
      byMonth[i].value += l.total;
      byMonth[i].realized += l.realized;
    }
  }

  return {
    total: lines.length,
    byStatus,
    acceptancePct: shown.length ? Number(((accepted.length / shown.length) * 100).toFixed(1)) : null,
    acceptedValue,
    realizedValue,
    remainingValue: money(acceptedValue - realizedValue),
    realizedPct: acceptedValue > 0 ? Number(((realizedValue / acceptedValue) * 100).toFixed(1)) : null,
    byDoctor: [...doctors.values()]
      .map(({ shown: s, ...d }) => ({ ...d, value: money(d.value), realized: money(d.realized), acceptancePct: s ? Number(((d.accepted / s) * 100).toFixed(1)) : null }))
      .sort((a, b) => b.value - a.value),
    byMonth: byMonth.map((m) => ({ ...m, value: money(m.value), realized: money(m.realized) })),
    lines: lines.sort((a, b) => b.remaining - a.remaining || b.total - a.total),
  };
}
