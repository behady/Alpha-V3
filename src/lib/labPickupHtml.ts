/**
 * The handover sheet: what one lab's driver took today, on one page he signs.
 *
 * Firebase-free, like the order sheet, so it can be tested and rendered without a browser. The
 * same two rules as every paper that leaves for a lab: the patient is a first name plus the code,
 * and nothing a person typed reaches the page unescaped.
 */

import { workTypeLabel, type LabCase } from "@/lib/labCases";
import { esc, palmerListHtml, type LabOrderClinic } from "@/lib/labOrderHtml";
import { caseCountWord } from "@/lib/labRounds";

const INK = "#14171A";
const MUTED = "#6A716F";
const RULE = "#D9DCD8";

function fmtDate(iso: string | undefined, language: "en" | "ar"): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function buildPickupSheetSrcDoc(options: {
  labName: string;
  cases: LabCase[];
  clinic: LabOrderClinic;
  language: "en" | "ar";
  /** The day of the handover, YYYY-MM-DD. */
  date: string;
}): string {
  const { labName, cases, clinic, language, date } = options;
  const isAr = language === "ar";
  const bi = (en: string, ar: string) => (isAr ? `${ar} · ${en}` : `${en} · ${ar}`);
  const start = isAr ? "right" : "left";
  const th = `padding:6px 8px;font-size:6.5pt;letter-spacing:0.09em;text-transform:uppercase;color:${MUTED};text-align:${start};border-bottom:1.5px solid ${INK};`;
  const td = `padding:8px;font-size:9.5pt;color:${INK};border-bottom:1px solid ${RULE};vertical-align:middle;text-align:${start};`;

  const rows = cases
    .map(
      (c, i) => `<tr>
        <td style="${td}width:26px;color:${MUTED};">${i + 1}</td>
        <td style="${td}font-weight:800;white-space:nowrap;"><span dir="ltr">${esc(c.code)}</span></td>
        <td style="${td}">${esc(c.patientFirstName || "—")}</td>
        <td style="${td}">${esc(workTypeLabel(c.workType, "en"))}${c.units ? ` × ${esc(c.units)}` : ""}</td>
        <td style="${td}font-weight:700;"><span dir="ltr">${c.teeth.length ? palmerListHtml(c.teeth) : "—"}</span></td>
        <td style="${td}white-space:nowrap;">${esc(fmtDate(c.dueDate, language))}</td>
      </tr>`
    )
    .join("");

  const signatures = ["Handed over by|سلّمها", "Driver signature|توقيع المندوب", "Date &amp; time|التاريخ والوقت"]
    .map((pair) => {
      const [en, ar] = pair.split("|");
      return `<td style="width:33.33%;padding-${isAr ? "left" : "right"}:14px;vertical-align:bottom;">
        <div style="border-bottom:1px solid ${INK};height:26px;"></div>
        <div style="font-size:6.5pt;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-top:3px;">${en} · ${ar}</div>
      </td>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="${isAr ? "ar" : "en"}" dir="${isAr ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8" />
<title>${esc(labName)} · ${esc(date)}</title>
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #FFFFFF; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Tajawal, 'Segoe UI', Arial, sans-serif; color: ${INK}; }
  table { border-collapse: collapse; width: 100%; }
  tr { break-inside: avoid; }
</style>
</head>
<body>
  <table style="border-bottom:2px solid ${INK};">
    <tr>
      <td style="vertical-align:top;padding-bottom:8px;">
        <div style="font-size:14pt;font-weight:800;line-height:1.1;">${esc(clinic.name || "—")}</div>
        <div style="font-size:6.5pt;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-top:2px;">
          ${esc([clinic.branchName, clinic.phone].filter(Boolean).join(" · "))}
        </div>
      </td>
      <td style="vertical-align:top;padding-bottom:8px;text-align:${isAr ? "left" : "right"};">
        <div style="font-size:6.5pt;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">${esc(bi("Handover to the lab", "تسليم للمعمل"))}</div>
        <div style="font-size:13pt;font-weight:800;margin-top:2px;">${esc(labName || "—")}</div>
        <div style="font-size:8.5pt;font-weight:600;color:${MUTED};margin-top:1px;">${esc(fmtDate(date, language))}</div>
      </td>
    </tr>
  </table>

  <table style="margin-top:10px;">
    <tr>
      <th style="${th}">#</th>
      <th style="${th}">${esc(bi("Code", "الكود"))}</th>
      <th style="${th}">${esc(bi("Patient", "المريض"))}</th>
      <th style="${th}">${esc(bi("Work", "الشغل"))}</th>
      <th style="${th}">${esc(bi("Teeth", "الأسنان"))}</th>
      <th style="${th}">${esc(bi("Due back", "ميعاد الرجوع"))}</th>
    </tr>
    ${rows}
  </table>

  <div style="margin-top:10px;font-size:10pt;font-weight:800;">
    ${esc(isAr ? `الإجمالي: ${caseCountWord(cases.length, "ar")}` : `Total: ${caseCountWord(cases.length, "en")}`)}
  </div>

  <table style="margin-top:26px;"><tr>${signatures}</tr></table>
</body>
</html>`;
}
