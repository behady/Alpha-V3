import * as XLSX from 'xlsx';

export const CHART_COLORS = [
  "#60d297",
  "#f39c12",
  "#EB5757",
  "#56CCF2",
  "#27ae60",
  "#FFD700",
  "#17ABC0",
  "#4eb37f"
];

export function parseMoney(v: unknown): number {
  return Number(v ?? 0) || 0;
}
/**
 * Exports an array of objects to an Excel file.
 * @param data Array of objects (each object is a row, keys are column headers)
 * @param filename Name of the file (without .xlsx extension)
 * @param isAr Boolean indicating if the report is in Arabic (sets RTL)
 */
export function exportToExcel(data: Record<string, any>[], filename: string, isAr: boolean = false) {
  if (data.length === 0) {
    console.warn("No data to export");
    return;
  }
  const worksheet = XLSX.utils.json_to_sheet(data);
  
  // Apply RTL view if Arabic
  if (isAr) {
    if (!worksheet['!views']) {
      worksheet['!views'] = [];
    }
    worksheet['!views'].push({ rightToLeft: true });
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  
  XLSX.writeFile(workbook, `${filename}.xlsx`);
}
