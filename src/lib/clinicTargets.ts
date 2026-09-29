/** The clinic's monthly goals: `settings/targets`, read by the owner's home and written by Settings. */

export const TARGETS_DOC = "targets";

export type ClinicTargets = { monthlyRevenue: number; monthlyNewPatients: number };

export function parseTargets(data: Record<string, unknown> | undefined | null): ClinicTargets {
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
  };
  return { monthlyRevenue: n(data?.monthlyRevenue), monthlyNewPatients: n(data?.monthlyNewPatients) };
}
