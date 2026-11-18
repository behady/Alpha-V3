/** Days and months as the company-sheet screens print them, in the reader's language. */

const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/** "14 Nov" / "١٤ نوفمبر"; "" for no day. */
export function dayLabel(ymd: string, ar: boolean): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  return new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(utc(ymd));
}

/** "November 2026". */
export function monthLabel(month: string, ar: boolean): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  return new Intl.DateTimeFormat(ar ? "ar-EG" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(utc(`${month}-01`));
}

/** "Nov" / "نوفمبر". */
export function monthShort(month: string, ar: boolean): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  return new Intl.DateTimeFormat(ar ? "ar-EG" : "en-US", { month: ar ? "long" : "short", timeZone: "UTC" }).format(utc(`${month}-01`));
}

export function money(n: number, ar: boolean): string {
  return n.toLocaleString(ar ? "ar-EG" : "en-US", { maximumFractionDigits: 2 });
}

/** Fill `{name}` slots. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
