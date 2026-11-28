import { printSrcDoc } from "@/lib/printSrcDoc";

/**
 * The full tables behind one of the assistant's ready-made answers, as a printable page.
 *
 * The chat reply carries the sums and the first few lines. Everything else (every payment, every
 * debtor) arrives beside the reply as plain table sections that never went through the model, and
 * this lays them out for the print dialog, where "Save as PDF" is one tap. Printed by the browser
 * rather than drawn with a PDF library because the browser shapes Arabic correctly on its own.
 *
 * Every cell is escaped here: the rows are clinic data (names, notes), never markup.
 */

export type PrintableSection = { heading?: string; columns?: string[]; rows?: string[][]; note?: string };
export type PrintableReport = { title: string; subtitle?: string; language: "ar" | "en"; sections: PrintableSection[] };

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** A cell that is only a number (with separators, a sign or a percent) is set like a figure. */
const isFigure = (s: string) => /^[−-]?[\d,]+(\.\d+)?%?$/.test(s.trim());

export function reportHtml(report: PrintableReport, clinicName?: string): string {
  const ar = report.language === "ar";
  const printedOn = new Date().toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "long", year: "numeric" });

  const sections = report.sections
    .map((s) => {
      const head = s.heading ? `<h2>${esc(s.heading)}</h2>` : "";
      const note = s.note ? `<p class="note">${esc(s.note)}</p>` : "";
      if (!s.rows || s.rows.length === 0) return head || note ? `<section>${head}${note}</section>` : "";
      const cols = s.columns && s.columns.some((c) => c.trim()) ? `<thead><tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>` : "";
      const body = s.rows.map((r) => `<tr>${r.map((c) => `<td${isFigure(c) ? ' class="num"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("");
      return `<section>${head}<table>${cols}<tbody>${body}</tbody></table>${note}</section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8" />
<title>${esc(report.title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #16150f; font-size: 12px; line-height: 1.5; }
  header { border-bottom: 2px solid #16150f; padding-bottom: 10px; margin-bottom: 16px; }
  .clinic { font-size: 11px; letter-spacing: .08em; color: #696860; }
  h1 { font-size: 20px; margin: 4px 0 0; }
  .meta { font-size: 11px; color: #696860; margin-top: 3px; }
  section { margin-bottom: 18px; }
  h2 { font-size: 13px; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: start; font-size: 10.5px; color: #696860; font-weight: 600; border-bottom: 1px solid #16150f; padding: 5px 6px; }
  td { padding: 5px 6px; border-bottom: 1px solid #e3e2da; vertical-align: top; overflow-wrap: anywhere; }
  td.num { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr { break-inside: avoid; }
  .note { font-size: 10.5px; color: #696860; margin: 6px 0 0; }
</style>
</head>
<body>
  <header>
    ${clinicName ? `<div class="clinic">${esc(clinicName)}</div>` : ""}
    <h1>${esc(report.title)}</h1>
    <div class="meta">${esc([report.subtitle, printedOn].filter(Boolean).join(" · "))}</div>
  </header>
  ${sections}
</body>
</html>`;
}

export async function printAssistantReport(report: PrintableReport, clinicName?: string): Promise<void> {
  if (typeof document === "undefined") return;
  await printSrcDoc(reportHtml(report, clinicName), "Assistant report");
}
