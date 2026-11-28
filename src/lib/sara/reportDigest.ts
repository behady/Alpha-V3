import type { DocColumn, DocRow, DocSection, ReportDoc } from "@/lib/reports/documents";

/**
 * A finished report, cut down to what the assistant needs to put it into words.
 *
 * The report itself is built by lib/reports, the same arithmetic the Reports page shows. What
 * the model receives is the headline figures and the first few rows of each table, with a count
 * of how many rows there are. The full tables go to the person as a PDF and never pass through
 * the model, so a clinic with 300 debtors costs the same to ask about as one with three.
 */

export type DigestSection =
  | { title: string; note?: string; columns: string[]; rows: string[][]; total?: string[]; rowCount: number; shown: number }
  | { title: string; note?: string; lines: { label: string; value: string }[]; rowCount: number; shown: number }
  | { note: string };

export type ReportDigest = {
  report: string;
  title: string;
  period: string;
  figures: { label: string; value: string; change?: string }[];
  sections: DigestSection[];
  /** True when at least one table has more rows than were shown. */
  moreInPdf: boolean;
};

export type PdfSection = { heading?: string; columns?: string[]; rows?: string[][]; note?: string };

const fmtNumber = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-US") : Number(n.toFixed(2)).toLocaleString("en-US"));

function cell(value: DocRow[string], column: DocColumn): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (column.kind === "pct") return `${Number(value.toFixed(1))}%`;
    if (column.kind === "money") return Math.round(value).toLocaleString("en-US");
    return fmtNumber(value);
  }
  return String(value);
}

function tableRow(row: DocRow, columns: DocColumn[]): string[] {
  return columns.map((c) => cell(row[c.key], c));
}

function digestSection(section: DocSection, maxRows: number): DigestSection | null {
  switch (section.type) {
    case "table": {
      const rows = section.rows.slice(0, maxRows).map((r) => tableRow(r, section.columns));
      return {
        title: section.title,
        ...(section.note ? { note: section.note } : {}),
        columns: section.columns.map((c) => c.label),
        rows,
        ...(section.total ? { total: tableRow(section.total, section.columns) } : {}),
        rowCount: section.rows.length,
        shown: rows.length,
      };
    }
    case "bars": {
      const lines = section.rows.slice(0, maxRows).map((r) => ({ label: r.label, value: r.text }));
      return { title: section.title, ...(section.note ? { note: section.note } : {}), lines, rowCount: section.rows.length, shown: lines.length };
    }
    case "statement": {
      const lines = section.lines.map((l) => ({ label: l.label, value: `${l.kind === "minus" ? "−" : ""}${Math.round(l.value).toLocaleString("en-US")}` }));
      return { title: section.title, lines, rowCount: lines.length, shown: lines.length };
    }
    case "months": {
      const lines = section.points.map((p) => ({ label: p.label, value: section.unit === "pct" ? `${Number(p.value.toFixed(1))}%` : Math.round(p.value).toLocaleString("en-US") }));
      return { title: section.title, ...(section.note ? { note: section.note } : {}), lines, rowCount: lines.length, shown: lines.length };
    }
    case "heat": {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const top = [...section.cells].filter((c) => c.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);
      const lines = top.map((c) => ({ label: `${days[c.weekday] || c.weekday} ${String(c.hour).padStart(2, "0")}:00`, value: Math.round(c.value).toLocaleString("en-US") }));
      return { title: section.title, ...(section.note ? { note: section.note } : {}), lines, rowCount: section.cells.length, shown: lines.length };
    }
    case "note":
      return section.text.trim() ? { note: section.text } : null;
  }
}

export function digestReportDoc(doc: ReportDoc, maxRows = 10): ReportDigest {
  const sections = doc.sections.map((s) => digestSection(s, maxRows)).filter((s): s is DigestSection => s !== null);
  return {
    report: doc.id,
    title: doc.title,
    period: doc.allTime ? "all time" : doc.range.label,
    figures: doc.figures.map((f) => ({ label: f.label, value: f.value, ...(f.delta ? { change: f.delta.text } : {}) })),
    sections,
    moreInPdf: sections.some((s) => "rowCount" in s && s.rowCount > s.shown),
  };
}

/** The whole report as plain table sections, for the PDF. Never sent to the model. */
export function docToPdfSections(doc: ReportDoc, maxRows = 400): PdfSection[] {
  const out: PdfSection[] = [];
  if (doc.figures.length > 0) {
    out.push({ heading: doc.title, columns: ["", ""], rows: doc.figures.map((f) => [f.label, f.delta ? `${f.value}  (${f.delta.text})` : f.value]) });
  }
  for (const section of doc.sections) {
    if (section.type === "table") {
      const rows = section.rows.slice(0, maxRows).map((r) => tableRow(r, section.columns));
      if (section.total) rows.push(tableRow(section.total, section.columns));
      const cut = section.rows.length > maxRows ? `${section.rows.length - maxRows} more rows not printed.` : "";
      const note = [section.note, cut].filter(Boolean).join(" ");
      out.push({ heading: section.title, columns: section.columns.map((c) => c.label), rows, ...(note ? { note } : {}) });
    } else if (section.type === "bars") {
      out.push({ heading: section.title, columns: ["", ""], rows: section.rows.slice(0, maxRows).map((r) => [r.label, r.text]), ...(section.note ? { note: section.note } : {}) });
    } else if (section.type === "statement") {
      out.push({ heading: section.title, columns: ["", ""], rows: section.lines.map((l) => [l.label, `${l.kind === "minus" ? "−" : ""}${Math.round(l.value).toLocaleString("en-US")}`]) });
    } else if (section.type === "months") {
      out.push({ heading: section.title, columns: ["", ""], rows: section.points.map((p) => [p.label, section.unit === "pct" ? `${Number(p.value.toFixed(1))}%` : Math.round(p.value).toLocaleString("en-US")]), ...(section.note ? { note: section.note } : {}) });
    } else if (section.type === "note" && section.text.trim()) {
      out.push({ note: section.text });
    }
  }
  return out;
}
