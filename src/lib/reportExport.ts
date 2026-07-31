import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

function escapeCsvCell(cell: string | number | null | undefined): string {
  const s = cell === null || cell === undefined ? "" : String(cell);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const lines = [headers.map(escapeCsvCell).join(","), ...rows.map((r) => r.map(escapeCsvCell).join(","))];
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadPdfTable(
  title: string,
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  metaLines?: string[]
) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 14;
  doc.setFontSize(14);
  doc.text(title, 14, y);
  y += 8;
  if (metaLines?.length) {
    doc.setFontSize(9);
    metaLines.forEach((line) => {
      doc.text(line, 14, y);
      y += 5;
    });
    y += 2;
  }
  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))),
    startY: y,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] },
  });
  const name = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  doc.save(name);
}
