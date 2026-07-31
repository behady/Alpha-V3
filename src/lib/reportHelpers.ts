export const getFirstDay = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
export const getToday = () => new Date().toISOString().split("T")[0];

export function cleanName(value: unknown, fallback = "Unknown"): string {
  const v = String(value ?? "").trim();
  if (!v || v === "undefined" || v === "null") return fallback;
  return v;
}

export function normalizeDoctorName(value: string) {
  return cleanName(value, "").replace(/^dr\.?\s*/i, "").toLowerCase();
}
